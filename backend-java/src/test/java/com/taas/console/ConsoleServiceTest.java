package com.taas.console;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.auth.JwtPrincipal;
import com.taas.infra.api.ApiException;
import com.taas.infra.security.CryptoUtils;
import com.taas.infra.util.Jsons;
import com.taas.ops.AuditService;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

class ConsoleServiceTest {
  private final NamedParameterJdbcTemplate jdbcTemplate = mock(NamedParameterJdbcTemplate.class);
  private final ConsoleService consoleService =
      new ConsoleService(
          jdbcTemplate,
          new Jsons(new ObjectMapper()),
          mock(CryptoUtils.class),
          mock(AuditService.class),
          mock(PasswordEncoder.class));

  @Test
  void updateAppKeyShouldRejectStatusChangeForRevokedKey() throws Exception {
    stubTenantLookup();
    stubRevokedAppKeyLookup();

    ApiException exception =
        assertThrows(
            ApiException.class,
            () ->
                consoleService.updateAppKey(
                    new JwtPrincipal("user_1", "tenant_1", "owner", "user"),
                    "ak_1",
                    Map.of("status", "active"),
                    "127.0.0.1"));

    assertEquals(400, exception.getStatusCode());
    assertEquals("已撤销的密钥无法切换启用状态", exception.getMessage());
    verify(jdbcTemplate, never()).update(startsWith("update app_keys"), any(Map.class));
    verify(jdbcTemplate, never()).update(startsWith("update app_keys"), any(org.springframework.jdbc.core.namedparam.MapSqlParameterSource.class));
  }

  @SuppressWarnings("unchecked")
  private void stubTenantLookup() throws Exception {
    when(jdbcTemplate.query(contains("from tenants t"), any(Map.class), any(RowMapper.class)))
        .thenAnswer(
            invocation -> {
              RowMapper<Object> rowMapper = (RowMapper<Object>) invocation.getArgument(2);
              ResultSet rs = mock(ResultSet.class);
              when(rs.getString("id")).thenReturn("tenant_1");
              when(rs.getString("name")).thenReturn("Demo Tenant");
              when(rs.getString("slug")).thenReturn("demo-tenant");
              when(rs.getString("status")).thenReturn("active");
              when(rs.getBigDecimal("balance_tokens")).thenReturn(new BigDecimal("1000"));
              when(rs.getTimestamp("trial_ends_at"))
                  .thenReturn(Timestamp.from(Instant.parse("2026-04-15T00:00:00Z")));
              when(rs.getString("billing_email")).thenReturn("billing@example.com");
              when(rs.getString("contact_sales_email")).thenReturn("sales@example.com");
              when(rs.getBigDecimal("monthly_budget_usd")).thenReturn(new BigDecimal("50"));
              when(rs.getString("contract_code")).thenReturn("contract-1");
              when(rs.getString("plan_name")).thenReturn("Starter");
              when(rs.getString("plan_code")).thenReturn("starter");
              return List.of(rowMapper.mapRow(rs, 0));
            });
  }

  @SuppressWarnings("unchecked")
  private void stubRevokedAppKeyLookup() throws Exception {
    when(jdbcTemplate.query(contains("from app_keys"), any(Map.class), any(RowMapper.class)))
        .thenAnswer(
            invocation -> {
              RowMapper<Object> rowMapper = (RowMapper<Object>) invocation.getArgument(2);
              ResultSet rs = mock(ResultSet.class);
              when(rs.getString("id")).thenReturn("ak_1");
              when(rs.getString("name")).thenReturn("Demo Key");
              when(rs.getString("description")).thenReturn("demo");
              when(rs.getString("token_preview")).thenReturn("sk-live-xxxx");
              when(rs.getString("status")).thenReturn("revoked");
              when(rs.getString("environment")).thenReturn("production");
              when(rs.getString("scopes")).thenReturn("[\"chat:complete\"]");
              when(rs.getObject("qps_limit")).thenReturn(10);
              when(rs.getBigDecimal("daily_budget_usd")).thenReturn(new BigDecimal("1.25"));
              when(rs.getBigDecimal("monthly_budget_usd")).thenReturn(new BigDecimal("9.99"));
              when(rs.getString("allowed_models")).thenReturn("[\"gpt-4o-mini\"]");
              when(rs.getTimestamp("created_at"))
                  .thenReturn(Timestamp.from(Instant.parse("2026-04-15T00:00:00Z")));
              when(rs.getTimestamp("last_used_at")).thenReturn(null);
              when(rs.getString("last_used_ip")).thenReturn(null);
              return List.of(rowMapper.mapRow(rs, 0));
            });
  }
}
