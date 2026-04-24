package com.taas.gateway;

import com.taas.infra.api.ApiException;
import com.taas.infra.config.TaasProperties;
import com.taas.infra.security.CryptoUtils;
import com.taas.infra.util.Ids;
import com.taas.infra.util.Jsons;
import com.taas.infra.util.MoneyUtils;
import com.taas.ops.AuditService;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import reactor.core.publisher.Flux;

@Service
public class GatewayService {
  private static final Logger log = LoggerFactory.getLogger(GatewayService.class);
  private static final String INTERNAL_DEBUG_TRACE_ID = "_gateway_debug_trace_id";
  private static final Pattern UPSTREAM_REQUEST_ID_PATTERN =
      Pattern.compile("request id: ([^)\\s]+)");
  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final GatewayCacheService cacheService;
  private final TenantIdempotencyCachePolicyService tenantIdempotencyCachePolicy;
  private final CryptoUtils cryptoUtils;
  private final Jsons jsons;
  private final TaasProperties properties;
  private final AuditService auditService;
  private final WebClient webClient;

  public GatewayService(
      NamedParameterJdbcTemplate jdbcTemplate,
      GatewayCacheService cacheService,
      TenantIdempotencyCachePolicyService tenantIdempotencyCachePolicy,
      CryptoUtils cryptoUtils,
      Jsons jsons,
      TaasProperties properties,
      AuditService auditService,
      WebClient.Builder webClientBuilder) {
    this.jdbcTemplate = jdbcTemplate;
    this.cacheService = cacheService;
    this.tenantIdempotencyCachePolicy = tenantIdempotencyCachePolicy;
    this.cryptoUtils = cryptoUtils;
    this.jsons = jsons;
    this.properties = properties;
    this.auditService = auditService;
    this.webClient = webClientBuilder.build();
  }

  public GatewayResponse chatCompletions(
      String authorizationHeader,
      String idempotencyKey,
      String requestIp,
      Map<String, Object> requestBody) {
    if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
      throw new ApiException(401, "Missing Bearer AppKey");
    }
    String rawKey = authorizationHeader.substring("Bearer ".length()).trim();
    AppKeyRow appKey = requireAppKey(rawKey);
    List<String> scopes = jsons.readStringList(appKey.scopesJson());
    if (!scopes.contains("chat:complete")) {
      throw new ApiException(403, "This AppKey does not have chat:complete scope");
    }
    List<String> allowedModels = jsons.readStringList(appKey.allowedModelsJson());
    String rawRequestedModel = normalizeRequestedModel(requestBody.get("model"));
    String requestedModel = canonicalizeAllowedModel(rawRequestedModel, allowedModels);
    if (rawRequestedModel != null && !allowedModels.isEmpty() && requestedModel == null) {
      return new GatewayResponse(
          HttpStatus.FORBIDDEN,
          Map.of("error", "此 AppKey 未授权使用该 model", "allowedModels", allowedModels),
          Map.of());
    }
    if (!cacheService.checkRateLimit("appkey:" + appKey.id(), appKey.qpsLimit())) {
      return new GatewayResponse(
          HttpStatus.TOO_MANY_REQUESTS,
          Map.of("error", "QPS limit exceeded"),
          Map.of("Retry-After", "1"));
    }

    TenantIdempotencyCachePolicyService.IdempotencyPolicy idemPolicy =
        tenantIdempotencyCachePolicy.forTenant(appKey.tenantId());
    String idemKey = idempotencyKey == null || idempotencyKey.isBlank() ? null : appKey.id() + ":" + idempotencyKey.trim();
    String bodyFingerprintSha =
        idemPolicy.enabled()
                && idemKey == null
                && properties.getGateway().isBodyFingerprintCacheEnabled()
                && ChatCompletionBodyFingerprint.isEligible(requestBody)
            ? ChatCompletionBodyFingerprint.sha256Hex(jsons, requestBody)
            : null;
    if (idemPolicy.enabled() && idemKey != null) {
      Map<String, Object> cached = cacheService.getIdempotentResponse(idemKey);
      if (cached != null) {
        recordCacheHit(
            appKey,
            firstNonBlank(requestedModel, stringValue(cached.get("model"))),
            requestIp,
            idempotencyKey,
            cached);
        return new GatewayResponse(HttpStatus.OK, cached, Map.of());
      }
    } else if (bodyFingerprintSha != null) {
      Map<String, Object> cached = cacheService.getBodyFingerprintResponse(appKey.id(), bodyFingerprintSha);
      if (cached != null) {
        recordCacheHit(
            appKey,
            firstNonBlank(requestedModel, stringValue(cached.get("model"))),
            requestIp,
            null,
            cached);
        return new GatewayResponse(HttpStatus.OK, cached, Map.of());
      }
    }

    enforceBudgets(appKey);
    RoutingConfig routingConfig = routingConfig(appKey.tenantId());
    ResolvedModelSelection resolvedModel =
        resolveModelSelection(requestedModel, allowedModels, routingConfig.mode());
    String model = resolvedModel.model();
    ProviderSelection selection = resolvedModel.selection();
    Map<String, Object> payload;
    ProviderExecution execution;
    try {
      execution = callProviders(selection.candidates(), model, requestBody);
      payload = normalizePayload(model, execution.payload(), execution.promptTokens(), execution.completionTokens(), execution.totalTokens());
    } catch (Exception exception) {
      if (exception instanceof ApiException apiException) {
        throw apiException;
      }
      throw new ApiException(502, exception.getMessage());
    }

    int totalTokens = execution.totalTokens();
    if (appKey.balanceTokens().compareTo(BigDecimal.valueOf(totalTokens)) < 0) {
      return new GatewayResponse(
          HttpStatus.PAYMENT_REQUIRED,
          Map.of("error", "Insufficient token balance"),
          Map.of());
    }
    BigDecimal inputPrice = execution.catalog() == null ? BigDecimal.ZERO : execution.catalog().inputUsdPerMillion();
    BigDecimal outputPrice = execution.catalog() == null ? BigDecimal.ZERO : execution.catalog().outputUsdPerMillion();
    BigDecimal subtotal =
        BigDecimal.valueOf(execution.promptTokens())
            .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
            .multiply(inputPrice)
            .add(
                BigDecimal.valueOf(execution.completionTokens())
                    .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
                    .multiply(outputPrice));

