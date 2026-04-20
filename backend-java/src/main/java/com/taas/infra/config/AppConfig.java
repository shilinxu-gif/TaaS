package com.taas.infra.config;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(TaasProperties.class)
public class AppConfig {
  private final TaasProperties properties;

  public AppConfig(TaasProperties properties) {
    this.properties = properties;
  }

  @PostConstruct
  void validateRequiredSecrets() {
    requireConfigured("JWT_SECRET", properties.getAuth().getJwtSecret());
    requireConfigured("PROVIDER_CONFIG_SECRET", properties.getSecurity().getProviderConfigSecret());
    requireConfigured("APP_KEY_PEPPER", properties.getSecurity().getAppKeyPepper());

    boolean hasBootstrapLogin = hasText(properties.getBootstrap().getAdminLogin());
    boolean hasBootstrapPassword = hasText(properties.getBootstrap().getAdminPassword());
    if (hasBootstrapLogin != hasBootstrapPassword) {
      throw new IllegalStateException(
          "BOOTSTRAP_ADMIN_LOGIN and BOOTSTRAP_ADMIN_PASSWORD must be set together");
    }
  }

  private static void requireConfigured(String key, String value) {
    if (!hasText(value)) {
      throw new IllegalStateException(key + " must be provided via environment variable");
    }
  }

  private static boolean hasText(String value) {
    return value != null && !value.isBlank();
  }
}
