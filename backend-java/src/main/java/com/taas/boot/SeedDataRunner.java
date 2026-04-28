package com.taas.boot;

import com.taas.infra.config.TaasProperties;
import com.taas.infra.util.Ids;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class SeedDataRunner implements CommandLineRunner {
  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final PasswordEncoder passwordEncoder;
  private final TaasProperties properties;

  public SeedDataRunner(
      NamedParameterJdbcTemplate jdbcTemplate,
      PasswordEncoder passwordEncoder,
      TaasProperties properties) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordEncoder = passwordEncoder;
    this.properties = properties;
  }

  @Override
  public void run(String... args) {
    cleanupLegacyDemoData();
    seedPlans();
    seedProviders();
    seedPlatformAdmin();
  }

  private void seedPlans() {
    Instant now = Instant.now();
    insertPlanIfMissing("starter", "Starter", 1_000_000, new BigDecimal("1.2000"), "入门套餐", now);
    insertPlanIfMissing("growth", "Growth", 10_000_000, new BigDecimal("1.0000"), "增长套餐", now);
    insertPlanIfMissing("enterprise", "Enterprise", 100_000_000, new BigDecimal("0.8000"), "企业套餐", now);
  }

  private void insertPlanIfMissing(String code, String name, int quota, BigDecimal price, String description, Instant now) {
    Integer count =
        jdbcTemplate.queryForObject(
            "select count(*) from plans where code = :code",
            Map.of("code", code),
            Integer.class);
    if (count != null && count > 0) {
      return;
    }
    jdbcTemplate.update(
        """
        insert into plans (id, name, code, monthly_token_quota, price_per_million_tokens, description, created_at)
        values (:id, :name, :code, :quota, :price, :description, :createdAt)
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("plan"))
            .addValue("name", name)
            .addValue("code", code)
            .addValue("quota", quota)
            .addValue("price", price)
            .addValue("description", description)
            .addValue("createdAt", ts(now)));
  }

  private void seedProviders() {
    seedProvider(
        "openai",
        "OpenAI",
        "openai",
        null,
        List.of(Map.of("model", "gpt-4o-mini", "providerType", "openai", "inputUsdPerMillion", "0.15", "outputUsdPerMillion", "0.60", "supportsStreaming", true)),
        10,
        30000);
    seedProvider(
        "claude",
        "Anthropic",
        "anthropic",
        null,
        List.of(Map.of("model", "claude-3-5-sonnet-latest", "providerType", "anthropic", "inputUsdPerMillion", "3.00", "outputUsdPerMillion", "15.00", "supportsStreaming", true)),
        20,
        30000);
    seedProvider(
        "gemini",
        "Google Gemini",
        "google",
        null,
        List.of(Map.of("model", "gemini-1.5-flash", "providerType", "google", "inputUsdPerMillion", "0.35", "outputUsdPerMillion", "0.70", "supportsStreaming", true)),
        30,
        30000);
    seedProvider(
        "deepseek-v3-1-terminus-single",
        "DeepSeek-V3.1-Terminus（单模型）",
        "openai",
        null,
        List.of(
            Map.of(
                "model", "deepseek-ai/DeepSeek-V3.1-Terminus",
                "providerType", "openai",
                "inputUsdPerMillion", "0",
                "outputUsdPerMillion", "0",
                "supportsStreaming", true)),
        5,
        120000);
    seedProvider(
        "qwen3-5-397b-a17b",
        "Qwen3.5-397B-A17B",
        "openai",
        null,
        List.of(
            Map.of(
                "model", "Qwen3.5-397B-A17B",
                "providerType", "openai",
                "inputUsdPerMillion", "0",
                "outputUsdPerMillion", "0",
                "supportsStreaming", true)),
        6,
        120000);
    seedProvider(
        "qwen-qwen3-32b",
        "Qwen/Qwen3-32B",
        "openai",
        null,
        List.of(
            Map.of(
                "model", "Qwen/Qwen3-32B",
                "providerType", "openai",
                "inputUsdPerMillion", "0",
                "outputUsdPerMillion", "0",
                "supportsStreaming", true)),
        7,
        120000);
  }

  private void seedProvider(
      String slug,
      String name,
      String providerType,
      String baseUrl,
      List<Map<String, Object>> catalog,
      int priority,
      int timeoutMs) {
    Integer count =
        jdbcTemplate.queryForObject(
            "select count(*) from providers where slug = :slug",
            Map.of("slug", slug),
            Integer.class);
    if (count != null && count > 0) {
      return;
    }
    jdbcTemplate.update(
        """
        insert into providers (
          id, name, slug, provider_type, status, enabled, base_url, api_key_ciphertext, model_catalog,
          priority, timeout_ms, health_status, supports_streaming, created_at
        ) values (
          :id, :name, :slug, :providerType, 'active', true, :baseUrl, null, cast(:modelCatalog as jsonb),
          :priority, :timeoutMs, 'healthy', true, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("prov"))
            .addValue("name", name)
            .addValue("slug", slug)
            .addValue("providerType", providerType)
            .addValue("baseUrl", baseUrl)
            .addValue("modelCatalog", new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(catalog).toString())
            .addValue("priority", priority)
            .addValue("timeoutMs", timeoutMs)
            .addValue("createdAt", ts(Instant.now())));
  }

  private void seedPlatformAdmin() {
    String login = properties.getBootstrap().getAdminLogin();
    String password = properties.getBootstrap().getAdminPassword();
    if (login == null || login.isBlank() || password == null || password.isBlank()) {
      return;
    }
    String email = login.contains("@") ? login.trim().toLowerCase() : login.trim().toLowerCase() + "@crm.local";
    Instant now = Instant.now();
    String userId =
        jdbcTemplate
            .query("select id from users where email = :email limit 1", Map.of("email", email), (rs, rowNum) -> rs.getString("id"))
            .stream()
            .findFirst()
            .orElse(null);
    if (userId == null) {
      userId = Ids.cuidLike("usr");
      jdbcTemplate.update(
          """
          insert into users (id, email, password_hash, name, platform_role, created_at, updated_at)
          values (:id, :email, :passwordHash, :name, 'platform_admin', :now, :now)
          """,
          new MapSqlParameterSource()
              .addValue("id", userId)
              .addValue("email", email)
              .addValue("passwordHash", passwordEncoder.encode(password))
              .addValue("name", "平台管理员")
              .addValue("now", ts(now)));
    } else {
      jdbcTemplate.update(
          """
          update users
          set password_hash = :passwordHash, name = :name, platform_role = 'platform_admin', updated_at = :now
          where id = :id
          """,
          new MapSqlParameterSource()
              .addValue("id", userId)
              .addValue("passwordHash", passwordEncoder.encode(password))
              .addValue("name", "平台管理员")
              .addValue("now", ts(now)));
    }

    String starterPlanId =
        jdbcTemplate.query(
                "select id from plans where code = 'starter' limit 1",
                (rs, rowNum) -> rs.getString("id"))
            .stream()
            .findFirst()
            .orElse(null);
    String tenantId =
        jdbcTemplate
            .query("select id from tenants where slug = :slug limit 1", Map.of("slug", "platform-admin"), (rs, rowNum) -> rs.getString("id"))
            .stream()
            .findFirst()
            .orElse(null);
    if (tenantId == null) {
      tenantId = Ids.cuidLike("tenant");
      jdbcTemplate.update(
          """
          insert into tenants (
            id, name, slug, status, plan_id, balance_tokens, trial_ends_at, billing_email,
            contact_sales_email, monthly_budget_usd, spend_cap_enforced, contract_code, created_at, updated_at
          ) values (
            :id, :name, :slug, 'active', :planId, 1000000, :trialEndsAt, :billingEmail,
            'sales@taas.example', 0, false, :contractCode, :now, :now
          )
          """,
          new MapSqlParameterSource()
              .addValue("id", tenantId)
              .addValue("name", "平台管理")
              .addValue("slug", "platform-admin")
              .addValue("planId", starterPlanId)
              .addValue("trialEndsAt", ts(now.plus(3650, ChronoUnit.DAYS)))
              .addValue("billingEmail", email)
              .addValue("contractCode", "CTR-PLATFORM")
              .addValue("now", ts(now)));
      jdbcTemplate.update(
          """
          insert into tenant_routing_strategies (
            id, tenant_id, mode, primary_provider_type, fallback_provider_types, max_retries, timeout_ms, created_at, updated_at
          ) values (
            :id, :tenantId, 'balance', 'openai', '["anthropic","google"]'::jsonb, 1, 30000, :now, :now
          )
          on conflict (tenant_id) do nothing
          """,
          Map.of("id", Ids.cuidLike("route"), "tenantId", tenantId, "now", ts(now)));
      jdbcTemplate.update(
          """
          insert into tenant_cache_settings (
            id, tenant_id, enabled, mode, similarity_threshold, ttl_seconds, created_at, updated_at
          ) values (
            :id, :tenantId, true, 'semantic', 0.920, 86400, :now, :now
          )
          on conflict (tenant_id) do nothing
          """,
          Map.of("id", Ids.cuidLike("cache"), "tenantId", tenantId, "now", ts(now)));
    }
    Integer memberCount =
        jdbcTemplate.queryForObject(
            "select count(*) from tenant_members where user_id = :userId and tenant_id = :tenantId",
            Map.of("userId", userId, "tenantId", tenantId),
            Integer.class);
    if (memberCount == null || memberCount == 0) {
      jdbcTemplate.update(
          "insert into tenant_members (id, user_id, tenant_id, role) values (:id, :userId, :tenantId, 'owner')",
          Map.of("id", Ids.cuidLike("tm"), "userId", userId, "tenantId", tenantId));
    }
  }

  private void cleanupLegacyDemoData() {
    List<String> demoUserIds =
        jdbcTemplate.query(
            "select id from users where email like '%@demo.local'",
            (rs, rowNum) -> rs.getString("id"));
    List<String> demoTenantIds =
        jdbcTemplate.query(
            """
            select distinct tm.tenant_id
            from tenant_members tm
            join users u on u.id = tm.user_id
            where u.email like '%@demo.local'
            """,
            (rs, rowNum) -> rs.getString("tenant_id"));
    if (!demoTenantIds.isEmpty()) {
      Map<String, Object> tenantParams = Map.of("tenantIds", demoTenantIds);
      jdbcTemplate.update("delete from billing_records where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from api_request_logs where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from wallet_recharge_orders where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from invoice_requests where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from audit_logs where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from app_keys where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from tenant_cache_settings where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from tenant_routing_strategies where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from tenant_members where tenant_id in (:tenantIds)", tenantParams);
      jdbcTemplate.update("delete from tenants where id in (:tenantIds)", tenantParams);
    }
    if (!demoUserIds.isEmpty()) {
      jdbcTemplate.update("delete from tenant_members where user_id in (:userIds)", Map.of("userIds", demoUserIds));
      jdbcTemplate.update("delete from users where id in (:userIds)", Map.of("userIds", demoUserIds));
    }
    jdbcTemplate.update("delete from prompt_templates where tenant_id is null", Map.of());
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }
}
