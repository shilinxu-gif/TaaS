package com.taas.gateway;

import com.taas.infra.util.Jsons;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 对非流式 Chat Completions 请求体做稳定子集 + 排序规范化后 SHA-256，用于无 {@code Idempotency-Key} 时的 Redis 指纹缓存键。
 *
 * <p>不包含 {@code stream}/{@code user} 等不参与推理契约或易引入噪声的字段；剔除网关内部调试字段。
 */
public final class ChatCompletionBodyFingerprint {

  private static final String GATEWAY_DEBUG_TRACE = "_gateway_debug_trace_id";

  /** 参与哈希的顶层字段顺序（白名单）。 */
  private static final List<String> CANONICAL_TOP_KEYS =
      List.of(
          "model",
          "messages",
          "max_tokens",
          "max_completion_tokens",
          "temperature",
          "top_p",
          "tools",
          "tool_choice",
          "response_format",
          "frequency_penalty",
          "presence_penalty",
          "stop",
          "seed");

  private ChatCompletionBodyFingerprint() {}

  public static boolean isEligible(Map<String, Object> body) {
    if (body == null || body.isEmpty()) {
      return false;
    }
    if (Boolean.TRUE.equals(body.get("stream"))) {
      return false;
    }
    Object messages = body.get("messages");
    return messages instanceof List<?> list && !list.isEmpty();
  }

  /** @return SHA-256 十六进制小写，无法规范化时 {@code null} */
  public static String sha256Hex(Jsons jsons, Map<String, Object> body) {
    if (!isEligible(body)) {
      return null;
    }
    Map<String, Object> stripped = stripGatewayOnlyKeys(body);
    Map<String, Object> slice = new LinkedHashMap<>();
    for (String key : CANONICAL_TOP_KEYS) {
      if (stripped.containsKey(key)) {
        slice.put(key, deepSortForCanonicalJson(stripped.get(key)));
      }
    }
    if (!slice.containsKey("messages")) {
      return null;
    }
    String canonical = jsons.stringify(slice);
    return sha256HexUtf8(canonical);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> stripGatewayOnlyKeys(Map<String, Object> body) {
    Map<String, Object> copy = new LinkedHashMap<>(body);
    copy.remove(GATEWAY_DEBUG_TRACE);
    return copy;
  }

  private static Object deepSortForCanonicalJson(Object value) {
    if (value instanceof Map<?, ?> raw) {
      TreeMap<String, Object> sorted = new TreeMap<>();
      for (Map.Entry<?, ?> e : raw.entrySet()) {
        String k = String.valueOf(e.getKey());
        if (GATEWAY_DEBUG_TRACE.equals(k)) {
          continue;
        }
        sorted.put(k, deepSortForCanonicalJson(e.getValue()));
      }
      return sorted;
    }
    if (value instanceof List<?> list) {
      List<Object> out = new ArrayList<>(list.size());
      for (Object item : list) {
        out.add(deepSortForCanonicalJson(item));
      }
      return out;
    }
    return value;
  }

  private static String sha256HexUtf8(String text) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(text.getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder(hash.length * 2);
      for (byte b : hash) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
