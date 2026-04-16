package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.infra.api.ApiException;
import com.taas.infra.config.TaasProperties;
import com.taas.infra.security.CryptoUtils;
import com.taas.infra.util.Jsons;
import com.taas.ops.AuditService;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.reactive.function.client.WebClient;

class GatewayServiceTest {
  private final GatewayService gatewayService =
      new GatewayService(
          mock(NamedParameterJdbcTemplate.class),
          mock(GatewayCacheService.class),
          mock(CryptoUtils.class),
          new Jsons(new ObjectMapper()),
          mock(TaasProperties.class),
          mock(AuditService.class),
          WebClient.builder());

  @Test
  void supportsModelShouldAllowAnthropicForFallbackDemo() throws Exception {
    Object providerRow = newProviderRow("anthropic", "[]");

    boolean supported = (boolean) invoke("supportsModel", providerRow, "gpt-fallback-demo");

    assertEquals(true, supported);
  }

  @Test
  void providerErrorParsingShouldReadNestedOpenAiErrorObject() throws Exception {
    ResponseEntity<String> entity =
        ResponseEntity.status(HttpStatusCode.valueOf(429))
            .body("{\"error\":{\"message\":\"Rate limited\",\"code\":\"rate_limit_exceeded\"}}");

    ApiException exception =
        assertThrows(
            ApiException.class,
            () -> invoke("toProviderHttpResponse", entity, "openai_request_failed"));

    assertEquals(429, exception.getStatusCode());
    assertEquals("Rate limited", exception.getMessage());
    assertEquals("rate_limit_exceeded", exception.getCode());
  }

  private Object invoke(String methodName, Object... args) throws Exception {
    Method method = null;
    for (Method candidate : GatewayService.class.getDeclaredMethods()) {
      if (candidate.getName().equals(methodName)
          && candidate.getParameterCount() == args.length) {
        method = candidate;
        break;
      }
    }
    if (method == null) {
      throw new NoSuchMethodException(methodName);
    }
    method.setAccessible(true);
    try {
      return method.invoke(gatewayService, args);
    } catch (InvocationTargetException exception) {
      if (exception.getCause() instanceof RuntimeException runtimeException) {
        throw runtimeException;
      }
      throw exception;
    }
  }

  private Object newProviderRow(String providerType, String modelCatalogJson) throws Exception {
    Class<?> providerRowClass =
        Class.forName("com.taas.gateway.GatewayService$ProviderRow");
    Constructor<?> constructor = providerRowClass.getDeclaredConstructors()[0];
    constructor.setAccessible(true);
    return constructor.newInstance(
        "prov_1",
        "Provider",
        providerType,
        providerType,
        "active",
        true,
        "https://example.com",
        "ciphertext",
        modelCatalogJson,
        1,
        30000,
        "healthy");
  }
}
