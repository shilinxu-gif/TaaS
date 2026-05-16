package com.taas.auth;

import com.taas.demo.DemoDailyUsageService;
import com.taas.infra.api.ApiException;
import com.taas.infra.config.TaasProperties;
import com.taas.infra.util.Ids;
import com.taas.ops.AuditService;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
  private static final Logger log = LoggerFactory.getLogger(AuthService.class);
  private static final String CRM_LOCAL_SUFFIX = "@crm.local";
  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;
  private final TaasProperties properties;
  private final AuditService auditService;
  private final DemoDailyUsageService demoDailyUsageService;

  public AuthService(
      NamedParameterJdbcTemplate jdbcTemplate,
      PasswordEncoder passwordEncoder,
      JwtService jwtService,
      TaasProperties properties,
      AuditService auditService,
      DemoDailyUsageService demoDailyUsageService) {
    this.jdbcTemplate = jdbcTemplate;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
    this.properties = properties;
    this.auditService = auditService;
    this.demoDailyUsageService = demoDailyUsageService;
  }

  public Map<String, Object> register(String email, String password, String name, String ip) {
    Integer existing =
        jdbcTemplate.queryForObject(
            "select count(*) from users where email = :email",
            Map.of("email", email.trim().toLowerCase()),
            Integer.class);
    if (existing != null && existing > 0) {
      throw new ApiException(409, "Email already registered");
    }

    String userId = Ids.cuidLike("usr");
    String tenantId = Ids.cuidLike("tenant");
    String planId =
        jdbcTemplate.query(
                "select id from plans where code = 'starter' limit 1",
                (rs, rowNum) -> rs.getString("id"))
            .stream()
            .findFirst()
            .orElse(null);
    Instant now = Instant.now();
    Instant trialEndsAt = now.plus(properties.getCommercial().getTrialDays(), ChronoUnit.DAYS);

    jdbcTemplate.update(
        """
        insert into users (id, email, password_hash, name, platform_role, created_at, updated_at)
        values (:id, :email, :passwordHash, :name, 'user', :now, :now)
        """,
        new MapSqlParameterSource()
            .addValue("id", userId)
            .addValue("email", email.trim().toLowerCase())
            .addValue("passwordHash", passwordEncoder.encode(password))
            .addValue("name", name.trim())
            .addValue("now", ts(now)));

    jdbcTemplate.update(
        """
        insert into tenants (
          id, name, slug, status, plan_id, balance_tokens, trial_ends_at, billing_email, contact_sales_email,
          monthly_budget_usd, spend_cap_enforced, created_at, updated_at
        ) values (
          :id, :name, :slug, 'trial', :planId, :balanceTokens, :trialEndsAt, :billingEmail, :salesEmail,
          :monthlyBudgetUsd, true, :now, :now
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", tenantId)
            .addValue("name", name.trim() + " 租户")
            .addValue("slug", "t-" + Ids.shortHex(4))
            .addValue("planId", planId)
            .addValue("balanceTokens", new BigDecimal("250000"))
            .addValue("trialEndsAt", ts(trialEndsAt))
            .addValue("billingEmail", email.trim().toLowerCase())
            .addValue("salesEmail", properties.getCommercial().getSalesEmail())
            .addValue("monthlyBudgetUsd", new BigDecimal("150.0000"))
            .addValue("now", ts(now)));

    jdbcTemplate.update(
        "insert into tenant_members (id, user_id, tenant_id, role) values (:id, :userId, :tenantId, 'owner')",
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("tm"))
            .addValue("userId", userId)
            .addValue("tenantId", tenantId));

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

    auditService.write(
        tenantId,
        userId,
        "user",
        "auth.register",
        "tenant",
        tenantId,
        ip,
        Map.of("trialEndsAt", trialEndsAt.toString()));

    return Map.of(
        "token", jwtService.issue(userId, tenantId, "owner", "user"),
        "user", Map.of("id", userId, "email", email.trim().toLowerCase(), "name", name.trim(), "platformRole", "user"),
        "tenantId", tenantId);
  }

  public Map<String, Object> login(String login, String password, String ip) {
    String email = resolveLoginEmail(login);
    UserRow user =
        jdbcTemplate.query(
                "select id, email, password_hash, name, platform_role from users where email = :email",
                Map.of("email", email),
                USER_ROW_MAPPER)
            .stream()
            .findFirst()
            .orElseThrow(() -> new ApiException(401, "Invalid credentials"));

    if (!passwordEncoder.matches(password, user.passwordHash())) {
      throw new ApiException(401, "Invalid credentials");
    }

    TenantMemberRow member =
        jdbcTemplate.query(
                """
                select tenant_id, role
                from tenant_members
                where user_id = :userId
                order by id asc
                limit 1
                """,
                Map.of("userId", user.id()),
                (rs, rowNum) -> new TenantMemberRow(rs.getString("tenant_id"), rs.getString("role")))
            .stream()
            .findFirst()
            .orElseThrow(() -> new ApiException(403, "No tenant membership"));

    auditService.write(
        member.tenantId(),
        user.id(),
        "user",
        "auth.login",
        "session",
        user.id(),
        ip,
        Map.of("role", member.role()));
    try {
      demoDailyUsageService.appendTodayIfNeeded(user.email(), user.id(), member.tenantId());
    } catch (Exception exception) {
      log.warn("demo.daily_usage.append_failed email={} tenantId={}", user.email(), member.tenantId(), exception);
    }

    return Map.of(
        "token", jwtService.issue(user.id(), member.tenantId(), member.role(), user.platformRole()),
        "user", Map.of("id", user.id(), "email", user.email(), "name", user.name(), "platformRole", user.platformRole()),
        "tenantId", member.tenantId());
  }

  private String resolveLoginEmail(String login) {
    String normalized = login == null ? "" : login.trim().toLowerCase();
    if (normalized.isBlank() || normalized.contains("@")) {
      return normalized;
    }
    return normalized + CRM_LOCAL_SUFFIX;
  }

  public Map<String, Object> me(JwtPrincipal principal) {
    return jdbcTemplate.query(
            """
            select
              u.id,
              u.email,
              u.name,
              u.platform_role,
              u.email_verified_at,
              t.id as tenant_id,
              t.name as tenant_name,
              t.slug as tenant_slug,
              t.status as tenant_status,
              t.balance_tokens,
              t.trial_ends_at,
              t.billing_email,
              t.contact_sales_email,
              t.monthly_budget_usd,
              t.spend_cap_enforced,
              t.contract_code,
              p.name as plan_name,
              p.code as plan_code
            from users u
            left join tenants t on t.id = :tenantId
            left join plans p on p.id = t.plan_id
            where u.id = :userId
            """,
            Map.of("userId", principal.userId(), "tenantId", principal.tenantId()),
            (rs, rowNum) ->
                orderedMap(
                    "id", rs.getString("id"),
                    "email", rs.getString("email"),
                    "name", rs.getString("name"),
                    "role", principal.role(),
                    "platformRole", rs.getString("platform_role"),
                    "emailVerifiedAt", rs.getTimestamp("email_verified_at"),
                    "tenant",
                        rs.getString("tenant_id") == null
                            ? null
                            : orderedMap(
                                "id", rs.getString("tenant_id"),
                                "name", rs.getString("tenant_name"),
                                "slug", rs.getString("tenant_slug"),
                                "status", rs.getString("tenant_status"),
                                "balanceTokens", rs.getBigDecimal("balance_tokens").stripTrailingZeros().toPlainString(),
                                "trialEndsAt", rs.getTimestamp("trial_ends_at"),
                                "billingEmail", rs.getString("billing_email"),
                                "contactSalesEmail", rs.getString("contact_sales_email"),
                                "monthlyBudgetUsd", rs.getBigDecimal("monthly_budget_usd") == null ? null : rs.getBigDecimal("monthly_budget_usd").stripTrailingZeros().toPlainString(),
                                "spendCapEnforced", rs.getBoolean("spend_cap_enforced"),
                                "contractCode", rs.getString("contract_code"),
                                "plan", rs.getString("plan_code") == null ? null : orderedMap("name", rs.getString("plan_name"), "code", rs.getString("plan_code")))))
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(404, "Not found"));
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

  private record UserRow(String id, String email, String passwordHash, String name, String platformRole) {
  }

  private record TenantMemberRow(String tenantId, String role) {
  }

  private static final RowMapper<UserRow> USER_ROW_MAPPER =
      new RowMapper<>() {
        @Override
        public UserRow mapRow(ResultSet rs, int rowNum) throws SQLException {
          return new UserRow(
              rs.getString("id"),
              rs.getString("email"),
              rs.getString("password_hash"),
              rs.getString("name"),
              rs.getString("platform_role"));
        }
      };
}
