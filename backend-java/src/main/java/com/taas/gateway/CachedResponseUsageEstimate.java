package com.taas.gateway;

import java.util.Map;

/**
 * 从幂等缓存体中解析 usage，用于 {@code api_request_logs.saved_* } 列；与 {@code total_tokens=0} 的计费语义分离。
 */
public final class CachedResponseUsageEstimate {

  private CachedResponseUsageEstimate() {}

  /**
   * @param savedPromptTokens OpenAI prompt_tokens 或 Anthropic input_tokens
   * @param savedCompletionTokens OpenAI completion_tokens 或 Anthropic output_tokens
   * @param savedTokensEstimate 优先 total_tokens，否则 prompt+completion；若完全无 usage 则均为 null
   */
  public record Result(Integer savedPromptTokens, Integer savedCompletionTokens, Integer savedTokensEstimate) {
    static Result empty() {
      return new Result(null, null, null);
    }
  }

  public static Result fromPayload(Map<String, Object> responsePayload) {
    if (responsePayload == null || responsePayload.isEmpty()) {
      return Result.empty();
    }
    Map<String, Object> usage = nestedMap(responsePayload.get("usage"));
    if (usage.isEmpty()) {
      return Result.empty();
    }
    if (usage.containsKey("prompt_tokens")
        || usage.containsKey("completion_tokens")
        || usage.containsKey("total_tokens")) {
      int pt = intValue(usage.get("prompt_tokens"), 0);
      int ct = intValue(usage.get("completion_tokens"), 0);
      int declaredTotal = intValue(usage.get("total_tokens"), 0);
      int total = declaredTotal > 0 ? declaredTotal : pt + ct;
      if (pt == 0 && ct == 0 && total == 0) {
        return Result.empty();
      }
      return new Result(pt, ct, total);
    }
    if (usage.containsKey("input_tokens") || usage.containsKey("output_tokens")) {
      int pt = intValue(usage.get("input_tokens"), 0);
      int ct = intValue(usage.get("output_tokens"), 0);
      int total = pt + ct;
      if (total == 0) {
        return Result.empty();
      }
      return new Result(pt, ct, total);
    }
    return Result.empty();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> nestedMap(Object value) {
    return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
  }

  private static int intValue(Object value, int fallback) {
    if (value == null || "null".equals(String.valueOf(value))) {
      return fallback;
    }
    try {
      return Integer.parseInt(String.valueOf(value));
    } catch (NumberFormatException ignored) {
      return fallback;
    }
  }
}
