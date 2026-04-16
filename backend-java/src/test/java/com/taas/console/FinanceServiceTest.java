package com.taas.console;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.taas.auth.JwtPrincipal;
import com.taas.infra.api.ApiException;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class FinanceServiceTest {
  private final NamedParameterJdbcTemplate jdbcTemplate = mock(NamedParameterJdbcTemplate.class);
  private final FinanceService financeService = new FinanceService(jdbcTemplate);

  @Test
  void rechargeActionShouldRejectCancelForNonPendingPaymentStatus() throws Exception {
    stubRechargeLookup("pending_review");

    ApiException exception =
        assertThrows(
            ApiException.class,
            () ->
                financeService.rechargeAction(
                    new JwtPrincipal("user_1", "tenant_1", "owner", "user"),
                    "rch_1",
                    "mock-pay-cancel"));

    assertEquals(400, exception.getStatusCode());
    assertEquals("仅待支付订单可取消", exception.getMessage());
    verify(jdbcTemplate, never())
        .update(contains("update wallet_recharge_orders set status = 'cancelled'"), any(Map.class));
  }

  @Test
  void invoiceActionShouldRejectAcceptForNonSubmittedStatus() throws Exception {
    stubInvoiceLookup("issued");

    ApiException exception =
        assertThrows(
            ApiException.class,
            () ->
                financeService.invoiceAction(
                    new JwtPrincipal("user_1", "tenant_1", "owner", "user"),
                    "inv_1",
                    "mock-accept"));

    assertEquals(400, exception.getStatusCode());
    assertEquals("仅「已提交」状态可模拟税局受理", exception.getMessage());
    verify(jdbcTemplate, never())
        .update(contains("update invoice_requests set status = 'processing'"), any(Map.class));
  }

  @SuppressWarnings("unchecked")
  private void stubRechargeLookup(String status) throws Exception {
    when(
            jdbcTemplate.query(
                contains("from wallet_recharge_orders o"), any(Map.class), any(RowMapper.class)))
        .thenAnswer(
            invocation -> {
              RowMapper<Object> rowMapper = (RowMapper<Object>) invocation.getArgument(2);
              ResultSet rs = mock(ResultSet.class);
              when(rs.getString("id")).thenReturn("rch_1");
              when(rs.getString("order_no")).thenReturn("RCH-1");
              when(rs.getBigDecimal("amount_cny")).thenReturn(new BigDecimal("10"));
              when(rs.getString("currency")).thenReturn("CNY");
              when(rs.getString("tenant_name")).thenReturn("Demo Tenant");
              when(rs.getString("pay_channel")).thenReturn("bank_transfer");
              when(rs.getString("status")).thenReturn(status);
              when(rs.getBigDecimal("credited_tokens")).thenReturn(new BigDecimal("12000"));
              when(rs.getString("payer_name")).thenReturn("Demo User");
              when(rs.getBoolean("need_invoice")).thenReturn(false);
              when(rs.getString("remark")).thenReturn(null);
              when(rs.getTimestamp("paid_at")).thenReturn(null);
              when(rs.getTimestamp("created_at"))
                  .thenReturn(Timestamp.from(Instant.parse("2026-04-15T00:00:00Z")));
              return List.of(rowMapper.mapRow(rs, 0));
            });
  }

  @SuppressWarnings("unchecked")
  private void stubInvoiceLookup(String status) throws Exception {
    when(
            jdbcTemplate.query(
                contains("select * from invoice_requests"), any(Map.class), any(RowMapper.class)))
        .thenAnswer(
            invocation -> {
              RowMapper<Object> rowMapper = (RowMapper<Object>) invocation.getArgument(2);
              ResultSet rs = mock(ResultSet.class);
              when(rs.getString("id")).thenReturn("inv_1");
              when(rs.getString("request_no")).thenReturn("INV-1");
              when(rs.getString("title_type")).thenReturn("enterprise");
              when(rs.getString("invoice_type")).thenReturn("vat_normal");
              when(rs.getString("buyer_name")).thenReturn("Demo Corp");
              when(rs.getString("buyer_tax_no")).thenReturn("123456789");
              when(rs.getBigDecimal("amount_cny")).thenReturn(new BigDecimal("88"));
              when(rs.getString("email")).thenReturn("billing@example.com");
              when(rs.getString("status")).thenReturn(status);
              when(rs.getString("invoice_no")).thenReturn(null);
              when(rs.getString("invoice_code")).thenReturn(null);
              when(rs.getString("pdf_url")).thenReturn(null);
              when(rs.getString("reject_reason")).thenReturn(null);
              when(rs.getTimestamp("issued_at")).thenReturn(null);
              when(rs.getTimestamp("created_at"))
                  .thenReturn(Timestamp.from(Instant.parse("2026-04-15T00:00:00Z")));
              when(rs.getString("buyer_address_phone")).thenReturn(null);
              when(rs.getString("buyer_bank_account")).thenReturn(null);
              when(rs.getTimestamp("updated_at"))
                  .thenReturn(Timestamp.from(Instant.parse("2026-04-15T00:00:00Z")));
              return List.of(rowMapper.mapRow(rs, 0));
            });
  }
}
