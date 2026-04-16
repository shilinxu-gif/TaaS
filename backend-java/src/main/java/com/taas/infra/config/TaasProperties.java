package com.taas.infra.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "taas")
public class TaasProperties {
  private final Auth auth = new Auth();
  private final Security security = new Security();
  private final Commercial commercial = new Commercial();
  private final Providers providers = new Providers();

  public Auth getAuth() {
    return auth;
  }

  public Security getSecurity() {
    return security;
  }

  public Commercial getCommercial() {
    return commercial;
  }

  public Providers getProviders() {
    return providers;
  }

  public static class Auth {
    private String jwtSecret = "dev-only-change-me";
    private String issuer = "taas-java";
    private long expireSeconds = 604800;

    public String getJwtSecret() {
      return jwtSecret;
    }

    public void setJwtSecret(String jwtSecret) {
      this.jwtSecret = jwtSecret;
    }

    public String getIssuer() {
      return issuer;
    }

    public void setIssuer(String issuer) {
      this.issuer = issuer;
    }

    public long getExpireSeconds() {
      return expireSeconds;
    }

    public void setExpireSeconds(long expireSeconds) {
      this.expireSeconds = expireSeconds;
    }
  }

  public static class Security {
    private String providerConfigSecret = "dev-provider-config-secret";
    private String appKeyPepper = "dev-app-key-pepper";

    public String getProviderConfigSecret() {
      return providerConfigSecret;
    }

    public void setProviderConfigSecret(String providerConfigSecret) {
      this.providerConfigSecret = providerConfigSecret;
    }

    public String getAppKeyPepper() {
      return appKeyPepper;
    }

    public void setAppKeyPepper(String appKeyPepper) {
      this.appKeyPepper = appKeyPepper;
    }
  }

  public static class Commercial {
    private String salesEmail = "sales@taas.example";
    private String supportEmail = "support@taas.example";
    private int trialDays = 14;
    private boolean allowMockProvider = true;

    public String getSalesEmail() {
      return salesEmail;
    }

    public void setSalesEmail(String salesEmail) {
      this.salesEmail = salesEmail;
    }

    public String getSupportEmail() {
      return supportEmail;
    }

    public void setSupportEmail(String supportEmail) {
      this.supportEmail = supportEmail;
    }

    public int getTrialDays() {
      return trialDays;
    }

    public void setTrialDays(int trialDays) {
      this.trialDays = trialDays;
    }

    public boolean isAllowMockProvider() {
      return allowMockProvider;
    }

    public void setAllowMockProvider(boolean allowMockProvider) {
      this.allowMockProvider = allowMockProvider;
    }
  }

  public static class Providers {
    private String openaiApiKey = "";
    private String anthropicApiKey = "";
    private String googleApiKey = "";

    public String getOpenaiApiKey() {
      return openaiApiKey;
    }

    public void setOpenaiApiKey(String openaiApiKey) {
      this.openaiApiKey = openaiApiKey;
    }

    public String getAnthropicApiKey() {
      return anthropicApiKey;
    }

    public void setAnthropicApiKey(String anthropicApiKey) {
      this.anthropicApiKey = anthropicApiKey;
    }

    public String getGoogleApiKey() {
      return googleApiKey;
    }

    public void setGoogleApiKey(String googleApiKey) {
      this.googleApiKey = googleApiKey;
    }
  }
}
