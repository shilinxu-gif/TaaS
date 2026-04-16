package com.taas.boot;

import com.taas.infra.security.CryptoUtils;
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
  private final CryptoUtils cryptoUtils;

  public SeedDataRunner(
      NamedParameterJdbcTemplate jdbcTemplate,
      PasswordEncoder passwordEncoder,
      CryptoUtils cryptoUtils) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordEncoder = passwordEncoder;
    this.cryptoUtils = cryptoUtils;
  }

  @Override
  public void run(String... args) {
    seedPlans();
    seedProviders();
    seedPlatformAdmin();
    seedDemoTenant("wangqiang", "王强", "owner");
    seedDemoTenant("liwei", "李伟", "admin");
    seedPromptTemplates();
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
    seedProvider("openai", "OpenAI", "openai", "https://api.openai.com/v1", List.of(Map.of("model", "gpt-4o-mini", "providerType", "openai", "inputUsdPerMillion", "0.15", "outputUsdPerMillion", "0.60", "supportsStreaming", true)));
    seedProvider("claude", "Anthropic", "anthropic", "https://api.anthropic.com/v1", List.of(Map.of("model", "claude-3-5-sonnet-latest", "providerType", "anthropic", "inputUsdPerMillion", "3.00", "outputUsdPerMillion", "15.00", "supportsStreaming", true)));
    seedProvider("gemini", "Google Gemini", "google", "https://generativelanguage.googleapis.com/v1beta", List.of(Map.of("model", "gemini-1.5-flash", "providerType", "google", "inputUsdPerMillion", "0.35", "outputUsdPerMillion", "0.70", "supportsStreaming", true)));
  }

  private void seedProvider(String slug, String name, String providerType, String baseUrl, List<Map<String, Object>> catalog) {
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
          :priority, 30000, 'healthy', true, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("prov"))
            .addValue("name", name)
            .addValue("slug", slug)
            .addValue("providerType", providerType)
            .addValue("baseUrl", baseUrl)
            .addValue("modelCatalog", new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(catalog).toString())
            .addValue("priority", "openai".equals(providerType) ? 10 : "anthropic".equals(providerType) ? 20 : 30)
            .addValue("createdAt", ts(Instant.now())));
  }

  private void seedPlatformAdmin() {
    String email = "admin@crm.local";
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
              .addValue("passwordHash", passwordEncoder.encode("admin123"))
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
              .addValue("passwordHash", passwordEncoder.encode("admin123"))
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

  private void seedDemoTenant(String login, String displayName, String role) {
    String email = login + "@demo.local";
    Integer count =
        jdbcTemplate.queryForObject(
            "select count(*) from users where email = :email",
            Map.of("email", email),
            Integer.class);
    if (count != null && count > 0) {
      return;
    }
    String starterPlanId =
        jdbcTemplate.query(
                "select id from plans where code = 'starter' limit 1",
                (rs, rowNum) -> rs.getString("id"))
            .stream()
            .findFirst()
            .orElse(null);
    String userId = Ids.cuidLike("usr");
    String tenantId = Ids.cuidLike("tenant");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into users (id, email, password_hash, name, platform_role, created_at, updated_at)
        values (:id, :email, :passwordHash, :name, 'user', :now, :now)
        """,
        new MapSqlParameterSource()
            .addValue("id", userId)
            .addValue("email", email)
            .addValue("passwordHash", passwordEncoder.encode("123456"))
            .addValue("name", displayName)
            .addValue("now", ts(now)));
    jdbcTemplate.update(
        """
        insert into tenants (
          id, name, slug, status, plan_id, balance_tokens, trial_ends_at, billing_email,
          contact_sales_email, monthly_budget_usd, spend_cap_enforced, contract_code, created_at, updated_at
        ) values (
          :id, :name, :slug, 'trial', :planId, 500000, :trialEndsAt, :billingEmail,
          'sales@taas.example', 150.0000, true, :contractCode, :now, :now
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", tenantId)
            .addValue("name", displayName + " 租户")
            .addValue("slug", "t-" + login)
            .addValue("planId", starterPlanId)
            .addValue("trialEndsAt", ts(now.plus(14, ChronoUnit.DAYS)))
            .addValue("billingEmail", email)
            .addValue("contractCode", "CTR-" + login.toUpperCase())
            .addValue("now", ts(now)));
    jdbcTemplate.update(
        "insert into tenant_members (id, user_id, tenant_id, role) values (:id, :userId, :tenantId, :role)",
        Map.of("id", Ids.cuidLike("tm"), "userId", userId, "tenantId", tenantId, "role", role));
    jdbcTemplate.update(
        """
        insert into tenant_routing_strategies (
          id, tenant_id, mode, primary_provider_type, fallback_provider_types, max_retries, timeout_ms, created_at, updated_at
        ) values (
          :id, :tenantId, 'balance', 'openai', '["anthropic","google"]'::jsonb, 1, 30000, :now, :now
        )
        """,
        Map.of("id", Ids.cuidLike("route"), "tenantId", tenantId, "now", ts(now)));
    jdbcTemplate.update(
        """
        insert into tenant_cache_settings (
          id, tenant_id, enabled, mode, similarity_threshold, ttl_seconds, created_at, updated_at
        ) values (
          :id, :tenantId, true, 'semantic', 0.920, 86400, :now, :now
        )
        """,
        Map.of("id", Ids.cuidLike("cache"), "tenantId", tenantId, "now", ts(now)));
    String token = "sk-demo-" + login + "-" + Ids.shortHex(8);
    jdbcTemplate.update(
        """
        insert into app_keys (
          id, tenant_id, name, description, token, token_hash, token_preview, status, environment, scopes,
          qps_limit, allowed_models, created_at
        ) values (
          :id, :tenantId, :name, :description, null, :tokenHash, :tokenPreview, 'active', 'development',
          '["chat:complete","usage:read","billing:read","admin:ops"]'::jsonb, 20, '[]'::jsonb, :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("ak"))
            .addValue("tenantId", tenantId)
            .addValue("name", login + "-default")
            .addValue("description", "Seeded demo AppKey")
            .addValue("tokenHash", cryptoUtils.hashAppKey(token))
            .addValue("tokenPreview", cryptoUtils.buildAppKeyPreview(token))
            .addValue("createdAt", ts(now)));
  }

  private void seedPromptTemplates() {
    Integer count =
        jdbcTemplate.queryForObject("select count(*) from prompt_templates", Map.of(), Integer.class);
    if (count != null && count > 0) {
      return;
    }
    jdbcTemplate.update(
        """
        insert into prompt_templates (id, tenant_id, name, description, snippet, uses_hint, saved_usd_hint, sort_order, created_at)
        values
          (:id1, null, '客服首轮应答', '与 Acme 在线客服生产密钥配套，统一问候与澄清话术', '你是 Acme 官方客服。用户问题：{user_msg}
请先复述诉求类别，再给不超过 3 步的解决方案。', 842, '126.40', 1, :createdAt),
          (:id2, null, '工单摘要（内部 QA）', '与 internal-qa 密钥联动，结构化抽取字段供 CRM 回填', '将工单正文压缩为 JSON：{category, urgency, owner_hint, next_action}。
正文：{ticket_body}', 531, '58.20', 2, :createdAt),
          (:id3, null, '合规审查清单', '法务抽检用固定模板，利于语义缓存命中', '按 ISO27001 与内部数据分级制度，对以下段落给出「合规风险提示」列表：
{excerpt}', 297, '41.05', 3, :createdAt)
        """,
        Map.of("id1", Ids.cuidLike("tpl"), "id2", Ids.cuidLike("tpl"), "id3", Ids.cuidLike("tpl"), "createdAt", ts(Instant.now())));
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }
}
