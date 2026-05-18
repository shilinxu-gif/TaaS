package com.taas.tools;

import com.taas.boot.TaasApplication;
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
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

public class DemoBillingSeedCommand {
  public static void main(String[] args) {
    System.setProperty("spring.flyway.enabled", "false");
    ConfigurableApplicationContext context =
        new SpringApplicationBuilder(TaasApplication.class)
            .web(WebApplicationType.NONE)
            .profiles("demo-billing-seed")
            .run(args);
    int exitCode = SpringApplication.exit(context);
    System.exit(exitCode);
  }
}

@Component
@Profile("demo-billing-seed")
@Order(Ordered.LOWEST_PRECEDENCE)
class DemoBillingSeedRunner implements CommandLineRunner {
  private static final String CONFIRM_VALUE = "YES";
  private static final String DEMO_CONTRACT_CODE = "DEMO-BILLING-SEED";
  private static final String DEFAULT_BATCH_ID = "default";
  private static final String DEFAULT_TENANT_SLUG = "aiot";
  private static final String DEFAULT_TENANT_NAME = "AIoT";
  private static final String DEFAULT_USER_EMAIL = "aiot@redtea.com";
  private static final String DEFAULT_USER_NAME = "AIoT 管理员";
  private static final String DEFAULT_USER_PASSWORD = "admin123";
  private static final int DEFAULT_DAYS = 30;
  private static final int DEFAULT_REQUESTS_PER_DAY = 8;
  private static final int MAX_DEMO_TOTAL_TOKENS = 999_983;
  private static final int MIN_DEMO_TOKEN_PART = 1_003;
  private static final BigDecimal DEFAULT_INITIAL_TOKENS = new BigDecimal("1587342917");
  private static final BigDecimal DEFAULT_RECHARGE_TOKENS = new BigDecimal("523418769");
  private static final BigDecimal MIN_DISPLAY_BALANCE_TOKENS = new BigDecimal("836482917");
  private static final BigDecimal DEFAULT_RECHARGE_CNY = new BigDecimal("6837.42");
  private static final BigDecimal TODAY_TARGET_SPEND_USD = new BigDecimal("486.37");
  private static final List<String> DEFAULT_APP_KEY_SCOPES =
      List.of("chat:complete", "usage:read", "billing:read", "admin:ops");
  private static final List<ModelProfile> MODEL_PROFILES =
      List.of(
          new ModelProfile("deepseekv4", new BigDecimal("0.28"), new BigDecimal("1.13")),
          new ModelProfile("gpt-5.4", new BigDecimal("3.24"), new BigDecimal("12.86")),
          new ModelProfile("claude-opus-4-7", new BigDecimal("15.37"), new BigDecimal("75.82")),
          new ModelProfile("GLM-5", new BigDecimal("0.93"), new BigDecimal("3.64")));

  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final PasswordEncoder passwordEncoder;
  private final CryptoUtils cryptoUtils;
  private final Jsons jsons;
  private final Environment environment;

