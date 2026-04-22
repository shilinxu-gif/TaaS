package com.taas.infra.i18n;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.context.MessageSource;
import org.springframework.context.NoSuchMessageException;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Component;

@Component
public class ApiMessageResolver {
  private static final Map<String, String> DIRECT_KEYS = directKeys();
  private static final Pattern REQUIRED_PATTERN = Pattern.compile("^(.+) is required$");
  private static final Pattern INVALID_PATTERN = Pattern.compile("^(.+) is invalid$");
  private static final Pattern TIMEOUT_PATTERN = Pattern.compile("^(.+) request timed out$");
  private static final Pattern UNAVAILABLE_MODEL_PATTERN =
      Pattern.compile("^allowedModels contains unavailable model: (.+)$");

  private final MessageSource messageSource;

  public ApiMessageResolver(MessageSource messageSource) {
    this.messageSource = messageSource;
  }

  public String get(String key, Object... args) {
    return messageSource.getMessage(key, args, key, currentLocale());
  }

  public String resolve(String message, String code) {
    if (code != null && !code.isBlank()) {
      String codeKey = "error.code." + code;
      if (hasMessage(codeKey)) {
        return get(codeKey);
      }
    }
    if (message == null || message.isBlank()) {
      return get("error.unexpected");
    }

    String directKey = DIRECT_KEYS.get(message);
    if (directKey != null) {
      return get(directKey);
    }

    Matcher required = REQUIRED_PATTERN.matcher(message);
    if (required.matches()) {
      return get("error.fieldRequired", required.group(1));
    }

    Matcher invalid = INVALID_PATTERN.matcher(message);
    if (invalid.matches()) {
      return get("error.fieldInvalid", invalid.group(1));
    }

    Matcher timeout = TIMEOUT_PATTERN.matcher(message);
    if (timeout.matches()) {
      return get("error.providerTimedOut", timeout.group(1));
    }

    Matcher unavailableModel = UNAVAILABLE_MODEL_PATTERN.matcher(message);
    if (unavailableModel.matches()) {
      return get("error.allowedModelsContainsUnavailable", unavailableModel.group(1));
    }

    return message;
  }

  private boolean hasMessage(String key) {
    try {
      messageSource.getMessage(key, null, currentLocale());
      return true;
    } catch (NoSuchMessageException ignored) {
      return false;
    }
  }

  private Locale currentLocale() {
    return LocaleContextHolder.getLocale();
  }

  private static Map<String, String> directKeys() {
    LinkedHashMap<String, String> mapping = new LinkedHashMap<>();
    mapping.put("Unauthorized", "error.unauthorized");
    mapping.put(
        "Use JWT for console API; AppKey is only for POST /v1/chat/completions or POST /v1/messages",
        "error.consoleJwtRequired");
    mapping.put("参数无效", "error.invalidArguments");
    mapping.put("生产模式下已禁用模拟充值动作，请通过真实支付回调或财务流程更新订单状态", "error.rechargeSimulationDisabled");
    mapping.put("记录不存在", "error.recordNotFound");
    mapping.put("生产模式下已禁用模拟开票动作，请通过真实开票系统或后台流程推进状态", "error.invoiceSimulationDisabled");
    mapping.put("订单不存在", "error.orderNotFound");
    mapping.put("Email already registered", "error.emailRegistered");
    mapping.put("Invalid credentials", "error.invalidCredentials");
    mapping.put("No tenant membership", "error.noTenantMembership");
    mapping.put("Not found", "error.notFound");
    mapping.put("name is required", "error.nameRequired");
    mapping.put("Failed to create app key", "error.appKeyCreateFailed");
    mapping.put("已撤销的密钥无法切换启用状态", "error.revokedKeyImmutable");
    mapping.put("未提供可更新字段", "error.noUpdatableFields");
    mapping.put("mode is invalid", "error.modeInvalid");
    mapping.put("Provider not found", "error.providerNotFound");
    mapping.put("该供应商已有历史调用记录，不能删除；如需停用请改为禁用", "error.providerHasHistory");
    mapping.put("from must be earlier than or equal to to", "error.fromMustNotExceedTo");
    mapping.put("dimension is invalid", "error.dimensionInvalid");
    mapping.put("Forbidden", "error.forbidden");
    mapping.put("Tenant not found", "error.tenantNotFound");
    mapping.put("enabled is required", "error.enabledRequired");
    mapping.put("Missing Bearer AppKey", "error.missingBearerAppKey");
    mapping.put("Missing AppKey", "error.missingAppKey");
    mapping.put(
        "This AppKey does not have chat:complete scope",
        "error.missingChatCompleteScope");
    mapping.put("Invalid or revoked AppKey", "error.invalidOrRevokedAppKey");
    mapping.put("AppKey daily budget exceeded", "error.appKeyDailyBudgetExceeded");
    mapping.put("AppKey monthly budget exceeded", "error.appKeyMonthlyBudgetExceeded");
    mapping.put("Tenant monthly budget exceeded", "error.tenantMonthlyBudgetExceeded");
    mapping.put("Provider is not configured", "error.providerNotConfigured");
    mapping.put("login or email required", "error.loginOrEmailRequired");
    return mapping;
  }
}
