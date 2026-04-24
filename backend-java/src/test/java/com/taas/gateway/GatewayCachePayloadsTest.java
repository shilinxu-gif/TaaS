package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;
import org.junit.jupiter.api.Test;

class GatewayCachePayloadsTest {

  @Test
  void withMetaRoundTripStripsForClient() {
    Map<String, Object> body = Map.of("model", "gpt-4o-mini", "choices", java.util.List.of());
    GatewayCachePayloads.CacheMeta meta =
        new GatewayCachePayloads.CacheMeta("prov_1", "openai", "openai-main", null);
    Map<String, Object> stored = GatewayCachePayloads.withMeta(body, meta);
    assertEquals("prov_1", ((Map<?, ?>) stored.get(GatewayCachePayloads.META_KEY)).get("providerId"));

    GatewayCachePayloads.Unwrapped uw = GatewayCachePayloads.unwrap(stored);
    assertEquals("gpt-4o-mini", uw.body().get("model"));
    assertNull(uw.body().get(GatewayCachePayloads.META_KEY));
    assertEquals("prov_1", uw.meta().providerId());
    assertEquals("openai", uw.meta().routingPrimary());
    assertEquals("openai-main", uw.meta().routingActual());
  }

  @Test
  void unwrapWithoutMetaLeavesBody() {
    Map<String, Object> raw = Map.of("model", "x");
    GatewayCachePayloads.Unwrapped uw = GatewayCachePayloads.unwrap(raw);
    assertEquals("x", uw.body().get("model"));
    assertNull(uw.meta());
  }
}
