package com.taas.infra.api;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.taas.infra.i18n.ApiMessageResolver;
import java.util.Map;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class GlobalExceptionHandlerTest {
  private final StaticMessageSource messageSource = buildMessageSource();
  private final GlobalExceptionHandler handler =
      new GlobalExceptionHandler(new ApiMessageResolver(messageSource));

  @Test
  void handleApiShouldExposeMachineReadableCode() {
    LocaleContextHolder.setLocale(Locale.US);
    ResponseEntity<Map<String, Object>> response =
        handler.handleApi(new ApiException(429, "QPS limit exceeded", "rate_limited"));

    assertEquals(HttpStatus.TOO_MANY_REQUESTS, response.getStatusCode());
    assertEquals("QPS limit exceeded", response.getBody().get("error"));
    assertEquals("rate_limited", response.getBody().get("code"));
  }

  @Test
  void handleApiShouldTranslateToChinese() {
    LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
    ResponseEntity<Map<String, Object>> response =
        handler.handleApi(new ApiException(429, "QPS limit exceeded", "rate_limited"));

    assertEquals("QPS 超限", response.getBody().get("error"));
  }

  private static StaticMessageSource buildMessageSource() {
    StaticMessageSource source = new StaticMessageSource();
    source.addMessage("error.code.rate_limited", Locale.US, "QPS limit exceeded");
    source.addMessage("error.code.rate_limited", Locale.SIMPLIFIED_CHINESE, "QPS 超限");
    return source;
  }
}
