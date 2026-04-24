package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.infra.util.Jsons;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ChatCompletionBodyFingerprintTest {

  private final Jsons jsons = new Jsons(new ObjectMapper());

  @Test
  void isEligibleShouldRejectStreamTrue() {
    assertFalse(
        ChatCompletionBodyFingerprint.isEligible(
            Map.of("stream", true, "messages", List.of(Map.of("role", "user", "content", "hi")))));
  }

  @Test
  void isEligibleShouldRequireNonEmptyMessages() {
    assertFalse(ChatCompletionBodyFingerprint.isEligible(Map.of("model", "gpt-4o-mini", "messages", List.of())));
    assertNull(ChatCompletionBodyFingerprint.sha256Hex(jsons, Map.of("model", "x", "messages", List.of())));
  }

  @Test
  void sha256ShouldBeStableRegardlessOfKeyOrderInMessages() {
    Map<String, Object> a = new LinkedHashMap<>();
    a.put("model", "gpt-4o-mini");
    a.put("messages", List.of(Map.of("role", "user", "content", "hello")));
    a.put("temperature", 0.2);
    Map<String, Object> b = new LinkedHashMap<>();
    b.put("messages", List.of(Map.of("content", "hello", "role", "user")));
    b.put("temperature", 0.2);
    b.put("model", "gpt-4o-mini");
    assertEquals(ChatCompletionBodyFingerprint.sha256Hex(jsons, a), ChatCompletionBodyFingerprint.sha256Hex(jsons, b));
  }

  @Test
  void sha256ShouldIgnoreUserAndStream() {
    Map<String, Object> base =
        Map.of(
            "model",
            "gpt-4o-mini",
            "messages",
            List.of(Map.of("role", "user", "content", "x")),
            "temperature",
            0.1);
    Map<String, Object> withExtra = new LinkedHashMap<>(base);
    withExtra.put("user", "u1");
    withExtra.put("stream", false);
    assertEquals(ChatCompletionBodyFingerprint.sha256Hex(jsons, base), ChatCompletionBodyFingerprint.sha256Hex(jsons, withExtra));
  }

  @Test
  void sha256ShouldChangeWhenModelChanges() {
    Map<String, Object> a =
        Map.of("model", "gpt-4o-mini", "messages", List.of(Map.of("role", "user", "content", "x")));
    Map<String, Object> b =
        Map.of("model", "gpt-4o", "messages", List.of(Map.of("role", "user", "content", "x")));
    assertNotEquals(ChatCompletionBodyFingerprint.sha256Hex(jsons, a), ChatCompletionBodyFingerprint.sha256Hex(jsons, b));
  }

  @Test
  void sha256ShouldIgnoreGatewayDebugTraceId() {
    Map<String, Object> clean =
        Map.of("model", "gpt-4o-mini", "messages", List.of(Map.of("role", "user", "content", "x")));
    Map<String, Object> withTrace = new LinkedHashMap<>(clean);
    withTrace.put("_gateway_debug_trace_id", "trace_xyz");
    assertEquals(ChatCompletionBodyFingerprint.sha256Hex(jsons, clean), ChatCompletionBodyFingerprint.sha256Hex(jsons, withTrace));
  }

  @Test
  void sha256ShouldProduceHex() {
    String h =
        ChatCompletionBodyFingerprint.sha256Hex(
            jsons,
            Map.of("model", "gpt-4o-mini", "messages", List.of(Map.of("role", "user", "content", "hello"))));
    assertNotNull(h);
    assertEquals(64, h.length());
    assertTrue(h.chars().allMatch(ch -> (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')));
  }
}