    persistGatewaySuccess(
        appKey,
        execution,
        payload,
        requestIp,
        idempotencyKey,
        model,
        subtotal,
        inputPrice,
        outputPrice,
        routingConfig);
    if (idemPolicy.enabled() && idemKey != null) {
      cacheService.setIdempotentResponse(idemKey, payload, idemPolicy.redisTtl());
    } else if (idemPolicy.enabled()
        && bodyFingerprintSha != null
        && properties.getGateway().isBodyFingerprintCacheEnabled()) {
      cacheService.setBodyFingerprintResponse(appKey.id(), bodyFingerprintSha, payload, idemPolicy.redisTtl());
    }
    return new GatewayResponse(HttpStatus.OK, payload, Map.of());
  }

  public GatewayResponse anthropicMessages(
      String authorizationHeader,
      String xApiKey,
      String idempotencyKey,
      String requestIp,
      Map<String, Object> requestBody) {
    if ((authorizationHeader == null || authorizationHeader.isBlank())
        && (xApiKey == null || xApiKey.isBlank())) {
      throw new ApiException(401, "Missing AppKey");
    }
    String debugTraceId = "anthdbg_" + Ids.shortHex(8);
    Map<String, Object> normalizedRequest =
        withGatewayDebugTraceId(normalizeAnthropicMessagesRequest(requestBody), debugTraceId);
    logAnthropicNormalization(debugTraceId, requestIp, false, requestBody, normalizedRequest);
    GatewayResponse response =
        chatCompletions(
            resolveGatewayAuthorization(authorizationHeader, xApiKey),
            idempotencyKey,
            requestIp,
            normalizedRequest);
    return new GatewayResponse(
        response.status(), normalizeAnthropicGatewayResponse(response.body()), response.headers());
  }

  public GatewayStreamResponse chatCompletionsStream(
      String authorizationHeader,
      String idempotencyKey,
      String requestIp,
      Map<String, Object> requestBody) {
    if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
      throw new ApiException(401, "Missing Bearer AppKey");
    }
    String rawKey = authorizationHeader.substring("Bearer ".length()).trim();
    AppKeyRow appKey = requireAppKey(rawKey);
    List<String> scopes = jsons.readStringList(appKey.scopesJson());
    if (!scopes.contains("chat:complete")) {
      throw new ApiException(403, "This AppKey does not have chat:complete scope");
    }
    List<String> allowedModels = jsons.readStringList(appKey.allowedModelsJson());
    String rawRequestedModel = normalizeRequestedModel(requestBody.get("model"));
    String requestedModel = canonicalizeAllowedModel(rawRequestedModel, allowedModels);
    if (rawRequestedModel != null && !allowedModels.isEmpty() && requestedModel == null) {
      return new GatewayStreamResponse(
          HttpStatus.FORBIDDEN,
          Map.of("error", "此 AppKey 未授权使用该 model", "allowedModels", allowedModels),
          null,
          Map.of());
    }
    if (!cacheService.checkRateLimit("appkey:" + appKey.id(), appKey.qpsLimit())) {
      return new GatewayStreamResponse(
          HttpStatus.TOO_MANY_REQUESTS,
          Map.of("error", "QPS limit exceeded"),
          null,
          Map.of("Retry-After", "1"));
    }
    TenantIdempotencyCachePolicyService.IdempotencyPolicy idemPolicy =
        tenantIdempotencyCachePolicy.forTenant(appKey.tenantId());
    String idemKey =
        idempotencyKey == null || idempotencyKey.isBlank()
            ? null
            : appKey.id() + ":" + idempotencyKey.trim();
    if (idemPolicy.enabled() && idemKey != null) {
      Map<String, Object> cached = cacheService.getIdempotentResponse(idemKey);
      if (cached != null) {
        recordCacheHit(
            appKey,
            firstNonBlank(requestedModel, stringValue(cached.get("model"))),
            requestIp,
            idempotencyKey,
            cached);
        return new GatewayStreamResponse(
            HttpStatus.OK,
            null,
            staticStreamBody(buildOpenAiStreamEvents(cached, includeOpenAiUsageInStream(requestBody))),
            Map.of());
      }
    }
    enforceBudgets(appKey);
    RoutingConfig routingConfig = routingConfig(appKey.tenantId());
    ResolvedModelSelection resolvedModel =
        resolveModelSelection(requestedModel, allowedModels, routingConfig.mode());
    StreamingResponseBody streamBody =
        outputStream ->
            streamOpenAiCompatibleRequest(
                appKey,
                idempotencyKey,
                idemKey,
                requestIp,
                requestBody,
                resolvedModel.model(),
                resolvedModel.selection(),
                routingConfig,
                idemPolicy,
                false,
                includeOpenAiUsageInStream(requestBody),
                outputStream);
    return new GatewayStreamResponse(HttpStatus.OK, null, streamBody, Map.of());
  }

  public GatewayStreamResponse anthropicMessagesStream(
      String authorizationHeader,
      String xApiKey,
      String idempotencyKey,
      String requestIp,
      Map<String, Object> requestBody) {
    if ((authorizationHeader == null || authorizationHeader.isBlank())
        && (xApiKey == null || xApiKey.isBlank())) {
      throw new ApiException(401, "Missing AppKey");
    }
    String resolvedAuthorization = resolveGatewayAuthorization(authorizationHeader, xApiKey);
    String debugTraceId = "anthdbg_" + Ids.shortHex(8);
    Map<String, Object> normalizedRequest =
        withGatewayDebugTraceId(normalizeAnthropicMessagesRequest(requestBody), debugTraceId);
    logAnthropicNormalization(debugTraceId, requestIp, true, requestBody, normalizedRequest);
    if (resolvedAuthorization == null || !resolvedAuthorization.startsWith("Bearer ")) {
      throw new ApiException(401, "Missing Bearer AppKey");
    }
    String rawKey = resolvedAuthorization.substring("Bearer ".length()).trim();
    AppKeyRow appKey = requireAppKey(rawKey);
    List<String> scopes = jsons.readStringList(appKey.scopesJson());
    if (!scopes.contains("chat:complete")) {
      throw new ApiException(403, "This AppKey does not have chat:complete scope");
    }
    List<String> allowedModels = jsons.readStringList(appKey.allowedModelsJson());
    String rawRequestedModel = normalizeRequestedModel(normalizedRequest.get("model"));
    String requestedModel = canonicalizeAllowedModel(rawRequestedModel, allowedModels);
    if (rawRequestedModel != null && !allowedModels.isEmpty() && requestedModel == null) {
      return new GatewayStreamResponse(
          HttpStatus.FORBIDDEN,
          Map.of("error", "此 AppKey 未授权使用该 model", "allowedModels", allowedModels),
          null,
          Map.of());
    }
    if (!cacheService.checkRateLimit("appkey:" + appKey.id(), appKey.qpsLimit())) {
      return new GatewayStreamResponse(
          HttpStatus.TOO_MANY_REQUESTS,
          Map.of("error", "QPS limit exceeded"),
          null,
          Map.of("Retry-After", "1"));
    }
    TenantIdempotencyCachePolicyService.IdempotencyPolicy idemPolicy =
        tenantIdempotencyCachePolicy.forTenant(appKey.tenantId());
    String idemKey =
        idempotencyKey == null || idempotencyKey.isBlank()
            ? null
            : appKey.id() + ":" + idempotencyKey.trim();
    if (idemPolicy.enabled() && idemKey != null) {
      Map<String, Object> cached = cacheService.getIdempotentResponse(idemKey);
      if (cached != null) {
        recordCacheHit(
            appKey,
            firstNonBlank(requestedModel, stringValue(cached.get("model"))),
            requestIp,
            idempotencyKey,
            cached);
        return new GatewayStreamResponse(
            HttpStatus.OK,
            null,
            staticStreamBody(buildAnthropicStreamEvents(normalizeAnthropicGatewayResponse(cached))),
            Map.of());
      }
    }
    enforceBudgets(appKey);
    RoutingConfig routingConfig = routingConfig(appKey.tenantId());
    ResolvedModelSelection resolvedModel =
        resolveModelSelection(requestedModel, allowedModels, routingConfig.mode());
    StreamingResponseBody streamBody =
        outputStream ->
            streamOpenAiCompatibleRequest(
                appKey,
                idempotencyKey,
                idemKey,
                requestIp,
                normalizedRequest,
                resolvedModel.model(),
                resolvedModel.selection(),
                routingConfig,
                idemPolicy,
                true,
                false,
                outputStream);
    return new GatewayStreamResponse(HttpStatus.OK, null, streamBody, Map.of());
  }

  private void streamOpenAiCompatibleRequest(
      AppKeyRow appKey,
      String idempotencyKey,
      String idemKey,
      String requestIp,
      Map<String, Object> requestBody,
      String model,
      ProviderSelection selection,
      RoutingConfig routingConfig,
      TenantIdempotencyCachePolicyService.IdempotencyPolicy idemPolicy,
      boolean outwardAnthropic,
      boolean includeOpenAiUsage,
      OutputStream outputStream)
      throws IOException {
    List<String> errors = new ArrayList<>();
    StreamWriteContext writeContext = new StreamWriteContext(outputStream);
    List<ProviderRow> candidates = selection.candidates();
    for (int i = 0; i < candidates.size(); i++) {
      ProviderRow provider = candidates.get(i);
      boolean wroteBefore = writeContext.started();
      try {
        ProviderExecution execution =
            streamProvider(
                provider,
                model,
                requestBody,
                outwardAnthropic,
                includeOpenAiUsage,
                i + 1,
                writeContext);
        BigDecimal inputPrice =
            execution.catalog() == null ? BigDecimal.ZERO : execution.catalog().inputUsdPerMillion();
        BigDecimal outputPrice =
            execution.catalog() == null ? BigDecimal.ZERO : execution.catalog().outputUsdPerMillion();
        BigDecimal subtotal =
            BigDecimal.valueOf(execution.promptTokens())
                .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
                .multiply(inputPrice)
                .add(
                    BigDecimal.valueOf(execution.completionTokens())
                        .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
                        .multiply(outputPrice));
        if (appKey.balanceTokens().compareTo(BigDecimal.valueOf(execution.totalTokens())) < 0) {
          throw new ApiException(402, "Insufficient token balance");
        }
        persistGatewaySuccess(
            appKey,
            execution,
            execution.payload(),
            requestIp,
            idempotencyKey,
            model,
            subtotal,
            inputPrice,
            outputPrice,
            routingConfig);
        if (idemPolicy.enabled() && idemKey != null) {
          cacheService.setIdempotentResponse(idemKey, execution.payload(), idemPolicy.redisTtl());
        }
        return;
      } catch (ApiException exception) {
        if (writeContext.started() != wroteBefore) {
          throw exception;
        }
        errors.add(
            provider.slug()
                + ":"
                + (exception.getCode() == null ? exception.getMessage() : exception.getCode()));
      }
    }
    throw new ApiException(
        502,
        "All providers failed: " + String.join(", ", errors),
        "all_providers_failed");
  }

  private ProviderExecution streamProvider(
      ProviderRow provider,
      String model,
      Map<String, Object> requestBody,
      boolean outwardAnthropic,
      boolean includeOpenAiUsage,
      int attempts,
      StreamWriteContext writeContext) {
    long startedAt = System.nanoTime();
    String apiKey = resolveProviderApiKey(provider);
    if (apiKey == null || apiKey.isBlank()) {
      throw new ApiException(503, "Provider is not configured", "provider_not_configured");
    }
    if ("anthropic".equals(provider.providerType())) {
      return streamAnthropicProvider(
          provider,
          model,
          requestBody,
          apiKey,
          outwardAnthropic,
          includeOpenAiUsage,
          attempts,
          writeContext,
          startedAt);
    }
    if ("openai".equals(provider.providerType())) {
      return streamOpenAiProvider(
          provider,
          model,
          requestBody,
          apiKey,
          outwardAnthropic,
          includeOpenAiUsage,
          attempts,
          writeContext,
          startedAt);
    }
    ProviderExecution execution = callProvider(provider, model, disableStreamFlag(requestBody), attempts);
    List<String> events =
        outwardAnthropic
            ? buildAnthropicStreamEvents(normalizeAnthropicGatewayResponse(execution.payload()))
            : buildOpenAiStreamEvents(execution.payload(), includeOpenAiUsage);
    for (String event : events) {
      writeUnchecked(writeContext, event);
    }
    return execution;
  }

  private ProviderExecution streamOpenAiProvider(
      ProviderRow provider,
      String model,
      Map<String, Object> requestBody,
      String apiKey,
      boolean outwardAnthropic,
      boolean includeOpenAiUsage,
      int attempts,
      StreamWriteContext writeContext,
      long startedAt) {
    String url = trimBaseUrl(provider.baseUrl()) + "/chat/completions";
    OpenAiStreamAccumulator accumulator =
        new OpenAiStreamAccumulator(model, estimatePromptTokens(requestBody.get("messages")));
    OpenAiToAnthropicStreamState outwardState =
        outwardAnthropic ? new OpenAiToAnthropicStreamState() : null;
    try (var stream =
        postSse(
                url,
                Map.of(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey),
                mergePayload(requestBody, Map.of("model", model, "stream", true)),
                "openai_request_failed",
                provider.timeoutMs(),
                gatewayDebugTraceId(requestBody),
                provider.slug(),
                model)
            .toStream()) {
      stream.forEach(
          event -> {
            String data = event.data();
            if (data == null || data.isBlank()) {
              return;
            }
            if ("[DONE]".equals(data)) {
              if (!outwardAnthropic) {
                writeUnchecked(writeContext, "data: [DONE]\n\n");
              }
              return;
            }
            Map<String, Object> chunk = readBodyAsMap(data);
            accumulator.applyChunk(chunk);
            if (outwardAnthropic) {
              for (String mapped :
                  outwardState.toAnthropicEvents(chunk, accumulator.promptTokens(), accumulator.completionTokens())) {
                writeUnchecked(writeContext, mapped);
              }
            } else {
              writeUnchecked(writeContext, serializeSseEvent(event.event(), data));
            }
          });
    }
    if (outwardAnthropic) {
      for (String mapped :
          outwardState.finish(accumulator.promptTokens(), accumulator.completionTokens())) {
        writeUnchecked(writeContext, mapped);
      }
    }
    Map<String, Object> payload = accumulator.toPayload();
    ProviderCatalog.Entry catalog = ProviderCatalog.find(model);
    int latencyMs = Math.max(1, (int) ((System.nanoTime() - startedAt) / 1_000_000));
    return new ProviderExecution(
        provider,
        payload,
        attempts,
        accumulator.promptTokens(),
        accumulator.completionTokens(),
        accumulator.totalTokens(),
        catalog,
        200,
        null,
        latencyMs);
  }

  private ProviderExecution streamAnthropicProvider(
      ProviderRow provider,
      String model,
      Map<String, Object> requestBody,
      String apiKey,
      boolean outwardAnthropic,
      boolean includeOpenAiUsage,
      int attempts,
      StreamWriteContext writeContext,
      long startedAt) {
    String url = trimBaseUrl(provider.baseUrl()) + "/messages";
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("messages", normalizeMessages(requestBody.get("messages"), true));
    body.put(
        "max_tokens",
        intValue(requestBody.get("max_completion_tokens"), intValue(requestBody.get("max_tokens"), 512)));
    body.put("stream", true);
    if (requestBody.get("temperature") != null) {
      body.put("temperature", requestBody.get("temperature"));
    }
    if (requestBody.get("top_p") != null) {
      body.put("top_p", requestBody.get("top_p"));
    }
    Object system = extractSystem(requestBody.get("messages"));
    if (system != null) {
      body.put("system", system);
    }
    List<Map<String, Object>> anthropicTools = openAiToolsToAnthropic(requestBody.get("tools"));
    if (!anthropicTools.isEmpty()) {
      body.put("tools", anthropicTools);
    }
    Object anthropicToolChoice = openAiToolChoiceToAnthropic(requestBody.get("tool_choice"));
    if (anthropicToolChoice != null) {
      body.put("tool_choice", anthropicToolChoice);
    }
    AnthropicStreamAccumulator accumulator =
        new AnthropicStreamAccumulator(model, estimatePromptTokens(requestBody.get("messages")));
    try (var stream =
        postSse(
                url,
                Map.of("x-api-key", apiKey, "anthropic-version", "2023-06-01"),
                body,
                "anthropic_request_failed",
                provider.timeoutMs(),
                gatewayDebugTraceId(requestBody),
                provider.slug(),
                model)
            .toStream()) {
      stream.forEach(
          event -> {
            String eventName = firstNonBlank(event.event(), "message");
            String data = event.data();
            if (data == null || data.isBlank()) {
              return;
            }
            Map<String, Object> payload = readBodyAsMap(data);
            accumulator.apply(eventName, payload);
            if (outwardAnthropic) {
              writeUnchecked(writeContext, serializeSseEvent(event.event(), data));
            } else {
              for (String mapped :
                  accumulator.toOpenAiEvents(eventName, payload, includeOpenAiUsage)) {
                writeUnchecked(writeContext, mapped);
              }
            }
          });
    }
    if (!outwardAnthropic) {
      for (String mapped : accumulator.finishOpenAi(includeOpenAiUsage)) {
        writeUnchecked(writeContext, mapped);
      }
    }
    Map<String, Object> payload = accumulator.toPayload();
    ProviderCatalog.Entry catalog = ProviderCatalog.find(model);
    int latencyMs = Math.max(1, (int) ((System.nanoTime() - startedAt) / 1_000_000));
    return new ProviderExecution(
        provider,
        payload,
        attempts,
        accumulator.promptTokens(),
        accumulator.completionTokens(),
        accumulator.totalTokens(),
        catalog,
        200,
        null,
        latencyMs);
  }

  private Flux<ServerSentEvent<String>> postSse(
      String url,
      Map<String, String> headers,
      Object body,
      String fallbackProviderErrorCode,
      int timeoutMs,
      String debugTraceId,
      String providerSlug,
      String model) {
    return webClient
        .post()
        .uri(url)
        .headers(httpHeaders -> headers.forEach(httpHeaders::set))
        .contentType(MediaType.APPLICATION_JSON)
        .accept(MediaType.TEXT_EVENT_STREAM)
        .bodyValue(body)
        .exchangeToFlux(
            response -> {
              if (response.statusCode().isError()) {
                return response
                    .toEntity(String.class)
                    .flatMapMany(
                        entity -> {
                          try {
                            toProviderHttpResponse(
                                entity,
                                fallbackProviderErrorCode,
                                debugTraceId,
                                providerSlug,
                                url,
                                model);
                            return Flux.empty();
                          } catch (ApiException exception) {
                            return Flux.error(exception);
                          }
                        });
              }
              return response.bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {});
            })
        .timeout(Duration.ofMillis(Math.max(timeoutMs, 1000)))
        .onErrorMap(
            java.util.concurrent.TimeoutException.class,
            error -> {
              logProviderTransportFailure(
                  "gateway.provider.timeout",
                  debugTraceId,
                  providerSlug,
                  model,
                  url,
                  "timeout");
              return new ApiException(
                  504,
                  providerNameFromErrorCode(fallbackProviderErrorCode) + " request timed out",
                  "timeout");
            })
        .onErrorMap(
            error -> !(error instanceof ApiException),
            error -> {
              logProviderTransportFailure(
                  "gateway.provider.network_error",
                  debugTraceId,
                  providerSlug,
                  model,
                  url,
                  error.getMessage());
              return new ApiException(
                  502,
                  error.getMessage() == null
                      ? providerNameFromErrorCode(fallbackProviderErrorCode) + " request failed"
                      : error.getMessage(),
                  "network_error");
            });
  }

  private StreamingResponseBody staticStreamBody(List<String> events) {
    return outputStream -> {
      for (String event : events) {
        outputStream.write(event.getBytes(StandardCharsets.UTF_8));
        outputStream.flush();
      }
    };
  }

  private String serializeSseEvent(String event, String data) {
    if (event == null || event.isBlank()) {
      return "data: " + data + "\n\n";
    }
    return "event: " + event + "\n" + "data: " + data + "\n\n";
  }

  private void writeUnchecked(StreamWriteContext writeContext, String value) {
    try {
      writeContext.write(value);
    } catch (IOException exception) {
      throw new IllegalStateException(exception);
    }
  }

  private ResolvedModelSelection resolveModelSelection(
      String requestedModel, List<String> allowedModels, String mode) {
    if (requestedModel != null) {
      ProviderSelection selection = chooseProvider(requestedModel, mode);
      return new ResolvedModelSelection(
          canonicalizeModelForSelection(requestedModel, selection), selection);
    }
    if (allowedModels.isEmpty()) {
      throw new ApiException(
          400,
          "model is required when AppKey does not bind allowedModels",
          "model_required_without_binding");
    }
    List<ResolvedModelSelection> availableSelections = new ArrayList<>();
    for (String allowedModel : allowedModels) {
      try {
        ProviderSelection selection = chooseProvider(allowedModel, mode);
        availableSelections.add(
            new ResolvedModelSelection(
                canonicalizeModelForSelection(allowedModel, selection), selection));
      } catch (ApiException exception) {
        if (!"no_provider_for_model".equals(exception.getCode())) {
          throw exception;
        }
      }
    }
    if (availableSelections.isEmpty()) {
      throw new ApiException(
          503,
          "No enabled provider can serve any model allowed by this AppKey",
          "no_provider_for_allowed_models");
    }
    if (availableSelections.size() == 1) {
      return availableSelections.get(0);
    }
    return availableSelections.get(ThreadLocalRandom.current().nextInt(availableSelections.size()));
  }

  private AppKeyRow requireAppKey(String rawKey) {
    String hash = cryptoUtils.hashAppKey(rawKey);
    return jdbcTemplate.query(
            """
            select
              a.id, a.tenant_id, a.name, a.qps_limit, a.daily_budget_usd, a.monthly_budget_usd,
              a.allowed_models::text as allowed_models, a.scopes::text as scopes, a.owner_user_id,
              t.balance_tokens, t.monthly_budget_usd as tenant_monthly_budget_usd, t.spend_cap_enforced
            from app_keys a
            join tenants t on t.id = a.tenant_id
            where a.token_hash = :tokenHash and a.status = 'active'
            limit 1
            """,
            Map.of("tokenHash", hash),
            APP_KEY_ROW_MAPPER)
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(401, "Invalid or revoked AppKey"));
  }

  private void enforceBudgets(AppKeyRow appKey) {
    Timestamp dayStart = ts(LocalDate.now(ZoneOffset.UTC).atStartOfDay().toInstant(ZoneOffset.UTC));
    Timestamp monthStart = ts(LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay().toInstant(ZoneOffset.UTC));
    BigDecimal daySpend =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(b.amount_usd), 0)
            from billing_records b join api_request_logs l on l.id = b.log_id
            where b.tenant_id = :tenantId and l.app_key_id = :appKeyId and b.type = 'usage' and b.created_at >= :dayStart
            """,
            Map.of("tenantId", appKey.tenantId(), "appKeyId", appKey.id(), "dayStart", dayStart),
            BigDecimal.class);
    BigDecimal monthSpend =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(b.amount_usd), 0)
            from billing_records b join api_request_logs l on l.id = b.log_id
            where b.tenant_id = :tenantId and l.app_key_id = :appKeyId and b.type = 'usage' and b.created_at >= :monthStart
            """,
            Map.of("tenantId", appKey.tenantId(), "appKeyId", appKey.id(), "monthStart", monthStart),
            BigDecimal.class);
    BigDecimal tenantMonthSpend =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(amount_usd), 0)
            from billing_records
            where tenant_id = :tenantId and type = 'usage' and created_at >= :monthStart
            """,
            Map.of("tenantId", appKey.tenantId(), "monthStart", monthStart),
            BigDecimal.class);
    if (appKey.dailyBudgetUsd() != null && daySpend.compareTo(appKey.dailyBudgetUsd()) >= 0) {
      throw new ApiException(402, "AppKey daily budget exceeded");
    }
    if (appKey.monthlyBudgetUsd() != null && monthSpend.compareTo(appKey.monthlyBudgetUsd()) >= 0) {
      throw new ApiException(402, "AppKey monthly budget exceeded");
    }
    if (appKey.spendCapEnforced() && appKey.tenantMonthlyBudgetUsd() != null && tenantMonthSpend.compareTo(appKey.tenantMonthlyBudgetUsd()) >= 0) {
      throw new ApiException(402, "Tenant monthly budget exceeded");
    }
  }

  private RoutingConfig routingConfig(String tenantId) {
    return jdbcTemplate.query(
            """
            select mode, primary_provider_type
            from tenant_routing_strategies
            where tenant_id = :tenantId
            limit 1
            """,
            Map.of("tenantId", tenantId),
            (rs, rowNum) ->
                new RoutingConfig(
                    rs.getString("mode"),
                    rs.getString("primary_provider_type")))
        .stream()
        .findFirst()
        .orElse(new RoutingConfig("balance", null));
  }

  private ProviderSelection chooseProvider(String model, String mode) {
    List<ProviderRow> providers =
        jdbcTemplate.query(
            """
            select
              id, name, slug, provider_type, status, enabled, base_url, api_key_ciphertext,
              model_catalog::text as model_catalog, priority, timeout_ms, health_status
            from providers
            order by priority asc, slug asc
            """,
            PROVIDER_ROW_MAPPER);
    List<ProviderRow> candidates =
        providers.stream()
            .filter(row -> row.enabled() && "active".equals(row.status()) && supportsModel(row, model))
            .sorted(providerComparator(mode, model))
            .toList();
    if (candidates.isEmpty()) {
      throw new ApiException(
          503, "No enabled provider can serve the requested model", "no_provider_for_model");
    }
    return new ProviderSelection(candidates);
  }

  private Comparator<ProviderRow> providerComparator(String mode, String model) {
    ProviderCatalog.Entry catalog = ProviderCatalog.find(model);
    return (left, right) -> Double.compare(score(right, mode, catalog), score(left, mode, catalog));
  }

  private String canonicalizeAllowedModel(String requestedModel, List<String> allowedModels) {
    if (requestedModel == null || allowedModels.isEmpty()) {
      return requestedModel;
    }
    return allowedModels.stream()
        .filter(allowedModel -> allowedModel.equalsIgnoreCase(requestedModel))
        .findFirst()
        .orElse(null);
  }

  private String canonicalizeModelForSelection(String model, ProviderSelection selection) {
    for (ProviderRow provider : selection.candidates()) {
      String canonicalModel = canonicalizeModelForProvider(model, provider);
      if (canonicalModel != null) {
        return canonicalModel;
      }
    }
    return model;
  }

  private String canonicalizeModelForProvider(String model, ProviderRow provider) {
    List<Map<String, Object>> catalog = jsons.readObjectList(provider.modelCatalogJson());
    for (Map<String, Object> item : catalog) {
      String configuredModel = normalizeRequestedModel(item.get("model"));
      if (configuredModel != null && configuredModel.equalsIgnoreCase(model)) {
        return configuredModel;
      }
    }
    return null;
  }

  private double score(ProviderRow row, String mode, ProviderCatalog.Entry catalog) {
    double healthScore = switch (row.healthStatus()) {
      case "healthy" -> 100;
      case "degraded" -> 75;
      default -> 40;
    };
    double priceScore =
        catalog == null
            ? 100
            : 200 - catalog.inputUsdPerMillion().doubleValue() - catalog.outputUsdPerMillion().doubleValue();
    double priorityScore = Math.max(0, 100 - row.priority());
    if ("quality".equals(mode)) return healthScore * 2 + priorityScore;
    if ("cost".equals(mode)) return priceScore * 2 + priorityScore;
    return healthScore + priceScore + priorityScore;
  }

  private boolean supportsModel(ProviderRow row, String model) {
    List<Map<String, Object>> catalog = jsons.readObjectList(row.modelCatalogJson());
    if (catalog.isEmpty()) {
      String inferred = ProviderCatalog.inferProviderType(model);
      return inferred != null && inferred.equals(row.providerType());
    }
    return catalog.stream().anyMatch(item -> model.equalsIgnoreCase(String.valueOf(item.get("model"))));
  }

  private ProviderExecution callProviders(List<ProviderRow> candidates, String model, Map<String, Object> requestBody) {
    List<String> errors = new ArrayList<>();
    String debugTraceId = gatewayDebugTraceId(requestBody);
    for (int i = 0; i < candidates.size(); i++) {
      ProviderRow provider = candidates.get(i);
      try {
        ProviderExecution execution = callProvider(provider, model, requestBody, i + 1);
        return execution;
      } catch (ApiException exception) {
        if (debugTraceId != null) {
          log.warn(
              "gateway.provider.failed traceId={} provider={} model={} attempt={} status={} code={} message={}",
              debugTraceId,
              provider.slug(),
              model,
              i + 1,
              exception.getStatusCode(),
              exception.getCode(),
              exception.getMessage());
        }
        errors.add(
            provider.slug()
                + ":"
                + (exception.getCode() == null ? exception.getMessage() : exception.getCode()));
      }
    }
    if (debugTraceId != null) {
      log.error(
          "gateway.provider.failed_all traceId={} model={} errors={}",
          debugTraceId,
          model,
          String.join(", ", errors));
    }
    throw new ApiException(
        502,
        "All providers failed: " + String.join(", ", errors),
        "all_providers_failed");
  }

  private ProviderExecution callProvider(ProviderRow provider, String model, Map<String, Object> requestBody, int attempts) {
    long startedAt = System.nanoTime();
    String apiKey = resolveProviderApiKey(provider);
    if (apiKey == null || apiKey.isBlank()) {
      throw new ApiException(503, "Provider is not configured", "provider_not_configured");
    }
    ProviderHttpResponse response;
    if ("anthropic".equals(provider.providerType())) {
      response = callAnthropic(provider, model, requestBody, apiKey);
    } else if ("google".equals(provider.providerType())) {
      response = callGoogle(provider, model, requestBody, apiKey);
    } else {
      response = callOpenAi(provider, model, requestBody, apiKey);
    }
    Map<String, Object> payload = response.payload();
    int promptTokens = readInt(payload, "usage.prompt_tokens", estimatePromptTokens(requestBody.get("messages")));
    int completionTokens = readInt(payload, "usage.completion_tokens", 256);
    int totalTokens = readInt(payload, "usage.total_tokens", promptTokens + completionTokens);
    ProviderCatalog.Entry catalog = ProviderCatalog.find(model);
    int latencyMs = Math.max(1, (int) ((System.nanoTime() - startedAt) / 1_000_000));
    return new ProviderExecution(
        provider,
        payload,
        attempts,
        promptTokens,
        completionTokens,
        totalTokens,
        catalog,
        response.statusCode(),
        response.providerErrorCode(),
        latencyMs);
  }

  private String resolveProviderApiKey(ProviderRow provider) {
    if (provider.apiKeyCiphertext() != null && !provider.apiKeyCiphertext().isBlank()) {
      return cryptoUtils.decryptSecret(provider.apiKeyCiphertext());
    }
    return switch (provider.providerType()) {
      case "anthropic" -> properties.getProviders().getAnthropicApiKey();
      case "google" -> properties.getProviders().getGoogleApiKey();
      default -> properties.getProviders().getOpenaiApiKey();
    };
  }

  private ProviderHttpResponse callOpenAi(
      ProviderRow provider, String model, Map<String, Object> requestBody, String apiKey) {
    String url = trimBaseUrl(provider.baseUrl()) + "/chat/completions";
    return postJson(
        url,
        Map.of(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey),
        mergePayload(requestBody, Map.of("model", model, "stream", false)),
        "openai_request_failed",
        provider.timeoutMs(),
        gatewayDebugTraceId(requestBody),
        provider.slug(),
        model);
  }

  private ProviderHttpResponse callAnthropic(
      ProviderRow provider, String model, Map<String, Object> requestBody, String apiKey) {
    String url = trimBaseUrl(provider.baseUrl()) + "/messages";
    List<Map<String, Object>> normalizedMessages = normalizeMessages(requestBody.get("messages"), true);
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put("model", model);
    body.put("messages", normalizedMessages);
    body.put(
        "max_tokens",
        intValue(requestBody.get("max_completion_tokens"), intValue(requestBody.get("max_tokens"), 512)));
    if (requestBody.get("temperature") != null) {
      body.put("temperature", requestBody.get("temperature"));
    }
    if (requestBody.get("top_p") != null) {
      body.put("top_p", requestBody.get("top_p"));
    }
    Object system = extractSystem(requestBody.get("messages"));
    if (system != null) {
      body.put("system", system);
    }
    List<Map<String, Object>> anthropicTools = openAiToolsToAnthropic(requestBody.get("tools"));
    if (!anthropicTools.isEmpty()) {
      body.put("tools", anthropicTools);
    }
    Object anthropicToolChoice = openAiToolChoiceToAnthropic(requestBody.get("tool_choice"));
    if (anthropicToolChoice != null) {
      body.put("tool_choice", anthropicToolChoice);
    }
    ProviderHttpResponse upstream =
        postJson(
            url,
            Map.of("x-api-key", apiKey, "anthropic-version", "2023-06-01"),
            body,
            "anthropic_request_failed",
            provider.timeoutMs(),
            gatewayDebugTraceId(requestBody),
            provider.slug(),
            model);
    Map<String, Object> raw = upstream.payload();
    AnthropicAssistantPayload assistantPayload = extractAnthropicAssistantPayload(raw.get("content"));
    Map<String, Object> usage = (Map<String, Object>) raw.getOrDefault("usage", Map.of());
    LinkedHashMap<String, Object> assistantMessage = new LinkedHashMap<>();
    assistantMessage.put("role", "assistant");
    assistantMessage.put("content", assistantPayload.text());
    if (!assistantPayload.toolCalls().isEmpty()) {
      assistantMessage.put("tool_calls", assistantPayload.toolCalls());
    }
    LinkedHashMap<String, Object> choice = new LinkedHashMap<>();
    choice.put("index", 0);
    choice.put("message", assistantMessage);
    choice.put("finish_reason", openAiFinishReasonFromAnthropic(raw));
    return new ProviderHttpResponse(
        upstream.statusCode(),
        Map.of(
            "id",
            "chatcmpl-proxy-" + UUID.randomUUID(),
            "object",
            "chat.completion",
            "created",
            Instant.now().getEpochSecond(),
            "model",
            model,
            "choices", List.of(choice),
            "usage",
            Map.of(
                "prompt_tokens",
                intValue(
                    usage.get("input_tokens"),
                    estimatePromptTokens(requestBody.get("messages"))),
                "completion_tokens", intValue(usage.get("output_tokens"), 256),
                "total_tokens",
                intValue(
                        usage.get("input_tokens"),
                        estimatePromptTokens(requestBody.get("messages")))
                    + intValue(usage.get("output_tokens"), 256)),
            "upstream",
            raw),
        upstream.providerErrorCode());
  }

  private ProviderHttpResponse callGoogle(
      ProviderRow provider, String model, Map<String, Object> requestBody, String apiKey) {
    String url = trimBaseUrl(provider.baseUrl()) + "/models/" + model + ":generateContent?key=" + apiKey;
    ProviderHttpResponse upstream =
        postJson(
            url,
            Map.of(),
            Map.of(
                "contents",
                normalizeMessages(requestBody.get("messages"), false),
                "generationConfig",
                Map.of(
                    "temperature",
                    requestBody.get("temperature"),
                    "maxOutputTokens",
                    intValue(
                        requestBody.get("max_completion_tokens"),
                        intValue(requestBody.get("max_tokens"), 512)))),
            "google_request_failed",
            provider.timeoutMs(),
            gatewayDebugTraceId(requestBody),
            provider.slug(),
            model);
    Map<String, Object> raw = upstream.payload();
    List<?> candidates = (List<?>) raw.getOrDefault("candidates", List.of());
    String text = "";
    if (!candidates.isEmpty() && candidates.get(0) instanceof Map<?, ?> candidate) {
      Object content = candidate.get("content");
      if (content instanceof Map<?, ?> contentMap) {
        Object parts = contentMap.get("parts");
        if (parts instanceof List<?> partList && !partList.isEmpty() && partList.get(0) instanceof Map<?, ?> firstPart) {
          text = String.valueOf(firstPart.get("text"));
        }
      }
    }
    Map<String, Object> usage = (Map<String, Object>) raw.getOrDefault("usageMetadata", Map.of());
    int promptTokens = intValue(usage.get("promptTokenCount"), estimatePromptTokens(requestBody.get("messages")));
    int completionTokens = intValue(usage.get("candidatesTokenCount"), 256);
    int totalTokens = intValue(usage.get("totalTokenCount"), promptTokens + completionTokens);
    return new ProviderHttpResponse(
        upstream.statusCode(),
        Map.of(
            "id",
            "chatcmpl-proxy-" + UUID.randomUUID(),
            "object",
            "chat.completion",
            "created",
            Instant.now().getEpochSecond(),
            "model",
            model,
            "choices",
            List.of(
                Map.of(
                    "index",
                    0,
                    "message",
                    Map.of("role", "assistant", "content", text),
                    "finish_reason",
                    "stop")),
            "usage",
            Map.of(
                "prompt_tokens", promptTokens,
                "completion_tokens", completionTokens,
                "total_tokens", totalTokens),
            "upstream",
            raw),
        upstream.providerErrorCode());
  }

  private Object extractSystem(Object messagesRaw) {
    if (!(messagesRaw instanceof List<?> messages)) {
      return null;
    }
    return messages.stream()
        .filter(Map.class::isInstance)
        .map(Map.class::cast)
        .filter(item -> "system".equals(String.valueOf(item.get("role"))))
        .map(item -> stringifyMessageContent(item.get("content")))
        .filter(text -> !text.isBlank())
        .reduce((left, right) -> left + "\n\n" + right)
        .orElse(null);
  }

  private List<Map<String, Object>> normalizeMessages(Object messagesRaw, boolean anthropic) {
    if (!(messagesRaw instanceof List<?> messages)) {
      return List.of();
    }
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object item : messages) {
      if (!(item instanceof Map<?, ?> map)) {
        continue;
      }
      Object rawRole = map.get("role");
      String role = rawRole == null ? "user" : String.valueOf(rawRole);
      if ("system".equals(role)) {
        continue;
      }
      if (anthropic) {
        if ("tool".equals(role)) {
          String toolUseId = stringValue(map.get("tool_call_id"));
          String text = stringifyMessageContent(map.get("content"));
          if (toolUseId == null || toolUseId.isBlank()) {
            out.add(Map.of("role", "user", "content", text));
          } else {
            out.add(
                Map.of(
                    "role",
                    "user",
                    "content",
                    List.of(
                        Map.of(
                            "type", "tool_result",
                            "tool_use_id", toolUseId,
                            "content", text))));
          }
          continue;
        }
        if ("assistant".equals(role)) {
          ArrayList<Map<String, Object>> blocks = new ArrayList<>();
          String text = stringifyMessageContent(map.get("content"));
          if (!text.isBlank()) {
            blocks.add(Map.of("type", "text", "text", text));
          }
          if (map.get("tool_calls") instanceof List<?> toolCalls) {
            for (Object toolCall : toolCalls) {
              Map<String, Object> normalizedToolUse = openAiToolCallToAnthropic(toolCall);
              if (!normalizedToolUse.isEmpty()) {
                blocks.add(normalizedToolUse);
              }
            }
          }
          if (blocks.isEmpty()) {
            out.add(Map.of("role", "assistant", "content", ""));
          } else if (blocks.size() == 1 && "text".equals(String.valueOf(blocks.get(0).get("type")))) {
            out.add(Map.of("role", "assistant", "content", blocks.get(0).get("text")));
          } else {
            out.add(Map.of("role", "assistant", "content", blocks));
          }
          continue;
        }
        out.add(Map.of("role", "user", "content", stringifyMessageContent(map.get("content"))));
        continue;
      }
      String text = stringifyMessageContent(map.get("content"));
      out.add(
          Map.of(
              "role", "assistant".equals(role) ? "model" : "user",
              "parts", List.of(Map.of("text", text))));
    }
    return out;
  }

  private Map<String, Object> normalizeAnthropicMessagesRequest(Map<String, Object> requestBody) {
    LinkedHashMap<String, Object> normalized = new LinkedHashMap<>();
    String model = normalizeRequestedModel(requestBody.get("model"));
    if (model != null) {
      normalized.put("model", model);
    }
    if (requestBody.get("temperature") != null) {
      normalized.put("temperature", requestBody.get("temperature"));
    }
    if (requestBody.get("max_tokens") != null) {
      normalized.put("max_tokens", requestBody.get("max_tokens"));
    }
    if (requestBody.get("max_completion_tokens") != null) {
      normalized.put("max_completion_tokens", requestBody.get("max_completion_tokens"));
    }
    if (requestBody.get("top_p") != null) {
      normalized.put("top_p", requestBody.get("top_p"));
    }
    List<Map<String, Object>> tools = anthropicToolsToOpenAi(requestBody.get("tools"));
    if (!tools.isEmpty()) {
      normalized.put("tools", tools);
    }
    Object toolChoice = anthropicToolChoiceToOpenAi(requestBody.get("tool_choice"));
    if (toolChoice != null) {
      normalized.put("tool_choice", toolChoice);
    }
    normalized.put("messages", anthropicMessagesToOpenAiMessages(requestBody));
    return normalized;
  }

  private Map<String, Object> normalizeAnthropicGatewayResponse(Map<String, Object> payload) {
    LinkedHashMap<String, Object> normalized = new LinkedHashMap<>();
    normalized.put("id", String.valueOf(payload.getOrDefault("id", "msg_" + Ids.shortHex(8))));
    normalized.put("type", "message");
    normalized.put("role", "assistant");
    normalized.put("content", anthropicResponseContent(payload));
    normalized.put("model", stringValue(payload.get("model")));
    normalized.put("stop_reason", anthropicStopReason(payload));
    normalized.put("stop_sequence", null);
    Map<String, Object> usage = nestedMap(payload.get("usage"));
    normalized.put(
        "usage",
        Map.of(
            "input_tokens",
            intValue(usage.get("prompt_tokens"), 0),
            "output_tokens",
            intValue(usage.get("completion_tokens"), 0)));
    return normalized;
  }

  private Map<String, Object> normalizePayload(String model, Map<String, Object> payload, int promptTokens, int completionTokens, int totalTokens) {
    if (payload.containsKey("choices")) {
      return payload;
    }
    return Map.of(
        "id", "chatcmpl-proxy-" + Ids.shortHex(8),
        "object", "chat.completion",
        "created", Instant.now().getEpochSecond(),
        "model", model,
        "choices", List.of(Map.of("index", 0, "message", Map.of("role", "assistant", "content", String.valueOf(payload.getOrDefault("text", ""))), "finish_reason", "stop")),
        "usage", Map.of("prompt_tokens", promptTokens, "completion_tokens", completionTokens, "total_tokens", totalTokens),
        "upstream", payload);
  }

  @Transactional
  private void persistGatewaySuccess(
      AppKeyRow appKey,
      ProviderExecution execution,
      Map<String, Object> responsePayload,
      String requestIp,
      String idempotencyKey,
      String model,
      BigDecimal subtotal,
      BigDecimal inputPrice,
      BigDecimal outputPrice,
      RoutingConfig routingConfig) {
    Instant now = Instant.now();
    String requestId = "req_" + Ids.shortHex(8);
    String traceId = "trace_" + Ids.shortHex(8);
    String logId = Ids.cuidLike("log");
    String routingPrimary =
        firstNonBlank(
            routingConfig.primaryProviderType(),
            execution.catalog() == null ? null : execution.catalog().providerType(),
            "openai");
    String routingReason =
        execution.attempts() > 1
            ? "fallback_from_" + routingPrimary
            : null;
    jdbcTemplate.update(
        """
        insert into api_request_logs (
          id, tenant_id, user_id, app_key_id, provider_id, request_id, trace_id, model,
          prompt_tokens, completion_tokens, total_tokens, latency_ms, cache_hit,
          routing_primary, routing_actual, routing_reason, provider_error_code, retry_count,
          request_source_ip, status_code, idempotency_key, created_at
        ) values (
          :id, :tenantId, :userId, :appKeyId, :providerId, :requestId, :traceId, :model,
          :promptTokens, :completionTokens, :totalTokens, :latencyMs, false,
          :routingPrimary, :routingActual, :routingReason, :providerErrorCode, :retryCount,
          :requestSourceIp, :statusCode, :idempotencyKey, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", logId)
            .addValue("tenantId", appKey.tenantId())
            .addValue("userId", appKey.ownerUserId())
            .addValue("appKeyId", appKey.id())
            .addValue("providerId", execution.provider().id())
            .addValue("requestId", requestId)
            .addValue("traceId", traceId)
            .addValue("model", model)
            .addValue("promptTokens", execution.promptTokens())
            .addValue("completionTokens", execution.completionTokens())
            .addValue("totalTokens", execution.totalTokens())
            .addValue("latencyMs", execution.latencyMs())
            .addValue("routingPrimary", routingPrimary)
            .addValue("routingActual", execution.provider().slug())
            .addValue("routingReason", routingReason)
            .addValue("providerErrorCode", execution.providerErrorCode())
            .addValue("retryCount", execution.attempts() - 1)
            .addValue("requestSourceIp", requestIp)
            .addValue("statusCode", execution.upstreamStatusCode())
            .addValue("idempotencyKey", idempotencyKey)
            .addValue("createdAt", ts(now)));
    jdbcTemplate.update(
        "insert into usage_records (id, log_id, tenant_id, period, total_tokens, created_at) values (:id, :logId, :tenantId, :period, :totalTokens, :createdAt)",
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("usage"))
            .addValue("logId", logId)
            .addValue("tenantId", appKey.tenantId())
            .addValue("period", MoneyUtils.dayPeriod())
            .addValue("totalTokens", execution.totalTokens())
            .addValue("createdAt", ts(now)));
    jdbcTemplate.update(
        """
        insert into billing_records (
          id, log_id, tenant_id, amount_usd, subtotal_usd, input_unit_price_usd, output_unit_price_usd,
          quantity_prompt_tokens, quantity_completion_tokens, tax_rate_pct, tax_amount_usd,
          reconciliation_status, invoice_status, currency, type, description, created_at
        ) values (
          :id, :logId, :tenantId, :amountUsd, :subtotalUsd, :inputPrice, :outputPrice,
          :promptTokens, :completionTokens, 0, 0, 'settled', 'not_requested', 'USD', 'usage',
          :description, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("bill"))
            .addValue("logId", logId)
            .addValue("tenantId", appKey.tenantId())
            .addValue("amountUsd", subtotal)
            .addValue("subtotalUsd", subtotal)
            .addValue("inputPrice", inputPrice)
            .addValue("outputPrice", outputPrice)
            .addValue("promptTokens", execution.promptTokens())
            .addValue("completionTokens", execution.completionTokens())
            .addValue("description", "LLM usage — " + model + " via " + execution.provider().slug())
            .addValue("createdAt", ts(now)));
    jdbcTemplate.update(
        "update tenants set balance_tokens = balance_tokens - :tokens where id = :tenantId",
        Map.of("tokens", BigDecimal.valueOf(execution.totalTokens()), "tenantId", appKey.tenantId()));
    jdbcTemplate.update(
        "update app_keys set last_used_at = :now, last_used_ip = :ip where id = :id",
        Map.of("now", ts(now), "ip", requestIp, "id", appKey.id()));
    auditService.write(appKey.tenantId(), null, "app_key", "gateway.chat_completion", "api_request_log", logId, requestIp, Map.of("provider", execution.provider().slug(), "model", model));
  }

  @Transactional
  private void recordCacheHit(AppKeyRow appKey, String model, String requestIp, String idempotencyKey, Map<String, Object> responsePayload) {
    ProviderRow provider =
        jdbcTemplate.query(
                "select id, name, slug, provider_type, status, enabled, base_url, api_key_ciphertext, '[]' as model_catalog, priority, timeout_ms, health_status from providers order by priority asc limit 1",
                PROVIDER_ROW_MAPPER)
            .stream()
            .findFirst()
            .orElse(null);
    if (provider == null) {
      return;
    }
    CachedResponseUsageEstimate.Result usageEst = CachedResponseUsageEstimate.fromPayload(responsePayload);
    String logId = Ids.cuidLike("log");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into api_request_logs (
          id, tenant_id, user_id, app_key_id, provider_id, request_id, trace_id, model, prompt_tokens, completion_tokens,
          total_tokens, latency_ms, cache_hit, routing_primary, routing_actual, retry_count, request_source_ip,
          status_code, idempotency_key, saved_tokens_estimate, saved_prompt_tokens, saved_completion_tokens, created_at
        ) values (
          :id, :tenantId, :userId, :appKeyId, :providerId, :requestId, :traceId, :model, 0, 0, 0, 8, true, 'cache', 'cache', 0, :ip, 200, :idempotencyKey,
          :savedTokensEstimate, :savedPromptTokens, :savedCompletionTokens, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", logId)
            .addValue("tenantId", appKey.tenantId())
            .addValue("userId", appKey.ownerUserId())
            .addValue("appKeyId", appKey.id())
            .addValue("providerId", provider.id())
            .addValue("requestId", "req_" + Ids.shortHex(8))
            .addValue("traceId", "trace_" + Ids.shortHex(8))
            .addValue("model", model)
            .addValue("ip", requestIp)
            .addValue("idempotencyKey", idempotencyKey)
            .addValue("savedTokensEstimate", usageEst.savedTokensEstimate())
            .addValue("savedPromptTokens", usageEst.savedPromptTokens())
            .addValue("savedCompletionTokens", usageEst.savedCompletionTokens())
            .addValue("createdAt", ts(now)));
    jdbcTemplate.update(
        "insert into usage_records (id, log_id, tenant_id, period, total_tokens, created_at) values (:id, :logId, :tenantId, :period, 0, :createdAt)",
        new MapSqlParameterSource().addValue("id", Ids.cuidLike("usage")).addValue("logId", logId).addValue("tenantId", appKey.tenantId()).addValue("period", MoneyUtils.dayPeriod()).addValue("createdAt", ts(now)));
    jdbcTemplate.update(
        """
        insert into billing_records (
          id, log_id, tenant_id, amount_usd, subtotal_usd, input_unit_price_usd, output_unit_price_usd,
          quantity_prompt_tokens, quantity_completion_tokens, tax_rate_pct, tax_amount_usd,
          reconciliation_status, invoice_status, currency, type, description, created_at
        ) values (
          :id, :logId, :tenantId, 0, 0, 0, 0, 0, 0, 0, 0, 'settled', 'not_requested', 'USD', 'cache_hit',
          'Idempotent cache hit — no charge', :createdAt
        )
        """,
        new MapSqlParameterSource().addValue("id", Ids.cuidLike("bill")).addValue("logId", logId).addValue("tenantId", appKey.tenantId()).addValue("createdAt", ts(now)));
    jdbcTemplate.update("update app_keys set last_used_at = :now, last_used_ip = :ip where id = :id", Map.of("now", ts(now), "ip", requestIp, "id", appKey.id()));
  }

  private static String trimBaseUrl(String baseUrl) {
    return baseUrl == null ? "" : baseUrl.replaceAll("/+$", "");
  }

  private ProviderHttpResponse postJson(
      String url,
      Map<String, String> headers,
      Object body,
      String fallbackProviderErrorCode,
      int timeoutMs,
      String debugTraceId,
      String providerSlug,
      String model) {
    return webClient
        .post()
        .uri(url)
        .headers(httpHeaders -> headers.forEach(httpHeaders::set))
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchangeToMono(
            response ->
                response
                    .toEntity(String.class)
                    .map(
                        entity ->
                            toProviderHttpResponse(
                                entity,
                                fallbackProviderErrorCode,
                                debugTraceId,
                                providerSlug,
                                url,
                                model)))
        .timeout(Duration.ofMillis(Math.max(timeoutMs, 1000)))
        .onErrorMap(
            java.util.concurrent.TimeoutException.class,
            error -> {
              logProviderTransportFailure(
                  "gateway.provider.timeout",
                  debugTraceId,
                  providerSlug,
                  model,
                  url,
                  "timeout");
              return new ApiException(
                  504,
                  providerNameFromErrorCode(fallbackProviderErrorCode) + " request timed out",
                  "timeout");
            })
        .onErrorMap(
            error ->
                !(error instanceof ApiException),
            error -> {
              logProviderTransportFailure(
                  "gateway.provider.network_error",
                  debugTraceId,
                  providerSlug,
                  model,
                  url,
                  error.getMessage());
              return new ApiException(
                  502,
                  error.getMessage() == null
                      ? providerNameFromErrorCode(fallbackProviderErrorCode) + " request failed"
                      : error.getMessage(),
                  "network_error");
            })
        .block();
  }

  private ProviderHttpResponse toProviderHttpResponse(
      org.springframework.http.ResponseEntity<String> entity,
      String fallbackProviderErrorCode,
      String debugTraceId,
      String providerSlug,
      String url,
      String model) {
    Map<String, Object> payload = readBodyAsMap(entity.getBody());
    int statusCode = entity.getStatusCode().value();
    if (statusCode >= 400) {
      Map<String, Object> nestedError = nestedMap(payload.get("error"));
      String providerErrorCode =
          firstNonBlank(
              stringValue(nestedError.get("code")),
              stringValue(nestedError.get("type")),
              stringValue(nestedError.get("status")),
              stringValue(payload.get("code")),
              fallbackProviderErrorCode);
      String providerMessage =
          firstNonBlank(
              stringValue(nestedError.get("message")),
              stringValue(payload.get("message")),
              stringValue(payload.get("error")),
              "Provider request failed");
      if (debugTraceId != null) {
        log.warn(
            "gateway.provider.http_error traceId={} provider={} model={} url={} status={} code={} upstreamRequestId={} message={}",
            debugTraceId,
            providerSlug,
            model,
            url,
            statusCode,
            providerErrorCode,
            extractUpstreamRequestId(payload, providerMessage),
            providerMessage);
      }
      throw new ApiException(
          statusCode,
          providerMessage,
          providerErrorCode);
    }
    return new ProviderHttpResponse(statusCode, payload, null);
  }

  private Map<String, Object> readBodyAsMap(String raw) {
    if (raw == null || raw.isBlank()) {
      return Map.of();
    }
    try {
      return jsons.readObject(raw);
    } catch (Exception ignored) {
      return Map.of("raw", raw);
    }
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return null;
  }

  private static String normalizeRequestedModel(Object rawModel) {
    if (rawModel == null) {
      return null;
    }
    String model = String.valueOf(rawModel).trim();
    return model.isBlank() ? null : model;
  }

  private static String stringValue(Object value) {
    return value == null ? null : String.valueOf(value);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> nestedMap(Object value) {
    return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
  }

  private static String providerNameFromErrorCode(String errorCode) {
    if (errorCode == null) {
      return "Provider";
    }
    if (errorCode.startsWith("openai")) {
      return "OpenAI";
    }
    if (errorCode.startsWith("anthropic")) {
      return "Anthropic";
    }
    if (errorCode.startsWith("google")) {
      return "Google";
    }
    return "Provider";
  }

  private String stringifyMessageContent(Object rawContent) {
    if (rawContent == null) {
      return "";
    }
    if (rawContent instanceof String text) {
      return text;
    }
    if (rawContent instanceof List<?>) {
      return jsons.stringify(rawContent);
    }
    return String.valueOf(rawContent);
  }

  private String anthropicContentToText(Object rawContent) {
    if (rawContent == null) {
      return "";
    }
    if (rawContent instanceof String text) {
      return text;
    }
    if (rawContent instanceof List<?> blocks) {
      StringBuilder builder = new StringBuilder();
      for (Object block : blocks) {
        if (block instanceof Map<?, ?> map) {
          Object text = map.get("text");
          if (text != null) {
            if (builder.length() > 0) {
              builder.append('\n');
            }
            builder.append(text);
          }
        }
      }
      if (builder.length() > 0) {
        return builder.toString();
      }
    }
    return stringifyMessageContent(rawContent);
  }

  private void logAnthropicNormalization(
      String debugTraceId,
      String requestIp,
      boolean stream,
      Map<String, Object> anthropicRequest,
      Map<String, Object> normalizedOpenAiRequest) {
    Map<String, Object> rawSummary = summarizeAnthropicRequest(anthropicRequest);
    Map<String, Object> normalizedSummary = summarizeOpenAiRequest(normalizedOpenAiRequest);
    int rawMaxToolUseBlocks = intValue(rawSummary.get("max_tool_use_blocks"), 0);
    int normalizedMaxToolCalls = intValue(normalizedSummary.get("max_tool_calls"), 0);
    log.info(
        "gateway.anthropic.debug traceId={} stream={} requestIp={} raw={} normalized={}",
        debugTraceId,
        stream,
        requestIp,
        jsons.stringify(rawSummary),
        jsons.stringify(normalizedSummary));
    if (rawMaxToolUseBlocks > 120 || normalizedMaxToolCalls > 120) {
      log.warn(
          "gateway.anthropic.debug.near_limit traceId={} stream={} requestIp={} rawMaxToolUseBlocks={} normalizedMaxToolCalls={}",
          debugTraceId,
          stream,
          requestIp,
          rawMaxToolUseBlocks,
          normalizedMaxToolCalls);
    }
  }

  private void logProviderTransportFailure(
      String eventName,
      String debugTraceId,
      String providerSlug,
      String model,
      String url,
      String message) {
    if (debugTraceId == null) {
      return;
    }
    log.warn(
        "{} traceId={} provider={} model={} url={} message={}",
        eventName,
        debugTraceId,
        providerSlug,
        model,
        url,
        message);
  }

  private Map<String, Object> withGatewayDebugTraceId(
      Map<String, Object> requestBody, String debugTraceId) {
    LinkedHashMap<String, Object> copy = new LinkedHashMap<>(requestBody);
    copy.put(INTERNAL_DEBUG_TRACE_ID, debugTraceId);
    return copy;
  }

  private String gatewayDebugTraceId(Map<String, Object> requestBody) {
    return requestBody == null ? null : stringValue(requestBody.get(INTERNAL_DEBUG_TRACE_ID));
  }

  private String extractUpstreamRequestId(Map<String, Object> payload, String providerMessage) {
    String raw =
        firstNonBlank(
            stringValue(payload.get("request_id")),
            stringValue(payload.get("requestId")),
            providerMessage);
    if (raw == null || raw.isBlank()) {
      return null;
    }
    Matcher matcher = UPSTREAM_REQUEST_ID_PATTERN.matcher(raw);
    if (matcher.find()) {
      return matcher.group(1);
    }
    return raw.contains("request id") ? raw : null;
  }

  private Map<String, Object> summarizeAnthropicRequest(Map<String, Object> requestBody) {
    LinkedHashMap<String, Object> summary = new LinkedHashMap<>();
    summary.put("model", normalizeRequestedModel(requestBody.get("model")));
    summary.put("stream", requestBody.get("stream"));
    summary.put("messages_count", listSize(requestBody.get("messages")));
    summary.put("system_blocks", contentBlockCount(requestBody.get("system")));
    summary.put("tools_count", listSize(requestBody.get("tools")));
    summary.put("tool_choice", toolChoiceSummary(requestBody.get("tool_choice")));

    ArrayList<Map<String, Object>> perMessage = new ArrayList<>();
    int maxToolUseBlocks = 0;
    if (requestBody.get("messages") instanceof List<?> messages) {
      for (int i = 0; i < messages.size(); i++) {
        if (!(messages.get(i) instanceof Map<?, ?> map)) {
          continue;
        }
        String role = stringValue(map.get("role"));
        Object content = map.get("content");
        int contentBlocks = contentBlockCount(content);
        int toolUseBlocks = anthropicBlockTypeCount(content, "tool_use");
        int toolResultBlocks = anthropicBlockTypeCount(content, "tool_result");
        int textBlocks = anthropicBlockTypeCount(content, "text");
        maxToolUseBlocks = Math.max(maxToolUseBlocks, toolUseBlocks);
        perMessage.add(
            Map.of(
                "index", i,
                "role", role == null ? "user" : role,
                "content_blocks", contentBlocks,
                "text_blocks", textBlocks,
                "tool_use_blocks", toolUseBlocks,
                "tool_result_blocks", toolResultBlocks));
      }
    }
    summary.put("max_tool_use_blocks", maxToolUseBlocks);
    summary.put("message_summaries", perMessage);
    return summary;
  }

  private Map<String, Object> summarizeOpenAiRequest(Map<String, Object> requestBody) {
    LinkedHashMap<String, Object> summary = new LinkedHashMap<>();
    summary.put("model", normalizeRequestedModel(requestBody.get("model")));
    summary.put("stream", requestBody.get("stream"));
    summary.put("messages_count", listSize(requestBody.get("messages")));
    summary.put("tools_count", listSize(requestBody.get("tools")));
    summary.put("tool_choice", toolChoiceSummary(requestBody.get("tool_choice")));

    ArrayList<Map<String, Object>> perMessage = new ArrayList<>();
    int maxToolCalls = 0;
    if (requestBody.get("messages") instanceof List<?> messages) {
      for (int i = 0; i < messages.size(); i++) {
        if (!(messages.get(i) instanceof Map<?, ?> map)) {
          continue;
        }
        String role = stringValue(map.get("role"));
        int contentBlocks = contentBlockCount(map.get("content"));
        int toolCalls = listSize(map.get("tool_calls"));
        maxToolCalls = Math.max(maxToolCalls, toolCalls);
        perMessage.add(
            Map.of(
                "index", i,
                "role", role == null ? "user" : role,
                "content_blocks", contentBlocks,
                "tool_calls", toolCalls));
      }
    }
    summary.put("max_tool_calls", maxToolCalls);
    summary.put("message_summaries", perMessage);
    return summary;
  }

  private int listSize(Object raw) {
    return raw instanceof List<?> list ? list.size() : 0;
  }

  private int contentBlockCount(Object rawContent) {
    if (rawContent instanceof List<?> blocks) {
      return blocks.size();
    }
    return rawContent == null ? 0 : 1;
  }

  private int anthropicBlockTypeCount(Object rawContent, String type) {
    if (!(rawContent instanceof List<?> blocks)) {
      return 0;
    }
    int count = 0;
    for (Object block : blocks) {
      if (block instanceof Map<?, ?> map
          && type.equals(stringValue(map.get("type")))) {
        count++;
      }
    }
    return count;
  }

  private Map<String, Object> toolChoiceSummary(Object rawToolChoice) {
    LinkedHashMap<String, Object> summary = new LinkedHashMap<>();
    if (rawToolChoice == null) {
      summary.put("type", "none");
      return summary;
    }
    if (rawToolChoice instanceof String text) {
      summary.put("type", text);
      return summary;
    }
    Map<String, Object> map = nestedMap(rawToolChoice);
    summary.put("type", firstNonBlank(stringValue(map.get("type")), "object"));
    String name = stringValue(map.get("name"));
    if (name == null) {
      name = stringValue(nestedMap(map.get("function")).get("name"));
    }
    if (name != null && !name.isBlank()) {
      summary.put("name", name);
    }
    return summary;
  }

  private Map<String, Object> disableStreamFlag(Map<String, Object> requestBody) {
    LinkedHashMap<String, Object> normalized = new LinkedHashMap<>(requestBody);
    normalized.put("stream", false);
    return normalized;
  }

  private boolean includeOpenAiUsageInStream(Map<String, Object> requestBody) {
    Map<String, Object> streamOptions = nestedMap(requestBody.get("stream_options"));
    Object includeUsage = streamOptions.get("include_usage");
    if (includeUsage instanceof Boolean bool) {
      return bool;
    }
    return includeUsage != null && "true".equalsIgnoreCase(String.valueOf(includeUsage));
  }

  private List<String> buildOpenAiStreamEvents(
      Map<String, Object> payload, boolean includeUsage) {
    ArrayList<String> events = new ArrayList<>();
    String id = firstNonBlank(stringValue(payload.get("id")), "chatcmpl-proxy-" + Ids.shortHex(8));
    long created = longValue(payload.get("created"), Instant.now().getEpochSecond());
    String model = firstNonBlank(stringValue(payload.get("model")), "");
    Map<String, Object> message = firstChoiceMessage(payload);
    events.add(sseData(openAiStreamChunk(id, created, model, Map.of("role", "assistant"), null)));

    String content = stringValue(message.get("content"));
    if (content != null && !content.isBlank()) {
      events.add(sseData(openAiStreamChunk(id, created, model, Map.of("content", content), null)));
    }

    if (message.get("tool_calls") instanceof List<?> toolCalls) {
      for (int i = 0; i < toolCalls.size(); i++) {
        Map<String, Object> toolCall = nestedMap(toolCalls.get(i));
        if (toolCall.isEmpty()) {
          continue;
        }
        events.add(
            sseData(
                openAiStreamChunk(
                    id,
                    created,
                    model,
                    Map.of(
                        "tool_calls",
                        List.of(
                            Map.of(
                                "index", i,
                                "id", firstNonBlank(stringValue(toolCall.get("id")), "call_" + Ids.shortHex(8)),
                                "type", firstNonBlank(stringValue(toolCall.get("type")), "function"),
                                "function", nestedMap(toolCall.get("function"))))),
                    null)));
      }
    }

    String finishReason = openAiFinishReason(payload);
    events.add(sseData(openAiStreamChunk(id, created, model, Map.of(), finishReason)));

    if (includeUsage) {
      Map<String, Object> usage = nestedMap(payload.get("usage"));
      if (!usage.isEmpty()) {
        events.add(
            sseData(
                Map.of(
                    "id", id,
                    "object", "chat.completion.chunk",
                    "created", created,
                    "model", model,
                    "choices", List.of(),
                    "usage", usage)));
      }
    }
    events.add("data: [DONE]\n\n");
    return events;
  }

  private List<String> buildAnthropicStreamEvents(Map<String, Object> payload) {
    ArrayList<String> events = new ArrayList<>();
    String id = firstNonBlank(stringValue(payload.get("id")), "msg_" + Ids.shortHex(8));
    String model = firstNonBlank(stringValue(payload.get("model")), "");
    Map<String, Object> usage = nestedMap(payload.get("usage"));
    List<Map<String, Object>> contentBlocks = contentBlocks(payload.get("content"));

    LinkedHashMap<String, Object> message = new LinkedHashMap<>();
    message.put("id", id);
    message.put("type", "message");
    message.put("role", "assistant");
    message.put("content", List.of());
    message.put("model", model);
    message.put("stop_reason", null);
    message.put("stop_sequence", null);
    message.put(
        "usage",
        Map.of(
            "input_tokens", intValue(usage.get("input_tokens"), 0),
            "output_tokens", 0));
    events.add(sseEvent("message_start", Map.of("type", "message_start", "message", message)));

    for (int i = 0; i < contentBlocks.size(); i++) {
      Map<String, Object> block = contentBlocks.get(i);
      String type = stringValue(block.get("type"));
      if ("tool_use".equals(type)) {
        events.add(
            sseEvent(
                "content_block_start",
                Map.of(
                    "type", "content_block_start",
                    "index", i,
                    "content_block",
                    Map.of(
                        "type", "tool_use",
                        "id", firstNonBlank(stringValue(block.get("id")), "toolu_" + Ids.shortHex(8)),
                        "name", firstNonBlank(stringValue(block.get("name")), "tool"),
                        "input", Map.of()))));
        events.add(
            sseEvent(
                "content_block_delta",
                Map.of(
                    "type", "content_block_delta",
                    "index", i,
                    "delta",
                    Map.of(
                        "type", "input_json_delta",
                        "partial_json", jsons.stringify(nestedMap(block.get("input")))))));
        events.add(
            sseEvent(
                "content_block_stop",
                Map.of("type", "content_block_stop", "index", i)));
        continue;
      }
      events.add(
          sseEvent(
              "content_block_start",
              Map.of(
                  "type", "content_block_start",
                  "index", i,
                  "content_block", Map.of("type", "text", "text", ""))));
      events.add(
          sseEvent(
              "content_block_delta",
              Map.of(
                  "type", "content_block_delta",
                  "index", i,
                  "delta",
                  Map.of("type", "text_delta", "text", firstNonBlank(stringValue(block.get("text")), "")))));
      events.add(
          sseEvent(
              "content_block_stop",
              Map.of("type", "content_block_stop", "index", i)));
    }

    events.add(
        sseEvent(
            "message_delta",
            anthropicMessageDeltaEvent(
                payload.get("stop_reason"),
                payload.get("stop_sequence"),
                intValue(usage.get("output_tokens"), 0))));
    events.add(sseEvent("message_stop", Map.of("type", "message_stop")));
    return events;
  }

  private Map<String, Object> openAiStreamChunk(
      String id,
      long created,
      String model,
      Map<String, Object> delta,
      String finishReason) {
    LinkedHashMap<String, Object> choice = new LinkedHashMap<>();
    choice.put("index", 0);
    choice.put("delta", delta);
    choice.put("finish_reason", finishReason);
    LinkedHashMap<String, Object> chunk = new LinkedHashMap<>();
    chunk.put("id", id);
    chunk.put("object", "chat.completion.chunk");
    chunk.put("created", created);
    chunk.put("model", model);
    chunk.put("choices", List.of(choice));
    return chunk;
  }

  private Map<String, Object> anthropicMessageDeltaEvent(
      Object stopReason, Object stopSequence, int outputTokens) {
    LinkedHashMap<String, Object> delta = new LinkedHashMap<>();
    delta.put("stop_reason", stopReason);
    delta.put("stop_sequence", stopSequence);
    LinkedHashMap<String, Object> event = new LinkedHashMap<>();
    event.put("type", "message_delta");
    event.put("delta", delta);
    event.put("usage", Map.of("output_tokens", outputTokens));
    return event;
  }

  private List<Map<String, Object>> contentBlocks(Object rawContent) {
    if (!(rawContent instanceof List<?> blocks)) {
      return List.of(Map.of("type", "text", "text", anthropicContentToText(rawContent)));
    }
    ArrayList<Map<String, Object>> normalized = new ArrayList<>();
    for (Object block : blocks) {
      Map<String, Object> map = nestedMap(block);
      if (!map.isEmpty()) {
        normalized.add(map);
      }
    }
    return normalized;
  }

  private String openAiFinishReason(Map<String, Object> payload) {
    Object rawChoices = payload.get("choices");
    if (!(rawChoices instanceof List<?> choices) || choices.isEmpty()) {
      return "stop";
    }
    Object first = choices.get(0);
    if (!(first instanceof Map<?, ?> firstChoice)) {
      return "stop";
    }
    return firstNonBlank(stringValue(firstChoice.get("finish_reason")), "stop");
  }

  private String sseData(Object data) {
    return "data: " + jsons.stringify(data) + "\n\n";
  }

  private String sseEvent(String event, Object data) {
    return "event: " + event + "\n" + "data: " + jsons.stringify(data) + "\n\n";
  }

  private List<Map<String, Object>> anthropicMessagesToOpenAiMessages(Map<String, Object> requestBody) {
    ArrayList<Map<String, Object>> messages = new ArrayList<>();
    String system = anthropicContentToText(requestBody.get("system"));
    if (!system.isBlank()) {
      messages.add(Map.of("role", "system", "content", system));
    }
    if (!(requestBody.get("messages") instanceof List<?> rawMessages)) {
      return messages;
    }
    for (Object item : rawMessages) {
      if (!(item instanceof Map<?, ?> map)) {
        continue;
      }
      String role = stringValue(map.get("role"));
      if ("system".equals(role)) {
        String systemText = anthropicContentToText(map.get("content"));
        if (!systemText.isBlank()) {
          messages.add(Map.of("role", "system", "content", systemText));
        }
        continue;
      }
      if ("assistant".equals(role)) {
        LinkedHashMap<String, Object> assistantMessage = new LinkedHashMap<>();
        assistantMessage.put("role", "assistant");
        String text = anthropicTextBlocksToString(map.get("content"));
        if (!text.isBlank()) {
          assistantMessage.put("content", text);
        }
        List<Map<String, Object>> toolCalls = anthropicToolUseBlocksToOpenAi(map.get("content"));
        if (!toolCalls.isEmpty()) {
          assistantMessage.put("tool_calls", toolCalls);
        }
        if (!assistantMessage.containsKey("content")) {
          assistantMessage.put("content", "");
        }
        messages.add(assistantMessage);
        continue;
      }
      appendAnthropicUserContent(messages, map.get("content"));
    }
    return messages;
  }

  private void appendAnthropicUserContent(List<Map<String, Object>> messages, Object rawContent) {
    if (rawContent instanceof String text) {
      if (!text.isBlank()) {
        messages.add(Map.of("role", "user", "content", text));
      }
      return;
    }
    if (!(rawContent instanceof List<?> blocks)) {
      String text = anthropicContentToText(rawContent);
      if (!text.isBlank()) {
        messages.add(Map.of("role", "user", "content", text));
      }
      return;
    }
    StringBuilder textBuilder = new StringBuilder();
    for (Object block : blocks) {
      if (!(block instanceof Map<?, ?> map)) {
        continue;
      }
      String type = stringValue(map.get("type"));
      if ("tool_result".equals(type)) {
        if (textBuilder.length() > 0) {
          messages.add(Map.of("role", "user", "content", textBuilder.toString()));
          textBuilder.setLength(0);
        }
        String toolUseId = stringValue(map.get("tool_use_id"));
        String content = anthropicContentToText(map.get("content"));
        if (toolUseId != null && !toolUseId.isBlank()) {
          messages.add(
              Map.of(
                  "role", "tool",
                  "tool_call_id", toolUseId,
                  "content", content));
        } else if (!content.isBlank()) {
          messages.add(Map.of("role", "user", "content", content));
        }
        continue;
      }
      String text = anthropicContentToText(List.of(map));
      if (!text.isBlank()) {
        if (textBuilder.length() > 0) {
          textBuilder.append('\n');
        }
        textBuilder.append(text);
      }
    }
    if (textBuilder.length() > 0) {
      messages.add(Map.of("role", "user", "content", textBuilder.toString()));
    }
  }

  private String anthropicTextBlocksToString(Object rawContent) {
    if (rawContent instanceof String text) {
      return text;
    }
    if (!(rawContent instanceof List<?> blocks)) {
      return anthropicContentToText(rawContent);
    }
    StringBuilder builder = new StringBuilder();
    for (Object block : blocks) {
      if (!(block instanceof Map<?, ?> map)) {
        continue;
      }
      String type = stringValue(map.get("type"));
      if (!"text".equals(type)) {
        continue;
      }
      String text = stringValue(map.get("text"));
      if (text == null || text.isBlank()) {
        continue;
      }
      if (builder.length() > 0) {
        builder.append('\n');
      }
      builder.append(text);
    }
    return builder.toString();
  }

  private List<Map<String, Object>> anthropicToolUseBlocksToOpenAi(Object rawContent) {
    if (!(rawContent instanceof List<?> blocks)) {
      return List.of();
    }
    ArrayList<Map<String, Object>> toolCalls = new ArrayList<>();
    for (Object block : blocks) {
      if (!(block instanceof Map<?, ?> map)) {
        continue;
      }
      if (!"tool_use".equals(stringValue(map.get("type")))) {
        continue;
      }
      String id = firstNonBlank(stringValue(map.get("id")), "call_" + Ids.shortHex(8));
      String name = stringValue(map.get("name"));
      LinkedHashMap<String, Object> function = new LinkedHashMap<>();
      function.put("name", name == null ? "tool" : name);
      Object input = map.containsKey("input") ? map.get("input") : Map.of();
      function.put("arguments", jsons.stringify(input));
      LinkedHashMap<String, Object> toolCall = new LinkedHashMap<>();
      toolCall.put("id", id);
      toolCall.put("type", "function");
      toolCall.put("function", function);
      toolCalls.add(toolCall);
    }
    return toolCalls;
  }

  private List<Map<String, Object>> anthropicToolsToOpenAi(Object rawTools) {
    if (!(rawTools instanceof List<?> tools)) {
      return List.of();
    }
    ArrayList<Map<String, Object>> normalized = new ArrayList<>();
    for (Object item : tools) {
      if (!(item instanceof Map<?, ?> map)) {
        continue;
      }
      String name = stringValue(map.get("name"));
      if (name == null || name.isBlank()) {
        continue;
      }
      LinkedHashMap<String, Object> function = new LinkedHashMap<>();
      function.put("name", name);
      if (map.get("description") != null) {
        function.put("description", map.get("description"));
      }
      function.put("parameters", nestedMap(map.get("input_schema")));
      normalized.add(Map.of("type", "function", "function", function));
    }
    return normalized;
  }

  private Object anthropicToolChoiceToOpenAi(Object rawToolChoice) {
    if (rawToolChoice == null) {
      return null;
    }
    if (rawToolChoice instanceof String text) {
      return text;
    }
    Map<String, Object> choice = nestedMap(rawToolChoice);
    String type = stringValue(choice.get("type"));
    if (type == null || type.isBlank()) {
      return null;
    }
    return switch (type) {
      case "auto" -> "auto";
      case "none" -> "none";
      case "any" -> "required";
      case "tool" -> {
        String name = stringValue(choice.get("name"));
        if (name == null || name.isBlank()) {
          yield "required";
        }
        yield Map.of("type", "function", "function", Map.of("name", name));
      }
      default -> null;
    };
  }

  private List<Map<String, Object>> anthropicResponseContent(Map<String, Object> payload) {
    Map<String, Object> message = firstChoiceMessage(payload);
    if (message.isEmpty()) {
      return List.of(Map.of("type", "text", "text", ""));
    }
    ArrayList<Map<String, Object>> content = new ArrayList<>();
    Object rawContent = message.get("content");
    if (rawContent instanceof List<?> blocks) {
      for (Object block : blocks) {
        if (block instanceof Map<?, ?> map && "text".equals(stringValue(map.get("type")))) {
          String text = stringValue(map.get("text"));
          if (text != null && !text.isBlank()) {
            content.add(Map.of("type", "text", "text", text));
          }
        }
      }
    } else {
      String text = stringifyMessageContent(rawContent);
      if (!text.isBlank()) {
        content.add(Map.of("type", "text", "text", text));
      }
    }
    if (message.get("tool_calls") instanceof List<?> toolCalls) {
      for (Object toolCall : toolCalls) {
        Map<String, Object> toolUse = openAiToolCallToAnthropic(toolCall);
        if (!toolUse.isEmpty()) {
          content.add(toolUse);
        }
      }
    }
    if (content.isEmpty()) {
      content.add(Map.of("type", "text", "text", ""));
    }
    return content;
  }

  private Map<String, Object> firstChoiceMessage(Map<String, Object> payload) {
    Object rawChoices = payload.get("choices");
    if (!(rawChoices instanceof List<?> choices) || choices.isEmpty()) {
      return Map.of();
    }
    Object first = choices.get(0);
    if (!(first instanceof Map<?, ?> firstChoice)) {
      return Map.of();
    }
    return nestedMap(firstChoice.get("message"));
  }

  private Map<String, Object> openAiToolCallToAnthropic(Object rawToolCall) {
    Map<String, Object> toolCall = nestedMap(rawToolCall);
    if (toolCall.isEmpty()) {
      return Map.of();
    }
    Map<String, Object> function = nestedMap(toolCall.get("function"));
    String name = stringValue(function.get("name"));
    if (name == null || name.isBlank()) {
      return Map.of();
    }
    LinkedHashMap<String, Object> normalized = new LinkedHashMap<>();
    normalized.put("type", "tool_use");
    normalized.put("id", firstNonBlank(stringValue(toolCall.get("id")), "toolu_" + Ids.shortHex(8)));
    normalized.put("name", name);
    normalized.put("input", parseJsonObject(function.get("arguments")));
    return normalized;
  }

  private List<Map<String, Object>> openAiToolsToAnthropic(Object rawTools) {
    if (!(rawTools instanceof List<?> tools)) {
      return List.of();
    }
    ArrayList<Map<String, Object>> normalized = new ArrayList<>();
    for (Object item : tools) {
      Map<String, Object> tool = nestedMap(item);
      if (tool.isEmpty()) {
        continue;
      }
      Map<String, Object> function = nestedMap(tool.get("function"));
      String name = stringValue(function.get("name"));
      if (name == null || name.isBlank()) {
        continue;
      }
      LinkedHashMap<String, Object> anthropicTool = new LinkedHashMap<>();
      anthropicTool.put("name", name);
      if (function.get("description") != null) {
        anthropicTool.put("description", function.get("description"));
      }
      anthropicTool.put("input_schema", nestedMap(function.get("parameters")));
      normalized.add(anthropicTool);
    }
    return normalized;
  }

  private Object openAiToolChoiceToAnthropic(Object rawToolChoice) {
    if (rawToolChoice == null) {
      return null;
    }
    if (rawToolChoice instanceof String text) {
      return switch (text) {
        case "auto" -> Map.of("type", "auto");
        case "required" -> Map.of("type", "any");
        case "none" -> Map.of("type", "none");
        default -> null;
      };
    }
    Map<String, Object> choice = nestedMap(rawToolChoice);
    Map<String, Object> function = nestedMap(choice.get("function"));
    String name = stringValue(function.get("name"));
    if (name == null || name.isBlank()) {
      return null;
    }
    return Map.of("type", "tool", "name", name);
  }

  private AnthropicAssistantPayload extractAnthropicAssistantPayload(Object rawContent) {
    ArrayList<Map<String, Object>> toolCalls = new ArrayList<>();
    StringBuilder text = new StringBuilder();
    if (rawContent instanceof List<?> blocks) {
      for (Object block : blocks) {
        if (!(block instanceof Map<?, ?> map)) {
          continue;
        }
        String type = stringValue(map.get("type"));
        if ("tool_use".equals(type)) {
          Map<String, Object> toolCall = anthropicToolUseBlocksToOpenAi(List.of(map)).stream().findFirst().orElse(Map.of());
          if (!toolCall.isEmpty()) {
            toolCalls.add(toolCall);
          }
          continue;
        }
        if (!"text".equals(type)) {
          continue;
        }
        String blockText = stringValue(map.get("text"));
        if (blockText == null || blockText.isBlank()) {
          continue;
        }
        if (text.length() > 0) {
          text.append('\n');
        }
        text.append(blockText);
      }
      return new AnthropicAssistantPayload(text.toString(), toolCalls);
    }
    return new AnthropicAssistantPayload(stringifyMessageContent(rawContent), toolCalls);
  }

  private String openAiFinishReasonFromAnthropic(Map<String, Object> payload) {
    String stopReason = stringValue(payload.get("stop_reason"));
    if (stopReason == null || stopReason.isBlank()) {
      return "stop";
    }
    return switch (stopReason) {
      case "tool_use" -> "tool_calls";
      case "max_tokens" -> "length";
      default -> "stop";
    };
  }

  private Map<String, Object> parseJsonObject(Object raw) {
    if (raw instanceof Map<?, ?> map) {
      return nestedMap(map);
    }
    if (raw == null) {
      return Map.of();
    }
    String text = String.valueOf(raw).trim();
    if (text.isBlank()) {
      return Map.of();
    }
    try {
      return jsons.readObject(text);
    } catch (Exception ignored) {
      return Map.of("_raw", text);
    }
  }

  private String firstAssistantText(Map<String, Object> payload) {
    Map<String, Object> message = firstChoiceMessage(payload);
    return stringifyMessageContent(message.get("content"));
  }

  private String anthropicStopReason(Map<String, Object> payload) {
    Map<String, Object> message = firstChoiceMessage(payload);
    if (message.isEmpty()) {
      return null;
    }
    if (message.get("tool_calls") instanceof List<?> toolCalls && !toolCalls.isEmpty()) {
      return "tool_use";
    }
    Object rawChoices = payload.get("choices");
    if (!(rawChoices instanceof List<?> choices) || choices.isEmpty()) {
      return null;
    }
    Object first = choices.get(0);
    if (!(first instanceof Map<?, ?> firstChoice)) {
      return null;
    }
    String finishReason = stringValue(firstChoice.get("finish_reason"));
    if (finishReason == null || finishReason.isBlank()) {
      return null;
    }
    return switch (finishReason) {
      case "stop" -> "end_turn";
      case "length" -> "max_tokens";
      case "tool_calls" -> "tool_use";
      default -> finishReason;
    };
  }

  private String resolveGatewayAuthorization(String authorizationHeader, String xApiKey) {
    if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")) {
      return authorizationHeader;
    }
    if (xApiKey != null && !xApiKey.isBlank()) {
      return "Bearer " + xApiKey.trim();
    }
    return authorizationHeader;
  }

  private static Map<String, Object> mergePayload(Map<String, Object> original, Map<String, Object> extra) {
    LinkedHashMap<String, Object> merged = new LinkedHashMap<>(original);
    merged.remove(INTERNAL_DEBUG_TRACE_ID);
    merged.putAll(extra);
    return merged;
  }

  private int estimatePromptTokens(Object messagesRaw) {
    String raw = messagesRaw instanceof String text ? text : jsons.stringify(messagesRaw == null ? List.of() : messagesRaw);
    return Math.max(16, Math.min(12000, raw.length() / 4));
  }

  private static int intValue(Object value, int fallback) {
    if (value == null || "null".equals(String.valueOf(value))) {
      return fallback;
    }
    return Integer.parseInt(String.valueOf(value));
  }

  private static long longValue(Object value, long fallback) {
    if (value == null || "null".equals(String.valueOf(value))) {
      return fallback;
    }
    return Long.parseLong(String.valueOf(value));
  }

  @SuppressWarnings("unchecked")
  private static int readInt(Map<String, Object> payload, String path, int fallback) {
    String[] parts = path.split("\\.");
    Object current = payload;
    for (String part : parts) {
      if (!(current instanceof Map<?, ?> map)) {
        return fallback;
      }
      current = ((Map<String, Object>) map).get(part);
    }
    return intValue(current, fallback);
  }

  private String mapOpenAiFinishReasonToAnthropic(String finishReason) {
    if (finishReason == null || finishReason.isBlank()) {
      return null;
    }
    return switch (finishReason) {
      case "tool_calls" -> "tool_use";
      case "length" -> "max_tokens";
      case "stop" -> "end_turn";
      default -> finishReason;
    };
  }

  private String openAiFinishReasonFromAnthropicStop(String stopReason) {
    if (stopReason == null || stopReason.isBlank()) {
      return "stop";
    }
    return switch (stopReason) {
      case "tool_use" -> "tool_calls";
      case "max_tokens" -> "length";
      default -> "stop";
    };
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }

  public record GatewayResponse(
      HttpStatus status, Map<String, Object> body, Map<String, String> headers) {
  }

  public record GatewayStreamResponse(
      HttpStatus status,
      Map<String, Object> body,
      StreamingResponseBody streamBody,
      Map<String, String> headers) {
  }

  private record AppKeyRow(
      String id,
      String tenantId,
      String name,
      Integer qpsLimit,
      BigDecimal dailyBudgetUsd,
      BigDecimal monthlyBudgetUsd,
      String allowedModelsJson,
      String scopesJson,
      String ownerUserId,
      BigDecimal balanceTokens,
      BigDecimal tenantMonthlyBudgetUsd,
      boolean spendCapEnforced) {
  }

  private record ProviderRow(
      String id,
      String name,
      String slug,
      String providerType,
      String status,
      boolean enabled,
      String baseUrl,
      String apiKeyCiphertext,
      String modelCatalogJson,
      int priority,
      int timeoutMs,
      String healthStatus) {
  }

  private record ProviderSelection(List<ProviderRow> candidates) {
  }

  private record RoutingConfig(String mode, String primaryProviderType) {
  }

  private record ResolvedModelSelection(String model, ProviderSelection selection) {
  }

  private record ProviderExecution(
      ProviderRow provider,
      Map<String, Object> payload,
      int attempts,
      int promptTokens,
      int completionTokens,
      int totalTokens,
      ProviderCatalog.Entry catalog,
      int upstreamStatusCode,
      String providerErrorCode,
      int latencyMs) {
  }

  private record ProviderHttpResponse(
      int statusCode, Map<String, Object> payload, String providerErrorCode) {
  }

  private record AnthropicAssistantPayload(
      String text, List<Map<String, Object>> toolCalls) {
  }

  private static final class StreamWriteContext {
    private final OutputStream outputStream;
    private boolean started;

    private StreamWriteContext(OutputStream outputStream) {
      this.outputStream = outputStream;
    }

    private boolean started() {
      return started;
    }

    private void write(String value) throws IOException {
      started = true;
      outputStream.write(value.getBytes(StandardCharsets.UTF_8));
      outputStream.flush();
    }
  }

  private final class OpenAiToolCallAccumulator {
    private String id;
    private String type = "function";
    private String name;
    private final StringBuilder arguments = new StringBuilder();

    private void applyChunk(Map<String, Object> item) {
      String nextId = stringValue(item.get("id"));
      if (nextId != null && !nextId.isBlank()) {
        this.id = nextId;
      }
      String nextType = stringValue(item.get("type"));
      if (nextType != null && !nextType.isBlank()) {
        this.type = nextType;
      }
      Map<String, Object> function = nestedMap(item.get("function"));
      String nextName = stringValue(function.get("name"));
      if (nextName != null && !nextName.isBlank()) {
        this.name = nextName;
      }
      String nextArguments = stringValue(function.get("arguments"));
      if (nextArguments != null && !nextArguments.isBlank()) {
        this.arguments.append(nextArguments);
      }
    }

    private void initialize(String toolId, String toolName) {
      if (toolId != null && !toolId.isBlank()) {
        this.id = toolId;
      }
      if (toolName != null && !toolName.isBlank()) {
        this.name = toolName;
      }
    }

    private void appendArguments(String partialArguments) {
      if (partialArguments != null && !partialArguments.isBlank()) {
        this.arguments.append(partialArguments);
      }
    }

    private Map<String, Object> toMap() {
      LinkedHashMap<String, Object> function = new LinkedHashMap<>();
      function.put("name", firstNonBlank(name, "tool"));
      function.put("arguments", arguments.toString());
      LinkedHashMap<String, Object> out = new LinkedHashMap<>();
      out.put("id", firstNonBlank(id, "call_" + Ids.shortHex(8)));
      out.put("type", firstNonBlank(type, "function"));
      out.put("function", function);
      return out;
    }
  }

  private final class OpenAiStreamAccumulator {
    private final String fallbackModel;
    private final int estimatedPromptTokens;
    private String id;
    private String model;
    private long created;
    private String role = "assistant";
    private final StringBuilder content = new StringBuilder();
    private final ArrayList<OpenAiToolCallAccumulator> toolCalls = new ArrayList<>();
    private String finishReason = "stop";
    private int promptTokens;
    private int completionTokens;
    private int totalTokens;

    private OpenAiStreamAccumulator(String fallbackModel, int estimatedPromptTokens) {
      this.fallbackModel = fallbackModel;
      this.estimatedPromptTokens = estimatedPromptTokens;
      this.promptTokens = estimatedPromptTokens;
    }

    private void applyChunk(Map<String, Object> chunk) {
      this.id = firstNonBlank(stringValue(chunk.get("id")), this.id);
      this.model = firstNonBlank(stringValue(chunk.get("model")), this.model, fallbackModel);
      this.created = longValue(chunk.get("created"), this.created == 0 ? Instant.now().getEpochSecond() : this.created);
      Map<String, Object> usage = nestedMap(chunk.get("usage"));
      if (!usage.isEmpty()) {
        this.promptTokens = intValue(usage.get("prompt_tokens"), promptTokens);
        this.completionTokens = intValue(usage.get("completion_tokens"), completionTokens);
        this.totalTokens = intValue(usage.get("total_tokens"), promptTokens + completionTokens);
      }
      Object rawChoices = chunk.get("choices");
      if (!(rawChoices instanceof List<?> choices) || choices.isEmpty()) {
        return;
      }
      Map<String, Object> firstChoice = nestedMap(choices.get(0));
      String nextFinishReason = stringValue(firstChoice.get("finish_reason"));
      if (nextFinishReason != null && !nextFinishReason.isBlank()) {
        this.finishReason = nextFinishReason;
      }
      Map<String, Object> delta = nestedMap(firstChoice.get("delta"));
      String nextRole = stringValue(delta.get("role"));
      if (nextRole != null && !nextRole.isBlank()) {
        this.role = nextRole;
      }
      String nextContent = stringValue(delta.get("content"));
      if (nextContent != null && !nextContent.isBlank()) {
        this.content.append(nextContent);
      }
      if (delta.get("tool_calls") instanceof List<?> rawToolCalls) {
        for (Object rawToolCall : rawToolCalls) {
          Map<String, Object> toolCall = nestedMap(rawToolCall);
          int index = intValue(toolCall.get("index"), toolCalls.size());
          while (toolCalls.size() <= index) {
            toolCalls.add(new OpenAiToolCallAccumulator());
          }
          toolCalls.get(index).applyChunk(toolCall);
        }
      }
    }

    private int promptTokens() {
      return promptTokens <= 0 ? estimatedPromptTokens : promptTokens;
    }

    private int completionTokens() {
      if (completionTokens > 0) {
        return completionTokens;
      }
      return Math.max(1, content.length() / 4);
    }

    private int totalTokens() {
      return totalTokens > 0 ? totalTokens : promptTokens() + completionTokens();
    }

    private Map<String, Object> toPayload() {
      LinkedHashMap<String, Object> message = new LinkedHashMap<>();
      message.put("role", firstNonBlank(role, "assistant"));
      message.put("content", content.toString());
      if (!toolCalls.isEmpty()) {
        message.put(
            "tool_calls",
            toolCalls.stream().map(OpenAiToolCallAccumulator::toMap).toList());
      }
      LinkedHashMap<String, Object> choice = new LinkedHashMap<>();
      choice.put("index", 0);
      choice.put("message", message);
      choice.put("finish_reason", firstNonBlank(finishReason, "stop"));
      return Map.of(
          "id", firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
          "object", "chat.completion",
          "created", created == 0 ? Instant.now().getEpochSecond() : created,
          "model", firstNonBlank(model, fallbackModel, ""),
          "choices", List.of(choice),
          "usage",
          Map.of(
              "prompt_tokens", promptTokens(),
              "completion_tokens", completionTokens(),
              "total_tokens", totalTokens()));
    }
  }

  private final class OpenAiToAnthropicStreamState {
    private boolean messageStarted;
    private boolean messageStopped;
    private Integer textBlockIndex;
    private int nextBlockIndex;
    private int promptTokens;
    private int outputTokens;
    private final LinkedHashMap<Integer, Integer> toolBlockIndexes = new LinkedHashMap<>();
    private String messageId;
    private String model;

    private List<String> toAnthropicEvents(
        Map<String, Object> chunk, int latestPromptTokens, int latestOutputTokens) {
      ArrayList<String> out = new ArrayList<>();
      this.promptTokens = latestPromptTokens;
      this.outputTokens = latestOutputTokens;
      this.messageId = firstNonBlank(stringValue(chunk.get("id")), this.messageId, "msg_" + Ids.shortHex(8));
      this.model = firstNonBlank(stringValue(chunk.get("model")), this.model, "");
      if (!messageStarted) {
        LinkedHashMap<String, Object> message = new LinkedHashMap<>();
        message.put("id", messageId);
        message.put("type", "message");
        message.put("role", "assistant");
        message.put("content", List.of());
        message.put("model", model);
        message.put("stop_reason", null);
        message.put("stop_sequence", null);
        message.put("usage", Map.of("input_tokens", promptTokens, "output_tokens", 0));
        out.add(sseEvent("message_start", Map.of("type", "message_start", "message", message)));
        messageStarted = true;
      }
      Object rawChoices = chunk.get("choices");
      if (!(rawChoices instanceof List<?> choices) || choices.isEmpty()) {
        return out;
      }
      Map<String, Object> firstChoice = nestedMap(choices.get(0));
      Map<String, Object> delta = nestedMap(firstChoice.get("delta"));
      String text = stringValue(delta.get("content"));
      if (text != null && !text.isBlank()) {
        if (textBlockIndex == null) {
          textBlockIndex = nextBlockIndex++;
          out.add(
              sseEvent(
                  "content_block_start",
                  Map.of(
                      "type", "content_block_start",
                      "index", textBlockIndex,
                      "content_block", Map.of("type", "text", "text", ""))));
        }
        out.add(
            sseEvent(
                "content_block_delta",
                Map.of(
                    "type", "content_block_delta",
                    "index", textBlockIndex,
                    "delta", Map.of("type", "text_delta", "text", text))));
      }
      if (delta.get("tool_calls") instanceof List<?> rawToolCalls) {
        for (Object rawToolCall : rawToolCalls) {
          Map<String, Object> toolCall = nestedMap(rawToolCall);
          int openAiIndex = intValue(toolCall.get("index"), toolBlockIndexes.size());
          Integer blockIndex = toolBlockIndexes.get(openAiIndex);
          Map<String, Object> function = nestedMap(toolCall.get("function"));
          if (blockIndex == null) {
            blockIndex = nextBlockIndex++;
            toolBlockIndexes.put(openAiIndex, blockIndex);
            out.add(
                sseEvent(
                    "content_block_start",
                    Map.of(
                        "type", "content_block_start",
                        "index", blockIndex,
                        "content_block",
                        Map.of(
                            "type", "tool_use",
                            "id", firstNonBlank(stringValue(toolCall.get("id")), "toolu_" + Ids.shortHex(8)),
                            "name", firstNonBlank(stringValue(function.get("name")), "tool"),
                            "input", Map.of()))));
          }
          String partialArguments = stringValue(function.get("arguments"));
          if (partialArguments != null && !partialArguments.isBlank()) {
            out.add(
                sseEvent(
                    "content_block_delta",
                    Map.of(
                        "type", "content_block_delta",
                        "index", blockIndex,
                        "delta",
                        Map.of("type", "input_json_delta", "partial_json", partialArguments))));
          }
        }
      }
      String finishReason = stringValue(firstChoice.get("finish_reason"));
      if (finishReason != null && !finishReason.isBlank()) {
        out.addAll(finish(promptTokens, outputTokens, finishReason));
      }
      return out;
    }

    private List<String> finish(int latestPromptTokens, int latestOutputTokens) {
      return finish(latestPromptTokens, latestOutputTokens, null);
    }

    private List<String> finish(int latestPromptTokens, int latestOutputTokens, String finishReason) {
      if (messageStopped) {
        return List.of();
      }
      this.promptTokens = latestPromptTokens;
      this.outputTokens = latestOutputTokens;
      ArrayList<String> out = new ArrayList<>();
      if (textBlockIndex != null) {
        out.add(sseEvent("content_block_stop", Map.of("type", "content_block_stop", "index", textBlockIndex)));
        textBlockIndex = null;
      }
      for (Integer blockIndex : toolBlockIndexes.values()) {
        out.add(sseEvent("content_block_stop", Map.of("type", "content_block_stop", "index", blockIndex)));
      }
      toolBlockIndexes.clear();
      out.add(
          sseEvent(
              "message_delta",
              anthropicMessageDeltaEvent(
                  mapOpenAiFinishReasonToAnthropic(firstNonBlank(finishReason, "stop")),
                  null,
                  outputTokens)));
      out.add(sseEvent("message_stop", Map.of("type", "message_stop")));
      messageStopped = true;
      return out;
    }
  }

  private final class AnthropicStreamAccumulator {
    private final String fallbackModel;
    private final int estimatedPromptTokens;
    private String id;
    private String model;
    private long created = Instant.now().getEpochSecond();
    private int promptTokens;
    private int completionTokens;
    private String stopReason = "end_turn";
    private String stopSequence;
    private boolean openAiDone;
    private boolean openAiRoleSent;
    private int nextToolIndex;
    private final StringBuilder content = new StringBuilder();
    private final LinkedHashMap<Integer, Integer> blockIndexToToolIndex = new LinkedHashMap<>();
    private final ArrayList<OpenAiToolCallAccumulator> toolCalls = new ArrayList<>();

    private AnthropicStreamAccumulator(String fallbackModel, int estimatedPromptTokens) {
      this.fallbackModel = fallbackModel;
      this.estimatedPromptTokens = estimatedPromptTokens;
      this.promptTokens = estimatedPromptTokens;
    }

    private void apply(String eventName, Map<String, Object> payload) {
      switch (eventName) {
        case "message_start" -> {
          Map<String, Object> message = nestedMap(payload.get("message"));
          this.id = firstNonBlank(stringValue(message.get("id")), this.id);
          this.model = firstNonBlank(stringValue(message.get("model")), this.model, fallbackModel);
          Map<String, Object> usage = nestedMap(message.get("usage"));
          this.promptTokens = intValue(usage.get("input_tokens"), promptTokens);
        }
        case "content_block_start" -> {
          int blockIndex = intValue(payload.get("index"), 0);
          Map<String, Object> block = nestedMap(payload.get("content_block"));
          if ("tool_use".equals(stringValue(block.get("type")))) {
            int toolIndex = nextToolIndex++;
            blockIndexToToolIndex.put(blockIndex, toolIndex);
            while (toolCalls.size() <= toolIndex) {
              toolCalls.add(new OpenAiToolCallAccumulator());
            }
            toolCalls.get(toolIndex).initialize(stringValue(block.get("id")), stringValue(block.get("name")));
          }
        }
        case "content_block_delta" -> {
          int blockIndex = intValue(payload.get("index"), 0);
          Map<String, Object> delta = nestedMap(payload.get("delta"));
          String type = stringValue(delta.get("type"));
          if ("text_delta".equals(type)) {
            String text = stringValue(delta.get("text"));
            if (text != null && !text.isBlank()) {
              content.append(text);
            }
          }
          if ("input_json_delta".equals(type)) {
            Integer toolIndex = blockIndexToToolIndex.get(blockIndex);
            if (toolIndex != null && toolIndex < toolCalls.size()) {
              toolCalls.get(toolIndex).appendArguments(stringValue(delta.get("partial_json")));
            }
          }
        }
        case "message_delta" -> {
          Map<String, Object> delta = nestedMap(payload.get("delta"));
          this.stopReason = firstNonBlank(stringValue(delta.get("stop_reason")), stopReason);
          this.stopSequence = stringValue(delta.get("stop_sequence"));
          Map<String, Object> usage = nestedMap(payload.get("usage"));
          this.completionTokens = intValue(usage.get("output_tokens"), completionTokens);
        }
        default -> {
        }
      }
    }

    private List<String> toOpenAiEvents(
        String eventName, Map<String, Object> payload, boolean includeUsage) {
      ArrayList<String> out = new ArrayList<>();
      if ("message_start".equals(eventName) && !openAiRoleSent) {
        out.add(
            sseData(
                openAiStreamChunk(
                    firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                    created,
                    firstNonBlank(model, fallbackModel, ""),
                    Map.of("role", "assistant"),
                    null)));
        openAiRoleSent = true;
      }
      if ("content_block_delta".equals(eventName)) {
        int blockIndex = intValue(payload.get("index"), 0);
        Map<String, Object> delta = nestedMap(payload.get("delta"));
        String type = stringValue(delta.get("type"));
        if ("text_delta".equals(type)) {
          String text = stringValue(delta.get("text"));
          if (text != null && !text.isBlank()) {
            out.add(
                sseData(
                    openAiStreamChunk(
                        firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                        created,
                        firstNonBlank(model, fallbackModel, ""),
                        Map.of("content", text),
                        null)));
          }
        }
        if ("input_json_delta".equals(type)) {
          Integer toolIndex = blockIndexToToolIndex.get(blockIndex);
          if (toolIndex != null) {
            OpenAiToolCallAccumulator toolCall = toolCalls.get(toolIndex);
            out.add(
                sseData(
                    openAiStreamChunk(
                        firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                        created,
                        firstNonBlank(model, fallbackModel, ""),
                        Map.of(
                            "tool_calls",
                            List.of(
                                Map.of(
                                    "index", toolIndex,
                                    "id", firstNonBlank(toolCall.id, "call_" + Ids.shortHex(8)),
                                    "type", "function",
                                    "function",
                                    Map.of("name", firstNonBlank(toolCall.name, "tool"), "arguments", stringValue(delta.get("partial_json")))))),
                        null)));
          }
        }
      }
      if ("content_block_start".equals(eventName)) {
        int blockIndex = intValue(payload.get("index"), 0);
        Map<String, Object> block = nestedMap(payload.get("content_block"));
        if ("tool_use".equals(stringValue(block.get("type")))) {
          Integer toolIndex = blockIndexToToolIndex.get(blockIndex);
          if (toolIndex != null) {
            out.add(
                sseData(
                    openAiStreamChunk(
                        firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                        created,
                        firstNonBlank(model, fallbackModel, ""),
                        Map.of(
                            "tool_calls",
                            List.of(
                                Map.of(
                                    "index", toolIndex,
                                    "id", firstNonBlank(stringValue(block.get("id")), "call_" + Ids.shortHex(8)),
                                    "type", "function",
                                    "function",
                                    Map.of("name", firstNonBlank(stringValue(block.get("name")), "tool"), "arguments", "")))),
                        null)));
          }
        }
      }
      if ("message_delta".equals(eventName)) {
        out.add(
            sseData(
                openAiStreamChunk(
                    firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                    created,
                    firstNonBlank(model, fallbackModel, ""),
                    Map.of(),
                    openAiFinishReasonFromAnthropicStop(stopReason))));
      }
      if ("message_stop".equals(eventName) && !openAiDone) {
        if (includeUsage) {
          out.add(
              sseData(
                  Map.of(
                      "id", firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                      "object", "chat.completion.chunk",
                      "created", created,
                      "model", firstNonBlank(model, fallbackModel, ""),
                      "choices", List.of(),
                      "usage",
                      Map.of(
                          "prompt_tokens", promptTokens(),
                          "completion_tokens", completionTokens(),
                          "total_tokens", totalTokens()))));
        }
        out.add("data: [DONE]\n\n");
        openAiDone = true;
      }
      return out;
    }

    private List<String> finishOpenAi(boolean includeUsage) {
      if (openAiDone) {
        return List.of();
      }
      ArrayList<String> out = new ArrayList<>();
      out.add(
          sseData(
              openAiStreamChunk(
                  firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                  created,
                  firstNonBlank(model, fallbackModel, ""),
                  Map.of(),
                  openAiFinishReasonFromAnthropicStop(stopReason))));
      if (includeUsage) {
        out.add(
            sseData(
                Map.of(
                    "id", firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)),
                    "object", "chat.completion.chunk",
                    "created", created,
                    "model", firstNonBlank(model, fallbackModel, ""),
                    "choices", List.of(),
                    "usage",
                    Map.of(
                        "prompt_tokens", promptTokens(),
                        "completion_tokens", completionTokens(),
                        "total_tokens", totalTokens()))));
      }
      out.add("data: [DONE]\n\n");
      openAiDone = true;
      return out;
    }

    private int promptTokens() {
      return promptTokens <= 0 ? estimatedPromptTokens : promptTokens;
    }

    private int completionTokens() {
      if (completionTokens > 0) {
        return completionTokens;
      }
      return Math.max(1, content.length() / 4);
    }

    private int totalTokens() {
      return promptTokens() + completionTokens();
    }

    private Map<String, Object> toPayload() {
      LinkedHashMap<String, Object> message = new LinkedHashMap<>();
      message.put("role", "assistant");
      message.put("content", content.toString());
      if (!toolCalls.isEmpty()) {
        message.put(
            "tool_calls",
            toolCalls.stream().map(OpenAiToolCallAccumulator::toMap).toList());
      }
      LinkedHashMap<String, Object> choice = new LinkedHashMap<>();
      choice.put("index", 0);
      choice.put("message", message);
      choice.put("finish_reason", openAiFinishReasonFromAnthropicStop(stopReason));
      LinkedHashMap<String, Object> payload = new LinkedHashMap<>();
      payload.put("id", firstNonBlank(id, "chatcmpl-proxy-" + Ids.shortHex(8)));
      payload.put("object", "chat.completion");
      payload.put("created", created);
      payload.put("model", firstNonBlank(model, fallbackModel, ""));
      payload.put("choices", List.of(choice));
      payload.put(
          "usage",
          Map.of(
              "prompt_tokens", promptTokens(),
              "completion_tokens", completionTokens(),
              "total_tokens", totalTokens()));
      return payload;
    }
  }

  private static final RowMapper<AppKeyRow> APP_KEY_ROW_MAPPER =
      new RowMapper<>() {
        @Override
        public AppKeyRow mapRow(ResultSet rs, int rowNum) throws SQLException {
          return new AppKeyRow(
              rs.getString("id"),
              rs.getString("tenant_id"),
              rs.getString("name"),
              (Integer) rs.getObject("qps_limit"),
              rs.getBigDecimal("daily_budget_usd"),
              rs.getBigDecimal("monthly_budget_usd"),
              rs.getString("allowed_models"),
              rs.getString("scopes"),
              rs.getString("owner_user_id"),
              rs.getBigDecimal("balance_tokens"),
              rs.getBigDecimal("tenant_monthly_budget_usd"),
              rs.getBoolean("spend_cap_enforced"));
        }
      };

  private static final RowMapper<ProviderRow> PROVIDER_ROW_MAPPER =
      new RowMapper<>() {
        @Override
        public ProviderRow mapRow(ResultSet rs, int rowNum) throws SQLException {
          return new ProviderRow(
              rs.getString("id"),
              rs.getString("name"),
              rs.getString("slug"),
              rs.getString("provider_type"),
              rs.getString("status"),
              rs.getBoolean("enabled"),
              rs.getString("base_url"),
              rs.getString("api_key_ciphertext"),
              rs.getString("model_catalog"),
              rs.getInt("priority"),
              rs.getInt("timeout_ms"),
              rs.getString("health_status"));
        }
      };
}
