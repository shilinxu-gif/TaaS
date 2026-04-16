package com.taas.console;

import com.taas.auth.JwtPrincipal;
import com.taas.infra.api.ApiException;
import com.taas.infra.util.Ids;
import com.taas.infra.util.MoneyUtils;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class FinanceService {
  private static final Map<String, String> RECHARGE_CHANNEL_LABEL =
      Map.of(
          "bank_transfer", "对公打款",
          "wechat", "微信支付",
          "alipay", "支付宝支付",
          "apple_pay", "苹果支付",
          "google_pay", "谷歌支付",
          "corporate_online", "企业网银",
          "aggregate_demo", "聚合支付演示");
  private static final Map<String, String> RECHARGE_STATUS_LABEL =
      Map.of(
          "pending_payment", "待支付",
          "pending", "待支付",
          "processing", "待支付",
          "pending_review", "待审核",
          "success", "已到账",
          "failed", "失败",
          "cancelled", "已取消");
  private static final Map<String, String> INVOICE_STATUS_LABEL =
      Map.of(
          "submitted", "已提交",
          "processing", "开票中",
          "issued", "已开票",
          "rejected", "已驳回");
  private static final Map<String, String> INVOICE_TITLE_LABEL =
      Map.of("enterprise", "企业", "personal", "个人");
  private static final Map<String, String> INVOICE_TYPE_LABEL =
      Map.of("vat_special", "增值税专用发票", "vat_normal", "增值税普通发票", "e_normal", "增值税电子普通发票");
  private static final Map<String, Object> BANK_INFO =
      Map.of(
          "companyName", "算力无限（上海）科技有限公司",
          "bankName", "招商银行股份有限公司上海分行营业部",
          "accountNo", "1219 1523 8888 6666 0123",
          "accountName", "算力无限（上海）科技有限公司");

  private final NamedParameterJdbcTemplate jdbcTemplate;

  public FinanceService(NamedParameterJdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Map<String, Object> rechargeSummary(JwtPrincipal principal) {
    Timestamp monthStart = ts(LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay().toInstant(ZoneOffset.UTC));
    BigDecimal balance =
        jdbcTemplate.queryForObject(
            "select balance_tokens from tenants where id = :tenantId",
            Map.of("tenantId", principal.tenantId()),
            BigDecimal.class);
    Integer pending =
        jdbcTemplate.queryForObject(
            """
            select count(*) from wallet_recharge_orders
            where tenant_id = :tenantId and status in ('pending_payment', 'pending_review', 'pending', 'processing')
            """,
            Map.of("tenantId", principal.tenantId()),
            Integer.class);
    BigDecimal monthRecharge =
        jdbcTemplate.queryForObject(
            """
            select coalesce(sum(case when currency = 'USD' then amount_cny * 7.2 else amount_cny end), 0)
            from wallet_recharge_orders
            where tenant_id = :tenantId and status = 'success' and paid_at >= :monthStart
            """,
            Map.of("tenantId", principal.tenantId(), "monthStart", monthStart),
            BigDecimal.class);
    return Map.of(
        "balanceTokens", MoneyUtils.money(balance),
        "pendingCount", pending == null ? 0 : pending,
        "monthRechargeCny", MoneyUtils.money(monthRecharge),
        "monthRechargeNote", "本月成功充值金额已按 USD×7.2 折合为人民币展示（演示汇率）。",
        "note", "演示环境：CNY 按 1 元≈1,200 tokens、USD 按 1≈8,500 tokens 折算到账；不产生真实支付。",
        "bankAccount", BANK_INFO,
        "recommendedChannels", List.of("bank_transfer", "alipay"));
  }

  public List<Map<String, Object>> recharges(JwtPrincipal principal) {
    return jdbcTemplate.query(
        """
        select o.*, t.name as tenant_name
        from wallet_recharge_orders o
        join tenants t on t.id = o.tenant_id
        where o.tenant_id = :tenantId
        order by o.created_at desc
        limit 100
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) -> mapRecharge(rs.getString("id"), rs.getString("order_no"), rs.getBigDecimal("amount_cny"), rs.getString("currency"), rs.getString("tenant_name"), rs.getString("pay_channel"), rs.getString("status"), rs.getBigDecimal("credited_tokens"), rs.getString("payer_name"), rs.getBoolean("need_invoice"), rs.getString("remark"), rs.getTimestamp("paid_at") == null ? null : rs.getTimestamp("paid_at").toInstant(), rs.getTimestamp("created_at").toInstant()));
  }

  public Map<String, Object> createRecharge(JwtPrincipal principal, Map<String, Object> body) {
    validateRechargeBody(body);
    String id = Ids.cuidLike("rch");
    String channel = String.valueOf(body.get("payChannel"));
    BigDecimal amount = decimalValue(body.get("amount"), "amount");
    String currency = String.valueOf(body.get("currency"));
    String status = "bank_transfer".equals(channel) ? "pending_review" : ("wechat".equals(channel) || "alipay".equals(channel)) ? "pending_payment" : "success";
    BigDecimal credited = "USD".equals(currency) ? BigDecimal.valueOf(Math.floor(amount.doubleValue() * 8500)) : BigDecimal.valueOf(Math.floor(amount.doubleValue() * 1200));
    Instant now = Instant.now();
    String payerName = String.valueOf(body.get("payerName")).trim();
    Boolean needInvoice = booleanValue(body.getOrDefault("needInvoice", false));
    String remark = nullableTrim(body.get("remark"));
    if (needInvoice) {
      remark = remark == null || remark.isBlank() ? "需开具发票" : remark + " · 需开具发票";
    }
    jdbcTemplate.update(
        """
        insert into wallet_recharge_orders (
          id, tenant_id, order_no, amount_cny, currency, pay_channel, status, credited_tokens,
          payer_name, need_invoice, remark, paid_at, created_at, updated_at
        ) values (
          :id, :tenantId, :orderNo, :amount, :currency, :payChannel, :status, :creditedTokens,
          :payerName, :needInvoice, :remark, :paidAt, :now, :now
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("tenantId", principal.tenantId())
            .addValue("orderNo", nextRechargeOrderNo())
            .addValue("amount", amount)
            .addValue("currency", currency)
            .addValue("payChannel", channel)
            .addValue("status", status)
            .addValue("creditedTokens", credited)
            .addValue("payerName", payerName)
            .addValue("needInvoice", needInvoice)
            .addValue("remark", remark)
            .addValue("paidAt", "success".equals(status) ? now : null)
            .addValue("now", ts(now)));
    if ("success".equals(status)) {
      jdbcTemplate.update("update tenants set balance_tokens = balance_tokens + :credited where id = :tenantId", Map.of("credited", credited, "tenantId", principal.tenantId()));
    }
    Map<String, Object> row = getRecharge(principal.tenantId(), id);
    return orderedMap(
        "id", row.get("id"),
        "orderNo", row.get("orderNo"),
        "amount", row.get("amount"),
        "currency", row.get("currency"),
        "amountDisplay", row.get("amountDisplay"),
        "tenantName", row.get("tenantName"),
        "payChannel", row.get("payChannel"),
        "payChannelLabel", row.get("payChannelLabel"),
        "status", row.get("status"),
        "statusLabel", row.get("statusLabel"),
        "creditedTokens", row.get("creditedTokens"),
        "payerName", row.get("payerName"),
        "needInvoice", row.get("needInvoice"),
        "remark", row.get("remark"),
        "paidAt", row.get("paidAt"),
        "createdAt", row.get("createdAt"),
        "hint",
            "bank_transfer".equals(channel)
                ? "请使用对公账户打款，到账后可点击「模拟审核通过」。"
                : ("success".equals(status) ? "国际支付演示单已自动入账，可直接查看余额变化。" : "演示环境可点击「模拟支付成功」体验到账。"),
        "flow", "bank_transfer".equals(channel) ? "bank" : ("success".equals(status) ? "intl_success" : "qr"),
        "bankAccount", "bank_transfer".equals(channel) ? BANK_INFO : null);
  }

  public Map<String, Object> rechargeAction(JwtPrincipal principal, String id, String action) {
    Map<String, Object> row = getRecharge(principal.tenantId(), id);
    String status = String.valueOf(row.get("status"));
    if ("mock-bank-approve".equals(action)) {
      if (!"pending_review".equals(status)) {
        throw new ApiException(400, "仅「待审核」对公单可模拟审核通过");
      }
      return finalizeRechargeSuccess(
          principal.tenantId(), id, "财务审核通过（演示）");
    }
    if ("mock-pay-success".equals(action)) {
      if (!List.of("pending_payment", "pending", "processing").contains(status)) {
        throw new ApiException(400, "仅待支付订单可模拟支付成功");
      }
      return finalizeRechargeSuccess(principal.tenantId(), id, "扫码支付成功（演示）");
    }
    if ("mock-pay-cancel".equals(action)) {
      if (!List.of("pending_payment", "pending", "processing").contains(status)) {
        throw new ApiException(400, "仅待支付订单可取消");
      }
      jdbcTemplate.update(
          """
          update wallet_recharge_orders
          set status = 'cancelled', remark = coalesce(remark, '用户取消（演示）'), updated_at = :now
          where id = :id and tenant_id = :tenantId
          """,
          Map.of("id", id, "tenantId", principal.tenantId(), "now", ts(Instant.now())));
      return getRecharge(principal.tenantId(), id);
    }
    if ("mock-complete".equals(action)) {
      if ("pending_review".equals(status)) {
        return finalizeRechargeSuccess(principal.tenantId(), id, "财务审核通过（演示）");
      }
      if (List.of("pending_payment", "pending", "processing").contains(status)) {
        return finalizeRechargeSuccess(principal.tenantId(), id, "模拟入账");
      }
      throw new ApiException(400, "当前状态不可完成");
    }
    throw new ApiException(400, "Unsupported action");
  }

  public Map<String, Object> invoiceSummary(JwtPrincipal principal) {
    Timestamp monthStart = ts(LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay().toInstant(ZoneOffset.UTC));
    Integer pending =
        jdbcTemplate.queryForObject(
            "select count(*) from invoice_requests where tenant_id = :tenantId and status in ('submitted', 'processing')",
            Map.of("tenantId", principal.tenantId()),
            Integer.class);
    Integer issued =
        jdbcTemplate.queryForObject(
            "select count(*) from invoice_requests where tenant_id = :tenantId and status = 'issued' and issued_at >= :monthStart",
            Map.of("tenantId", principal.tenantId(), "monthStart", monthStart),
            Integer.class);
    BigDecimal issuedAmount =
        jdbcTemplate.queryForObject(
            "select coalesce(sum(amount_cny), 0) from invoice_requests where tenant_id = :tenantId and status = 'issued' and issued_at >= :monthStart",
            Map.of("tenantId", principal.tenantId(), "monthStart", monthStart),
            BigDecimal.class);
    return Map.of(
        "pendingCount", pending == null ? 0 : pending,
        "issuedThisMonth", issued == null ? 0 : issued,
        "issuedAmountMonthCny", MoneyUtils.money(issuedAmount),
        "note", "演示环境：发票号码与 PDF 为模拟数据；可点击「模拟开票完成」体验状态流转。");
  }

  public List<Map<String, Object>> invoices(JwtPrincipal principal) {
    return jdbcTemplate.query(
        """
        select * from invoice_requests
        where tenant_id = :tenantId
        order by created_at desc
        limit 100
        """,
        Map.of("tenantId", principal.tenantId()),
        (rs, rowNum) -> mapInvoice(rs.getString("id"), rs.getString("request_no"), rs.getString("title_type"), rs.getString("invoice_type"), rs.getString("buyer_name"), rs.getString("buyer_tax_no"), rs.getBigDecimal("amount_cny"), rs.getString("email"), rs.getString("status"), rs.getString("invoice_no"), rs.getString("invoice_code"), rs.getString("pdf_url"), rs.getString("reject_reason"), rs.getTimestamp("issued_at") == null ? null : rs.getTimestamp("issued_at").toInstant(), rs.getTimestamp("created_at").toInstant(), rs.getString("buyer_address_phone"), rs.getString("buyer_bank_account"), rs.getTimestamp("updated_at").toInstant(), false));
  }

  public Map<String, Object> invoiceDetail(JwtPrincipal principal, String id) {
    return jdbcTemplate.query(
            "select * from invoice_requests where tenant_id = :tenantId and id = :id",
            Map.of("tenantId", principal.tenantId(), "id", id),
            (rs, rowNum) -> mapInvoice(rs.getString("id"), rs.getString("request_no"), rs.getString("title_type"), rs.getString("invoice_type"), rs.getString("buyer_name"), rs.getString("buyer_tax_no"), rs.getBigDecimal("amount_cny"), rs.getString("email"), rs.getString("status"), rs.getString("invoice_no"), rs.getString("invoice_code"), rs.getString("pdf_url"), rs.getString("reject_reason"), rs.getTimestamp("issued_at") == null ? null : rs.getTimestamp("issued_at").toInstant(), rs.getTimestamp("created_at").toInstant(), rs.getString("buyer_address_phone"), rs.getString("buyer_bank_account"), rs.getTimestamp("updated_at").toInstant(), true))
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(404, "记录不存在"));
  }

  public Map<String, Object> createInvoice(JwtPrincipal principal, Map<String, Object> body) {
    validateInvoiceBody(body);
    String id = Ids.cuidLike("inv");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        insert into invoice_requests (
          id, tenant_id, request_no, title_type, invoice_type, buyer_name, buyer_tax_no,
          buyer_address_phone, buyer_bank_account, amount_cny, email, status, created_at, updated_at
        ) values (
          :id, :tenantId, :requestNo, :titleType, :invoiceType, :buyerName, :buyerTaxNo,
          :buyerAddressPhone, :buyerBankAccount, :amountCny, :email, 'submitted', :now, :now
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("tenantId", principal.tenantId())
            .addValue("requestNo", nextInvoiceRequestNo())
            .addValue("titleType", body.get("titleType"))
            .addValue("invoiceType", body.get("invoiceType"))
            .addValue("buyerName", String.valueOf(body.get("buyerName")).trim())
            .addValue("buyerTaxNo", String.valueOf(body.get("buyerTaxNo")).trim())
            .addValue("buyerAddressPhone", nullableTrim(body.get("buyerAddressPhone")))
            .addValue("buyerBankAccount", nullableTrim(body.get("buyerBankAccount")))
            .addValue("amountCny", decimalValue(body.get("amountCny"), "amountCny"))
            .addValue("email", String.valueOf(body.get("email")).trim())
            .addValue("now", ts(now)));
    return invoiceDetail(principal, id);
  }

  public Map<String, Object> invoiceAction(JwtPrincipal principal, String id, String action) {
    Map<String, Object> detail = invoiceDetail(principal, id);
    String status = String.valueOf(detail.get("status"));
    if ("mock-accept".equals(action)) {
      if (!"submitted".equals(status)) {
        throw new ApiException(400, "仅「已提交」状态可模拟税局受理");
      }
      jdbcTemplate.update("update invoice_requests set status = 'processing', updated_at = :now where id = :id and tenant_id = :tenantId", Map.of("id", id, "tenantId", principal.tenantId(), "now", ts(Instant.now())));
      return invoiceDetail(principal, id);
    }
    if ("mock-issue".equals(action)) {
      if (!"submitted".equals(status) && !"processing".equals(status)) {
        throw new ApiException(400, "仅待开票/开票中的申请可模拟开票完成");
      }
      jdbcTemplate.update(
          """
          update invoice_requests
          set status = 'issued', invoice_no = :invoiceNo, invoice_code = :invoiceCode,
              pdf_url = :pdfUrl, issued_at = :now, updated_at = :now
          where id = :id and tenant_id = :tenantId
          """,
          Map.of(
              "id", id,
              "tenantId", principal.tenantId(),
              "invoiceNo", "31" + System.currentTimeMillis(),
              "invoiceCode", String.valueOf(3200000000L + (System.currentTimeMillis() % 100000)),
              "pdfUrl", "#mock-invoice-" + id.substring(Math.max(0, id.length() - 6)),
              "now", ts(Instant.now())));
      return invoiceDetail(principal, id);
    }
    throw new ApiException(400, "Unsupported action");
  }

  private Map<String, Object> getRecharge(String tenantId, String id) {
    return jdbcTemplate.query(
            """
            select o.*, t.name as tenant_name
            from wallet_recharge_orders o
            join tenants t on t.id = o.tenant_id
            where o.tenant_id = :tenantId and o.id = :id
            """,
            Map.of("tenantId", tenantId, "id", id),
            (rs, rowNum) -> mapRecharge(rs.getString("id"), rs.getString("order_no"), rs.getBigDecimal("amount_cny"), rs.getString("currency"), rs.getString("tenant_name"), rs.getString("pay_channel"), rs.getString("status"), rs.getBigDecimal("credited_tokens"), rs.getString("payer_name"), rs.getBoolean("need_invoice"), rs.getString("remark"), rs.getTimestamp("paid_at") == null ? null : rs.getTimestamp("paid_at").toInstant(), rs.getTimestamp("created_at").toInstant()))
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiException(404, "订单不存在"));
  }

  private Map<String, Object> mapRecharge(
      String id,
      String orderNo,
      BigDecimal amount,
      String currency,
      String tenantName,
      String payChannel,
      String status,
      BigDecimal creditedTokens,
      String payerName,
      boolean needInvoice,
      String remark,
      Instant paidAt,
      Instant createdAt) {
    return orderedMap(
        "id", id,
        "orderNo", orderNo,
        "amount", MoneyUtils.money(amount),
        "currency", currency,
        "amountDisplay", ("USD".equals(currency) ? "$" : "¥") + MoneyUtils.money(amount),
        "tenantName", tenantName,
        "payChannel", payChannel,
        "payChannelLabel", RECHARGE_CHANNEL_LABEL.getOrDefault(payChannel, payChannel),
        "status", status,
        "statusLabel", RECHARGE_STATUS_LABEL.getOrDefault(status, status),
        "creditedTokens", MoneyUtils.money(creditedTokens),
        "payerName", payerName,
        "needInvoice", needInvoice,
        "remark", remark,
        "paidAt", paidAt,
        "createdAt", createdAt);
  }

  private Map<String, Object> mapInvoice(
      String id,
      String requestNo,
      String titleType,
      String invoiceType,
      String buyerName,
      String buyerTaxNo,
      BigDecimal amountCny,
      String email,
      String status,
      String invoiceNo,
      String invoiceCode,
      String pdfUrl,
      String rejectReason,
      Instant issuedAt,
      Instant createdAt,
      String buyerAddressPhone,
      String buyerBankAccount,
      Instant updatedAt,
      boolean detail) {
    Map<String, Object> base =
        new java.util.LinkedHashMap<>(
            orderedMap(
                "id", id,
                "requestNo", requestNo,
                "titleType", titleType,
                "titleTypeLabel", INVOICE_TITLE_LABEL.getOrDefault(titleType, titleType),
                "invoiceType", invoiceType,
                "invoiceTypeLabel", INVOICE_TYPE_LABEL.getOrDefault(invoiceType, invoiceType),
                "buyerName", buyerName,
                "buyerTaxNo", buyerTaxNo,
                "amountCny", MoneyUtils.money(amountCny),
                "email", email,
                "status", status,
                "statusLabel", INVOICE_STATUS_LABEL.getOrDefault(status, status),
                "invoiceNo", invoiceNo,
                "invoiceCode", invoiceCode,
                "pdfUrl", pdfUrl,
                "rejectReason", rejectReason,
                "issuedAt", issuedAt,
                "createdAt", createdAt));
    if (detail) {
      base.put("buyerAddressPhone", buyerAddressPhone);
      base.put("buyerBankAccount", buyerBankAccount);
      base.put("updatedAt", updatedAt);
    }
    return base;
  }

  private static String nextRechargeOrderNo() {
    return "RCH-" + Long.toString(System.currentTimeMillis(), 36).toUpperCase() + "-" + Ids.shortHex(2);
  }

  private static String nextInvoiceRequestNo() {
    return "INV-" + Long.toString(System.currentTimeMillis(), 36).toUpperCase() + "-" + Ids.shortHex(2);
  }

  private Map<String, Object> finalizeRechargeSuccess(
      String tenantId, String rechargeId, String extraRemark) {
    Map<String, Object> row = getRecharge(tenantId, rechargeId);
    BigDecimal credited = decimalValue(row.get("creditedTokens"), "creditedTokens");
    Instant now = Instant.now();
    jdbcTemplate.update(
        """
        update wallet_recharge_orders
        set status = 'success', paid_at = :now,
            remark = case
              when :extraRemark is null or trim(:extraRemark) = '' then remark
              when remark is null or trim(remark) = '' then :extraRemark
              else trim(remark || ' ' || :extraRemark)
            end,
            updated_at = :now
        where id = :id and tenant_id = :tenantId
        """,
        new MapSqlParameterSource()
            .addValue("id", rechargeId)
            .addValue("tenantId", tenantId)
            .addValue("extraRemark", extraRemark)
            .addValue("now", ts(now)));
    jdbcTemplate.update(
        "update tenants set balance_tokens = balance_tokens + :credited where id = :tenantId",
        Map.of("credited", credited, "tenantId", tenantId));
    return getRecharge(tenantId, rechargeId);
  }

  private void validateRechargeBody(Map<String, Object> body) {
    BigDecimal amount = decimalValue(body.get("amount"), "amount");
    if (amount.compareTo(BigDecimal.ZERO) <= 0
        || amount.compareTo(new BigDecimal("9999999")) > 0) {
      throw new ApiException(400, "参数无效");
    }
    String currency = String.valueOf(body.get("currency"));
    if (!List.of("CNY", "USD").contains(currency)) {
      throw new ApiException(400, "参数无效");
    }
    String payChannel = String.valueOf(body.get("payChannel"));
    if (!List.of("bank_transfer", "wechat", "alipay", "apple_pay", "google_pay")
        .contains(payChannel)) {
      throw new ApiException(400, "参数无效");
    }
    String payerName = nullableTrim(body.get("payerName"));
    if (payerName == null || payerName.length() < 2 || payerName.length() > 120) {
      throw new ApiException(400, "参数无效");
    }
    String remark = nullableTrim(body.get("remark"));
    if (remark != null && remark.length() > 500) {
      throw new ApiException(400, "参数无效");
    }
  }

  private void validateInvoiceBody(Map<String, Object> body) {
    if (!List.of("enterprise", "personal").contains(String.valueOf(body.get("titleType")))) {
      throw new ApiException(400, "参数无效");
    }
    if (!List.of("vat_special", "vat_normal", "e_normal")
        .contains(String.valueOf(body.get("invoiceType")))) {
      throw new ApiException(400, "参数无效");
    }
    String buyerName = nullableTrim(body.get("buyerName"));
    String buyerTaxNo = nullableTrim(body.get("buyerTaxNo"));
    String email = nullableTrim(body.get("email"));
    if (buyerName == null || buyerName.length() < 2 || buyerName.length() > 120) {
      throw new ApiException(400, "参数无效");
    }
    if (buyerTaxNo == null || buyerTaxNo.length() < 6 || buyerTaxNo.length() > 32) {
      throw new ApiException(400, "参数无效");
    }
    if (email == null || !email.contains("@")) {
      throw new ApiException(400, "参数无效");
    }
    String buyerAddressPhone = nullableTrim(body.get("buyerAddressPhone"));
    if (buyerAddressPhone != null && buyerAddressPhone.length() > 280) {
      throw new ApiException(400, "参数无效");
    }
    String buyerBankAccount = nullableTrim(body.get("buyerBankAccount"));
    if (buyerBankAccount != null && buyerBankAccount.length() > 280) {
      throw new ApiException(400, "参数无效");
    }
    BigDecimal amount = decimalValue(body.get("amountCny"), "amountCny");
    if (amount.compareTo(BigDecimal.ZERO) <= 0
        || amount.compareTo(new BigDecimal("9999999")) > 0) {
      throw new ApiException(400, "参数无效");
    }
  }

  private static BigDecimal decimalValue(Object raw, String field) {
    try {
      return new BigDecimal(String.valueOf(raw));
    } catch (Exception exception) {
      throw new ApiException(400, field + " is invalid");
    }
  }

  private static boolean booleanValue(Object raw) {
    return Boolean.parseBoolean(String.valueOf(raw));
  }

  private static String nullableTrim(Object raw) {
    if (raw == null) {
      return null;
    }
    String value = String.valueOf(raw).trim();
    return value.isEmpty() ? null : value;
  }

  private static Map<String, Object> orderedMap(Object... items) {
    java.util.LinkedHashMap<String, Object> map = new java.util.LinkedHashMap<>();
    for (int i = 0; i < items.length; i += 2) {
      map.put(String.valueOf(items[i]), items[i + 1]);
    }
    return map;
  }

  private static Timestamp ts(Instant instant) {
    return Timestamp.from(instant);
  }
}
