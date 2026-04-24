package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class GatewayControllerTest {
  private final GatewayService gatewayService = mock(GatewayService.class);
  private final GatewayController controller = new GatewayController(gatewayService);

  @Test
  void completionsShouldPropagateHeadersFromGatewayResponse() {
    when(gatewayService.chatCompletions(eq("Bearer app-key"), eq("idem-1"), eq("10.0.0.1"), any()))
        .thenReturn(
            new GatewayService.GatewayResponse(
                HttpStatus.TOO_MANY_REQUESTS,
                Map.of("error", "QPS limit exceeded"),
                Map.of("Retry-After", "1")));

    Object raw =
        controller.completions(
            "Bearer app-key", "idem-1", "10.0.0.1, 127.0.0.1", Map.of("model", "gpt-4o-mini"));
    @SuppressWarnings("unchecked")
    ResponseEntity<Map<String, Object>> response = (ResponseEntity<Map<String, Object>>) raw;

    assertEquals(HttpStatus.TOO_MANY_REQUESTS, response.getStatusCode());
    assertEquals("1", response.getHeaders().getFirst("Retry-After"));
    Map<String, Object> responseBody = (Map<String, Object>) response.getBody();
    assertEquals("QPS limit exceeded", responseBody.get("error"));
  }
}
