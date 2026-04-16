package com.taas.gateway;

import com.taas.infra.api.ApiException;
import com.taas.infra.config.TaasProperties;
import com.taas.infra.security.CryptoUtils;
import com.taas.infra.util.Ids;
import com.taas.infra.util.Jsons;
import com.taas.infra.util.MoneyUtils;
import com.taas.ops.AuditService;
import java.math.BigDecimal;
import java.math.RoundingMode;
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
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;

@Service
public class GatewayService {
  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final GatewayCacheService cacheService;
  private final CryptoUtils cryptoUtils;
  private final Jsons jsons;
  private final TaasProperties properties;
  private final AuditService auditService;
  private final WebClient webClient;

  public GatewayService(
      NamedParameterJdbcTemplate jdbcTemplate,
      GatewayCacheService cacheService,
      CryptoUtils cryptoUtils,
      Jsons jsons,
      TaasProperties properties,
      AuditService auditService,
      WebClient.Builder webClientBuilder) {
    this.jdbcTemplate = jdbcTemplate;
    this.cacheService = cacheService;
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
    String model = String.valueOf(requestBody.getOrDefault("model", "gpt-4o-mini")).trim();
    List<String> scopes = jsons.readStringList(appKey.scopesJson());
    if (!scopes.contains("chat:complete")) {
      throw new ApiException(403, "This AppKey does not have chat:complete scope");
    }
    List<String> allowedModels = jsons.readStringList(appKey.allowedModelsJson());
    if (!allowedModels.isEmpty() && !allowedModels.contains(model)) {
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

    String idemKey = idempotencyKey == null || idempotencyKey.isBlank() ? null : appKey.id() + ":" + idempotencyKey.trim();
    if (idemKey != null) {
      Map<String, Object> cached = cacheService.getIdempotentResponse(idemKey);
      if (cached != null) {
        recordCacheHit(appKey, model, requestIp, idempotencyKey, cached);
        return new GatewayResponse(HttpStatus.OK, cached, Map.of());
      }
    }

    enforceBudgets(appKey);
    RoutingConfig routingConfig = routingConfig(appKey.tenantId());
    ProviderSelection selection = chooseProvider(model, routingConfig.mode());
    Map<String, Object> payload;
    ProviderExecution execution;
    try {
      execution = callProviders(selection.candidates(), model, requestBody);
      payload = normalizePayload(model, execution.payload(), execution.promptTokens(), execution.completionTokens(), execution.totalTokens());
    } catch (Exception exception) {
      String errorCode = exception instanceof ApiException apiException ? apiException.getCode() : null;
      if (properties.getCommercial().isAllowMockProvider()
          && ("provider_not_configured".equals(errorCode)
              || "all_providers_failed".equals(errorCode))) {
        Map<String, Object> mock =
            Map.of(
                "id", "chatcmpl-demo-" + Ids.shortHex(8),
                "object", "chat.completion",
                "created", Instant.now().getEpochSecond(),
                "model", model,
                "choices", List.of(Map.of("index", 0, "message", Map.of("role", "assistant", "content", "当前未配置真实上游模型密钥，已返回本地演示回复。请配置 OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY。"), "finish_reason", "stop")),
                "usage", Map.of("prompt_tokens", 0, "completion_tokens", 0, "total_tokens", 0));
        return new GatewayResponse(HttpStatus.OK, mock, Map.of());
      }
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
    if (idemKey != null) {
      cacheService.setIdempotentResponse(idemKey, payload);
    }
    return new GatewayResponse(HttpStatus.OK, payload, Map.of());
  }

  private AppKeyRow requireAppKey(String rawKey) {
    String hash = cryptoUtils.hashAppKey(rawKey);
    return jdbcTemplate.query(
            """
            select
              a.id, a.tenant_id, a.name, a.qps_limit, a.daily_budget_usd, a.monthly_budget_usd,
              a.allowed_models::text as allowed_models, a.scopes::text as scopes,
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
    if ("gpt-fallback-demo".equalsIgnoreCase(model)) {
      return "openai".equals(row.providerType()) || "anthropic".equals(row.providerType());
    }
    List<Map<String, Object>> catalog = jsons.readObjectList(row.modelCatalogJson());
    if (catalog.isEmpty()) {
      String inferred = ProviderCatalog.inferProviderType(model);
      return inferred != null && inferred.equals(row.providerType());
    }
    return catalog.stream().anyMatch(item -> model.equalsIgnoreCase(String.valueOf(item.get("model"))));
  }

  private ProviderExecution callProviders(List<ProviderRow> candidates, String model, Map<String, Object> requestBody) {
    List<String> errors = new ArrayList<>();
    for (int i = 0; i < candidates.size(); i++) {
      ProviderRow provider = candidates.get(i);
      try {
        ProviderExecution execution = callProvider(provider, model, requestBody, i + 1);
        return execution;
      } catch (ApiException exception) {
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
        provider.timeoutMs());
  }

  private ProviderHttpResponse callAnthropic(
      ProviderRow provider, String model, Map<String, Object> requestBody, String apiKey) {
    String url = trimBaseUrl(provider.baseUrl()) + "/messages";
    List<Map<String, Object>> normalizedMessages = normalizeMessages(requestBody.get("messages"), true);
    Map<String, Object> body =
        new LinkedHashMap<>(
            Map.of(
                "model", model,
                "messages", normalizedMessages,
                "max_tokens", intValue(requestBody.get("max_completion_tokens"), intValue(requestBody.get("max_tokens"), 512))));
    if (requestBody.get("temperature") != null) {
      body.put("temperature", requestBody.get("temperature"));
    }
    Object system = extractSystem(requestBody.get("messages"));
    if (system != null) {
      body.put("system", system);
    }
    ProviderHttpResponse upstream =
        postJson(
            url,
            Map.of("x-api-key", apiKey, "anthropic-version", "2023-06-01"),
            body,
            "anthropic_request_failed",
            provider.timeoutMs());
    Map<String, Object> raw = upstream.payload();
    String text =
        ((List<?>) raw.getOrDefault("content", List.of())).stream()
            .filter(Map.class::isInstance)
            .map(Map.class::cast)
            .map(item -> String.valueOf(item.getOrDefault("text", "")))
            .reduce("", String::concat);
    Map<String, Object> usage = (Map<String, Object>) raw.getOrDefault("usage", Map.of());
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
            provider.timeoutMs());
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
      String text = stringifyMessageContent(map.get("content"));
      out.add(
          anthropic
              ? Map.of("role", "assistant".equals(role) ? "assistant" : "user", "content", text)
              : Map.of("role", "assistant".equals(role) ? "model" : "user", "parts", List.of(Map.of("text", text))));
    }
    return out;
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
            : ("gpt-fallback-demo".equalsIgnoreCase(model)
                    && "anthropic".equals(execution.provider().providerType())
                    && "openai".equals(routingPrimary))
                ? "fallback_primary_unavailable"
                : null;
    jdbcTemplate.update(
        """
        insert into api_request_logs (
          id, tenant_id, app_key_id, provider_id, request_id, trace_id, model,
          prompt_tokens, completion_tokens, total_tokens, latency_ms, cache_hit,
          routing_primary, routing_actual, routing_reason, provider_error_code, retry_count,
          request_source_ip, status_code, idempotency_key, created_at
        ) values (
          :id, :tenantId, :appKeyId, :providerId, :requestId, :traceId, :model,
          :promptTokens, :completionTokens, :totalTokens, :latencyMs, false,
          :routingPrimary, :routingActual, :routingReason, :providerErrorCode, :retryCount,
          :requestSourceIp, :statusCode, :idempotencyKey, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", logId)
            .addValue("tenantId", appKey.tenantId())
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
    String logId = Ids.cuidLike("log");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into api_request_logs (
          id, tenant_id, app_key_id, provider_id, request_id, trace_id, model, prompt_tokens, completion_tokens,
          total_tokens, latency_ms, cache_hit, routing_primary, routing_actual, retry_count, request_source_ip,
          status_code, idempotency_key, created_at
        ) values (
          :id, :tenantId, :appKeyId, :providerId, :requestId, :traceId, :model, 0, 0, 0, 8, true, 'cache', 'cache', 0, :ip, 200, :idempotencyKey, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", logId)
            .addValue("tenantId", appKey.tenantId())
            .addValue("appKeyId", appKey.id())
            .addValue("providerId", provider.id())
            .addValue("requestId", "req_" + Ids.shortHex(8))
            .addValue("traceId", "trace_" + Ids.shortHex(8))
            .addValue("model", model)
            .addValue("ip", requestIp)
            .addValue("idempotencyKey", idempotencyKey)
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
      int timeoutMs) {
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
                                entity, fallbackProviderErrorCode)))
        .timeout(Duration.ofMillis(Math.max(timeoutMs, 1000)))
        .onErrorMap(
            java.util.concurrent.TimeoutException.class,
            error -> new ApiException(504, providerNameFromErrorCode(fallbackProviderErrorCode) + " request timed out", "timeout"))
        .onErrorMap(
            error ->
                !(error instanceof ApiException),
            error ->
                new ApiException(
                    502,
                    error.getMessage() == null
                        ? providerNameFromErrorCode(fallbackProviderErrorCode) + " request failed"
                        : error.getMessage(),
                    "network_error"))
        .block();
  }

  private ProviderHttpResponse toProviderHttpResponse(
      org.springframework.http.ResponseEntity<String> entity,
      String fallbackProviderErrorCode) {
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
      throw new ApiException(
          statusCode,
          firstNonBlank(
              stringValue(nestedError.get("message")),
              stringValue(payload.get("message")),
              stringValue(payload.get("error")),
              "Provider request failed"),
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

  private static Map<String, Object> mergePayload(Map<String, Object> original, Map<String, Object> extra) {
    LinkedHashMap<String, Object> merged = new LinkedHashMap<>(original);
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

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }

  public record GatewayResponse(
      HttpStatus status, Map<String, Object> body, Map<String, String> headers) {
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