  DemoBillingSeedRunner(
      NamedParameterJdbcTemplate jdbcTemplate,
      PasswordEncoder passwordEncoder,
      CryptoUtils cryptoUtils,
      Jsons jsons,
      Environment environment) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordEncoder = passwordEncoder;
    this.cryptoUtils = cryptoUtils;
    this.jsons = jsons;
    this.environment = environment;
  }

  @Override
  @Transactional
  public void run(String... args) {
    SeedOptions options = readOptions();
    boolean userExists = exists("select count(*) from users where email = :email", Map.of("email", options.userEmail()));
    if (!options.dryRun() && !userExists && !hasText(options.userPassword())) {
      throw new IllegalStateException("DEMO_USER_PASSWORD is required when creating a demo user");
    }

    Map<String, ProviderModel> providerCatalog = providerCatalog(options.dryRun());
    SeedSummary summary = buildSummary(options);
    printPlan(options, providerCatalog, summary, userExists);
    if (options.dryRun()) {
      System.out.println("Dry-run only. Set DEMO_BILLING_SEED_APPLY=YES to write demo data.");
      return;
    }

    String userId = ensureUser(options, userExists);
    TenantRow tenant = ensureTenant(options, userId);
    ensureTenantDefaults(tenant.id());
    String appKeyToken = ensureAppKey(options, tenant.id(), userId);
    if (!options.appendDailyRecords()) {
      cleanupPriorBatch(tenant.id(), options.batchKey());
    }
    insertUsageAndBilling(options, tenant.id(), userId, providerCatalog, summary);
    if (options.includeFinance()) {
      insertFinanceRows(options, tenant.id());
    }
    updateBalances(options, tenant.id(), summary);

    System.out.println("Demo billing seed completed.");
    System.out.println("Tenant slug: " + options.tenantSlug());
    System.out.println("User email: " + options.userEmail());
    if (appKeyToken != null) {
      System.out.println("New AppKey token: " + appKeyToken);
    } else {
      System.out.println("AppKey token: existing key reused; raw token is not recoverable.");
    }
    System.out.println("Requests inserted: " + summary.totalRequests());
    System.out.println("Usage tokens inserted: " + summary.usageTokens());
    System.out.println("Billing USD inserted: " + summary.amountUsd());
    System.out.println("Final balance tokens set to: " + summary.finalBalanceTokens());
  }

  private SeedOptions readOptions() {
    String confirm = required("DEMO_BILLING_SEED_CONFIRM");
    if (!CONFIRM_VALUE.equals(confirm)) {
      throw new IllegalStateException("DEMO_BILLING_SEED_CONFIRM must be YES");
    }
    String tenantSlug = normalizeSlug(optional("DEMO_TENANT_SLUG", DEFAULT_TENANT_SLUG));
    String tenantName = optional("DEMO_TENANT_NAME", DEFAULT_TENANT_NAME).trim();
    String userEmail = optional("DEMO_USER_EMAIL", DEFAULT_USER_EMAIL).trim().toLowerCase(Locale.ROOT);
    if (userEmail.endsWith("@demo.local")) {
      throw new IllegalStateException("DEMO_USER_EMAIL must not use @demo.local because startup cleanup removes it");
    }
    boolean apply = CONFIRM_VALUE.equals(optional("DEMO_BILLING_SEED_APPLY", "NO"));
    if (apply && !CONFIRM_VALUE.equals(optional("DEMO_ALLOW_PROD_LIKE", "NO"))) {
      throw new IllegalStateException("DEMO_ALLOW_PROD_LIKE=YES is required before writing demo data");
    }
    String batchId = normalizeBatchId(optional("DEMO_BATCH_ID", DEFAULT_BATCH_ID));
    boolean appendDailyRecords = !"NO".equalsIgnoreCase(optional("DEMO_APPEND_DAILY_RECORDS", "YES"));
    int days = appendDailyRecords ? 1 : intOption("DEMO_DAYS", DEFAULT_DAYS, 1, 90);
    int requestsPerDay = intOption("DEMO_REQUESTS_PER_DAY", DEFAULT_REQUESTS_PER_DAY, 1, 50);
    BigDecimal initialTokens = decimalOption("DEMO_INITIAL_TOKENS", DEFAULT_INITIAL_TOKENS);
    BigDecimal rechargeTokens = decimalOption("DEMO_RECHARGE_TOKENS", DEFAULT_RECHARGE_TOKENS);
    String baseBatchKey = "demo-billing-seed:" + batchId;
    String batchKey =
        appendDailyRecords
            ? baseBatchKey
                + ":"
                + LocalDate.now(ZoneOffset.UTC).format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
                + ":"
                + Ids.shortHex(3)
            : baseBatchKey;
    return new SeedOptions(
        tenantSlug,
        tenantName,
        userEmail,
        optional("DEMO_USER_NAME", DEFAULT_USER_NAME).trim(),
        optional("DEMO_USER_PASSWORD", DEFAULT_USER_PASSWORD).trim(),
        CONFIRM_VALUE.equals(optional("DEMO_RESET_USER_PASSWORD", "NO")),
        batchKey,
        days,
        requestsPerDay,
        initialTokens,
        rechargeTokens,
        !apply,
        !"NO".equalsIgnoreCase(optional("DEMO_INCLUDE_FINANCE", "YES")),
        appendDailyRecords);
  }

  private Map<String, ProviderModel> providerCatalog(boolean dryRun) {
    return Map.of(
        "deepseekv4",
        providerModel(
            dryRun,
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
        providerModel(
            dryRun,
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
        providerModel(
            dryRun,
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
        providerModel(
            dryRun,
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

  private ProviderModel providerModel(boolean dryRun, ProviderSpec spec) {
    if (dryRun) {
      return new ProviderModel(
          "dry-run-" + spec.slug(),
          spec.slug(),
          spec.providerType(),
          spec.model(),
          spec.inputUsdPerMillion(),
          spec.outputUsdPerMillion());
    }
    return ensureProvider(spec);
  }

  private ProviderModel ensureProvider(ProviderSpec spec) {
    Instant now = Instant.now();
    String providerId = Ids.cuidLike("prov");
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
            .addValue("id", providerId)
            .addValue("name", spec.name())
            .addValue("slug", spec.slug())
            .addValue("providerType", spec.providerType())
            .addValue("modelVendor", spec.modelVendor())
            .addValue("modelCatalog", catalog)
            .addValue("priority", spec.priority())
            .addValue("createdAt", ts(now)));
    String id =
        jdbcTemplate.queryForObject(
            "select id from providers where slug = :slug",
            Map.of("slug", spec.slug()),
            String.class);
    return new ProviderModel(
        id,
        spec.slug(),
        spec.providerType(),
        spec.model(),
        spec.inputUsdPerMillion(),
        spec.outputUsdPerMillion());
  }

  private SeedSummary buildSummary(SeedOptions options) {
    long usageTokens = 0;
    BigDecimal amountUsd = BigDecimal.ZERO;
    int cacheHits = 0;
    for (int day = 0; day < options.days(); day++) {
      for (int seq = 0; seq < options.requestsPerDay(); seq++) {
        DemoRequest request = demoRequest(options, day, seq);
        if (request.cacheHit()) {
          cacheHits++;
          continue;
        }
        usageTokens += request.totalTokens();
        amountUsd = amountUsd.add(request.amountUsd());
      }
    }
    BigDecimal finalBalance =
        options.initialTokens()
            .add(options.includeFinance() ? options.rechargeTokens() : BigDecimal.ZERO)
            .subtract(BigDecimal.valueOf(usageTokens));
    if (finalBalance.compareTo(MIN_DISPLAY_BALANCE_TOKENS) < 0) {
      finalBalance = MIN_DISPLAY_BALANCE_TOKENS;
    }
    return new SeedSummary(
        options.days() * options.requestsPerDay(),
        cacheHits,
        usageTokens,
        amountUsd.setScale(6, RoundingMode.HALF_UP),
        finalBalance);
  }

  private void printPlan(
      SeedOptions options, Map<String, ProviderModel> providerCatalog, SeedSummary summary, boolean userExists) {
    System.out.println("Demo billing seed plan");
    System.out.println("Mode: " + (options.dryRun() ? "dry-run" : "apply"));
    System.out.println("Tenant slug: " + options.tenantSlug());
    System.out.println("Tenant name: " + options.tenantName());
    System.out.println("User email: " + options.userEmail() + (userExists ? " (existing)" : " (will create)"));
    System.out.println("Batch key: " + options.batchKey());
    System.out.println("Append daily records: " + options.appendDailyRecords());
    System.out.println("Providers: " + providerCatalog.values().stream().map(ProviderModel::providerSlug).toList());
    System.out.println("Models: " + modelNames());
    System.out.println("Requests: " + summary.totalRequests() + " (" + summary.cacheHits() + " cache hits)");
    System.out.println("Usage tokens: " + summary.usageTokens());
    System.out.println("Billing USD: " + summary.amountUsd());
    System.out.println("Final balance tokens: " + summary.finalBalanceTokens());
  }

  private String ensureUser(SeedOptions options, boolean userExists) {
    List<String> existing =
        jdbcTemplate.query(
            "select id from users where email = :email limit 1",
            Map.of("email", options.userEmail()),
            (rs, rowNum) -> rs.getString("id"));
    if (!existing.isEmpty()) {
      if (options.resetUserPassword() && hasText(options.userPassword())) {
        jdbcTemplate.update(
            "update users set password_hash = :passwordHash, name = :name, updated_at = :now where id = :id",
            new MapSqlParameterSource()
                .addValue("id", existing.get(0))
                .addValue("passwordHash", passwordEncoder.encode(options.userPassword()))
                .addValue("name", options.userName())
                .addValue("now", ts(Instant.now())));
      }
      return existing.get(0);
    }
    if (userExists) {
      throw new IllegalStateException("User lookup changed during seed");
    }
    String userId = Ids.cuidLike("usr");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into users (id, email, password_hash, name, platform_role, email_verified_at, created_at, updated_at)
        values (:id, :email, :passwordHash, :name, 'user', :now, :now, :now)
        """,
        new MapSqlParameterSource()
            .addValue("id", userId)
            .addValue("email", options.userEmail())
            .addValue("passwordHash", passwordEncoder.encode(options.userPassword()))
            .addValue("name", options.userName())
            .addValue("now", ts(now)));
    return userId;
  }

  private TenantRow ensureTenant(SeedOptions options, String userId) {
    List<TenantRow> existing =
        jdbcTemplate.query(
            "select id, contract_code from tenants where slug = :slug limit 1",
            Map.of("slug", options.tenantSlug()),
            (rs, rowNum) -> new TenantRow(rs.getString("id"), rs.getString("contract_code")));
    if (!existing.isEmpty()) {
      TenantRow row = existing.get(0);
      if (!DEMO_CONTRACT_CODE.equals(row.contractCode())
          && !CONFIRM_VALUE.equals(optional("DEMO_ALLOW_EXISTING_TENANT", "NO"))) {
        throw new IllegalStateException(
            "Tenant slug already exists and is not marked as demo. Set DEMO_ALLOW_EXISTING_TENANT=YES only for a dedicated demo tenant.");
      }
      jdbcTemplate.update(
          "update tenants set name = :name, billing_email = :email, contract_code = :contractCode, updated_at = :now where id = :id",
          new MapSqlParameterSource()
              .addValue("id", row.id())
              .addValue("name", options.tenantName())
              .addValue("email", options.userEmail())
              .addValue("contractCode", DEMO_CONTRACT_CODE)
              .addValue("now", ts(Instant.now())));
      ensureTenantMember(userId, row.id());
      return row;
    }

    String planId =
        jdbcTemplate.query(
                "select id from plans where code = 'enterprise' limit 1",
                (rs, rowNum) -> rs.getString("id"))
            .stream()
            .findFirst()
            .orElse(null);
    String tenantId = Ids.cuidLike("tenant");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into tenants (
          id, name, slug, status, plan_id, balance_tokens, trial_ends_at, billing_email,
          contact_sales_email, monthly_budget_usd, spend_cap_enforced, contract_code, created_at, updated_at
        ) values (
          :id, :name, :slug, 'active', :planId, :balanceTokens, :trialEndsAt, :billingEmail,
          'sales@taas.example', 5286.7300, true, :contractCode, :now, :now
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", tenantId)
            .addValue("name", options.tenantName())
            .addValue("slug", options.tenantSlug())
            .addValue("planId", planId)
            .addValue("balanceTokens", options.initialTokens())
            .addValue("trialEndsAt", ts(now.plus(365, ChronoUnit.DAYS)))
            .addValue("billingEmail", options.userEmail())
            .addValue("contractCode", DEMO_CONTRACT_CODE)
            .addValue("now", ts(now)));
    ensureTenantMember(userId, tenantId);
    return new TenantRow(tenantId, DEMO_CONTRACT_CODE);
  }

  private void ensureTenantMember(String userId, String tenantId) {
    jdbcTemplate.update(
        """
        insert into tenant_members (id, user_id, tenant_id, role)
        values (:id, :userId, :tenantId, 'owner')
        on conflict (user_id, tenant_id) do update set role = 'owner'
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("tm"))
            .addValue("userId", userId)
            .addValue("tenantId", tenantId));
  }

  private void ensureTenantDefaults(String tenantId) {
    Instant now = Instant.now();
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

  private String ensureAppKey(SeedOptions options, String tenantId, String userId) {
    List<String> existing =
        jdbcTemplate.query(
            """
            select id
            from app_keys
            where tenant_id = :tenantId and name = 'AIoT 生产调用密钥'
            limit 1
            """,
            Map.of("tenantId", tenantId),
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
              .addValue("scopes", jsons.stringify(DEFAULT_APP_KEY_SCOPES))
              .addValue("allowedModels", jsons.stringify(modelNames()))
              .addValue("ownerUserId", userId));
      return null;
    }
    String token = cryptoUtils.generateAppKeyToken();
    jdbcTemplate.update(
        """
        insert into app_keys (
          id, tenant_id, name, description, token, token_hash, token_preview, status, environment,
          scopes, qps_limit, daily_budget_usd, monthly_budget_usd, allowed_models, owner_user_id, created_at
        ) values (
          :id, :tenantId, 'AIoT 生产调用密钥', :description, null, :tokenHash, :tokenPreview, 'active', 'production',
          cast(:scopes as jsonb), 23, 537.2800, 5286.7300, cast(:allowedModels as jsonb), :ownerUserId, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("ak"))
            .addValue("tenantId", tenantId)
            .addValue("description", "AIoT 商用系统生产调用")
            .addValue("tokenHash", cryptoUtils.hashAppKey(token))
            .addValue("tokenPreview", cryptoUtils.buildAppKeyPreview(token))
            .addValue("scopes", jsons.stringify(DEFAULT_APP_KEY_SCOPES))
            .addValue("allowedModels", jsons.stringify(modelNames()))
            .addValue("ownerUserId", userId)
            .addValue("createdAt", ts(Instant.now())));
    return token;
  }

  private void cleanupPriorBatch(String tenantId, String batchKey) {
    MapSqlParameterSource params =
        new MapSqlParameterSource().addValue("tenantId", tenantId).addValue("batchLike", batchKey + ":%");
    jdbcTemplate.update(
        """
        delete from billing_records
        where tenant_id = :tenantId
          and log_id in (
            select id from api_request_logs
            where tenant_id = :tenantId and idempotency_key like :batchLike
          )
        """,
        params);
    jdbcTemplate.update(
        """
        delete from usage_records
        where tenant_id = :tenantId
          and log_id in (
            select id from api_request_logs
            where tenant_id = :tenantId and idempotency_key like :batchLike
          )
        """,
        params);
    jdbcTemplate.update(
        "delete from api_request_logs where tenant_id = :tenantId and idempotency_key like :batchLike",
        params);
    jdbcTemplate.update(
        "delete from wallet_recharge_orders where tenant_id = :tenantId and order_no like 'RCH-AIOT-%'",
        Map.of("tenantId", tenantId));
    jdbcTemplate.update(
        "delete from invoice_requests where tenant_id = :tenantId and request_no like 'INV-AIOT-%'",
        Map.of("tenantId", tenantId));
  }

  private void insertUsageAndBilling(
      SeedOptions options,
      String tenantId,
      String userId,
      Map<String, ProviderModel> providerCatalog,
      SeedSummary summary) {
    String appKeyId =
        jdbcTemplate.queryForObject(
            """
            select id from app_keys
            where tenant_id = :tenantId and name = 'AIoT 生产调用密钥'
            limit 1
            """,
            Map.of("tenantId", tenantId),
            String.class);
    List<DemoRequest> requests = new ArrayList<>();
    for (int day = 0; day < options.days(); day++) {
      for (int seq = 0; seq < options.requestsPerDay(); seq++) {
        requests.add(demoRequest(options, day, seq));
      }
    }
    for (DemoRequest request : requests) {
      ProviderModel providerModel = providerCatalog.get(request.model());
      if (providerModel == null) {
        throw new IllegalStateException("No demo provider mapping for model " + request.model());
      }
      insertRequest(options, tenantId, userId, appKeyId, providerModel, request);
    }
    if (summary.totalRequests() > 0) {
      jdbcTemplate.update(
          "update app_keys set last_used_at = :now, last_used_ip = '203.0.113.24' where id = :id",
          Map.of("now", ts(Instant.now()), "id", appKeyId));
    }
  }

  private void insertRequest(
      SeedOptions options,
      String tenantId,
      String userId,
      String appKeyId,
      ProviderModel providerModel,
      DemoRequest request) {
    request = uniqueTokenConsumption(tenantId, request);
    String logId = Ids.cuidLike("log");
    MapSqlParameterSource logParams =
        new MapSqlParameterSource()
            .addValue("id", logId)
            .addValue("tenantId", tenantId)
            .addValue("userId", userId)
            .addValue("appKeyId", appKeyId)
            .addValue("providerId", providerModel.providerId())
            .addValue("requestId", "req_" + Ids.shortHex(8))
            .addValue("traceId", "trace_" + Ids.shortHex(8))
            .addValue("model", request.model())
            .addValue("promptTokens", request.promptTokens())
            .addValue("completionTokens", request.completionTokens())
            .addValue("totalTokens", request.totalTokens())
            .addValue("latencyMs", request.latencyMs())
            .addValue("cacheHit", request.cacheHit())
            .addValue("routingPrimary", providerModel.providerType())
            .addValue("routingActual", providerModel.providerSlug())
            .addValue("routingReason", request.cacheHit() ? "semantic_cache_hit" : null)
            .addValue("retryCount", request.retryCount())
            .addValue("ip", "203.0.113.24")
            .addValue("statusCode", 200)
            .addValue("idempotencyKey", request.idempotencyKey())
            .addValue("savedTokensEstimate", request.cacheHit() ? request.totalTokens() : null)
            .addValue("savedPromptTokens", request.cacheHit() ? request.promptTokens() : null)
            .addValue("savedCompletionTokens", request.cacheHit() ? request.completionTokens() : null)
            .addValue("createdAt", ts(request.createdAt()));
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
          :statusCode, :idempotencyKey, :savedTokensEstimate, :savedPromptTokens, :savedCompletionTokens, :createdAt
        )
        """,
        logParams);
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
          :promptTokens, :completionTokens, 0, 0, 'settled', :invoiceStatus, 'USD', :type,
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
            .addValue("invoiceStatus", request.createdAt().isBefore(Instant.now().minus(14, ChronoUnit.DAYS)) ? "issued" : "not_requested")
            .addValue("type", request.cacheHit() ? "cache_hit" : "usage")
            .addValue(
                "description",
                request.cacheHit()
                    ? "智能设备诊断问答缓存命中"
                    : "智能设备诊断问答 - " + request.model() + " via " + providerModel.providerSlug())
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
        .setScale(6, RoundingMode.HALF_UP);
  }

  private void insertFinanceRows(SeedOptions options, String tenantId) {
    Instant now = Instant.now();
    String rechargeOrderNo =
        "RCH-AIOT-" + LocalDate.now(ZoneOffset.UTC).format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE);
    String invoiceRequestNo =
        "INV-AIOT-" + LocalDate.now(ZoneOffset.UTC).format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE);
    boolean rechargeExists =
        exists(
        "select count(*) from wallet_recharge_orders where tenant_id = :tenantId and order_no = :orderNo",
        Map.of("tenantId", tenantId, "orderNo", rechargeOrderNo));
    boolean invoiceExists =
        exists(
            "select count(*) from invoice_requests where tenant_id = :tenantId and request_no = :requestNo",
            Map.of("tenantId", tenantId, "requestNo", invoiceRequestNo));
    if (!rechargeExists) {
      insertRechargeOrder(options, tenantId, now, rechargeOrderNo);
    }
    if (!invoiceExists) {
      insertInvoiceRequest(options, tenantId, now, invoiceRequestNo);
    }
  }

  private void insertRechargeOrder(
      SeedOptions options, String tenantId, Instant now, String rechargeOrderNo) {
    jdbcTemplate.update(
        """
        insert into wallet_recharge_orders (
          id, tenant_id, order_no, amount_cny, currency, pay_channel, status, credited_tokens,
          payer_name, need_invoice, remark, paid_at, created_at, updated_at
        ) values (
          :id, :tenantId, :orderNo, :amountCny, 'CNY', 'bank_transfer', 'success', :creditedTokens,
          :payerName, true, :remark, :paidAt, :createdAt, :updatedAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("rch"))
            .addValue("tenantId", tenantId)
            .addValue("orderNo", rechargeOrderNo)
            .addValue("amountCny", DEFAULT_RECHARGE_CNY)
            .addValue("creditedTokens", options.rechargeTokens())
            .addValue("payerName", options.userName())
            .addValue("remark", "AIoT 设备智能运维服务预充值")
            .addValue("paidAt", ts(now.minus(20, ChronoUnit.DAYS)))
            .addValue("createdAt", ts(now.minus(21, ChronoUnit.DAYS)))
            .addValue("updatedAt", ts(now.minus(20, ChronoUnit.DAYS))));
  }

  private void insertInvoiceRequest(
      SeedOptions options, String tenantId, Instant now, String invoiceRequestNo) {
    jdbcTemplate.update(
        """
        insert into invoice_requests (
          id, tenant_id, request_no, title_type, invoice_type, buyer_name, buyer_tax_no,
          buyer_address_phone, buyer_bank_account, amount_cny, email, status, invoice_no,
          invoice_code, pdf_url, issued_at, created_at, updated_at
        ) values (
          :id, :tenantId, :requestNo, 'enterprise', 'vat_electronic', :buyerName, '91110000AIOT202601',
          '北京市朝阳区望京东路 88 号 010-88888888', '招商银行北京分行 1100000000000000',
          :amountCny, :email, 'issued', :invoiceNo, :invoiceCode, null, :issuedAt, :createdAt, :updatedAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("inv"))
            .addValue("tenantId", tenantId)
            .addValue("requestNo", invoiceRequestNo)
            .addValue("buyerName", options.tenantName() + "有限公司")
            .addValue("amountCny", DEFAULT_RECHARGE_CNY)
            .addValue("email", options.userEmail())
            .addValue("invoiceNo", "AIOT" + Ids.shortHex(4).toUpperCase(Locale.ROOT))
            .addValue("invoiceCode", "04400" + Ids.shortHex(3).toUpperCase(Locale.ROOT))
            .addValue("issuedAt", ts(now.minus(18, ChronoUnit.DAYS)))
            .addValue("createdAt", ts(now.minus(19, ChronoUnit.DAYS)))
            .addValue("updatedAt", ts(now.minus(18, ChronoUnit.DAYS))));
  }

  private void updateBalances(SeedOptions options, String tenantId, SeedSummary summary) {
    if (options.appendDailyRecords()) {
      jdbcTemplate.update(
          """
          update tenants
          set balance_tokens = greatest(balance_tokens - :usageTokens, :minBalance),
              updated_at = :now
          where id = :tenantId
          """,
          new MapSqlParameterSource()
              .addValue("usageTokens", BigDecimal.valueOf(summary.usageTokens()))
              .addValue("minBalance", MIN_DISPLAY_BALANCE_TOKENS)
              .addValue("now", ts(Instant.now()))
              .addValue("tenantId", tenantId));
    } else {
      jdbcTemplate.update(
          "update tenants set balance_tokens = :balanceTokens, updated_at = :now where id = :tenantId",
          new MapSqlParameterSource()
              .addValue("balanceTokens", summary.finalBalanceTokens())
              .addValue("now", ts(Instant.now()))
              .addValue("tenantId", tenantId));
    }
  }

  private DemoRequest demoRequest(SeedOptions options, int day, int seq) {
    boolean today = day == options.days() - 1;
    ModelProfile modelProfile = modelProfile(options, day, seq);
    double dayFactor = dailyUsageFactor(options, day);
    boolean cacheHit =
        seq >= Math.max(1, options.requestsPerDay() - 2)
            && (today || day % 4 == 0 || dayFactor < 1.8);
    int promptTokens;
    int completionTokens;
    if (today && cacheHit) {
      int savedTotal = 55_482_913 + Math.max(0, seq - (options.requestsPerDay() - 2)) * 20_731_849;
      promptTokens = (int) Math.round(savedTotal * 0.62);
      completionTokens = savedTotal - promptTokens;
    } else if (today) {
      BigDecimal desiredUsd = TODAY_TARGET_SPEND_USD.multiply(todaySpendShare(options, seq));
      TokenSplit split = tokensForSpend(desiredUsd, modelProfile);
      promptTokens = split.promptTokens();
      completionTokens = split.completionTokens();
    } else {
      promptTokens =
          (int)
              Math.round(
                  (18000 + (day % 10) * 3200 + seq * 1800 + burstTokens(day, seq))
                      * dayFactor);
      completionTokens =
          (int)
              Math.round(
                  (9000 + (day % 7) * 2400 + seq * 1200 + burstTokens(day + 3, seq) / 2.0)
                      * dayFactor);
    }
    TokenSplit normalized = normalizeTokenSplit(promptTokens, completionTokens, day * 97 + seq * 13);
    promptTokens = normalized.promptTokens();
    completionTokens = normalized.completionTokens();
    int totalTokens = promptTokens + completionTokens;
    Instant createdAt =
        LocalDate.now(ZoneOffset.UTC)
            .minusDays(options.days() - 1L - day)
            .atTime(9 + (seq % 9), (seq * 7) % 60)
            .toInstant(ZoneOffset.UTC);
    BigDecimal amountUsd =
        BigDecimal.valueOf(promptTokens)
            .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
            .multiply(modelProfile.inputUsdPerMillion())
            .add(
                BigDecimal.valueOf(completionTokens)
                    .divide(BigDecimal.valueOf(1_000_000), 6, RoundingMode.HALF_UP)
                    .multiply(modelProfile.outputUsdPerMillion()))
            .setScale(6, RoundingMode.HALF_UP);
    return new DemoRequest(
        modelProfile.model(),
        modelProfile.inputUsdPerMillion(),
        modelProfile.outputUsdPerMillion(),
        promptTokens,
        completionTokens,
        totalTokens,
        280 + (seq * 37) + (day % 5) * 24,
        cacheHit,
        seq % 11 == 0 ? 1 : 0,
        amountUsd,
        createdAt,
        options.batchKey() + ":" + MoneyUtils.dayPeriod(createdAt) + ":" + seq);
  }

  private ModelProfile modelProfile(SeedOptions options, int day, int seq) {
    if (day == options.days() - 1) {
      int[] todayPattern = {1, 3, 2, 1, 0, 2, 3, 1, 2, 0, 3, 1};
      return MODEL_PROFILES.get(todayPattern[Math.floorMod(seq, todayPattern.length)]);
    }
    int[] pattern = {0, 2, 1, 3, 1, 0, 3, 2, 2, 1, 3, 0, 1, 3, 0, 2};
    int index = Math.floorMod(day * 7 + seq * 5 + (day % 3) * 2 + (seq % 2), pattern.length);
    return MODEL_PROFILES.get(pattern[index]);
  }

  private List<String> modelNames() {
    return MODEL_PROFILES.stream().map(ModelProfile::model).toList();
  }

  private double dailyUsageFactor(SeedOptions options, int day) {
    double[] factors = {
      1.2, 4.5, 11.0, 2.8, 16.0, 5.4, 1.7, 8.6, 21.0, 3.6,
      6.8, 14.0, 1.4, 10.5, 18.5
    };
    double factor = factors[day % factors.length];
    if (day == options.days() - 1) {
      return Math.max(factor * 4.8, 155.0);
    }
    if (day % 11 == 0) {
      return factor * 1.65;
    }
    if (day % 6 == 0) {
      return factor * 0.55;
    }
    return factor;
  }

  private BigDecimal todaySpendShare(SeedOptions options, int seq) {
    double[] weights = {0.16, 0.10, 0.31, 0.18, 0.03, 0.22, 0.12, 0.08, 0.20, 0.14};
    double current = weights[Math.floorMod(seq, weights.length)];
    double total = 0;
    for (int i = 0; i < options.requestsPerDay(); i++) {
      if (i >= Math.max(1, options.requestsPerDay() - 2)) {
        continue;
      }
      total += weights[Math.floorMod(i, weights.length)];
    }
    if (total <= 0) {
      return BigDecimal.ZERO;
    }
    return BigDecimal.valueOf(current / total).setScale(8, RoundingMode.HALF_UP);
  }

  private TokenSplit tokensForSpend(BigDecimal amountUsd, ModelProfile modelProfile) {
    BigDecimal promptRatio = new BigDecimal("0.58");
    BigDecimal completionRatio = BigDecimal.ONE.subtract(promptRatio);
    BigDecimal blendedPrice =
        modelProfile
            .inputUsdPerMillion()
            .multiply(promptRatio)
            .add(modelProfile.outputUsdPerMillion().multiply(completionRatio));
    if (blendedPrice.compareTo(BigDecimal.ZERO) <= 0) {
      return new TokenSplit(0, 0);
    }
    long totalTokens =
        amountUsd
            .multiply(BigDecimal.valueOf(1_000_000))
            .divide(blendedPrice, 0, RoundingMode.HALF_UP)
            .longValue();
    int promptTokens = Math.toIntExact(Math.round(totalTokens * promptRatio.doubleValue()));
    int completionTokens = Math.toIntExact(totalTokens - promptTokens);
    return normalizeTokenSplit(promptTokens, completionTokens, modelProfile.model().hashCode());
  }

  private TokenSplit normalizeTokenSplit(int promptTokens, int completionTokens, int salt) {
    long prompt = Math.max(MIN_DEMO_TOKEN_PART, promptTokens);
    long completion = Math.max(MIN_DEMO_TOKEN_PART, completionTokens);
    long total = prompt + completion;
    if (total > MAX_DEMO_TOTAL_TOKENS) {
      double promptRatio = prompt / (double) total;
      prompt = Math.max(MIN_DEMO_TOKEN_PART, Math.round(MAX_DEMO_TOTAL_TOKENS * promptRatio));
      completion = MAX_DEMO_TOTAL_TOKENS - prompt;
      if (completion < MIN_DEMO_TOKEN_PART) {
        completion = MIN_DEMO_TOKEN_PART;
        prompt = MAX_DEMO_TOTAL_TOKENS - completion;
      }
    }
    prompt = avoidRoundEnding(prompt, salt + 17);
    completion = avoidRoundEnding(completion, salt + 31);
    while (prompt + completion > MAX_DEMO_TOTAL_TOKENS) {
      long overflow = prompt + completion - MAX_DEMO_TOTAL_TOKENS;
      if (completion >= prompt && completion - overflow - 37 >= MIN_DEMO_TOKEN_PART) {
        completion -= overflow + 37;
      } else {
        prompt -= overflow + 37;
      }
      prompt = Math.max(MIN_DEMO_TOKEN_PART, avoidRoundEnding(prompt, salt + 43));
      completion = Math.max(MIN_DEMO_TOKEN_PART, avoidRoundEnding(completion, salt + 59));
    }
    if ((prompt + completion) % 100 == 0) {
      if (prompt + completion + 17 <= MAX_DEMO_TOTAL_TOKENS) {
        completion += 17;
      } else {
        completion -= 17;
      }
    }
    prompt = avoidRoundEnding(prompt, salt + 71);
    completion = avoidRoundEnding(completion, salt + 83);
    while (prompt + completion > MAX_DEMO_TOTAL_TOKENS) {
      completion -= 29;
      completion = avoidRoundEnding(completion, salt + 97);
    }
    if ((prompt + completion) % 100 == 0) {
      completion += prompt + completion + 19 <= MAX_DEMO_TOTAL_TOKENS ? 19 : -19;
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
        prompt += prompt + completion + delta <= MAX_DEMO_TOTAL_TOKENS ? delta : -delta;
      } else {
        completion += prompt + completion + delta <= MAX_DEMO_TOTAL_TOKENS ? delta : -delta;
      }
    }
    if (prompt % 100 == 0 || completion % 100 == 0 || (prompt + completion) % 100 == 0) {
      throw new IllegalStateException("Unable to normalize demo token split");
    }
    return new TokenSplit(Math.toIntExact(prompt), Math.toIntExact(completion));
  }

  private long avoidRoundEnding(long value, int salt) {
    if (value % 100 != 0) {
      return value;
    }
    long delta = 11 + Math.floorMod(salt, 73);
    return value + delta;
  }

  private int burstTokens(int day, int seq) {
    if (day % 9 == 0 && seq >= 2 && seq <= 5) {
      return 180000 + seq * 45000;
    }
    if (day % 5 == 2 && seq == 1) {
      return 120000;
    }
    return 0;
  }

  private boolean exists(String sql, Map<String, ?> params) {
    Integer count = jdbcTemplate.queryForObject(sql, params, Integer.class);
    return count != null && count > 0;
  }

  private String required(String key) {
    String value = optional(key, "");
    if (!hasText(value)) {
      throw new IllegalStateException(key + " is required");
    }
    return value.trim();
  }

  private String optional(String key, String defaultValue) {
    String value = environment.getProperty(key);
    return hasText(value) ? value.trim() : defaultValue;
  }

  private int intOption(String key, int defaultValue, int min, int max) {
    int value = Integer.parseInt(optional(key, String.valueOf(defaultValue)));
    if (value < min || value > max) {
      throw new IllegalStateException(key + " must be between " + min + " and " + max);
    }
    return value;
  }

  private BigDecimal decimalOption(String key, BigDecimal defaultValue) {
    BigDecimal value = new BigDecimal(optional(key, defaultValue.toPlainString()));
    if (value.compareTo(BigDecimal.ZERO) < 0) {
      throw new IllegalStateException(key + " must be >= 0");
    }
    return value;
  }

  private static String normalizeSlug(String value) {
    String slug = value.trim().toLowerCase(Locale.ROOT);
    if (!slug.matches("[a-z0-9][a-z0-9-]{1,62}[a-z0-9]")) {
      throw new IllegalStateException("DEMO_TENANT_SLUG must be 3-64 chars of lowercase letters, digits, or hyphen");
    }
    return slug;
  }

  private static String normalizeBatchId(String value) {
    String batchId = value.trim().toLowerCase(Locale.ROOT);
    if (!batchId.matches("[a-z0-9][a-z0-9-]{0,40}")) {
      throw new IllegalStateException("DEMO_BATCH_ID must use lowercase letters, digits, or hyphen");
    }
    return batchId;
  }

  private static boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private static String stringValue(Object value) {
    return value == null ? "" : String.valueOf(value).trim();
  }

  private static BigDecimal decimalValue(Object value, BigDecimal fallback) {
    if (value == null || String.valueOf(value).isBlank()) {
      return fallback;
    }
    return new BigDecimal(String.valueOf(value));
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }

  private record SeedOptions(
      String tenantSlug,
      String tenantName,
      String userEmail,
      String userName,
      String userPassword,
      boolean resetUserPassword,
      String batchKey,
      int days,
      int requestsPerDay,
      BigDecimal initialTokens,
      BigDecimal rechargeTokens,
      boolean dryRun,
      boolean includeFinance,
      boolean appendDailyRecords) {}

  private record ProviderModel(
      String providerId,
      String providerSlug,
      String providerType,
      String model,
      BigDecimal inputUsdPerMillion,
      BigDecimal outputUsdPerMillion) {}

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

  private record SeedSummary(
      int totalRequests,
      int cacheHits,
      long usageTokens,
      BigDecimal amountUsd,
      BigDecimal finalBalanceTokens) {}

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

  private record TenantRow(String id, String contractCode) {}
}
