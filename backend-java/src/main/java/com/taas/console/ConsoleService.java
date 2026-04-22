package com.taas.console;

import com.taas.auth.JwtPrincipal;
import com.taas.gateway.ProviderCatalog;
import com.taas.infra.api.ApiException;
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
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ConsoleService {
  private static final List<String> DEFAULT_APP_KEY_SCOPES =
      List.of("chat:complete", "usage:read", "billing:read", "admin:ops");
  private static final Set<String> MEMBER_ROLES =
      Set.of("owner", "admin", "developer", "billing", "member");
  private static final Set<String> WRITE_ROLES = Set.of("owner", "admin", "developer");
  private static final Set<String> ADMIN_ROLES = Set.of("owner", "admin");
  private static final Set<String> OPS_ROLES = Set.of("owner", "admin", "billing");
  private static final List<Map<String, Object>> ROUTING_FALLBACK_CHAINS =
      List.of(
          Map.of(
              "id", "chain-primary",
              "title", "通用主链",
              "description", "优先选择已配置且健康的主模型，失败时按供应商链路依次回退。",
              "models", List.of("主模型", "同类备选模型", "跨供应商兜底模型")),
          Map.of(
              "id", "chain-eco",
              "title", "成本控制链",
              "description", "在满足可用性的前提下优先使用低成本模型，适合批处理与内部工具。",
              "models", List.of("经济型主模型", "成本备选模型", "跨厂商低成本模型")),
          Map.of(
              "id", "chain-failover",
              "title", "故障转移链",
              "description", "当主供应商超时、限流或不可用时，自动切换到下一候选供应商。",
              "models", List.of("主供应商", "备用供应商", "最终兜底供应商")));
  private static final Map<String, String> ROUTING_NOTES =
      Map.of(
          "cost", "优先经济性评分（越高越省），在可接受延迟内将流量引向低价模型组合；适合批量与成本敏感业务。",
          "quality", "优先成功率与延迟稳定性，必要时接受较高单价；适合对结果一致性要求高的生产链路。",
          "balance", "综合成功率、成本评分与延迟加权排序，适合作为大多数生产流量的默认策略。");
  private static final String MODEL_HUB_GATEWAY_BASE_URL = "/v1";

  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final Jsons jsons;
  private final CryptoUtils cryptoUtils;
  private final AuditService auditService;
  private final PasswordEncoder passwordEncoder;

  public ConsoleService(
      NamedParameterJdbcTemplate jdbcTemplate,
      Jsons jsons,
      CryptoUtils cryptoUtils,
      AuditService auditService,
      PasswordEncoder passwordEncoder) {
    this.jdbcTemplate = jdbcTemplate;
    this.jsons = jsons;
    this.cryptoUtils = cryptoUtils;
    this.auditService = auditService;
    this.passwordEncoder = passwordEncoder;
  }

  public Map<String, Object> dashboardSummary(JwtPrincipal principal) {
    TenantRow tenant = requireTenant(principal.tenantId());
    Timestamp since24h = ts(Instant.now().minus(24, ChronoUnit.HOURS));
    Timestamp startOfDay = ts(LocalDate.now(ZoneOffset.UTC).atStartOfDay().toInstant(ZoneOffset.UTC));
    Timestamp sevenDaysAgo = ts(Instant.now().minus(7, ChronoUnit.DAYS));

    SummaryAgg agg =
        jdbcTemplate.query(
                """
                select
                  count(*) as requests_24h,
                  coalesce(sum(total_tokens), 0) as tokens_24h,
                  coalesce(sum(case when status_code >= 400 then 1 else 0 end), 0) as failed_24h,
                  coalesce(avg(latency_ms), 0) as average_latency_ms,
                  coalesce(avg(case when provider_error_code is null then 100 else 0 end), 100) as provider_success_rate
                from api_request_logs
                where tenant_id = :tenantId and created_at >= :since
                """,
                new MapSqlParameterSource().addValue("tenantId", principal.tenantId()).addValue("since", since24h),
                (rs, rowNum) ->
                    new SummaryAgg(
                        rs.getLong("requests_24h"),
                        rs.getLong("tokens_24h"),
                        rs.getLong("failed_24h"),
                        rs.getBigDecimal("average_latency_ms"),
                        rs.getBigDecimal("provider_success_rate")))
            .stream()
            .findFirst()
            .orElse(new SummaryAgg(0, 0, 0, BigDecimal.ZERO, BigDecimal.valueOf(100)));

    BigDecimal spend24h =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(amount_usd), 0)
            from billing_records
            where tenant_id = :tenantId and type = 'usage' and created_at >= :since
            """,
            Map.of("tenantId", principal.tenantId(), "since", since24h),
            BigDecimal.class);

    BigDecimal todaySpend =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(amount_usd), 0)
            from billing_records
            where tenant_id = :tenantId and type = 'usage' and created_at >= :since
            """,
            Map.of("tenantId", principal.tenantId(), "since", startOfDay),
            BigDecimal.class);

    Long todayTokens =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(total_tokens), 0)
            from api_request_logs
            where tenant_id = :tenantId and created_at >= :since
            """,
            Map.of("tenantId", principal.tenantId(), "since", startOfDay),
            Long.class);

    Long cacheHits =
        jdbcTemplate.queryForObject(
            """
            select count(*) from api_request_logs
            where tenant_id = :tenantId and created_at >= :since and cache_hit = true
            """,
            Map.of("tenantId", principal.tenantId(), "since", since24h),
            Long.class);
    Long nonCacheRequests =
        jdbcTemplate.queryForObject(
            """
            select count(*) from api_request_logs
            where tenant_id = :tenantId and created_at >= :since and cache_hit = false
            """,
            Map.of("tenantId", principal.tenantId(), "since", since24h),
            Long.class);

    List<Map<String, Object>> chartSeries = buildChartSeries(principal.tenantId(), sevenDaysAgo);
    List<Map<String, Object>> modelMix = buildModelMix(principal.tenantId(), sevenDaysAgo);
    BigDecimal cacheSavings = estimateCacheSavings(principal.tenantId(), startOfDay);
    BigDecimal cacheHitRate =
        ((cacheHits == null ? 0 : cacheHits) + (nonCacheRequests == null ? 0 : nonCacheRequests)) == 0
            ? BigDecimal.ZERO
            : BigDecimal.valueOf(
                    (cacheHits == null ? 0 : cacheHits)
                        * 1000.0
                        / ((cacheHits == null ? 0 : cacheHits)
                            + (nonCacheRequests == null ? 0 : nonCacheRequests)))
                .setScale(1, RoundingMode.HALF_UP);
    BigDecimal customerSuccess =
        agg.requests24h() == 0
            ? BigDecimal.valueOf(100)
            : BigDecimal.valueOf(((agg.requests24h() - agg.failed24h()) * 1000.0 / agg.requests24h()) / 10.0)
                .setScale(1, RoundingMode.HALF_UP);

    List<Map<String, Object>> risks = new ArrayList<>();
    double balanceNum = tenant.balanceTokens() == null ? 0 : tenant.balanceTokens().doubleValue();
    long tokensToday = todayTokens == null ? 0 : todayTokens;
    long monthlyQuota = tenant.monthlyTokenQuota() == null ? 0 : tenant.monthlyTokenQuota();
    if (balanceNum < 200_000) {
      risks.add(
          Map.of(
              "level",
              "warning",
              "title",
              "余额偏低",
              "detail",
              "当前余额约 "
                  + MoneyUtils.money(tenant.balanceTokens())
                  + " tokens，建议关注充值或配额，避免影响生产调用。"));
    }
    if (monthlyQuota > 0 && tokensToday > monthlyQuota * 0.08) {
      risks.add(
          Map.of(
              "level",
              "warning",
              "title",
              "今日 Token 用量较高",
              "detail",
              "今日已用 " + String.format("%,d", tokensToday) + " tokens，接近当月套餐日均可用的参考阈值。"));
    }
    if (agg.failed24h() > 0) {
      risks.add(
          Map.of(
              "level",
              "critical",
              "title",
              "近期存在失败请求",
              "detail",
              "近 24 小时内有 "
                  + agg.failed24h()
                  + " 条 HTTP≥400 的请求日志，建议在「用量」中排查。"));
    }
    if (risks.isEmpty()) {
      risks.add(Map.of("level", "info", "title", "暂无异常", "detail", "路由与计费链路运行正常，可持续观察用量与余额。"));
    }

    return Map.of(
        "tenant",
            Map.of(
                "name", tenant.name(),
                "slug", tenant.slug(),
                "status", tenant.status(),
                "balanceTokens", MoneyUtils.money(tenant.balanceTokens()),
                "trialEndsAt", tenant.trialEndsAt(),
                "trialDaysRemaining", tenant.trialDaysRemaining(),
                "billingEmail", tenant.billingEmail(),
                "contactSalesEmail", tenant.contactSalesEmail(),
                "monthlyBudgetUsd", tenant.monthlyBudgetUsd() == null ? null : MoneyUtils.money(tenant.monthlyBudgetUsd()),
                "plan", tenant.planCode() == null ? null : Map.of("name", tenant.planName(), "code", tenant.planCode())),
        "kpis",
            Map.of(
                "requests24h", agg.requests24h(),
                "tokens24h", agg.tokens24h(),
                "spendUsd24h", MoneyUtils.money(spend24h),
                "cacheHitRate", cacheHitRate.doubleValue(),
                "averageLatencyMs", agg.averageLatencyMs().setScale(0, RoundingMode.HALF_UP).intValue(),
                "customerSuccessRate", customerSuccess.doubleValue(),
                "providerSuccessRate", agg.providerSuccessRate().setScale(1, RoundingMode.HALF_UP).doubleValue(),
                "failedRequests24h", agg.failed24h()),
        "today",
            Map.of(
                "spendUsd", MoneyUtils.money(todaySpend),
                "tokens", todayTokens == null ? 0 : todayTokens,
                "cacheSavingsUsd", MoneyUtils.money(cacheSavings)),
        "tenantsOverview", List.of(Map.of("name", tenant.name(), "slug", tenant.slug(), "requests24h", agg.requests24h())),
        "chartSeries7d", chartSeries,
        "modelMix7d", modelMix,
        "serviceTargets", Map.of("latencySloMs", 1500, "successSloPct", 99.5),
        "risks", risks);
  }

  public List<Map<String, Object>> listAppKeys(JwtPrincipal principal) {
    TenantRow tenant = requireTenant(principal.tenantId());
    return jdbcTemplate.query(
        """
        select
          id, name, description, token_preview, status, environment, scopes::text as scopes,
          qps_limit, daily_budget_usd, monthly_budget_usd, allowed_models::text as allowed_models,
          created_at, last_used_at, last_used_ip
        from app_keys
        where tenant_id = :tenantId
        order by created_at desc
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) -> mapAppKeyRow(rs, tenant.name(), false, null));
  }

  public List<Map<String, Object>> availableAppKeyModels(JwtPrincipal principal) {
    requireTenant(principal.tenantId());
    List<String> allowedModels = memberAllowedModels(principal.tenantId(), principal.userId());
    List<Map<String, Object>> rows = availableGatewayModels();
    if (allowedModels.isEmpty()) {
      return rows;
    }
    Set<String> allowedSet = Set.copyOf(allowedModels);
    return rows.stream()
        .filter(row -> allowedSet.contains(String.valueOf(row.get("model"))))
        .toList();
  }

  public List<Map<String, Object>> adminUserAvailableModels(JwtPrincipal principal) {
    requirePlatformAdmin(principal);
    return availableGatewayModels();
  }

  private List<Map<String, Object>> availableGatewayModels() {
    Map<String, Map<String, Object>> byModel = new LinkedHashMap<>();
    jdbcTemplate.query(
        """
        select
          name, slug, provider_type, priority, supports_streaming, model_catalog::text as model_catalog
        from providers
        where enabled = true
          and status = 'active'
          and base_url is not null
          and nullif(trim(base_url), '') is not null
          and api_key_ciphertext is not null
          and nullif(trim(api_key_ciphertext), '') is not null
        order by priority asc, name asc
        """,
        (rs, rowNum) -> {
          String providerName = rs.getString("name");
          String providerSlug = rs.getString("slug");
          String providerType = rs.getString("provider_type");
          boolean supportsStreaming = rs.getBoolean("supports_streaming");
          int priority = rs.getInt("priority");
          for (Map<String, Object> item : jsons.readObjectList(rs.getString("model_catalog"))) {
            String model = nullableTrim(item.get("model"));
            if (model == null || byModel.containsKey(model)) {
              continue;
            }
            byModel.put(
                model,
                orderedMap(
                    "id", model,
                    "model", model,
                    "label", providerName + " · " + model,
                    "providerName", providerName,
                    "providerSlug", providerSlug,
                    "providerType", providerType,
                    "priority", priority,
                    "supportsStreaming", booleanValue(item.get("supportsStreaming"), supportsStreaming)));
          }
          return null;
        });
    return new ArrayList<>(byModel.values());
  }

  public List<Map<String, Object>> modelCatalog(JwtPrincipal principal) {
    requireTenant(principal.tenantId());
    List<String> allowedModels = memberAllowedModels(principal.tenantId(), principal.userId());
    Set<String> allowedSet = allowedModels.isEmpty() ? Set.of() : Set.copyOf(allowedModels);
    Map<String, Map<String, Object>> byModel = new LinkedHashMap<>();
    jdbcTemplate.query(
        """
        select
          name, slug, provider_type, priority, supports_streaming, model_catalog::text as model_catalog
        from providers
        where enabled = true
          and status = 'active'
          and base_url is not null
          and nullif(trim(base_url), '') is not null
          and api_key_ciphertext is not null
          and nullif(trim(api_key_ciphertext), '') is not null
        order by priority asc, name asc
        """,
        (rs, rowNum) -> {
          String providerName = rs.getString("name");
          String providerSlug = rs.getString("slug");
          String providerType = rs.getString("provider_type");
          boolean providerSupportsStreaming = rs.getBoolean("supports_streaming");
          int priority = rs.getInt("priority");
          for (Map<String, Object> item : jsons.readObjectList(rs.getString("model_catalog"))) {
            String modelId = nullableTrim(item.get("model"));
            if (modelId == null || byModel.containsKey(modelId)) {
              continue;
            }
            if (!allowedSet.isEmpty() && !allowedSet.contains(modelId)) {
              continue;
            }
            String normalizedProviderType =
                blankDefault(item.get("providerType"), providerType);
            boolean supportsStreaming =
                booleanValue(item.get("supportsStreaming"), providerSupportsStreaming);
            ProviderCatalog.Entry pricing = ProviderCatalog.find(modelId);
            byModel.put(
                modelId,
                orderedMap(
                    "modelId", modelId,
                    "displayName", modelId,
                    "providerType", normalizedProviderType,
                    "providerName", providerName,
                    "providerSlug", providerSlug,
                    "priority", priority,
                    "supportsStreaming", supportsStreaming,
                    "inputUsdPerMillion",
                    pricing == null ? null : MoneyUtils.money(pricing.inputUsdPerMillion()),
                    "outputUsdPerMillion",
                    pricing == null ? null : MoneyUtils.money(pricing.outputUsdPerMillion()),
                    "billingRuleSummary", billingRuleSummary(pricing),
                    "protocolFamily", protocolFamily(normalizedProviderType),
                    "protocolLabel", protocolLabel(normalizedProviderType),
                    "gatewayBaseUrl", MODEL_HUB_GATEWAY_BASE_URL,
                    "gatewayEndpoint", gatewayEndpoint(normalizedProviderType),
                    "upstreamEndpointPath", upstreamEndpointPath(normalizedProviderType, modelId),
                    "integrationFormatNote", integrationFormatNote(normalizedProviderType),
                    "capabilityTags", capabilityTags(supportsStreaming),
                    "status", "available"));
          }
          return null;
        });
    return new ArrayList<>(byModel.values());
  }

  public Map<String, Object> createAppKey(
      JwtPrincipal principal, Map<String, Object> body, String ip) {
    requireRole(principal.role(), WRITE_ROLES);
    validateAppKeyBody(body, false);
    validateAllowedModelsConfigured(principal, body);
    List<String> memberAllowedModels = memberAllowedModels(principal.tenantId(), principal.userId());
    String token = cryptoUtils.generateAppKeyToken();
    Instant now = Instant.now();
    String id = Ids.cuidLike("ak");
    String name = stringValue(body.get("name"));
    if (name.isBlank()) {
      throw new ApiException(400, "name is required");
    }
    jdbcTemplate.update(
        """
        insert into app_keys (
          id, tenant_id, name, description, token, token_hash, token_preview, status, environment,
          scopes, qps_limit, daily_budget_usd, monthly_budget_usd, allowed_models, created_at
        ) values (
          :id, :tenantId, :name, :description, null, :tokenHash, :tokenPreview, :status, :environment,
          cast(:scopes as jsonb), :qpsLimit, :dailyBudgetUsd, :monthlyBudgetUsd, cast(:allowedModels as jsonb), :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("tenantId", principal.tenantId())
            .addValue("name", name)
            .addValue("description", nullableTrim(body.get("description")))
            .addValue("tokenHash", cryptoUtils.hashAppKey(token))
            .addValue("tokenPreview", cryptoUtils.buildAppKeyPreview(token))
            .addValue("status", blankDefault(body.get("status"), "active"))
            .addValue("environment", blankDefault(body.get("environment"), "production"))
            .addValue(
                "scopes",
                jsons.stringify(defaultStringList(body.get("scopes"), DEFAULT_APP_KEY_SCOPES)))
            .addValue("qpsLimit", body.get("qpsLimit"))
            .addValue("dailyBudgetUsd", decimalOrNull(body.get("dailyBudgetUsd")))
            .addValue("monthlyBudgetUsd", decimalOrNull(body.get("monthlyBudgetUsd")))
            .addValue(
                "allowedModels",
                jsons.stringify(
                    defaultStringList(body.get("allowedModels"), memberAllowedModels)))
            .addValue("createdAt", ts(now)));

    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "app_key.create",
        "app_key",
        id,
        ip,
        Map.of(
            "actorRole", principal.role(),
            "environment", blankDefault(body.get("environment"), "production"),
            "scopes", defaultStringList(body.get("scopes"), DEFAULT_APP_KEY_SCOPES)));

    return jdbcTemplate.query(
            """
            select
              id, name, description, token_preview, status, environment, scopes::text as scopes,
              qps_limit, daily_budget_usd, monthly_budget_usd, allowed_models::text as allowed_models,
              created_at, last_used_at, last_used_ip
            from app_keys where id = :id
            """,
            Map.of("id", id),
            (rs, rowNum) -> mapAppKeyRow(rs, requireTenant(principal.tenantId()).name(), true, token))
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(500, "Failed to create app key"));
  }

  public Map<String, Object> updateAppKey(
      JwtPrincipal principal, String appKeyId, Map<String, Object> body, String ip) {
    requireRole(principal.role(), WRITE_ROLES);
    validateAppKeyBody(body, true);
    validateAllowedModelsConfigured(principal, body);
    Map<String, Object> existing = getAppKey(principal.tenantId(), appKeyId);
    if (body.containsKey("status")
        && "revoked".equals(String.valueOf(existing.get("status")))
        && body.get("status") != null) {
      throw new ApiException(400, "已撤销的密钥无法切换启用状态");
    }
    MapSqlParameterSource params = new MapSqlParameterSource().addValue("id", appKeyId).addValue("tenantId", principal.tenantId());
    List<String> sets = new ArrayList<>();
    patchSet(sets, params, "name", nullableTrim(body.get("name")));
    patchSet(sets, params, "description", nullableTrim(body.get("description")));
    patchSet(sets, params, "status", body.get("status"));
    patchSet(sets, params, "environment", body.get("environment"));
    if (body.containsKey("scopes")) {
      sets.add("scopes = cast(:scopes as jsonb)");
      params.addValue(
          "scopes",
          jsons.stringify(defaultStringList(body.get("scopes"), DEFAULT_APP_KEY_SCOPES)));
    }
    patchSet(sets, params, "qps_limit", body.get("qpsLimit"));
    patchSet(sets, params, "daily_budget_usd", decimalOrNull(body.get("dailyBudgetUsd")));
    patchSet(sets, params, "monthly_budget_usd", decimalOrNull(body.get("monthlyBudgetUsd")));
    if (body.containsKey("allowedModels")) {
      sets.add("allowed_models = cast(:allowedModels as jsonb)");
      params.addValue("allowedModels", jsons.stringify(defaultStringList(body.get("allowedModels"), List.of())));
    }
    if (sets.isEmpty()) {
      throw new ApiException(400, "未提供可更新字段");
    }
    jdbcTemplate.update(
        "update app_keys set " + String.join(", ", sets) + " where id = :id and tenant_id = :tenantId",
        params);
    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "app_key.update",
        "app_key",
        appKeyId,
        ip,
        Map.of("actorRole", principal.role(), "previousStatus", existing.get("status")));
    return getAppKey(principal.tenantId(), appKeyId);
  }

  public Map<String, Object> revokeAppKey(JwtPrincipal principal, String appKeyId, String ip) {
    requireRole(principal.role(), ADMIN_ROLES);
    int updated =
        jdbcTemplate.update(
            "update app_keys set status = 'revoked' where id = :id and tenant_id = :tenantId",
            Map.of("id", appKeyId, "tenantId", principal.tenantId()));
    if (updated == 0) {
      throw new ApiException(404, "Not found");
    }
    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "app_key.revoke",
        "app_key",
        appKeyId,
        ip,
        Map.of());
    return Map.of("ok", true);
  }

  public Map<String, Object> deleteAppKey(JwtPrincipal principal, String appKeyId, String ip) {
    requireRole(principal.role(), ADMIN_ROLES);
    Map<String, Object> existing = getAppKey(principal.tenantId(), appKeyId);
    int deleted =
        jdbcTemplate.update(
            "delete from app_keys where id = :id and tenant_id = :tenantId",
            Map.of("id", appKeyId, "tenantId", principal.tenantId()));
    if (deleted == 0) {
      throw new ApiException(404, "Not found");
    }
    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "app_key.delete",
        "app_key",
        appKeyId,
        ip,
        Map.of("actorRole", principal.role(), "name", String.valueOf(existing.get("name"))));
    return Map.of("id", appKeyId, "name", String.valueOf(existing.get("name")), "deleted", true);
  }

  public List<Map<String, Object>> usage(JwtPrincipal principal) {
    return jdbcTemplate.query(
        """
        select
          l.id, l.request_id, l.trace_id, l.created_at, l.model, l.prompt_tokens, l.completion_tokens,
          l.total_tokens, l.cache_hit, l.latency_ms, l.provider_error_code, l.retry_count,
          l.request_source_ip, l.status_code, l.routing_primary, l.routing_actual, l.routing_reason,
          l.idempotency_key, p.name as provider_name, p.slug as provider_slug,
          a.id as app_key_id, a.name as app_key_name, t.name as tenant_name,
          b.amount_usd, b.subtotal_usd, b.currency, b.type as billing_type, b.description as billing_description,
          b.input_unit_price_usd, b.output_unit_price_usd, b.reconciliation_status, b.invoice_status
        from api_request_logs l
        join providers p on p.id = l.provider_id
        join app_keys a on a.id = l.app_key_id
        join tenants t on t.id = l.tenant_id
        left join billing_records b on b.log_id = l.id
        where l.tenant_id = :tenantId
        order by l.created_at desc
        limit 300
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) ->
            orderedMap(
                "id", rs.getString("id"),
                "requestId", rs.getString("request_id"),
                "traceId", rs.getString("trace_id"),
                "createdAt", rs.getTimestamp("created_at").toInstant(),
                "period", MoneyUtils.dayPeriod(rs.getTimestamp("created_at").toInstant()),
                "tenantName", rs.getString("tenant_name"),
                "appKey", Map.of("id", rs.getString("app_key_id"), "name", rs.getString("app_key_name")),
                "model", rs.getString("model"),
                "promptTokens", rs.getInt("prompt_tokens"),
                "completionTokens", rs.getInt("completion_tokens"),
                "totalTokens", rs.getInt("total_tokens"),
                "costUsd", MoneyUtils.money(rs.getBigDecimal("amount_usd")),
                "subtotalUsd", MoneyUtils.money(rs.getBigDecimal("subtotal_usd")),
                "currency", rs.getString("currency") == null ? "USD" : rs.getString("currency"),
                "billingType", rs.getString("billing_type"),
                "billingDescription", rs.getString("billing_description"),
                "inputUnitPriceUsd", MoneyUtils.money(rs.getBigDecimal("input_unit_price_usd")),
                "outputUnitPriceUsd", MoneyUtils.money(rs.getBigDecimal("output_unit_price_usd")),
                "reconciliationStatus", rs.getString("reconciliation_status"),
                "invoiceStatus", rs.getString("invoice_status"),
                "cacheHit", rs.getBoolean("cache_hit"),
                "provider", Map.of("name", rs.getString("provider_name"), "slug", rs.getString("provider_slug")),
                "latencyMs", rs.getInt("latency_ms"),
                "providerErrorCode", rs.getString("provider_error_code"),
                "retryCount", rs.getInt("retry_count"),
                "requestSourceIp", rs.getString("request_source_ip"),
                "statusCode", rs.getInt("status_code"),
                "routingPrimary", rs.getString("routing_primary"),
                "routingActual", rs.getString("routing_actual"),
                "routingReason", rs.getString("routing_reason"),
                "idempotencyKey", rs.getString("idempotency_key")));
  }

  public List<Map<String, Object>> logs(JwtPrincipal principal) {
    return jdbcTemplate.query(
        """
        select
          l.id, l.model, l.prompt_tokens, l.completion_tokens, l.total_tokens, l.latency_ms,
          l.cache_hit, l.routing_primary, l.routing_actual, l.routing_reason, l.status_code,
          l.created_at, p.name as provider_name, p.slug as provider_slug, a.id as app_key_id, a.name as app_key_name
        from api_request_logs l
        join providers p on p.id = l.provider_id
        join app_keys a on a.id = l.app_key_id
        where l.tenant_id = :tenantId
        order by l.created_at desc
        limit 100
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) ->
            orderedMap(
                "id", rs.getString("id"),
                "model", rs.getString("model"),
                "promptTokens", rs.getInt("prompt_tokens"),
                "completionTokens", rs.getInt("completion_tokens"),
                "totalTokens", rs.getInt("total_tokens"),
                "latencyMs", rs.getInt("latency_ms"),
                "cacheHit", rs.getBoolean("cache_hit"),
                "routingPrimary", rs.getString("routing_primary"),
                "routingActual", rs.getString("routing_actual"),
                "routingReason", rs.getString("routing_reason"),
                "statusCode", rs.getInt("status_code"),
                "createdAt", rs.getTimestamp("created_at").toInstant(),
                "provider", Map.of("name", rs.getString("provider_name"), "slug", rs.getString("provider_slug")),
                "appKey", Map.of("id", rs.getString("app_key_id"), "name", rs.getString("app_key_name"))));
  }

  public Map<String, Object> billingOverview(JwtPrincipal principal) {
    TenantRow tenant = requireTenant(principal.tenantId());
    Timestamp monthStart = ts(LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay().toInstant(ZoneOffset.UTC));
    List<BigDecimal> recentUsageSpend =
        jdbcTemplate.query(
            """
            select amount_usd
            from billing_records
            where tenant_id = :tenantId and type = 'usage'
            order by created_at desc
            limit 100
            """,
            Map.of("tenantId", principal.tenantId()),
            (rs, rowNum) -> rs.getBigDecimal("amount_usd"));
    BigDecimal totalSpend =
        recentUsageSpend.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    Long currentMonthUsage =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(total_tokens), 0)
            from api_request_logs
            where tenant_id = :tenantId and created_at >= :monthStart
            """,
            Map.of("tenantId", principal.tenantId(), "monthStart", monthStart),
            Long.class);
    List<Map<String, Object>> plans =
        jdbcTemplate.query(
            """
            select id, name, code, monthly_token_quota, price_per_million_tokens, description
            from plans order by monthly_token_quota asc
            """,
            (rs, rowNum) -> mapPlan(rs));
    Map<String, Object> currentPlan =
        jdbcTemplate.query(
                """
                select p.id, p.name, p.code, p.monthly_token_quota, p.price_per_million_tokens, p.description
                from tenants t
                join plans p on p.id = t.plan_id
                where t.id = :tenantId
                limit 1
                """,
                Map.of("tenantId", principal.tenantId()),
                (rs, rowNum) -> mapPlan(rs))
            .stream()
            .findFirst()
            .orElse(null);
    List<Map<String, Object>> records =
        jdbcTemplate.query(
            """
            select
              b.id, b.created_at, b.type, b.amount_usd, b.subtotal_usd, b.input_unit_price_usd,
              b.output_unit_price_usd, b.quantity_prompt_tokens, b.quantity_completion_tokens,
              b.currency, b.reconciliation_status, b.invoice_status, b.description, l.model
            from billing_records b
            join api_request_logs l on l.id = b.log_id
            where b.tenant_id = :tenantId
            order by b.created_at desc
            limit 100
            """,
            Map.of("tenantId", principal.tenantId()),
            (rs, rowNum) ->
                orderedMap(
                    "id", rs.getString("id"),
                    "createdAt", rs.getTimestamp("created_at").toInstant(),
                    "type", rs.getString("type"),
                    "typeLabel", billingTypeLabel(rs.getString("type")),
                    "amountUsd", MoneyUtils.money(rs.getBigDecimal("amount_usd")),
                    "subtotalUsd", MoneyUtils.money(rs.getBigDecimal("subtotal_usd")),
                    "inputUnitPriceUsd", MoneyUtils.money(rs.getBigDecimal("input_unit_price_usd")),
                    "outputUnitPriceUsd", MoneyUtils.money(rs.getBigDecimal("output_unit_price_usd")),
                    "quantityPromptTokens", rs.getInt("quantity_prompt_tokens"),
                    "quantityCompletionTokens", rs.getInt("quantity_completion_tokens"),
                    "currency", rs.getString("currency"),
                    "status", "cache_hit".equals(rs.getString("type")) ? "已减免" : "已结算",
                    "reconciliationStatus", rs.getString("reconciliation_status"),
                    "invoiceStatus", rs.getString("invoice_status"),
                    "description", rs.getString("description"),
                    "model", rs.getString("model")));
    BigDecimal estimatedSaving = estimateCacheSavings(principal.tenantId(), monthStart);
    return Map.of(
        "summary",
            orderedMap(
                "totalSpendUsd", MoneyUtils.money(totalSpend),
                "remainingBalanceTokens", MoneyUtils.money(tenant.balanceTokens()),
                "currentMonthUsageTokens", currentMonthUsage == null ? 0 : currentMonthUsage,
                "estimatedSavingUsd", MoneyUtils.money(estimatedSaving),
                "currency", "USD",
                "trialEndsAt", tenant.trialEndsAt(),
                "trialDaysRemaining", tenant.trialDaysRemaining(),
                "tenantStatus", tenant.status(),
                "billingEmail", tenant.billingEmail(),
                "monthlyBudgetUsd", tenant.monthlyBudgetUsd() == null ? null : MoneyUtils.money(tenant.monthlyBudgetUsd()),
                "contractCode", tenant.contractCode()),
        "currentPlan", currentPlan,
        "plans", plans,
        "records", records);
  }

  public List<Map<String, Object>> billing(JwtPrincipal principal) {
    return jdbcTemplate.query(
        """
        select
          b.id, b.amount_usd, b.subtotal_usd, b.currency, b.type, b.description, b.created_at,
          b.reconciliation_status, b.invoice_status, l.model, l.cache_hit
        from billing_records b
        join api_request_logs l on l.id = b.log_id
        where b.tenant_id = :tenantId
        order by b.created_at desc
        limit 100
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) ->
            orderedMap(
                "id", rs.getString("id"),
                "amountUsd", MoneyUtils.money(rs.getBigDecimal("amount_usd")),
                "subtotalUsd", MoneyUtils.money(rs.getBigDecimal("subtotal_usd")),
                "currency", rs.getString("currency"),
                "type", rs.getString("type"),
                "description", rs.getString("description"),
                "createdAt", rs.getTimestamp("created_at").toInstant(),
                "model", rs.getString("model"),
                "cacheHit", rs.getBoolean("cache_hit"),
                "reconciliationStatus", rs.getString("reconciliation_status"),
                "invoiceStatus", rs.getString("invoice_status")));
  }

  public Map<String, Object> routingSummary(JwtPrincipal principal) {
    Map<String, Object> config = getRoutingConfig(principal.tenantId());
    Timestamp since = ts(Instant.now().minus(14, ChronoUnit.DAYS));
    List<Map<String, Object>> providers =
        jdbcTemplate.query(
            """
            select
              p.id, p.slug, p.name, p.provider_type, p.priority, p.timeout_ms, p.enabled,
              p.health_status, p.status, p.api_key_ciphertext is not null as configured,
              coalesce(avg(l.latency_ms), 0) as avg_latency,
              avg(case when l.status_code < 400 then 100 else 0 end) as success_rate,
              max(l.model) filter (where l.model is not null) as top_model
            from providers p
            left join api_request_logs l on l.provider_id = p.id and l.tenant_id = :tenantId and l.created_at >= :since
            group by p.id
            order by p.priority asc, p.slug asc
            """,
            Map.of("tenantId", principal.tenantId(), "since", since),
            (rs, rowNum) -> {
              String slug = rs.getString("slug");
              BigDecimal successRate = rs.getBigDecimal("success_rate");
              if (successRate == null) {
                successRate = BigDecimal.valueOf("claude".equals(slug) ? 98.1 : "gemini".equals(slug) ? 97.2 : 99.0);
              }
              String model = rs.getString("top_model");
              if (model == null) {
                model = defaultModelForType(rs.getString("provider_type"));
              }
              int latency = rs.getBigDecimal("avg_latency") == null || rs.getBigDecimal("avg_latency").compareTo(BigDecimal.ZERO) == 0
                  ? ("claude".equals(slug) ? 720 : "gemini".equals(slug) ? 455 : 380)
                  : rs.getBigDecimal("avg_latency").setScale(0, RoundingMode.HALF_UP).intValue();
              String status = !"active".equals(rs.getString("status")) ? "readonly" : successRate.doubleValue() < 92 ? "degraded" : "active";
              return orderedMap(
                  "providerSlug", slug,
                  "providerName", displayProviderName(slug, rs.getString("name")),
                  "providerType", rs.getString("provider_type"),
                  "model", model,
                  "priority", rowNum + 1,
                  "costScore", costScore(model),
                  "latencyMs", latency,
                  "successRate", successRate.setScale(1, RoundingMode.HALF_UP).doubleValue(),
                  "status", status,
                  "enabled", rs.getBoolean("enabled"),
                  "healthStatus", rs.getString("health_status"),
                  "configured", rs.getBoolean("configured"));
            });
    providers = sortProviderPriority(providers, String.valueOf(config.get("mode")));
    List<Map<String, Object>> routes =
        jdbcTemplate.query(
            """
            select coalesce(routing_actual, 'unknown') as actual_slug, count(*) as count,
                   max(routing_primary) as sample_primary, max(routing_reason) as sample_reason
            from api_request_logs
            where tenant_id = :tenantId and created_at >= :since
            group by coalesce(routing_actual, 'unknown')
            order by count(*) desc
            """,
            Map.of("tenantId", principal.tenantId(), "since", since),
            (rs, rowNum) ->
                orderedMap(
                    "actualSlug", rs.getString("actual_slug"),
                    "count", rs.getLong("count"),
                    "samplePrimary", rs.getString("sample_primary"),
                    "sampleReason", rs.getString("sample_reason")));
    List<Map<String, Object>> recentFallbacks =
        jdbcTemplate.query(
            """
            select model, routing_primary, routing_actual, routing_reason, created_at
            from api_request_logs
            where tenant_id = :tenantId and routing_reason is not null
            order by created_at desc
            limit 8
            """,
            Map.of("tenantId", principal.tenantId()),
            (rs, rowNum) ->
                orderedMap(
                    "model", rs.getString("model"),
                    "routingPrimary", rs.getString("routing_primary"),
                    "routingActual", rs.getString("routing_actual"),
                    "routingReason", rs.getString("routing_reason"),
                    "createdAt", rs.getTimestamp("created_at").toInstant()));
    return Map.of(
        "windowDays", 14,
        "strategyMode", config.get("mode"),
        "strategyNote", ROUTING_NOTES.getOrDefault(String.valueOf(config.get("mode")), ROUTING_NOTES.get("balance")),
        "config", config,
        "fallbackChains", ROUTING_FALLBACK_CHAINS,
        "providerPriority", providers,
        "routes", routes,
        "recentFallbacks", recentFallbacks);
  }

  public Map<String, Object> updateRouting(JwtPrincipal principal, Map<String, Object> body, String ip) {
    requireRole(principal.role(), WRITE_ROLES);
    String mode = blankDefault(body.get("mode"), "balance");
    if (!List.of("cost", "quality", "balance").contains(mode)) {
      throw new ApiException(400, "mode is invalid");
    }
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into tenant_routing_strategies (
          id, tenant_id, mode, fallback_provider_types, max_retries, timeout_ms, created_at, updated_at
        ) values (
          :id, :tenantId, :mode, '[]'::jsonb, 1, 30000, :now, :now
        )
        on conflict (tenant_id) do update set mode = excluded.mode, updated_at = excluded.updated_at
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("route"))
            .addValue("tenantId", principal.tenantId())
            .addValue("mode", mode)
            .addValue("now", ts(now)));
    auditService.write(principal.tenantId(), principal.userId(), "user", "routing.update_strategy", "tenant_routing_strategy", principal.tenantId(), ip, Map.of("mode", mode));
    return Map.of("strategyMode", mode, "strategyNote", ROUTING_NOTES.getOrDefault(mode, ROUTING_NOTES.get("balance")));
  }

  public Map<String, Object> optimizationSummary(JwtPrincipal principal) {
    Timestamp since = ts(Instant.now().minus(30, ChronoUnit.DAYS));
    Long hits =
        jdbcTemplate.queryForObject(
            "select count(*) from api_request_logs where tenant_id = :tenantId and created_at >= :since and cache_hit = true",
            Map.of("tenantId", principal.tenantId(), "since", since),
            Long.class);
    Long misses =
        jdbcTemplate.queryForObject(
            "select count(*) from api_request_logs where tenant_id = :tenantId and created_at >= :since and cache_hit = false",
            Map.of("tenantId", principal.tenantId(), "since", since),
            Long.class);
    Long savedTokens =
        jdbcTemplate.queryForObject(
            "select coalesce(sum(total_tokens), 0) from api_request_logs where tenant_id = :tenantId and created_at >= :since and cache_hit = true",
            Map.of("tenantId", principal.tenantId(), "since", since),
            Long.class);
    List<Map<String, Object>> topRepeatedPrompts =
        jdbcTemplate.query(
            """
            select idempotency_key, count(*) as hits, coalesce(sum(total_tokens), 0) as saved_tokens
            from api_request_logs
            where tenant_id = :tenantId and created_at >= :since and cache_hit = true and idempotency_key is not null
            group by idempotency_key
            order by hits desc
            limit 12
            """,
            Map.of("tenantId", principal.tenantId(), "since", since),
            (rs, rowNum) -> {
              String key = rs.getString("idempotency_key");
              return Map.<String, Object>of(
                  "id", "idem:" + key,
                  "preview", key.length() > 40 ? key.substring(0, 40) + "…" : key,
                  "hits", rs.getLong("hits"),
                  "savedTokens", rs.getLong("saved_tokens"),
                  "source", "idempotency");
            });
    List<Map<String, Object>> promptTemplates;
    try {
      promptTemplates =
          jdbcTemplate.query(
              """
              select id, name, coalesce(description, '') as description, snippet, uses_hint, saved_usd_hint
              from prompt_templates
              where tenant_id is null or tenant_id = :tenantId
              order by sort_order asc, name asc
              """,
              Map.of("tenantId", principal.tenantId()),
              (rs, rowNum) ->
                  Map.of(
                      "id", rs.getString("id"),
                      "name", rs.getString("name"),
                      "description", rs.getString("description"),
                      "snippet", rs.getString("snippet"),
                      "uses", rs.getInt("uses_hint"),
                      "savedUsd", rs.getString("saved_usd_hint")));
    } catch (Exception exception) {
      promptTemplates = List.of();
    }
    long total = (hits == null ? 0 : hits) + (misses == null ? 0 : misses);
    BigDecimal hitRate = total == 0 ? BigDecimal.ZERO : BigDecimal.valueOf((hits == null ? 0 : hits) * 1000.0 / total).setScale(1, RoundingMode.HALF_UP);
    BigDecimal savedUsd = estimateCacheSavings(principal.tenantId(), since);
    return Map.of(
        "windowDays", 30,
        "cacheHitRate", hitRate.doubleValue(),
        "savedTokens", savedTokens == null ? 0 : savedTokens,
        "estimatedSavedUsd", MoneyUtils.money(savedUsd),
        "cacheHits", hits == null ? 0 : hits,
        "nonCacheRequests", misses == null ? 0 : misses,
        "note", "节省金额按「缓存命中累计 Token × 当前套餐每百万 Token 单价」估算；命中率=命中次数/（命中+未命中）。",
        "valueLine", "平台通过语义与幂等缓存拦截重复流量，将本将消耗的 Token 与上游成本转化为可核算的节省项。",
        "topRepeatedPrompts", topRepeatedPrompts,
        "promptTemplates", promptTemplates);
  }

  public Map<String, Object> getCacheSettings(JwtPrincipal principal) {
    return jdbcTemplate.query(
            """
            select enabled, mode, similarity_threshold, ttl_seconds
            from tenant_cache_settings
            where tenant_id = :tenantId
            limit 1
            """,
            Map.of("tenantId", principal.tenantId()),
            (rs, rowNum) ->
                Map.<String, Object>of(
                    "enabled", rs.getBoolean("enabled"),
                    "mode", rs.getString("mode"),
                    "similarityThreshold", rs.getBigDecimal("similarity_threshold").doubleValue(),
                    "ttlSeconds", rs.getInt("ttl_seconds")))
        .stream()
        .findFirst()
        .orElse(Map.of("enabled", true, "mode", "semantic", "similarityThreshold", 0.92, "ttlSeconds", 86400));
  }

  public Map<String, Object> updateCacheSettings(JwtPrincipal principal, Map<String, Object> body, String ip) {
    requireRole(principal.role(), WRITE_ROLES);
    validateCacheSettingsBody(body);
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into tenant_cache_settings (
          id, tenant_id, enabled, mode, similarity_threshold, ttl_seconds, created_at, updated_at
        ) values (
          :id, :tenantId, :enabled, :mode, :similarityThreshold, :ttlSeconds, :now, :now
        )
        on conflict (tenant_id) do update set
          enabled = excluded.enabled,
          mode = excluded.mode,
          similarity_threshold = excluded.similarity_threshold,
          ttl_seconds = excluded.ttl_seconds,
          updated_at = excluded.updated_at
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("cache"))
            .addValue("tenantId", principal.tenantId())
            .addValue("enabled", booleanValue(body.get("enabled"), true))
            .addValue("mode", blankDefault(body.get("mode"), "semantic"))
            .addValue("similarityThreshold", decimalOrDefault(body.get("similarityThreshold"), new BigDecimal("0.920")))
            .addValue("ttlSeconds", intValue(body.get("ttlSeconds"), 86400))
            .addValue("now", ts(now)));
    auditService.write(principal.tenantId(), principal.userId(), "user", "optimization.update_cache_settings", "tenant_cache_settings", principal.tenantId(), ip, body);
    return getCacheSettings(principal);
  }

  public List<Map<String, Object>> providers(JwtPrincipal principal) {
    requireRole(principal.role(), Set.of("owner", "admin", "developer", "billing"));
    return jdbcTemplate.query(
        """
        select
          id, name, slug, provider_type, status, enabled, priority, timeout_ms, base_url, health_status,
          api_key_ciphertext is not null as configured, supports_streaming, model_catalog::text as model_catalog, last_checked_at
        from providers
        order by priority asc, name asc
        """,
        (rs, rowNum) ->
            orderedMap(
                "id", rs.getString("id"),
                "name", rs.getString("name"),
                "slug", rs.getString("slug"),
                "providerType", rs.getString("provider_type"),
                "status", rs.getString("status"),
                "enabled", rs.getBoolean("enabled"),
                "priority", rs.getInt("priority"),
                "timeoutMs", rs.getInt("timeout_ms"),
                "baseUrl", rs.getString("base_url"),
                "healthStatus", rs.getString("health_status"),
                "configured", rs.getBoolean("configured"),
                "supportsStreaming", rs.getBoolean("supports_streaming"),
                "modelCatalog", jsons.readObjectList(rs.getString("model_catalog")),
                "lastCheckedAt", rs.getTimestamp("last_checked_at") == null ? null : rs.getTimestamp("last_checked_at").toInstant()));
  }

  public Map<String, Object> updateProvider(JwtPrincipal principal, String id, Map<String, Object> body, String ip) {
    requireRole(principal.role(), ADMIN_ROLES);
    validateProviderBody(body);
    MapSqlParameterSource params = new MapSqlParameterSource().addValue("id", id);
    List<String> sets = new ArrayList<>();
    patchSet(sets, params, "enabled", body.get("enabled"));
    patchSet(sets, params, "priority", body.get("priority"));
    patchSet(sets, params, "timeout_ms", body.get("timeoutMs"));
    patchSet(sets, params, "base_url", body.get("baseUrl"));
    patchSet(sets, params, "health_status", body.get("healthStatus"));
    if (body.containsKey("apiKey")) {
      sets.add("api_key_ciphertext = :apiKeyCiphertext");
      params.addValue("apiKeyCiphertext", cryptoUtils.encryptSecret(String.valueOf(body.get("apiKey"))));
    }
    if (body.containsKey("modelCatalog")) {
      sets.add("model_catalog = cast(:modelCatalog as jsonb)");
      params.addValue("modelCatalog", jsons.stringify(body.get("modelCatalog")));
    }
    if (sets.isEmpty()) {
      throw new ApiException(400, "未提供可更新字段");
    }
    int updated = jdbcTemplate.update("update providers set " + String.join(", ", sets) + " where id = :id", params);
    if (updated == 0) {
      throw new ApiException(404, "Provider not found");
    }
    auditService.write(principal.tenantId(), principal.userId(), "user", "provider.update", "provider", id, ip, Map.of("fields", body.keySet()));
    return providers(principal).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow(() -> new ApiException(404, "Provider not found"));
  }

  public Map<String, Object> deleteProvider(JwtPrincipal principal, String id, String ip) {
    requireRole(principal.role(), ADMIN_ROLES);
    Map<String, Object> existing =
        providers(principal).stream()
            .filter(row -> id.equals(row.get("id")))
            .findFirst()
            .orElseThrow(() -> new ApiException(404, "Provider not found"));
    Integer usageCount =
        jdbcTemplate.queryForObject(
            "select count(*) from api_request_logs where provider_id = :id",
            Map.of("id", id),
            Integer.class);
    if (usageCount != null && usageCount > 0) {
      throw new ApiException(409, "该供应商已有历史调用记录，不能删除；如需停用请改为禁用");
    }
    int deleted = jdbcTemplate.update("delete from providers where id = :id", Map.of("id", id));
    if (deleted == 0) {
      throw new ApiException(404, "Provider not found");
    }
    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "provider.delete",
        "provider",
        id,
        ip,
        Map.of("name", existing.get("name"), "slug", existing.get("slug")));
    return orderedMap("id", id, "name", existing.get("name"), "deleted", true);
  }

  public List<Map<String, Object>> adminUsers(JwtPrincipal principal) {
    requirePlatformAdmin(principal);
    List<Map<String, Object>> users =
        jdbcTemplate.query(
            """
            select
              u.id, u.email, u.name, coalesce(u.platform_role, 'user') as platform_role,
              u.email_verified_at, u.created_at, count(tm.id) as tenant_count
            from users u
            left join tenant_members tm on tm.user_id = u.id
            group by u.id, u.email, u.name, u.platform_role, u.email_verified_at, u.created_at
            order by u.created_at desc
            """,
            (rs, rowNum) ->
                orderedMap(
                    "id", rs.getString("id"),
                    "email", rs.getString("email"),
                    "name", rs.getString("name"),
                    "platformRole", rs.getString("platform_role"),
                    "emailVerifiedAt", rs.getTimestamp("email_verified_at") == null ? null : rs.getTimestamp("email_verified_at").toInstant(),
                    "createdAt", rs.getTimestamp("created_at").toInstant(),
                    "tenantCount", rs.getLong("tenant_count"),
                    "requestCount", 0L,
                    "totalTokens", 0L,
                    "rechargeCount", 0L,
                    "rechargeSuccessCny", "0",
                    "rechargeTokens", "0",
                    "lastRequestAt", null,
                    "lastRechargeAt", null,
                    "memberships", new ArrayList<Map<String, Object>>()));
    Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
    for (Map<String, Object> user : users) {
      byId.put(String.valueOf(user.get("id")), user);
    }
    jdbcTemplate.query(
        """
        select
          tm.user_id,
          count(l.id) as request_count,
          coalesce(sum(l.total_tokens), 0) as total_tokens,
          max(l.created_at) as last_request_at
        from tenant_members tm
        left join api_request_logs l on l.tenant_id = tm.tenant_id
        group by tm.user_id
        """,
        (rs, rowNum) -> {
          Map<String, Object> user = byId.get(rs.getString("user_id"));
          if (user != null) {
            user.put("requestCount", rs.getLong("request_count"));
            user.put("totalTokens", rs.getLong("total_tokens"));
            user.put(
                "lastRequestAt",
                rs.getTimestamp("last_request_at") == null
                    ? null
                    : rs.getTimestamp("last_request_at").toInstant());
          }
          return null;
        });
    jdbcTemplate.query(
        """
        select
          tm.user_id,
          count(o.id) as recharge_count,
          coalesce(sum(case when o.status = 'success' then o.amount_cny else 0 end), 0) as recharge_success_cny,
          coalesce(sum(case when o.status = 'success' then o.credited_tokens else 0 end), 0) as recharge_tokens,
          max(o.created_at) as last_recharge_at
        from tenant_members tm
        left join wallet_recharge_orders o on o.tenant_id = tm.tenant_id
        group by tm.user_id
        """,
        (rs, rowNum) -> {
          Map<String, Object> user = byId.get(rs.getString("user_id"));
          if (user != null) {
            user.put("rechargeCount", rs.getLong("recharge_count"));
            user.put("rechargeSuccessCny", MoneyUtils.money(rs.getBigDecimal("recharge_success_cny")));
            user.put("rechargeTokens", MoneyUtils.money(rs.getBigDecimal("recharge_tokens")));
            user.put(
                "lastRechargeAt",
                rs.getTimestamp("last_recharge_at") == null
                    ? null
                    : rs.getTimestamp("last_recharge_at").toInstant());
          }
          return null;
        });
    jdbcTemplate.query(
        """
        select
          tm.user_id, tm.role, tm.allowed_models::text as allowed_models,
          t.id as tenant_id, t.name as tenant_name, t.slug as tenant_slug, t.status as tenant_status,
          t.balance_tokens
        from tenant_members tm
        join tenants t on t.id = tm.tenant_id
        order by tm.id asc
        """,
        (rs, rowNum) -> {
          Map<String, Object> user = byId.get(rs.getString("user_id"));
          if (user != null) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> memberships = (List<Map<String, Object>>) user.get("memberships");
            memberships.add(
                orderedMap(
                    "tenantId", rs.getString("tenant_id"),
                    "tenantName", rs.getString("tenant_name"),
                    "tenantSlug", rs.getString("tenant_slug"),
                    "tenantStatus", rs.getString("tenant_status"),
                    "role", rs.getString("role"),
                    "balanceTokens", MoneyUtils.money(rs.getBigDecimal("balance_tokens")),
                    "allowedModels", jsons.readStringList(rs.getString("allowed_models"))));
          }
          return null;
        });
    return users;
  }

  public List<Map<String, Object>> adminUserTenantOptions(JwtPrincipal principal) {
    requirePlatformAdmin(principal);
    return jdbcTemplate.query(
        """
        select id, name, slug, status, balance_tokens
        from tenants
        order by created_at desc, name asc
        """,
        (rs, rowNum) ->
            orderedMap(
                "id", rs.getString("id"),
                "name", rs.getString("name"),
                "slug", rs.getString("slug"),
                "status", rs.getString("status"),
                "balanceTokens", MoneyUtils.money(rs.getBigDecimal("balance_tokens"))));
  }

  @Transactional
  public Map<String, Object> createAdminUser(
      JwtPrincipal principal, Map<String, Object> body, String ip) {
    requirePlatformAdmin(principal);
    String name = nullableTrim(body.get("name"));
    String email = nullableTrim(body.get("email"));
    String password = stringValue(body.get("password"));
    String platformRole = blankDefault(body.get("platformRole"), "user");
    String tenantMode = blankDefault(body.get("tenantMode"), "new");
    String tenantRole = blankDefault(body.get("tenantRole"), "owner");
    if (name == null || name.length() > 80) {
      throw new ApiException(400, "姓名不能为空且不能超过 80 个字符");
    }
    if (email == null || email.length() > 200 || !email.contains("@")) {
      throw new ApiException(400, "邮箱格式不正确");
    }
    if (password.length() < 6 || password.length() > 128) {
      throw new ApiException(400, "密码长度必须在 6 到 128 个字符之间");
    }
    if (!Set.of("user", "platform_admin").contains(platformRole)) {
      throw new ApiException(400, "平台角色不支持");
    }
    if (!Set.of("new", "existing").contains(tenantMode)) {
      throw new ApiException(400, "租户模式不支持");
    }
    if (!MEMBER_ROLES.contains(tenantRole)) {
      throw new ApiException(400, "租户角色不支持");
    }
    String normalizedEmail = email.trim().toLowerCase();
    BigDecimal tokenBalance;
    try {
      tokenBalance = decimalOrDefault(body.get("tokenBalance"), new BigDecimal("250000"));
    } catch (RuntimeException ex) {
      throw new ApiException(400, "Token 余额格式不正确");
    }
    if (tokenBalance.compareTo(BigDecimal.ZERO) < 0
        || tokenBalance.compareTo(new BigDecimal("999999999999999")) > 0) {
      throw new ApiException(400, "Token 余额超出允许范围");
    }
    Integer existing =
        jdbcTemplate.queryForObject(
            "select count(*) from users where email = :email",
            Map.of("email", normalizedEmail),
            Integer.class);
    if (existing != null && existing > 0) {
      throw new ApiException(409, "邮箱已存在");
    }

    Instant now = Instant.now();
    String userId = Ids.cuidLike("usr");
    jdbcTemplate.update(
        """
        insert into users (id, email, password_hash, name, platform_role, created_at, updated_at)
        values (:id, :email, :passwordHash, :name, :platformRole, :now, :now)
        """,
        new MapSqlParameterSource()
            .addValue("id", userId)
            .addValue("email", normalizedEmail)
            .addValue("passwordHash", passwordEncoder.encode(password))
            .addValue("name", name)
            .addValue("platformRole", platformRole)
            .addValue("now", ts(now)));

    String tenantId;
    String tenantName;
    if ("new".equals(tenantMode)) {
      tenantName = nullableTrim(body.get("tenantName"));
      if (tenantName == null || tenantName.length() > 120) {
        throw new ApiException(400, "租户名称不能为空且不能超过 120 个字符");
      }
      String starterPlanId =
          jdbcTemplate.query(
                  "select id from plans where code = 'starter' limit 1",
                  (rs, rowNum) -> rs.getString("id"))
              .stream()
              .findFirst()
              .orElse(null);
      tenantId = Ids.cuidLike("tenant");
      jdbcTemplate.update(
          """
          insert into tenants (
            id, name, slug, status, plan_id, balance_tokens, trial_ends_at, billing_email,
            contact_sales_email, monthly_budget_usd, spend_cap_enforced, created_at, updated_at
          ) values (
            :id, :name, :slug, 'active', :planId, :balanceTokens, null, :billingEmail,
            null, 0, false, :now, :now
          )
          """,
          new MapSqlParameterSource()
              .addValue("id", tenantId)
              .addValue("name", tenantName)
              .addValue("slug", nextTenantSlug())
              .addValue("planId", starterPlanId)
              .addValue("balanceTokens", tokenBalance)
              .addValue("billingEmail", normalizedEmail)
              .addValue("now", ts(now)));
      ensureTenantDefaults(tenantId, now);
    } else {
      tenantId = nullableTrim(body.get("tenantId"));
      if (tenantId == null) {
        throw new ApiException(400, "请选择已有租户");
      }
      TenantRow tenant = requireTenant(tenantId);
      tenantName = tenant.name();
      jdbcTemplate.update(
          """
          update tenants
          set balance_tokens = :balanceTokens, updated_at = :now
          where id = :tenantId
          """,
          new MapSqlParameterSource()
              .addValue("tenantId", tenantId)
              .addValue("balanceTokens", tokenBalance)
              .addValue("now", ts(now)));
    }

    jdbcTemplate.update(
        """
        insert into tenant_members (id, user_id, tenant_id, role)
        values (:id, :userId, :tenantId, :role)
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("tm"))
            .addValue("userId", userId)
            .addValue("tenantId", tenantId)
            .addValue("role", tenantRole));

    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "admin.user.create",
        "user",
        userId,
        ip,
        orderedMap(
            "email", normalizedEmail,
            "platformRole", platformRole,
            "tenantMode", tenantMode,
            "tenantRole", tenantRole,
            "tenantId", tenantId,
            "tenantName", tenantName,
            "tokenBalance", MoneyUtils.money(tokenBalance)));

    return orderedMap(
        "id", userId,
        "email", normalizedEmail,
        "name", name,
        "platformRole", platformRole,
        "tenantId", tenantId,
        "tenantName", tenantName,
        "tenantRole", tenantRole,
        "tokenBalance", MoneyUtils.money(tokenBalance));
  }

  public Map<String, Object> updateAdminUserAllowedModels(
      JwtPrincipal principal,
      String userId,
      String tenantId,
      Map<String, Object> body,
      String ip) {
    requirePlatformAdmin(principal);
    List<String> allowedModels = defaultStringList(body.get("allowedModels"), List.of());
    validateAllowedModelsWithinAvailable(allowedModels, availableGatewayModelIds());
    int updated =
        jdbcTemplate.update(
            """
            update tenant_members
            set allowed_models = cast(:allowedModels as jsonb)
            where user_id = :userId and tenant_id = :tenantId
            """,
            new MapSqlParameterSource()
                .addValue("userId", userId)
                .addValue("tenantId", tenantId)
                .addValue("allowedModels", jsons.stringify(allowedModels)));
    if (updated == 0) {
      throw new ApiException(404, "Not found");
    }
    auditService.write(
        principal.tenantId(),
        principal.userId(),
        "user",
        "tenant_member.allowed_models.update",
        "tenant_member",
        tenantId + ":" + userId,
        ip,
        Map.of("allowedModels", allowedModels));
    return Map.of("ok", true, "userId", userId, "tenantId", tenantId, "allowedModels", allowedModels);
  }

  public Map<String, Object> adminUsageOverview(
      JwtPrincipal principal, String from, String to, String dimension) {
    requirePlatformAdmin(principal);
    UsageRange range = parseUsageRange(from, to);
    String resolvedDimension = normalizeUsageDimension(dimension);
    MapSqlParameterSource rangeParams = usageRangeParams(range);
    return orderedMap(
        "from", range.fromDate().toString(),
        "to", range.toDate().toString(),
        "dimension", resolvedDimension,
        "summaries",
            "user".equals(resolvedDimension)
                ? adminUserUsageSummaries(range)
                : adminTenantUsageSummaries(range),
        "appKeys",
            jdbcTemplate.query(
                """
                select
                  a.id, a.name, t.name as tenant_name, a.environment,
                  count(l.id) as request_count,
                  coalesce(sum(l.total_tokens), 0) as total_tokens,
                  coalesce(sum(case when l.status_code >= 200 and l.status_code < 300 then 1 else 0 end), 0) as success_count,
                  coalesce(sum(b.amount_usd), 0) as spend_usd,
                  max(l.created_at) as last_called_at
                from app_keys a
                join tenants t on t.id = a.tenant_id
                left join api_request_logs l
                  on l.app_key_id = a.id and l.created_at >= :fromTs and l.created_at < :toTs
                left join billing_records b on b.log_id = l.id
                group by a.id, a.name, t.name, a.environment
                order by request_count desc, a.name asc
                """,
                rangeParams,
                (rs, rowNum) ->
                    orderedMap(
                        "id", rs.getString("id"),
                        "name", rs.getString("name"),
                        "tenantName", rs.getString("tenant_name"),
                        "environment", rs.getString("environment"),
                        "requestCount", rs.getLong("request_count"),
                        "totalTokens", rs.getLong("total_tokens"),
                        "successCount", rs.getLong("success_count"),
                        "spendUsd", MoneyUtils.money(rs.getBigDecimal("spend_usd")),
                        "lastCalledAt",
                            rs.getTimestamp("last_called_at") == null
                                ? null
                                : rs.getTimestamp("last_called_at").toInstant())),
        "models",
            jdbcTemplate.query(
                """
                select
                  coalesce(l.model, 'unknown') as model,
                  coalesce(p.slug, 'unknown') as provider_slug,
                  count(l.id) as request_count,
                  coalesce(sum(l.total_tokens), 0) as total_tokens,
                  coalesce(sum(b.amount_usd), 0) as spend_usd,
                  coalesce(avg(l.latency_ms), 0) as avg_latency_ms,
                  coalesce(sum(case when l.status_code >= 200 and l.status_code < 300 then 1 else 0 end), 0) as success_count
                from api_request_logs l
                left join providers p on p.id = l.provider_id
                left join billing_records b on b.log_id = l.id
                where l.created_at >= :fromTs and l.created_at < :toTs
                group by coalesce(l.model, 'unknown'), coalesce(p.slug, 'unknown')
                order by request_count desc, model asc
                """,
                rangeParams,
                (rs, rowNum) -> {
                  long requestCount = rs.getLong("request_count");
                  long successCount = rs.getLong("success_count");
                  double successRate =
                      requestCount == 0
                          ? 100.0
                          : BigDecimal.valueOf(successCount * 100.0 / requestCount)
                              .setScale(1, RoundingMode.HALF_UP)
                              .doubleValue();
                  return orderedMap(
                      "model", rs.getString("model"),
                      "providerSlug", rs.getString("provider_slug"),
                      "requestCount", requestCount,
                      "totalTokens", rs.getLong("total_tokens"),
                      "spendUsd", MoneyUtils.money(rs.getBigDecimal("spend_usd")),
                      "avgLatencyMs",
                          rs.getBigDecimal("avg_latency_ms").setScale(0, RoundingMode.HALF_UP).intValue(),
                      "successRate", successRate);
                }),
        "appKeyTrends", buildAppKeyTrends(range),
        "modelTrends", buildModelTrends(range),
        "recharges", adminRechargeOverview(range),
        "rechargeOrders", adminRechargeOrders(range));
  }

  private List<Map<String, Object>> adminUserUsageSummaries(UsageRange range) {
    List<Map<String, Object>> users =
        jdbcTemplate.query(
            """
            select
              u.id, u.email, u.name, coalesce(u.platform_role, 'user') as platform_role,
              u.created_at, count(tm.id) as tenant_count
            from users u
            left join tenant_members tm on tm.user_id = u.id
            group by u.id, u.email, u.name, u.platform_role, u.created_at
            order by u.created_at desc
            """,
            (rs, rowNum) ->
                orderedMap(
                    "id", rs.getString("id"),
                    "name", blankDefault(rs.getString("name"), rs.getString("email")),
                    "email", rs.getString("email"),
                    "platformRole", rs.getString("platform_role"),
                    "tenantCount", rs.getLong("tenant_count"),
                    "requestCount", 0L,
                    "totalTokens", 0L,
                    "rechargeCount", 0L,
                    "rechargeSuccessCny", "0",
                    "rechargeTokens", "0",
                    "lastRequestAt", null,
                    "lastRechargeAt", null));
    Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
    for (Map<String, Object> user : users) {
      byId.put(String.valueOf(user.get("id")), user);
    }
    jdbcTemplate.query(
        """
        select
          tm.user_id,
          count(l.id) as request_count,
          coalesce(sum(l.total_tokens), 0) as total_tokens,
          max(l.created_at) as last_request_at
        from tenant_members tm
        left join api_request_logs l
          on l.tenant_id = tm.tenant_id and l.created_at >= :fromTs and l.created_at < :toTs
        group by tm.user_id
        """,
        usageRangeParams(range),
        (rs, rowNum) -> {
          Map<String, Object> user = byId.get(rs.getString("user_id"));
          if (user != null) {
            user.put("requestCount", rs.getLong("request_count"));
            user.put("totalTokens", rs.getLong("total_tokens"));
            user.put(
                "lastRequestAt",
                rs.getTimestamp("last_request_at") == null
                    ? null
                    : rs.getTimestamp("last_request_at").toInstant());
          }
          return null;
        });
    jdbcTemplate.query(
        """
        select
          tm.user_id,
          count(o.id) as recharge_count,
          coalesce(sum(case when o.status = 'success' then o.amount_cny else 0 end), 0) as recharge_success_cny,
          coalesce(sum(case when o.status = 'success' then o.credited_tokens else 0 end), 0) as recharge_tokens,
          max(o.created_at) as last_recharge_at
        from tenant_members tm
        left join wallet_recharge_orders o
          on o.tenant_id = tm.tenant_id and o.created_at >= :fromTs and o.created_at < :toTs
        group by tm.user_id
        """,
        usageRangeParams(range),
        (rs, rowNum) -> {
          Map<String, Object> user = byId.get(rs.getString("user_id"));
          if (user != null) {
            user.put("rechargeCount", rs.getLong("recharge_count"));
            user.put("rechargeSuccessCny", MoneyUtils.money(rs.getBigDecimal("recharge_success_cny")));
            user.put("rechargeTokens", MoneyUtils.money(rs.getBigDecimal("recharge_tokens")));
            user.put(
                "lastRechargeAt",
                rs.getTimestamp("last_recharge_at") == null
                    ? null
                    : rs.getTimestamp("last_recharge_at").toInstant());
          }
          return null;
        });
    users.sort(
        (left, right) -> {
          int byRequests =
              Long.compare(longValue(right.get("requestCount")), longValue(left.get("requestCount")));
          if (byRequests != 0) {
            return byRequests;
          }
          int byTokens =
              Long.compare(longValue(right.get("totalTokens")), longValue(left.get("totalTokens")));
          if (byTokens != 0) {
            return byTokens;
          }
          return String.valueOf(left.get("name")).compareToIgnoreCase(String.valueOf(right.get("name")));
        });
    return users;
  }

  private List<Map<String, Object>> adminTenantUsageSummaries(UsageRange range) {
    List<Map<String, Object>> tenants =
        jdbcTemplate.query(
            """
            select
              t.id, t.name, t.slug, t.status, count(tm.id) as member_count
            from tenants t
            left join tenant_members tm on tm.tenant_id = t.id
            group by t.id, t.name, t.slug, t.status
            order by t.name asc
            """,
            (rs, rowNum) ->
                orderedMap(
                    "id", rs.getString("id"),
                    "name", rs.getString("name"),
                    "tenantSlug", rs.getString("slug"),
                    "tenantStatus", rs.getString("status"),
                    "memberCount", rs.getLong("member_count"),
                    "requestCount", 0L,
                    "totalTokens", 0L,
                    "rechargeCount", 0L,
                    "rechargeSuccessCny", "0",
                    "rechargeTokens", "0",
                    "lastRequestAt", null,
                    "lastRechargeAt", null));
    Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
    for (Map<String, Object> tenant : tenants) {
      byId.put(String.valueOf(tenant.get("id")), tenant);
    }
    jdbcTemplate.query(
        """
        select
          t.id as tenant_id,
          count(l.id) as request_count,
          coalesce(sum(l.total_tokens), 0) as total_tokens,
          max(l.created_at) as last_request_at
        from tenants t
        left join api_request_logs l
          on l.tenant_id = t.id and l.created_at >= :fromTs and l.created_at < :toTs
        group by t.id
        """,
        usageRangeParams(range),
        (rs, rowNum) -> {
          Map<String, Object> tenant = byId.get(rs.getString("tenant_id"));
          if (tenant != null) {
            tenant.put("requestCount", rs.getLong("request_count"));
            tenant.put("totalTokens", rs.getLong("total_tokens"));
            tenant.put(
                "lastRequestAt",
                rs.getTimestamp("last_request_at") == null
                    ? null
                    : rs.getTimestamp("last_request_at").toInstant());
          }
          return null;
        });
    jdbcTemplate.query(
        """
        select
          t.id as tenant_id,
          count(o.id) as recharge_count,
          coalesce(sum(case when o.status = 'success' then o.amount_cny else 0 end), 0) as recharge_success_cny,
          coalesce(sum(case when o.status = 'success' then o.credited_tokens else 0 end), 0) as recharge_tokens,
          max(o.created_at) as last_recharge_at
        from tenants t
        left join wallet_recharge_orders o
          on o.tenant_id = t.id and o.created_at >= :fromTs and o.created_at < :toTs
        group by t.id
        """,
        usageRangeParams(range),
        (rs, rowNum) -> {
          Map<String, Object> tenant = byId.get(rs.getString("tenant_id"));
          if (tenant != null) {
            tenant.put("rechargeCount", rs.getLong("recharge_count"));
            tenant.put("rechargeSuccessCny", MoneyUtils.money(rs.getBigDecimal("recharge_success_cny")));
            tenant.put("rechargeTokens", MoneyUtils.money(rs.getBigDecimal("recharge_tokens")));
            tenant.put(
                "lastRechargeAt",
                rs.getTimestamp("last_recharge_at") == null
                    ? null
                    : rs.getTimestamp("last_recharge_at").toInstant());
          }
          return null;
        });
    tenants.sort(
        (left, right) -> {
          int byRequests =
              Long.compare(longValue(right.get("requestCount")), longValue(left.get("requestCount")));
          if (byRequests != 0) {
            return byRequests;
          }
          int byTokens =
              Long.compare(longValue(right.get("totalTokens")), longValue(left.get("totalTokens")));
          if (byTokens != 0) {
            return byTokens;
          }
          return String.valueOf(left.get("name")).compareToIgnoreCase(String.valueOf(right.get("name")));
        });
    return tenants;
  }

  private List<Map<String, Object>> adminRechargeOverview(UsageRange range) {
    return jdbcTemplate.query(
        """
        select
          t.id as tenant_id, t.name as tenant_name,
          count(o.id) as recharge_count,
          coalesce(sum(case when o.status = 'success' then o.amount_cny else 0 end), 0) as success_amount_cny,
          coalesce(sum(case when o.status = 'success' then o.credited_tokens else 0 end), 0) as success_tokens,
          max(o.created_at) as last_recharge_at
        from tenants t
        left join wallet_recharge_orders o
          on o.tenant_id = t.id and o.created_at >= :fromTs and o.created_at < :toTs
        group by t.id, t.name
        order by recharge_count desc, t.name asc
        """,
        usageRangeParams(range),
        (rs, rowNum) ->
            orderedMap(
                "tenantId", rs.getString("tenant_id"),
                "tenantName", rs.getString("tenant_name"),
                "rechargeCount", rs.getLong("recharge_count"),
                "successAmountCny", MoneyUtils.money(rs.getBigDecimal("success_amount_cny")),
                "successTokens", MoneyUtils.money(rs.getBigDecimal("success_tokens")),
                "lastRechargeAt",
                    rs.getTimestamp("last_recharge_at") == null
                        ? null
                        : rs.getTimestamp("last_recharge_at").toInstant()));
  }

  private List<Map<String, Object>> adminRechargeOrders(UsageRange range) {
    return jdbcTemplate.query(
        """
        select
          o.id, o.order_no, o.tenant_id, t.name as tenant_name, o.amount_cny, o.currency,
          o.pay_channel, o.status, o.credited_tokens, o.payer_name, o.need_invoice, o.remark,
          o.paid_at, o.created_at
        from wallet_recharge_orders o
        join tenants t on t.id = o.tenant_id
        where o.created_at >= :fromTs and o.created_at < :toTs
        order by o.created_at desc
        limit 300
        """,
        usageRangeParams(range),
        (rs, rowNum) ->
            orderedMap(
                "id", rs.getString("id"),
                "orderNo", rs.getString("order_no"),
                "tenantId", rs.getString("tenant_id"),
                "tenantName", rs.getString("tenant_name"),
                "amount", MoneyUtils.money(rs.getBigDecimal("amount_cny")),
                "currency", rs.getString("currency"),
                "payChannel", rs.getString("pay_channel"),
                "status", rs.getString("status"),
                "creditedTokens", MoneyUtils.money(rs.getBigDecimal("credited_tokens")),
                "payerName", rs.getString("payer_name"),
                "needInvoice", rs.getBoolean("need_invoice"),
                "remark", rs.getString("remark"),
                "paidAt", rs.getTimestamp("paid_at") == null ? null : rs.getTimestamp("paid_at").toInstant(),
                "createdAt", rs.getTimestamp("created_at").toInstant()));
  }

  private List<Map<String, Object>> buildAppKeyTrends(UsageRange range) {
    List<Map<String, Object>> topKeys =
        jdbcTemplate.query(
            """
            select
              a.id, a.name, t.name as tenant_name, count(l.id) as request_count
            from app_keys a
            join tenants t on t.id = a.tenant_id
            left join api_request_logs l
              on l.app_key_id = a.id and l.created_at >= :fromTs and l.created_at < :toTs
            group by a.id, a.name, t.name
            order by request_count desc, a.name asc
            limit 5
            """,
            usageRangeParams(range),
            (rs, rowNum) ->
                orderedMap(
                    "id", rs.getString("id"),
                    "label", rs.getString("name") + " · " + rs.getString("tenant_name"),
                    "requestCount", rs.getLong("request_count")));
    if (topKeys.isEmpty()) {
      return List.of();
    }
    Map<String, Map<String, Long>> countsByKey = new LinkedHashMap<>();
    for (Map<String, Object> row : topKeys) {
      countsByKey.put(String.valueOf(row.get("id")), new LinkedHashMap<>());
    }
    jdbcTemplate.query(
        """
        select
          l.app_key_id,
          to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD') as day,
          count(l.id) as request_count
        from api_request_logs l
        where l.created_at >= :fromTs and l.created_at < :toTs and l.app_key_id in (:ids)
        group by l.app_key_id, to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD')
        order by day asc
        """,
        usageRangeParams(range).addValue("ids", countsByKey.keySet()),
        (rs, rowNum) -> {
          Map<String, Long> byDay = countsByKey.get(rs.getString("app_key_id"));
          if (byDay != null) {
            byDay.put(rs.getString("day"), rs.getLong("request_count"));
          }
          return null;
        });
    return topKeys.stream()
        .map(
            row ->
                orderedMap(
                    "key", row.get("id"),
                    "label", row.get("label"),
                    "requestCount", row.get("requestCount"),
                    "points", buildTrendPoints(range, countsByKey.get(String.valueOf(row.get("id"))))))
        .toList();
  }

  private List<Map<String, Object>> buildModelTrends(UsageRange range) {
    List<Map<String, Object>> topModels =
        jdbcTemplate.query(
            """
            select
              coalesce(l.model, 'unknown') as model,
              coalesce(p.slug, 'unknown') as provider_slug,
              count(l.id) as request_count
            from api_request_logs l
            left join providers p on p.id = l.provider_id
            where l.created_at >= :fromTs and l.created_at < :toTs
            group by coalesce(l.model, 'unknown'), coalesce(p.slug, 'unknown')
            order by request_count desc, model asc
            limit 5
            """,
            usageRangeParams(range),
            (rs, rowNum) ->
                orderedMap(
                    "key", rs.getString("model") + "||" + rs.getString("provider_slug"),
                    "label", rs.getString("model") + " · " + rs.getString("provider_slug"),
                    "requestCount", rs.getLong("request_count")));
    if (topModels.isEmpty()) {
      return List.of();
    }
    Map<String, Map<String, Long>> countsByModel = new LinkedHashMap<>();
    for (Map<String, Object> row : topModels) {
      countsByModel.put(String.valueOf(row.get("key")), new LinkedHashMap<>());
    }
    jdbcTemplate.query(
        """
        select
          coalesce(l.model, 'unknown') as model,
          coalesce(p.slug, 'unknown') as provider_slug,
          to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD') as day,
          count(l.id) as request_count
        from api_request_logs l
        left join providers p on p.id = l.provider_id
        where l.created_at >= :fromTs and l.created_at < :toTs
        group by coalesce(l.model, 'unknown'), coalesce(p.slug, 'unknown'), to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD')
        order by day asc
        """,
        usageRangeParams(range),
        (rs, rowNum) -> {
          String key = rs.getString("model") + "||" + rs.getString("provider_slug");
          Map<String, Long> byDay = countsByModel.get(key);
          if (byDay != null) {
            byDay.put(rs.getString("day"), rs.getLong("request_count"));
          }
          return null;
        });
    return topModels.stream()
        .map(
            row ->
                orderedMap(
                    "key", row.get("key"),
                    "label", row.get("label"),
                    "requestCount", row.get("requestCount"),
                    "points", buildTrendPoints(range, countsByModel.get(String.valueOf(row.get("key"))))))
        .toList();
  }

  private List<Map<String, Object>> buildTrendPoints(UsageRange range, Map<String, Long> byDay) {
    List<Map<String, Object>> points = new ArrayList<>();
    for (LocalDate day = range.fromDate(); !day.isAfter(range.toDate()); day = day.plusDays(1)) {
      String key = day.toString();
      points.add(orderedMap("date", key, "requestCount", byDay == null ? 0L : byDay.getOrDefault(key, 0L)));
    }
    return points;
  }

  private UsageRange parseUsageRange(String from, String to) {
    LocalDate resolvedTo =
        to == null || to.isBlank() ? LocalDate.now(ZoneOffset.UTC) : parseUsageDate(to, "to");
    LocalDate resolvedFrom =
        from == null || from.isBlank() ? resolvedTo.minusDays(13) : parseUsageDate(from, "from");
    if (resolvedFrom.isAfter(resolvedTo)) {
      throw new ApiException(400, "from must be earlier than or equal to to");
    }
    return new UsageRange(
        resolvedFrom,
        resolvedTo,
        ts(resolvedFrom.atStartOfDay().toInstant(ZoneOffset.UTC)),
        ts(resolvedTo.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC)));
  }

  private LocalDate parseUsageDate(String value, String field) {
    try {
      return LocalDate.parse(value);
    } catch (Exception exception) {
      throw new ApiException(400, field + " is invalid");
    }
  }

  private String normalizeUsageDimension(String dimension) {
    if (dimension == null || dimension.isBlank()) {
      return "tenant";
    }
    if (!List.of("tenant", "user").contains(dimension)) {
      throw new ApiException(400, "dimension is invalid");
    }
    return dimension;
  }

  private static MapSqlParameterSource usageRangeParams(UsageRange range) {
    return new MapSqlParameterSource()
        .addValue("fromTs", range.fromTs())
        .addValue("toTs", range.toExclusiveTs());
  }

  public Map<String, Object> opsOverview(JwtPrincipal principal) {
    requireRole(principal.role(), OPS_ROLES);
    Timestamp since = ts(Instant.now().minus(24, ChronoUnit.HOURS));
    Timestamp monthStart = ts(LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay().toInstant(ZoneOffset.UTC));
    Long requests =
        jdbcTemplate.queryForObject(
            "select count(*) from api_request_logs where tenant_id = :tenantId and created_at >= :since",
            Map.of("tenantId", principal.tenantId(), "since", since),
            Long.class);
    Long failed =
        jdbcTemplate.queryForObject(
            "select count(*) from api_request_logs where tenant_id = :tenantId and created_at >= :since and status_code >= 400",
            Map.of("tenantId", principal.tenantId(), "since", since),
            Long.class);
    BigDecimal spend =
        jdbcTemplate.queryForObject(
            "select coalesce(sum(amount_usd), 0) from billing_records where tenant_id = :tenantId and created_at >= :monthStart and type = 'usage'",
            Map.of("tenantId", principal.tenantId(), "monthStart", monthStart),
            BigDecimal.class);
    Long audits =
        jdbcTemplate.queryForObject(
            "select count(*) from audit_logs where tenant_id = :tenantId and created_at >= :since",
            Map.of("tenantId", principal.tenantId(), "since", since),
            Long.class);
    return Map.of(
        "requests24h", requests == null ? 0 : requests,
        "failed24h", failed == null ? 0 : failed,
        "customerSuccessRate", (requests == null || requests == 0) ? 100.0 : BigDecimal.valueOf(((requests - (failed == null ? 0 : failed)) * 1000.0) / requests).setScale(1, RoundingMode.HALF_UP).doubleValue(),
        "spendUsdMonth", MoneyUtils.money(spend),
        "auditEvents24h", audits == null ? 0 : audits,
        "providers",
            jdbcTemplate.query(
                """
                select slug, provider_type, enabled, health_status, priority, api_key_ciphertext is not null as configured
                from providers order by priority asc
                """,
                (rs, rowNum) ->
                    Map.of(
                        "slug", rs.getString("slug"),
                        "type", rs.getString("provider_type"),
                        "configured", rs.getBoolean("configured"),
                        "enabled", rs.getBoolean("enabled"),
                        "healthStatus", rs.getString("health_status"),
                        "priority", rs.getInt("priority"))));
  }

  public List<Map<String, Object>> auditLogs(JwtPrincipal principal) {
    requireRole(principal.role(), OPS_ROLES);
    return jdbcTemplate.query(
        """
        select id, tenant_id, user_id, actor_type, action, entity_type, entity_id, ip, metadata::text as metadata, created_at
        from audit_logs
        where tenant_id = :tenantId
        order by created_at desc
        limit 100
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) ->
            Map.of(
                "id", rs.getString("id"),
                "tenantId", rs.getString("tenant_id"),
                "userId", rs.getString("user_id"),
                "actorType", rs.getString("actor_type"),
                "action", rs.getString("action"),
                "entityType", rs.getString("entity_type"),
                "entityId", rs.getString("entity_id"),
                "ip", rs.getString("ip"),
                "metadata", jsons.readObject(rs.getString("metadata")),
                "createdAt", rs.getTimestamp("created_at").toInstant()));
  }

  public Map<String, Object> getRoutingConfig(String tenantId) {
    return jdbcTemplate.query(
            """
            select mode, primary_provider_type, fallback_provider_types::text as fallback_provider_types,
                   max_retries, timeout_ms
            from tenant_routing_strategies
            where tenant_id = :tenantId
            limit 1
            """,
            Map.of("tenantId", tenantId),
            (rs, rowNum) ->
                orderedMap(
                    "mode", rs.getString("mode"),
                    "primaryProviderType", rs.getString("primary_provider_type"),
                    "fallbackProviderTypes", jsons.readStringList(rs.getString("fallback_provider_types")),
                    "maxRetries", rs.getInt("max_retries"),
                    "timeoutMs", rs.getInt("timeout_ms")))
        .stream()
        .findFirst()
        .orElse(orderedMap("mode", "balance", "primaryProviderType", null, "fallbackProviderTypes", List.of(), "maxRetries", 1, "timeoutMs", 30000));
  }

  public void requireRole(String role, Set<String> allowed) {
    if (!allowed.contains(role)) {
      throw new ApiException(403, "Forbidden");
    }
  }

  public void requirePlatformAdmin(JwtPrincipal principal) {
    if (!"platform_admin".equals(principal.platformRole())) {
      throw new ApiException(403, "Forbidden");
    }
  }

  private String nextTenantSlug() {
    String slug = "t-" + Ids.shortHex(6);
    Integer exists =
        jdbcTemplate.queryForObject(
            "select count(*) from tenants where slug = :slug",
            Map.of("slug", slug),
            Integer.class);
    if (exists != null && exists > 0) {
      return nextTenantSlug();
    }
    return slug;
  }

  private void ensureTenantDefaults(String tenantId, Instant now) {
    jdbcTemplate.update(
        """
        insert into tenant_routing_strategies (
          id, tenant_id, mode, primary_provider_type, fallback_provider_types, max_retries, timeout_ms, created_at, updated_at
        ) values (
          :id, :tenantId, 'balance', null, '["anthropic","google"]'::jsonb, 1, 30000, :now, :now
        )
        on conflict (tenant_id) do nothing
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("route"))
            .addValue("tenantId", tenantId)
            .addValue("now", ts(now)));
    jdbcTemplate.update(
        """
        insert into tenant_cache_settings (
          id, tenant_id, enabled, mode, similarity_threshold, ttl_seconds, created_at, updated_at
        ) values (
          :id, :tenantId, true, 'semantic', 0.920, 86400, :now, :now
        )
        on conflict (tenant_id) do nothing
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("cache"))
            .addValue("tenantId", tenantId)
            .addValue("now", ts(now)));
  }

  private Map<String, Object> getAppKey(String tenantId, String appKeyId) {
    String tenantName = requireTenant(tenantId).name();
    return jdbcTemplate.query(
            """
            select
              id, name, description, token_preview, status, environment, scopes::text as scopes,
              qps_limit, daily_budget_usd, monthly_budget_usd, allowed_models::text as allowed_models,
              created_at, last_used_at, last_used_ip
            from app_keys
            where id = :id and tenant_id = :tenantId
            """,
            Map.of("id", appKeyId, "tenantId", tenantId),
            (rs, rowNum) -> mapAppKeyRow(rs, tenantName, false, null))
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(404, "Not found"));
  }

  private Map<String, Object> mapAppKeyRow(ResultSet rs, String tenantName, boolean includeToken, String token) throws SQLException {
    Map<String, Object> map = new LinkedHashMap<>();
    map.put("id", rs.getString("id"));
    map.put("name", rs.getString("name"));
    map.put("description", rs.getString("description"));
    map.put(includeToken ? "token" : "keyPrefix", includeToken ? token : rs.getString("token_preview"));
    map.put("tenantName", tenantName);
    map.put("status", rs.getString("status"));
    map.put("environment", rs.getString("environment"));
    map.put("scopes", jsons.readStringList(rs.getString("scopes")));
    map.put("qpsLimit", (Integer) rs.getObject("qps_limit"));
    map.put("dailyBudgetUsd", rs.getBigDecimal("daily_budget_usd") == null ? null : MoneyUtils.money(rs.getBigDecimal("daily_budget_usd")));
    map.put("monthlyBudgetUsd", rs.getBigDecimal("monthly_budget_usd") == null ? null : MoneyUtils.money(rs.getBigDecimal("monthly_budget_usd")));
    map.put("allowedModels", jsons.readStringList(rs.getString("allowed_models")));
    map.put("createdAt", rs.getTimestamp("created_at").toInstant());
    map.put("lastUsedAt", rs.getTimestamp("last_used_at") == null ? null : rs.getTimestamp("last_used_at").toInstant());
    map.put("lastUsedIp", rs.getString("last_used_ip"));
    return map;
  }

  private List<Map<String, Object>> buildChartSeries(String tenantId, Timestamp since) {
    Map<String, Long> counts = new LinkedHashMap<>();
    for (int i = 6; i >= 0; i--) {
      String date = LocalDate.now(ZoneOffset.UTC).minusDays(i).toString();
      counts.put(date, 0L);
    }
    jdbcTemplate
        .queryForList(
            """
            select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, coalesce(sum(total_tokens), 0) as tokens
            from api_request_logs
            where tenant_id = :tenantId and created_at >= :since
            group by day
            """,
            Map.of("tenantId", tenantId, "since", since))
        .forEach(row -> counts.put(String.valueOf(row.get("day")), ((Number) row.get("tokens")).longValue()));
    List<Map<String, Object>> result = new ArrayList<>();
    counts.forEach((date, tokens) -> result.add(Map.of("date", date, "tokens", tokens)));
    return result;
  }

  private List<Map<String, Object>> buildModelMix(String tenantId, Timestamp since) {
    return jdbcTemplate.query(
        """
        select model, coalesce(sum(total_tokens), 0) as tokens
        from api_request_logs
        where tenant_id = :tenantId and created_at >= :since
        group by model
        order by tokens desc
        limit 8
        """,
        Map.of("tenantId", tenantId, "since", since),
        (rs, rowNum) -> Map.of("model", rs.getString("model"), "tokens", rs.getLong("tokens")));
  }

  private BigDecimal estimateCacheSavings(String tenantId, Timestamp since) {
    BigDecimal pricePerMillion =
        jdbcTemplate.queryForObject(
            """
            select coalesce(p.price_per_million_tokens, 1.2)
            from tenants t
            left join plans p on p.id = t.plan_id
            where t.id = :tenantId
            """,
            Map.of("tenantId", tenantId),
            BigDecimal.class);
    Long savedTokens =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(total_tokens), 0)
            from api_request_logs
            where tenant_id = :tenantId and created_at >= :since and cache_hit = true
            """,
            Map.of("tenantId", tenantId, "since", since),
            Long.class);
    return BigDecimal.valueOf(savedTokens == null ? 0 : savedTokens)
        .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
        .multiply(pricePerMillion == null ? new BigDecimal("1.2") : pricePerMillion);
  }

  private TenantRow requireTenant(String tenantId) {
    return jdbcTemplate.query(
            """
            select
              t.id, t.name, t.slug, t.status, t.balance_tokens, t.trial_ends_at, t.billing_email,
              t.contact_sales_email, t.monthly_budget_usd, t.contract_code, p.name as plan_name, p.code as plan_code,
              p.monthly_token_quota
            from tenants t
            left join plans p on p.id = t.plan_id
            where t.id = :tenantId
            """,
            Map.of("tenantId", tenantId),
            TENANT_ROW_MAPPER)
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(404, "Tenant not found"));
  }

  private static Map<String, Object> mapPlan(ResultSet rs) throws SQLException {
    return Map.of(
        "id", rs.getString("id"),
        "name", rs.getString("name"),
        "code", rs.getString("code"),
        "monthlyTokenQuota", rs.getInt("monthly_token_quota"),
        "pricePerMillionTokens", MoneyUtils.money(rs.getBigDecimal("price_per_million_tokens")),
        "description", rs.getString("description"));
  }

  private static String billingTypeLabel(String type) {
    return switch (type) {
      case "usage" -> "用量结算";
      case "cache_hit" -> "缓存减免";
      default -> type;
    };
  }

  private static String defaultModelForType(String providerType) {
    return switch (providerType) {
      case "anthropic" -> "claude-3-5-sonnet";
      case "google" -> "gemini-1.5-pro";
      default -> "gpt-4o-mini";
    };
  }

  private static int costScore(String model) {
    if (model == null) {
      return 76;
    }
    return switch (model) {
      case "gpt-4o" -> 72;
      case "gpt-4o-mini" -> 90;
      case "gpt-4" -> 74;
      case "gpt-3.5-turbo" -> 93;
      case "gemini-1.5-pro" -> 84;
      case "gemini-1.5-flash" -> 94;
      case "claude-3-5-sonnet", "claude-3-5-sonnet-latest" -> 80;
      case "claude-3-haiku" -> 91;
      default -> 76;
    };
  }

  private static String displayProviderName(String slug, String fallback) {
    return switch (slug) {
      case "openai" -> "OpenAI";
      case "gemini" -> "Google Gemini";
      case "claude" -> "Anthropic Claude";
      default -> fallback;
    };
  }

  private static void patchSet(List<String> sets, MapSqlParameterSource params, String column, Object value) {
    if (value != null) {
      sets.add(column + " = :" + column.replace('.', '_'));
      params.addValue(column.replace('.', '_'), value);
    }
  }

  private static String stringValue(Object value) {
    return value == null ? "" : String.valueOf(value).trim();
  }

  private static String nullableTrim(Object value) {
    String text = stringValue(value);
    return text.isBlank() ? null : text;
  }

  private static String blankDefault(Object value, String fallback) {
    String text = stringValue(value);
    return text.isBlank() ? fallback : text;
  }

  private static BigDecimal decimalOrNull(Object value) {
    if (value == null || String.valueOf(value).isBlank()) {
      return null;
    }
    return new BigDecimal(String.valueOf(value));
  }

  private static BigDecimal decimalOrDefault(Object value, BigDecimal fallback) {
    BigDecimal decimal = decimalOrNull(value);
    return decimal == null ? fallback : decimal;
  }

  private static boolean booleanValue(Object value, boolean fallback) {
    return value == null ? fallback : Boolean.parseBoolean(String.valueOf(value));
  }

  private static int intValue(Object value, int fallback) {
    return value == null ? fallback : Integer.parseInt(String.valueOf(value));
  }

  private static List<String> defaultStringList(Object value, List<String> fallback) {
    if (value instanceof List<?> list) {
      return list.stream().map(String::valueOf).filter(item -> !item.isBlank()).toList();
    }
    return fallback;
  }

  private static String billingRuleSummary(ProviderCatalog.Entry pricing) {
    if (pricing == null) {
      return "按输入 Token 与输出 Token 分开计费；当前模型未命中公开目录价表，请以实际账单为准。";
    }
    return "按输入 Token 与输出 Token 分开计费；当前目录价为输入 $"
        + MoneyUtils.money(pricing.inputUsdPerMillion())
        + " / 百万 tokens，输出 $"
        + MoneyUtils.money(pricing.outputUsdPerMillion())
        + " / 百万 tokens。";
  }

  private static String protocolFamily(String providerType) {
    return switch (providerType) {
      case "anthropic" -> "anthropic_messages";
      case "google" -> "google_generate_content";
      default -> "openai_compatible";
    };
  }

  private static String protocolLabel(String providerType) {
    return switch (providerType) {
      case "anthropic" -> "Anthropic Messages";
      case "google" -> "Google GenerateContent";
      default -> "OpenAI-compatible Chat Completions";
    };
  }

  private static String gatewayEndpoint(String providerType) {
    return switch (providerType) {
      case "anthropic" -> "/v1/messages";
      default -> "/v1/chat/completions";
    };
  }

  private static String upstreamEndpointPath(String providerType, String modelId) {
    return switch (providerType) {
      case "anthropic" -> "/messages";
      case "google" -> "/models/" + modelId + ":generateContent";
      default -> "/chat/completions";
    };
  }

  private static String integrationFormatNote(String providerType) {
    return switch (providerType) {
      case "anthropic" ->
          "Claude / Anthropic 模型建议直接使用 `/v1/messages`，请求体保持 Messages 形态（system 与 messages 分离），无需再套 OpenAI 的 chat completions 格式。";
      case "google" ->
          "原生上游通常使用 GenerateContent 风格请求体（contents / parts）；通过 TaaS 调用时仍统一走 OpenAI-compatible chat completions 网关。";
      default ->
          "OpenAI 系模型继续使用标准 Chat Completions 形态，通过 TaaS 调用时推荐 `/v1/chat/completions`。";
    };
  }

  private static List<String> capabilityTags(boolean supportsStreaming) {
    ArrayList<String> tags = new ArrayList<>();
    tags.add("chat");
    if (supportsStreaming) {
      tags.add("streaming");
    }
    return tags;
  }

  private List<String> memberAllowedModels(String tenantId, String userId) {
    return jdbcTemplate.query(
            """
            select allowed_models::text
            from tenant_members
            where tenant_id = :tenantId and user_id = :userId
            limit 1
            """,
            Map.of("tenantId", tenantId, "userId", userId),
            (rs, rowNum) -> jsons.readStringList(rs.getString(1)))
        .stream()
        .findFirst()
        .orElse(List.of());
  }

  private Set<String> availableGatewayModelIds() {
    return availableGatewayModels().stream()
        .map(row -> String.valueOf(row.get("model")))
        .collect(java.util.stream.Collectors.toSet());
  }

  private void validateAllowedModelsWithinAvailable(
      List<String> allowedModels, Set<String> availableModelIds) {
    for (String model : allowedModels) {
      if (!availableModelIds.contains(model)) {
        throw new ApiException(400, "allowedModels contains unavailable model: " + model);
      }
    }
  }

  private void validateAllowedModelsConfigured(JwtPrincipal principal, Map<String, Object> body) {
    if (!body.containsKey("allowedModels")) {
      return;
    }
    List<String> requested = defaultStringList(body.get("allowedModels"), List.of());
    if (requested.isEmpty()) {
      return;
    }
    validateAllowedModelsWithinAvailable(
        requested,
        availableAppKeyModels(principal).stream()
            .map(row -> String.valueOf(row.get("model")))
            .collect(java.util.stream.Collectors.toSet()));
  }

  private void validateAppKeyBody(Map<String, Object> body, boolean partial) {
    String name = nullableTrim(body.get("name"));
    if (!partial && (name == null || name.isBlank())) {
      throw new ApiException(400, "name is required");
    }
    if (body.containsKey("status")
        && !List.of("active", "disabled").contains(String.valueOf(body.get("status")))) {
      throw new ApiException(400, "status is invalid");
    }
    if (body.containsKey("environment")
        && !List.of("production", "staging", "development", "sandbox")
            .contains(String.valueOf(body.get("environment")))) {
      throw new ApiException(400, "environment is invalid");
    }
    if (body.containsKey("qpsLimit") && body.get("qpsLimit") != null) {
      int qps = intValue(body.get("qpsLimit"), -1);
      if (qps <= 0) {
        throw new ApiException(400, "qpsLimit is invalid");
      }
    }
    if (body.containsKey("scopes")) {
      for (String scope : defaultStringList(body.get("scopes"), List.of())) {
        if (!List.of("chat:complete", "usage:read", "billing:read", "admin:ops")
            .contains(scope)) {
          throw new ApiException(400, "scopes is invalid");
        }
      }
    }
    if (body.containsKey("allowedModels")) {
      for (String model : defaultStringList(body.get("allowedModels"), List.of())) {
        if (model.isBlank()) {
          throw new ApiException(400, "allowedModels is invalid");
        }
      }
    }
    validateBudgetField(body.get("dailyBudgetUsd"), "dailyBudgetUsd");
    validateBudgetField(body.get("monthlyBudgetUsd"), "monthlyBudgetUsd");
  }

  private static void validateBudgetField(Object value, String field) {
    BigDecimal decimal = decimalOrNull(value);
    if (decimal != null && decimal.compareTo(BigDecimal.ZERO) < 0) {
      throw new ApiException(400, field + " is invalid");
    }
  }

  private void validateCacheSettingsBody(Map<String, Object> body) {
    if (body.get("enabled") == null) {
      throw new ApiException(400, "enabled is required");
    }
    String mode = String.valueOf(body.get("mode"));
    if (!List.of("exact", "semantic", "hybrid").contains(mode)) {
      throw new ApiException(400, "mode is invalid");
    }
    BigDecimal threshold = decimalOrDefault(body.get("similarityThreshold"), BigDecimal.valueOf(-1));
    if (threshold.compareTo(BigDecimal.ZERO) < 0 || threshold.compareTo(BigDecimal.ONE) > 0) {
      throw new ApiException(400, "similarityThreshold is invalid");
    }
    int ttl = intValue(body.get("ttlSeconds"), -1);
    if (ttl < 60 || ttl > 604800) {
      throw new ApiException(400, "ttlSeconds is invalid");
    }
  }

  private void validateProviderBody(Map<String, Object> body) {
    if (body.containsKey("priority")) {
      int priority = intValue(body.get("priority"), -1);
      if (priority < 1 || priority > 999) {
        throw new ApiException(400, "priority is invalid");
      }
    }
    if (body.containsKey("timeoutMs")) {
      int timeoutMs = intValue(body.get("timeoutMs"), -1);
      if (timeoutMs < 1000 || timeoutMs > 120000) {
        throw new ApiException(400, "timeoutMs is invalid");
      }
    }
    if (body.containsKey("healthStatus")
        && !List.of("healthy", "degraded", "unknown")
            .contains(String.valueOf(body.get("healthStatus")))) {
      throw new ApiException(400, "healthStatus is invalid");
    }
    if (body.containsKey("apiKey") && String.valueOf(body.get("apiKey")).trim().length() < 10) {
      throw new ApiException(400, "apiKey is invalid");
    }
    if (body.containsKey("baseUrl")) {
      String baseUrl = String.valueOf(body.get("baseUrl"));
      if (!(baseUrl.startsWith("http://") || baseUrl.startsWith("https://"))) {
        throw new ApiException(400, "baseUrl is invalid");
      }
    }
    if (body.containsKey("modelCatalog")) {
      for (Map<String, Object> item : jsons.readObjectList(jsons.stringify(body.get("modelCatalog")))) {
        if (nullableTrim(item.get("model")) == null) {
          throw new ApiException(400, "modelCatalog is invalid");
        }
        if (!List.of("openai", "anthropic", "google")
            .contains(String.valueOf(item.get("providerType")))) {
          throw new ApiException(400, "modelCatalog is invalid");
        }
      }
    }
  }

  private List<Map<String, Object>> sortProviderPriority(
      List<Map<String, Object>> providers, String strategyMode) {
    List<Map<String, Object>> sorted = new ArrayList<>(providers);
    sorted.sort(
        (left, right) -> {
          if ("cost".equals(strategyMode)) {
            return Integer.compare(
                intValue(right.get("costScore"), 0), intValue(left.get("costScore"), 0));
          }
          if ("quality".equals(strategyMode)) {
            int bySuccess =
                Double.compare(
                    numericValue(right.get("successRate")),
                    numericValue(left.get("successRate")));
            if (bySuccess != 0) {
              return bySuccess;
            }
            return Integer.compare(
                intValue(left.get("latencyMs"), 0), intValue(right.get("latencyMs"), 0));
          }
          return Double.compare(balanceScore(right), balanceScore(left));
        });
    List<Map<String, Object>> withPriority = new ArrayList<>();
    for (int i = 0; i < sorted.size(); i++) {
      Map<String, Object> row = new LinkedHashMap<>(sorted.get(i));
      row.put("priority", i + 1);
      withPriority.add(row);
    }
    return withPriority;
  }

  private static double balanceScore(Map<String, Object> row) {
    return 0.45 * numericValue(row.get("successRate"))
        + 0.35 * intValue(row.get("costScore"), 0)
        + 0.2 * Math.max(0, 100 - Math.min(intValue(row.get("latencyMs"), 0) / 12.0, 100));
  }

  private static double numericValue(Object value) {
    return value instanceof Number number
        ? number.doubleValue()
        : Double.parseDouble(String.valueOf(value));
  }

  private static long longValue(Object value) {
    return value instanceof Number number ? number.longValue() : Long.parseLong(String.valueOf(value));
  }

  private static Map<String, Object> orderedMap(Object... items) {
    LinkedHashMap<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < items.length; i += 2) {
      map.put(String.valueOf(items[i]), items[i + 1]);
    }
    return map;
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }

  private record UsageRange(
      LocalDate fromDate, LocalDate toDate, Timestamp fromTs, Timestamp toExclusiveTs) {
  }

  private record SummaryAgg(
      long requests24h,
      long tokens24h,
      long failed24h,
      BigDecimal averageLatencyMs,
      BigDecimal providerSuccessRate) {
  }

  private record TenantRow(
      String id,
      String name,
      String slug,
      String status,
      BigDecimal balanceTokens,
      Instant trialEndsAt,
      String billingEmail,
      String contactSalesEmail,
      BigDecimal monthlyBudgetUsd,
      String contractCode,
      String planName,
      String planCode,
      Long monthlyTokenQuota) {
    Long trialDaysRemaining() {
      if (trialEndsAt == null) {
        return null;
      }
      long millis = trialEndsAt.toEpochMilli() - Instant.now().toEpochMilli();
      if (millis <= 0) {
        return 0L;
      }
      return Math.max(1L, (long) Math.ceil(millis / 86_400_000d));
    }
  }

  private static final RowMapper<TenantRow> TENANT_ROW_MAPPER =
      new RowMapper<>() {
        @Override
        public TenantRow mapRow(ResultSet rs, int rowNum) throws SQLException {
          return new TenantRow(
              rs.getString("id"),
              rs.getString("name"),
              rs.getString("slug"),
              rs.getString("status"),
              rs.getBigDecimal("balance_tokens"),
              rs.getTimestamp("trial_ends_at") == null ? null : rs.getTimestamp("trial_ends_at").toInstant(),
              rs.getString("billing_email"),
              rs.getString("contact_sales_email"),
              rs.getBigDecimal("monthly_budget_usd"),
              rs.getString("contract_code"),
              rs.getString("plan_name"),
              rs.getString("plan_code"),
              rs.getObject("monthly_token_quota") == null ? null : rs.getLong("monthly_token_quota"));
        }
      };
}
