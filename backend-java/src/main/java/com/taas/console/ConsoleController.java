package com.taas.console;

import com.taas.auth.JwtPrincipal;
import com.taas.auth.RequestContext;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ConsoleController {
  private final ConsoleService consoleService;
  private final FinanceService financeService;

  public ConsoleController(ConsoleService consoleService, FinanceService financeService) {
    this.consoleService = consoleService;
    this.financeService = financeService;
  }

  @GetMapping("/dashboard/summary")
  public Map<String, Object> dashboardSummary() {
    return consoleService.dashboardSummary(principal());
  }

  @GetMapping("/app-keys")
  public List<Map<String, Object>> appKeys() {
    return consoleService.listAppKeys(principal());
  }

  @GetMapping("/app-keys/available-models")
  public List<Map<String, Object>> availableAppKeyModels() {
    return consoleService.availableAppKeyModels(principal());
  }

  @GetMapping("/model-catalog")
  public List<Map<String, Object>> modelCatalog() {
    return consoleService.modelCatalog(principal());
  }

  @PostMapping("/app-keys")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> createAppKey(
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.createAppKey(principal(), body, clientIp(forwardedFor));
  }

  @PatchMapping("/app-keys/{id}")
  public Map<String, Object> updateAppKey(
      @PathVariable String id,
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.updateAppKey(principal(), id, body, clientIp(forwardedFor));
  }

  @PatchMapping("/app-keys/{id}/revoke")
  public Map<String, Object> revokeAppKey(
      @PathVariable String id,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.revokeAppKey(principal(), id, clientIp(forwardedFor));
  }

  @DeleteMapping("/app-keys/{id}")
  public Map<String, Object> deleteAppKey(
      @PathVariable String id,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.deleteAppKey(principal(), id, clientIp(forwardedFor));
  }

  @GetMapping("/usage")
  public List<Map<String, Object>> usage() {
    return consoleService.usage(principal());
  }

  @GetMapping("/logs")
  public List<Map<String, Object>> logs() {
    return consoleService.logs(principal());
  }

  @GetMapping("/billing/overview")
  public Map<String, Object> billingOverview() {
    return consoleService.billingOverview(principal());
  }

  @GetMapping("/billing")
  public List<Map<String, Object>> billing() {
    return consoleService.billing(principal());
  }

  @GetMapping("/finance/recharges/summary")
  public Map<String, Object> rechargeSummary() {
    return financeService.rechargeSummary(principal());
  }

  @GetMapping("/finance/recharges")
  public List<Map<String, Object>> recharges() {
    return financeService.recharges(principal());
  }

  @PostMapping("/finance/recharges")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> createRecharge(@RequestBody Map<String, Object> body) {
    return financeService.createRecharge(principal(), body);
  }

  @GetMapping("/finance/invoices/summary")
  public Map<String, Object> invoiceSummary() {
    return financeService.invoiceSummary(principal());
  }

  @GetMapping("/finance/invoices")
  public List<Map<String, Object>> invoices() {
    return financeService.invoices(principal());
  }

  @GetMapping("/finance/invoices/{id}")
  public Map<String, Object> invoiceDetail(@PathVariable String id) {
    return financeService.invoiceDetail(principal(), id);
  }

  @PostMapping("/finance/invoices")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> createInvoice(@RequestBody Map<String, Object> body) {
    return financeService.createInvoice(principal(), body);
  }

  @GetMapping("/routing/summary")
  public Map<String, Object> routingSummary() {
    return consoleService.routingSummary(principal());
  }

  @PatchMapping("/routing/strategy")
  public Map<String, Object> updateRouting(
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.updateRouting(principal(), body, clientIp(forwardedFor));
  }

  @GetMapping("/optimization/summary")
  public Map<String, Object> optimizationSummary() {
    return consoleService.optimizationSummary(principal());
  }

  @GetMapping("/optimization/cache-settings")
  public Map<String, Object> cacheSettings() {
    return consoleService.getCacheSettings(principal());
  }

  @PatchMapping("/optimization/cache-settings")
  public Map<String, Object> updateCacheSettings(
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.updateCacheSettings(principal(), body, clientIp(forwardedFor));
  }

  @GetMapping("/providers")
  public List<Map<String, Object>> providers() {
    return consoleService.providers(principal());
  }

  @PostMapping("/providers")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> createProvider(
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.createProvider(principal(), body, clientIp(forwardedFor));
  }

  @GetMapping("/admin/users")
  public List<Map<String, Object>> adminUsers() {
    return consoleService.adminUsers(principal());
  }

  @PostMapping("/admin/users")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> createAdminUser(
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.createAdminUser(principal(), body, clientIp(forwardedFor));
  }

  @GetMapping("/admin/users/tenant-options")
  public List<Map<String, Object>> adminUserTenantOptions() {
    return consoleService.adminUserTenantOptions(principal());
  }

  @GetMapping("/admin/users/available-models")
  public List<Map<String, Object>> adminUserAvailableModels() {
    return consoleService.adminUserAvailableModels(principal());
  }

  @PatchMapping("/admin/users/{userId}/tenants/{tenantId}/allowed-models")
  public Map<String, Object> updateAdminUserAllowedModels(
      @PathVariable String userId,
      @PathVariable String tenantId,
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.updateAdminUserAllowedModels(
        principal(), userId, tenantId, body, clientIp(forwardedFor));
  }

  @PatchMapping("/admin/users/tenants/{tenantId}/token-balance")
  public Map<String, Object> updateAdminTenantTokenBalance(
      @PathVariable String tenantId,
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.updateAdminTenantTokenBalance(
        principal(), tenantId, body, clientIp(forwardedFor));
  }

  @GetMapping("/admin/usage-overview")
  public Map<String, Object> adminUsageOverview(
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) String dimension) {
    return consoleService.adminUsageOverview(principal(), from, to, dimension);
  }

  @PatchMapping("/providers/{id}")
  public Map<String, Object> updateProvider(
      @PathVariable String id,
      @RequestBody Map<String, Object> body,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.updateProvider(principal(), id, body, clientIp(forwardedFor));
  }

  @DeleteMapping("/providers/{id}")
  public Map<String, Object> deleteProvider(
      @PathVariable String id,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return consoleService.deleteProvider(principal(), id, clientIp(forwardedFor));
  }

  @GetMapping("/ops/overview")
  public Map<String, Object> opsOverview() {
    return consoleService.opsOverview(principal());
  }

  @GetMapping("/ops/audit-logs")
  public List<Map<String, Object>> auditLogs() {
    return consoleService.auditLogs(principal());
  }

  private JwtPrincipal principal() {
    return RequestContext.getRequired();
  }

  private String clientIp(String forwardedFor) {
    if (forwardedFor == null || forwardedFor.isBlank()) {
      return "127.0.0.1";
    }
    return forwardedFor.split(",")[0].trim();
  }
}
