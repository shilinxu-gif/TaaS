package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletResponse;

class GatewayControllerTest {
  private final GatewayService gatewayService = mock(GatewayService.class);
  private final ObjectMapper objectMapper = new ObjectMapper();
  private final GatewayController controller = new GatewayController(gatewayService, objectMapper);

  @Test
  void completionsShouldPropagateHeadersFromGatewayResponse() throws Exception {
    when(gatewayService.chatCompletions(eq("Bearer app-key"), eq("idem-1"), eq("10.0.0.1"), any()))
        .thenReturn(
            new GatewayService.GatewayResponse(
                HttpStatus.TOO_MANY_REQUESTS,
                Map.of("error", "QPS limit exceeded"),
                Map.of("Retry-After", "1")));

    MockHttpServletResponse httpResponse = new MockHttpServletResponse();
    controller.completions(
        "Bearer app-key", "idem-1", "10.0.0.1, 127.0.0.1", Map.of("model", "gpt-4o-mini"), httpResponse);

    assertEquals(HttpStatus.TOO_MANY_REQUESTS.value(), httpResponse.getStatus());
    assertEquals("1", httpResponse.getHeader("Retry-After"));
    @SuppressWarnings("unchecked")
    Map<String, Object> responseBody =
        objectMapper.readValue(
            httpResponse.getContentAsString(StandardCharsets.UTF_8), Map.class);
    assertEquals("QPS limit exceeded", responseBody.get("error"));
  }
}
