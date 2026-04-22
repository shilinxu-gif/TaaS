package com.taas.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.infra.api.ApiException;
import com.taas.infra.config.TaasProperties;
import com.taas.infra.security.CryptoUtils;
import com.taas.infra.util.Jsons;
import com.taas.ops.AuditService;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.reactive.function.client.WebClient;

class GatewayServiceTest {
  private final NamedParameterJdbcTemplate jdbcTemplate = mock(NamedParameterJdbcTemplate.class);
  private final GatewayService gatewayService =
      new GatewayService(
          jdbcTemplate,
          mock(GatewayCacheService.class),
          mock(CryptoUtils.class),
          new Jsons(new ObjectMapper()),
          mock(TaasProperties.class),
          mock(AuditService.class),
          WebClient.builder());

  @Test
  void supportsModelShouldRejectLegacyFallbackDemoModel() throws Exception {
    Object providerRow = newProviderRow("anthropic", "[]");

    boolean supported = (boolean) invoke("supportsModel", providerRow, "gpt-fallback-demo");

    assertEquals(false, supported);
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

  @Test
  void resolveModelSelectionShouldRequireModelWhenAppKeyHasNoBoundModels() throws Exception {
    ApiException exception =
        assertThrows(
            ApiException.class,
            () -> invoke("resolveModelSelection", null, List.of(), "balance"));

    assertEquals(400, exception.getStatusCode());
    assertEquals("model_required_without_binding", exception.getCode());
  }

  @Test
  void resolveModelSelectionShouldUseOnlyBoundModelWhenModelIsOmitted() throws Exception {
    when(jdbcTemplate.query(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any()))
        .thenReturn(List.of(newProviderRow("openai", "[{\"model\":\"gpt-4o-mini\"}]")));

    Object resolved =
        invoke(
            "resolveModelSelection",
            null,
            List.of("gpt-4o-mini"),
            "balance");

    assertEquals("gpt-4o-mini", invokeRecordAccessor(resolved, "model"));
  }

  @Test
  void resolveModelSelectionShouldSkipUnavailableModelsWhenAutoSelecting() throws Exception {
    when(jdbcTemplate.query(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<Object>>any()))
        .thenReturn(List.of(newProviderRow("openai", "[{\"model\":\"gpt-4o-mini\"}]")));

    Object resolved =
        invoke(
            "resolveModelSelection",
            null,
            List.of("claude-3-5-sonnet", "gpt-4o-mini"),
            "balance");

    assertEquals("gpt-4o-mini", invokeRecordAccessor(resolved, "model"));
  }

  @Test
  @SuppressWarnings("unchecked")
  void normalizeAnthropicMessagesRequestShouldConvertSystemAndContentBlocks() throws Exception {
    Map<String, Object> normalized =
        (Map<String, Object>)
            invoke(
                "normalizeAnthropicMessagesRequest",
                Map.of(
                    "model",
                    "claude-3-5-sonnet",
                    "system",
                    List.of(Map.of("type", "text", "text", "Be concise")),
                    "messages",
                    List.of(
                        Map.of(
                            "role",
                            "user",
                            "content",
                            List.of(Map.of("type", "text", "text", "Hello Claude"))),
                        Map.of("role", "assistant", "content", "Hi there")),
                    "max_tokens",
                    256));

    assertEquals("claude-3-5-sonnet", normalized.get("model"));
    assertEquals(256, normalized.get("max_tokens"));
    List<Map<String, Object>> messages =
        assertInstanceOf(List.class, normalized.get("messages"));
    assertEquals("system", messages.get(0).get("role"));
    assertEquals("Be concise", messages.get(0).get("content"));
    assertEquals("user", messages.get(1).get("role"));
    assertEquals("Hello Claude", messages.get(1).get("content"));
    assertEquals("assistant", messages.get(2).get("role"));
  }

  @Test
  @SuppressWarnings("unchecked")
  void normalizeAnthropicGatewayResponseShouldConvertChatPayloadShape() throws Exception {
    Map<String, Object> normalized =
        (Map<String, Object>)
            invoke(
                "normalizeAnthropicGatewayResponse",
                Map.of(
                    "id",
                    "chatcmpl_123",
                    "model",
                    "claude-3-5-sonnet",
                    "choices",
                    List.of(
                        Map.of(
                            "message", Map.of("role", "assistant", "content", "Hello back"),
                            "finish_reason", "stop")),
                    "usage",
                    Map.of("prompt_tokens", 12, "completion_tokens", 8, "total_tokens", 20)));

    assertEquals("message", normalized.get("type"));
    assertEquals("assistant", normalized.get("role"));
    assertEquals("claude-3-5-sonnet", normalized.get("model"));
    assertEquals("end_turn", normalized.get("stop_reason"));
    List<Map<String, Object>> content =
        assertInstanceOf(List.class, normalized.get("content"));
    assertEquals("text", content.get(0).get("type"));
    assertEquals("Hello back", content.get(0).get("text"));
    Map<String, Object> usage = assertInstanceOf(Map.class, normalized.get("usage"));
    assertEquals(12, usage.get("input_tokens"));
    assertEquals(8, usage.get("output_tokens"));
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

  private Object invokeRecordAccessor(Object target, String accessor) throws Exception {
    Method method = target.getClass().getDeclaredMethod(accessor);
    method.setAccessible(true);
    return method.invoke(target);
  }
}
