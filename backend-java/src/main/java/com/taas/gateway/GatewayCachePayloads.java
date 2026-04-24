package com.taas.gateway;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 在写入 Redis 的响应 JSON 顶层附带网关私有字段，返回客户端前剥离；用于缓存命中时落库真实 {@code provider_id} 与路由列。
 *
 * <p>键名以下划线开头，与 OpenAI 响应字段区分；旧缓存无此键时 {@link #unwrap} 的 meta 为 {@code null}。
 */
public final class GatewayCachePayloads {

  public static final String META_KEY = "_taasGatewayCacheMeta";

  public record CacheMeta(String providerId, String routingPrimary, String routingActual, String routingReason) {}

  private GatewayCachePayloads() {}

  /** 将 meta 并入副本；{@code meta} 或 {@code providerId} 为空时返回原 map 引用（不写入 meta）。 */
  public static Map<String, Object> withMeta(Map<String, Object> responseBody, CacheMeta meta) {
    if (responseBody == null || meta == null || meta.providerId() == null || meta.providerId().isBlank()) {
      return responseBody;
    }
    LinkedHashMap<String, Object> out = new LinkedHashMap<>(responseBody);
    LinkedHashMap<String, Object> m = new LinkedHashMap<>();
    m.put("providerId", meta.providerId());
    m.put("routingPrimary", meta.routingPrimary() != null ? meta.routingPrimary() : "");
    m.put("routingActual", meta.routingActual() != null ? meta.routingActual() : "");
    if (meta.routingReason() != null && !meta.routingReason().isBlank()) {
      m.put("routingReason", meta.routingReason());
    }
    out.put(META_KEY, m);
    return out;
  }

  public record Unwrapped(Map<String, Object> body, CacheMeta meta) {}

  @SuppressWarnings("unchecked")
  public static Unwrapped unwrap(Map<String, Object> raw) {
    if (raw == null) {
      return new Unwrapped(null, null);
    }
    Object metaObj = raw.get(META_KEY);
    CacheMeta meta = parseMeta(metaObj);
    LinkedHashMap<String, Object> body = new LinkedHashMap<>(raw);
    body.remove(META_KEY);
    return new Unwrapped(body, meta);
  }

  private static CacheMeta parseMeta(Object metaObj) {
    if (!(metaObj instanceof Map<?, ?> raw)) {
      return null;
    }
    Map<String, Object> map = (Map<String, Object>) raw;
    String pid = stringVal(map.get("providerId"));
    if (pid == null || pid.isBlank()) {
      return null;
    }
    return new CacheMeta(
        pid,
        blankToNull(stringVal(map.get("routingPrimary"))),
        blankToNull(stringVal(map.get("routingActual"))),
        blankToNull(stringVal(map.get("routingReason"))));
  }

  private static String stringVal(Object o) {
    return o == null ? null : String.valueOf(o);
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }
}
