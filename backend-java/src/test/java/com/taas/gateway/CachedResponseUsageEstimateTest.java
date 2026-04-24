package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;
import org.junit.jupiter.api.Test;

class CachedResponseUsageEstimateTest {

  @Test
  void fromPayloadShouldReadOpenAiUsage() {
    CachedResponseUsageEstimate.Result r =
        CachedResponseUsageEstimate.fromPayload(
            Map.of("usage", Map.of("prompt_tokens", 10, "completion_tokens", 5, "total_tokens", 15)));
    assertEquals(10, r.savedPromptTokens());
    assertEquals(5, r.savedCompletionTokens());
    assertEquals(15, r.savedTokensEstimate());
  }

  @Test
  void fromPayloadShouldDeriveTotalWhenMissing() {
    CachedResponseUsageEstimate.Result r =
        CachedResponseUsageEstimate.fromPayload(
            Map.of("usage", Map.of("prompt_tokens", 3, "completion_tokens", 7)));
    assertEquals(3, r.savedPromptTokens());
    assertEquals(7, r.savedCompletionTokens());
    assertEquals(10, r.savedTokensEstimate());
  }

  @Test
  void fromPayloadShouldReadAnthropicStyleUsage() {
    CachedResponseUsageEstimate.Result r =
        CachedResponseUsageEstimate.fromPayload(
            Map.of("usage", Map.of("input_tokens", 11, "output_tokens", 4)));
    assertEquals(11, r.savedPromptTokens());
    assertEquals(4, r.savedCompletionTokens());
    assertEquals(15, r.savedTokensEstimate());
  }

  @Test
  void fromPayloadShouldReturnNullsWhenNoUsage() {
    CachedResponseUsageEstimate.Result r = CachedResponseUsageEstimate.fromPayload(Map.of("model", "x"));
    assertNull(r.savedPromptTokens());
    assertNull(r.savedCompletionTokens());
    assertNull(r.savedTokensEstimate());
  }
}
