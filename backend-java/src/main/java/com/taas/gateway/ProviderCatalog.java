package com.taas.gateway;

import java.math.BigDecimal;
import java.util.List;

public final class ProviderCatalog {
  private ProviderCatalog() {
  }

  public static final List<Entry> ENTRIES =
      List.of(
          new Entry("gpt-4.1-mini", "openai", new BigDecimal("0.40"), new BigDecimal("1.60"), true),
          new Entry("gpt-4o-mini", "openai", new BigDecimal("0.15"), new BigDecimal("0.60"), true),
          new Entry("gpt-4o", "openai", new BigDecimal("2.50"), new BigDecimal("10.00"), true),
          new Entry("claude-3-5-sonnet-latest", "anthropic", new BigDecimal("3.00"), new BigDecimal("15.00"), true),
          new Entry("claude-3-5-haiku-latest", "anthropic", new BigDecimal("0.80"), new BigDecimal("4.00"), true),
          new Entry("claude-3-haiku", "anthropic", new BigDecimal("0.25"), new BigDecimal("1.25"), true),
          new Entry("gemini-1.5-pro", "google", new BigDecimal("3.50"), new BigDecimal("10.50"), true),
          new Entry("gemini-1.5-flash", "google", new BigDecimal("0.35"), new BigDecimal("0.70"), true));

  public static Entry find(String model) {
    String normalized = normalizeModel(model);
    return ENTRIES.stream().filter(entry -> entry.model().equalsIgnoreCase(normalized)).findFirst().orElse(null);
  }

  public static String inferProviderType(String model) {
    String normalized = normalizeModel(model).toLowerCase();
    if (normalized.startsWith("gpt-")) return "openai";
    if (normalized.startsWith("claude")) return "anthropic";
    if (normalized.startsWith("gemini")) return "google";
    return null;
  }

  private static String normalizeModel(String model) {
    return model;
  }

  public record Entry(
      String model,
      String providerType,
      BigDecimal inputUsdPerMillion,
      BigDecimal outputUsdPerMillion,
      boolean supportsStreaming) {
  }
}
