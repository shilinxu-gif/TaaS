package com.taas.infra.api;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class GlobalExceptionHandlerTest {
  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

  @Test
  void handleApiShouldExposeMachineReadableCode() {
    ResponseEntity<Map<String, Object>> response =
        handler.handleApi(new ApiException(429, "QPS limit exceeded", "rate_limited"));

    assertEquals(HttpStatus.TOO_MANY_REQUESTS, response.getStatusCode());
    assertEquals("QPS limit exceeded", response.getBody().get("error"));
    assertEquals("rate_limited", response.getBody().get("code"));
  }
}
