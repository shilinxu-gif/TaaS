package com.taas.demo;

import com.taas.infra.security.CryptoUtils;
import com.taas.infra.util.Ids;
import com.taas.infra.util.Jsons;
import com.taas.infra.util.MoneyUtils;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DemoDailyUsageService {
  private static final String DEMO_EMAIL = "aiot@redtea.com";
  private static final String DEMO_TENANT_SLUG = "aiot";
  private static final String APP_KEY_NAME = "AIoT 生产调用密钥";
  private static final int MAX_DEMO_TOTAL_TOKENS = 999_983;
  private static final int MIN_DEMO_TOKEN_PART = 1_003;
  private static final BigDecimal MIN_DISPLAY_BALANCE_TOKENS = new BigDecimal("836482917");
  private static final List<String> APP_KEY_SCOPES =
      List.of("chat:complete", "usage:read", "billing:read", "admin:ops");
  private static final List<ModelProfile> MODEL_PROFILES =
      List.of(
          new ModelProfile("deepseekv4", new BigDecimal("0.28"), new BigDecimal("1.13")),
          new ModelProfile("gpt-5.4", new BigDecimal("3.24"), new BigDecimal("12.86")),
          new ModelProfile("claude-opus-4-7", new BigDecimal("15.37"), new BigDecimal("75.82")),
          new ModelProfile("GLM-5", new BigDecimal("0.93"), new BigDecimal("3.64")));

  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final CryptoUtils cryptoUtils;
  private final Jsons jsons;

  public DemoDailyUsageService(
      NamedParameterJdbcTemplate jdbcTemplate, CryptoUtils cryptoUtils, Jsons jsons) {
    this.jdbcTemplate = jdbcTemplate;
    this.cryptoUtils = cryptoUtils;
    this.jsons = jsons;
  }

  @Transactional
  public void appendTodayIfNeeded(String email, String userId, String tenantId) {
    if (!DEMO_EMAIL.equalsIgnoreCase(email)) {
      return;
    }
    if (!isDemoTenant(tenantId)) {
      return;
    }
    ensureMinimumDisplayBalance(tenantId);
    String day = LocalDate.now(ZoneOffset.UTC).format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE);
    String batchPrefix = "demo-login-daily:" + day + ":%";
    jdbcTemplate.queryForObject(
        "select pg_advisory_xact_lock(hashtext(:lockKey))",
        Map.of("lockKey", "demo-login-daily:" + tenantId + ":" + day),
        Object.class);
    Integer existing =
        jdbcTemplate.queryForObject(
            """
            select count(*)
            from api_request_logs
            where tenant_id = :tenantId
              and idempotency_key like :batchPrefix
            """,
            Map.of("tenantId", tenantId, "batchPrefix", batchPrefix),
            Integer.class);
    if (existing != null && existing > 0) {
      return;
    }

    Map<String, ProviderRow> providerCatalog = ensureProviderCatalog();
    String appKeyId = ensureAppKey(tenantId, userId);
    String batchKey = "demo-login-daily:" + day + ":" + Ids.shortHex(3);
    UsageSummary summary = insertTodayUsage(tenantId, userId, appKeyId, providerCatalog, batchKey);
    jdbcTemplate.update(
        """
        update tenants
        set balance_tokens = greatest(balance_tokens - :tokens, :minBalance),
            updated_at = :now
        where id = :tenantId
        """,
        new MapSqlParameterSource()
            .addValue("tokens", BigDecimal.valueOf(summary.usageTokens()))
            .addValue("minBalance", MIN_DISPLAY_BALANCE_TOKENS)
            .addValue("tenantId", tenantId)
            .addValue("now", ts(Instant.now())));
    jdbcTemplate.update(
        "update app_keys set last_used_at = :now, last_used_ip = '203.0.113.24' where id = :id",
        Map.of("id", appKeyId, "now", ts(Instant.now())));
  }

  private boolean isDemoTenant(String tenantId) {
    Integer count =
        jdbcTemplate.queryForObject(
            "select count(*) from tenants where id = :tenantId and slug = :slug",
            Map.of("tenantId", tenantId, "slug", DEMO_TENANT_SLUG),
            Integer.class);
    return count != null && count > 0;
  }

  private void ensureMinimumDisplayBalance(String tenantId) {
    jdbcTemplate.update(
        """
        update tenants
        set balance_tokens = :minBalance,
            updated_at = :now
        where id = :tenantId
          and balance_tokens < :minBalance
        """,
        new MapSqlParameterSource()
            .addValue("tenantId", tenantId)
            .addValue("minBalance", MIN_DISPLAY_BALANCE_TOKENS)
            .addValue("now", ts(Instant.now())));
  }

  private Map<String, ProviderRow> ensureProviderCatalog() {
    return Map.of(
        "deepseekv4",
        ensureProvider(
            new ProviderSpec(
                "DeepSeek",
                "deepseek-commercial",
                "openai",
                "DeepSeek",
                "deepseekv4",
                new BigDecimal("0.28"),
                new BigDecimal("1.13"),
                14)),
        "gpt-5.4",
        ensureProvider(
            new ProviderSpec(
                "OpenAI",
                "openai-commercial",
                "openai",
                "OpenAI",
                "gpt-5.4",
                new BigDecimal("3.24"),
                new BigDecimal("12.86"),
                11)),
        "claude-opus-4-7",
        ensureProvider(
            new ProviderSpec(
                "Anthropic",
                "anthropic-commercial",
                "anthropic",
                "Anthropic",
                "claude-opus-4-7",
                new BigDecimal("15.37"),
                new BigDecimal("75.82"),
                12)),
        "GLM-5",
        ensureProvider(
            new ProviderSpec(
                "GLM",
                "glm-commercial",
                "openai",
                "GLM",
                "GLM-5",
                new BigDecimal("0.93"),
                new BigDecimal("3.64"),
                13)));
  }

  private ProviderRow ensureProvider(ProviderSpec spec) {
    String catalog =
        jsons.stringify(
            List.of(
                Map.of(
                    "model", spec.model(),
                    "providerType", spec.providerType(),
                    "inputUsdPerMillion", spec.inputUsdPerMillion().toPlainString(),
                    "outputUsdPerMillion", spec.outputUsdPerMillion().toPlainString(),
                    "supportsStreaming", true)));
    jdbcTemplate.update(
        """
        insert into providers (
          id, name, slug, provider_type, model_vendor, status, enabled, base_url, api_key_ciphertext,
          model_catalog, priority, timeout_ms, health_status, supports_streaming, created_at
        ) values (
          :id, :name, :slug, :providerType, :modelVendor, 'active', true, null, null,
          cast(:modelCatalog as jsonb), :priority, 30000, 'healthy', true, :createdAt
        )
        on conflict (slug) do update set
          name = excluded.name,
          provider_type = excluded.provider_type,
          model_vendor = excluded.model_vendor,
          status = 'active',
          enabled = true,
          model_catalog = excluded.model_catalog,
          priority = excluded.priority,
          health_status = 'healthy'
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("prov"))
            .addValue("name", spec.name())
            .addValue("slug", spec.slug())
            .addValue("providerType", spec.providerType())
            .addValue("modelVendor", spec.modelVendor())
            .addValue("modelCatalog", catalog)
            .addValue("priority", spec.priority())
            .addValue("createdAt", ts(Instant.now())));
    return jdbcTemplate.query(
            "select id, slug, provider_type from providers where slug = :slug",
            Map.of("slug", spec.slug()),
            (rs, rowNum) ->
                new ProviderRow(
                    rs.getString("id"), rs.getString("slug"), rs.getString("provider_type")))
        .stream()
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("No provider found for " + spec.slug()));
  }

  private String ensureAppKey(String tenantId, String userId) {
    List<String> existing =
        jdbcTemplate.query(
            """
            select id
            from app_keys
            where tenant_id = :tenantId and name = :name
            limit 1
            """,
            Map.of("tenantId", tenantId, "name", APP_KEY_NAME),
            (rs, rowNum) -> rs.getString("id"));
    if (!existing.isEmpty()) {
      jdbcTemplate.update(
          """
          update app_keys
          set status = 'active',
              environment = 'production',
              scopes = cast(:scopes as jsonb),
              allowed_models = cast(:allowedModels as jsonb),
              owner_user_id = :ownerUserId
          where id = :id
          """,
          new MapSqlParameterSource()
              .addValue("id", existing.get(0))
              .addValue("scopes", jsons.stringify(APP_KEY_SCOPES))
              .addValue("allowedModels", jsons.stringify(modelNames()))
              .addValue("ownerUserId", userId));
      return existing.get(0);
    }

    String token = cryptoUtils.generateAppKeyToken();
    String appKeyId = Ids.cuidLike("ak");
    jdbcTemplate.update(
        """
        insert into app_keys (
          id, tenant_id, name, description, token, token_hash, token_preview, status, environment,
          scopes, qps_limit, daily_budget_usd, monthly_budget_usd, allowed_models, owner_user_id, created_at
        ) values (
          :id, :tenantId, :name, :description, null, :tokenHash, :tokenPreview, 'active', 'production',
          cast(:scopes as jsonb), 23, 537.2800, 5286.7300, cast(:allowedModels as jsonb), :ownerUserId, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", appKeyId)
            .addValue("tenantId", tenantId)
            .addValue("name", APP_KEY_NAME)
            .addValue("description", "AIoT 商用系统生产调用")
            .addValue("tokenHash", cryptoUtils.hashAppKey(token))
            .addValue("tokenPreview", cryptoUtils.buildAppKeyPreview(token))
            .addValue("scopes", jsons.stringify(APP_KEY_SCOPES))
            .addValue("allowedModels", jsons.stringify(modelNames()))
            .addValue("ownerUserId", userId)
            .addValue("createdAt", ts(Instant.now())));
    return appKeyId;
  }

  private UsageSummary insertTodayUsage(
      String tenantId,
      String userId,
      String appKeyId,
      Map<String, ProviderRow> providerCatalog,
      String batchKey) {
    long usageTokens = 0;
    BigDecimal spendUsd = BigDecimal.ZERO;
    for (int seq = 0; seq < 8; seq++) {
      DemoRequest request = demoRequest(seq, batchKey);
      ProviderRow provider = providerCatalog.get(request.model());
      if (provider == null) {
        throw new IllegalStateException("No demo provider mapping for model " + request.model());
      }
      insertRequest(tenantId, userId, appKeyId, provider, request);
      if (!request.cacheHit()) {
        usageTokens += request.totalTokens();
        spendUsd = spendUsd.add(request.amountUsd());
      }
    }
    return new UsageSummary(usageTokens, spendUsd.setScale(2, RoundingMode.HALF_UP));
  }

  private DemoRequest demoRequest(int seq, String batchKey) {
    boolean cacheHit = seq >= 6;
    ModelProfile model = modelProfile(seq);
    int promptTokens;
    int completionTokens;
    if (cacheHit) {
      int savedTotal = 48_391_727 + (seq - 6) * 22_684_319;
      promptTokens = (int) Math.round(savedTotal * 0.62);
      completionTokens = savedTotal - promptTokens;
    } else {
      BigDecimal desiredUsd = dailyTargetSpendUsd().multiply(spendShare(seq));
      TokenSplit split = tokensForSpend(desiredUsd, model);
      promptTokens = split.promptTokens();
      completionTokens = split.completionTokens();
    }
    TokenSplit normalized =
        normalizeTokenSplit(
            promptTokens,
            completionTokens,
            seq * 41 + model.model().hashCode() + LocalDate.now(ZoneOffset.UTC).getDayOfYear());
    promptTokens = normalized.promptTokens();
    completionTokens = normalized.completionTokens();
    int totalTokens = promptTokens + completionTokens;
    Instant createdAt =
        LocalDate.now(ZoneOffset.UTC).atTime(9 + seq, (seq * 11) % 60).toInstant(ZoneOffset.UTC);
    BigDecimal amountUsd =
        BigDecimal.valueOf(promptTokens)
            .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
            .multiply(model.inputUsdPerMillion())
            .add(
                BigDecimal.valueOf(completionTokens)
                    .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
                    .multiply(model.outputUsdPerMillion()))
            .setScale(2, RoundingMode.HALF_UP);
    return new DemoRequest(
        model.model(),
        model.inputUsdPerMillion(),
        model.outputUsdPerMillion(),
        promptTokens,
        completionTokens,
        totalTokens,
        260 + seq * 41,
        cacheHit,
        seq == 0 ? 1 : 0,
        amountUsd,
        createdAt,
        batchKey + ":" + seq);
  }

  private void insertRequest(
      String tenantId, String userId, String appKeyId, ProviderRow provider, DemoRequest request) {
    request = uniqueTokenConsumption(tenantId, request);
    String logId = Ids.cuidLike("log");
    jdbcTemplate.update(
        """
        insert into api_request_logs (
          id, tenant_id, user_id, app_key_id, provider_id, request_id, trace_id, model,
          prompt_tokens, completion_tokens, total_tokens, latency_ms, cache_hit,
          routing_primary, routing_actual, routing_reason, retry_count, request_source_ip,
          status_code, idempotency_key, saved_tokens_estimate, saved_prompt_tokens, saved_completion_tokens, created_at
        ) values (
          :id, :tenantId, :userId, :appKeyId, :providerId, :requestId, :traceId, :model,
          :promptTokens, :completionTokens, :totalTokens, :latencyMs, :cacheHit,
          :routingPrimary, :routingActual, :routingReason, :retryCount, :ip,
          200, :idempotencyKey, :savedTokensEstimate, :savedPromptTokens, :savedCompletionTokens, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", logId)
            .addValue("tenantId", tenantId)
            .addValue("userId", userId)
            .addValue("appKeyId", appKeyId)
            .addValue("providerId", provider.id())
            .addValue("requestId", "req_" + Ids.shortHex(8))
            .addValue("traceId", "trace_" + Ids.shortHex(8))
            .addValue("model", request.model())
            .addValue("promptTokens", request.promptTokens())
            .addValue("completionTokens", request.completionTokens())
            .addValue("totalTokens", request.totalTokens())
            .addValue("latencyMs", request.latencyMs())
            .addValue("cacheHit", request.cacheHit())
            .addValue("routingPrimary", provider.providerType())
            .addValue("routingActual", provider.slug())
            .addValue("routingReason", request.cacheHit() ? "semantic_cache_hit" : null)
            .addValue("retryCount", request.retryCount())
            .addValue("ip", "203.0.113.24")
            .addValue("idempotencyKey", request.idempotencyKey())
            .addValue("savedTokensEstimate", request.cacheHit() ? request.totalTokens() : null)
            .addValue("savedPromptTokens", request.cacheHit() ? request.promptTokens() : null)
            .addValue("savedCompletionTokens", request.cacheHit() ? request.completionTokens() : null)
            .addValue("createdAt", ts(request.createdAt())));
    if (!request.cacheHit()) {
      jdbcTemplate.update(
          "insert into usage_records (id, log_id, tenant_id, period, total_tokens, created_at) values (:id, :logId, :tenantId, :period, :totalTokens, :createdAt)",
          new MapSqlParameterSource()
              .addValue("id", Ids.cuidLike("usage"))
              .addValue("logId", logId)
              .addValue("tenantId", tenantId)
              .addValue("period", MoneyUtils.dayPeriod(request.createdAt()))
              .addValue("totalTokens", request.totalTokens())
              .addValue("createdAt", ts(request.createdAt())));
    }
    jdbcTemplate.update(
        """
        insert into billing_records (
          id, log_id, tenant_id, amount_usd, subtotal_usd, input_unit_price_usd, output_unit_price_usd,
          quantity_prompt_tokens, quantity_completion_tokens, tax_rate_pct, tax_amount_usd,
          reconciliation_status, invoice_status, currency, type, description, created_at
        ) values (
          :id, :logId, :tenantId, :amountUsd, :subtotalUsd, :inputPrice, :outputPrice,
          :promptTokens, :completionTokens, 0, 0, 'settled', 'not_requested', 'USD', :type,
          :description, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("bill"))
            .addValue("logId", logId)
            .addValue("tenantId", tenantId)
            .addValue("amountUsd", request.cacheHit() ? BigDecimal.ZERO : request.amountUsd())
            .addValue("subtotalUsd", request.cacheHit() ? BigDecimal.ZERO : request.amountUsd())
            .addValue("inputPrice", request.inputUsdPerMillion())
            .addValue("outputPrice", request.outputUsdPerMillion())
            .addValue("promptTokens", request.cacheHit() ? 0 : request.promptTokens())
            .addValue("completionTokens", request.cacheHit() ? 0 : request.completionTokens())
            .addValue("type", request.cacheHit() ? "cache_hit" : "usage")
            .addValue(
                "description",
                request.cacheHit()
                    ? "智能设备诊断问答缓存命中"
                    : "智能设备诊断问答 - " + request.model() + " via " + provider.slug())
            .addValue("createdAt", ts(request.createdAt())));
  }

  private DemoRequest uniqueTokenConsumption(String tenantId, DemoRequest request) {
    DemoRequest candidate = request;
    for (int attempt = 0; attempt < 64; attempt++) {
      if (!hasSameDailyDemoUsage(tenantId, candidate)) {
        return candidate;
      }
      candidate = withTokenSplit(candidate, perturbTokenSplit(candidate, attempt));
    }
    throw new IllegalStateException("Unable to generate unique demo token consumption");
  }

  private boolean hasSameDailyDemoUsage(String tenantId, DemoRequest request) {
    Instant dayStart =
        LocalDate.ofInstant(request.createdAt(), ZoneOffset.UTC).atStartOfDay().toInstant(ZoneOffset.UTC);
    Integer count =
        jdbcTemplate.queryForObject(
            """
            select count(*)
            from api_request_logs l
            left join billing_records b on b.log_id = l.id
            where l.tenant_id = :tenantId
              and l.created_at >= :dayStart
              and l.created_at < :dayEnd
              and l.model = :model
              and l.prompt_tokens = :promptTokens
              and l.completion_tokens = :completionTokens
              and l.total_tokens = :totalTokens
              and coalesce(b.amount_usd, 0) = :amountUsd
            """,
            new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("dayStart", ts(dayStart))
                .addValue("dayEnd", ts(dayStart.plusSeconds(86_400)))
                .addValue("model", request.model())
                .addValue("promptTokens", request.promptTokens())
                .addValue("completionTokens", request.completionTokens())
                .addValue("totalTokens", request.totalTokens())
                .addValue("amountUsd", request.cacheHit() ? BigDecimal.ZERO : request.amountUsd()),
            Integer.class);
    return count != null && count > 0;
  }

  private DemoRequest withTokenSplit(DemoRequest request, TokenSplit split) {
    BigDecimal amountUsd =
        amountUsd(
            split.promptTokens(),
            split.completionTokens(),
            request.inputUsdPerMillion(),
            request.outputUsdPerMillion());
    return new DemoRequest(
        request.model(),
        request.inputUsdPerMillion(),
        request.outputUsdPerMillion(),
        split.promptTokens(),
        split.completionTokens(),
        split.promptTokens() + split.completionTokens(),
        request.latencyMs(),
        request.cacheHit(),
        request.retryCount(),
        amountUsd,
        request.createdAt(),
        request.idempotencyKey());
  }

  private TokenSplit perturbTokenSplit(DemoRequest request, int attempt) {
    int promptTokens = request.promptTokens() + 1_021 + attempt * 37;
    int completionTokens = request.completionTokens() + 1_409 + attempt * 53;
    return normalizeTokenSplit(promptTokens, completionTokens, request.retryCount() + attempt + 1);
  }

  private BigDecimal amountUsd(
      int promptTokens,
      int completionTokens,
      BigDecimal inputUsdPerMillion,
      BigDecimal outputUsdPerMillion) {
    return BigDecimal.valueOf(promptTokens)
        .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
        .multiply(inputUsdPerMillion)
        .add(
            BigDecimal.valueOf(completionTokens)
                .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
                .multiply(outputUsdPerMillion))
        .setScale(2, RoundingMode.HALF_UP);
  }

  private BigDecimal dailyTargetSpendUsd() {
    int dayOfYear = LocalDate.now(ZoneOffset.UTC).getDayOfYear();
    BigDecimal base = new BigDecimal("486.37");
    BigDecimal drift = BigDecimal.valueOf(((dayOfYear * 37L) % 53) - 26).divide(BigDecimal.TEN);
    return base.add(drift).setScale(2, RoundingMode.HALF_UP);
  }

  private BigDecimal spendShare(int seq) {
    double[] weights = {0.16, 0.10, 0.31, 0.18, 0.03, 0.22};
    double total = 0;
    for (double weight : weights) {
      total += weight;
    }
    return BigDecimal.valueOf(weights[Math.floorMod(seq, weights.length)] / total)
        .setScale(8, RoundingMode.HALF_UP);
  }

  private TokenSplit tokensForSpend(BigDecimal amountUsd, ModelProfile modelProfile) {
    BigDecimal promptRatio = new BigDecimal("0.58");
    BigDecimal completionRatio = BigDecimal.ONE.subtract(promptRatio);
    BigDecimal blendedPrice =
        modelProfile
            .inputUsdPerMillion()
            .multiply(promptRatio)
            .add(modelProfile.outputUsdPerMillion().multiply(completionRatio));
    long totalTokens =
        amountUsd
            .multiply(BigDecimal.valueOf(1_000_000))
            .divide(blendedPrice, 0, RoundingMode.HALF_UP)
            .longValue();
    int promptTokens = Math.toIntExact(Math.round(totalTokens * promptRatio.doubleValue()));
    int completionTokens = Math.toIntExact(totalTokens - promptTokens);
    return new TokenSplit(promptTokens, completionTokens);
  }

  private TokenSplit normalizeTokenSplit(int promptTokens, int completionTokens, int salt) {
    long prompt = Math.max(MIN_DEMO_TOKEN_PART, promptTokens);
    long completion = Math.max(MIN_DEMO_TOKEN_PART, completionTokens);
    long tokenLimit = demoTokenLimit(salt);
    long total = prompt + completion;
    if (total > tokenLimit) {
      double promptRatio = prompt / (double) total;
      prompt = Math.max(MIN_DEMO_TOKEN_PART, Math.round(tokenLimit * promptRatio));
      completion = tokenLimit - prompt;
      if (completion < MIN_DEMO_TOKEN_PART) {
        completion = MIN_DEMO_TOKEN_PART;
        prompt = tokenLimit - completion;
      }
    }
    prompt = avoidRoundEnding(prompt, salt + 17);
    completion = avoidRoundEnding(completion, salt + 31);
    while (prompt + completion > tokenLimit) {
      long overflow = prompt + completion - tokenLimit;
      if (completion >= prompt && completion - overflow - 37 >= MIN_DEMO_TOKEN_PART) {
        completion -= overflow + 37;
      } else {
        prompt -= overflow + 37;
      }
      prompt = Math.max(MIN_DEMO_TOKEN_PART, avoidRoundEnding(prompt, salt + 43));
      completion = Math.max(MIN_DEMO_TOKEN_PART, avoidRoundEnding(completion, salt + 59));
    }
    if ((prompt + completion) % 100 == 0) {
      if (prompt + completion + 17 <= tokenLimit) {
        completion += 17;
      } else {
        completion -= 17;
      }
    }
    prompt = avoidRoundEnding(prompt, salt + 71);
    completion = avoidRoundEnding(completion, salt + 83);
    while (prompt + completion > tokenLimit) {
      completion -= 29;
      completion = avoidRoundEnding(completion, salt + 97);
    }
    if ((prompt + completion) % 100 == 0) {
      completion += prompt + completion + 19 <= tokenLimit ? 19 : -19;
    }
    for (int attempt = 0; attempt < 8; attempt++) {
      boolean valid =
          prompt >= MIN_DEMO_TOKEN_PART
              && completion >= MIN_DEMO_TOKEN_PART
              && prompt + completion <= MAX_DEMO_TOTAL_TOKENS
              && prompt % 100 != 0
              && completion % 100 != 0
              && (prompt + completion) % 100 != 0;
      if (valid) {
        return new TokenSplit(Math.toIntExact(prompt), Math.toIntExact(completion));
      }
      long delta = 13 + Math.floorMod(salt + attempt * 11, 61);
      if (prompt % 100 == 0) {
        prompt += prompt + completion + delta <= tokenLimit ? delta : -delta;
      } else {
        completion += prompt + completion + delta <= tokenLimit ? delta : -delta;
      }
    }
    if (prompt % 100 == 0 || completion % 100 == 0 || (prompt + completion) % 100 == 0) {
      throw new IllegalStateException("Unable to normalize demo token split");
    }
    return new TokenSplit(Math.toIntExact(prompt), Math.toIntExact(completion));
  }

  private long demoTokenLimit(int salt) {
    long spread = Math.floorMod((long) salt * 7_919L + 104_729L, 260_000);
    long limit = MAX_DEMO_TOTAL_TOKENS - spread;
    return avoidRoundEnding(Math.max(720_013L, limit), salt + 109);
  }

  private long avoidRoundEnding(long value, int salt) {
    if (value % 100 != 0) {
      return value;
    }
    long delta = 11 + Math.floorMod(salt, 73);
    return value + delta;
  }

  private ModelProfile modelProfile(int seq) {
    int[] pattern = {1, 3, 2, 1, 0, 2, 3, 1};
    return MODEL_PROFILES.get(pattern[Math.floorMod(seq, pattern.length)]);
  }

  private List<String> modelNames() {
    return MODEL_PROFILES.stream().map(ModelProfile::model).toList();
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }

  private record ProviderRow(String id, String slug, String providerType) {}

  private record ProviderSpec(
      String name,
      String slug,
      String providerType,
      String modelVendor,
      String model,
      BigDecimal inputUsdPerMillion,
      BigDecimal outputUsdPerMillion,
      int priority) {}

  private record ModelProfile(
      String model, BigDecimal inputUsdPerMillion, BigDecimal outputUsdPerMillion) {}

  private record TokenSplit(int promptTokens, int completionTokens) {}

  private record DemoRequest(
      String model,
      BigDecimal inputUsdPerMillion,
      BigDecimal outputUsdPerMillion,
      int promptTokens,
      int completionTokens,
      int totalTokens,
      int latencyMs,
      boolean cacheHit,
      int retryCount,
      BigDecimal amountUsd,
      Instant createdAt,
      String idempotencyKey) {}

  private record UsageSummary(long usageTokens, BigDecimal spendUsd) {}
}
