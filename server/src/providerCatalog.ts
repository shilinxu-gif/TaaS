type ProviderType = "openai" | "anthropic" | "google";

export type ProviderCatalogEntry = {
  model: string;
  providerType: ProviderType;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  supportsStreaming: boolean;
};

const CATALOG: ProviderCatalogEntry[] = [
  {
    model: "gpt-4.1-mini",
    providerType: "openai",
    inputUsdPerMillion: "0.40",
    outputUsdPerMillion: "1.60",
    supportsStreaming: true,
  },
  {
    model: "gpt-4o-mini",
    providerType: "openai",
    inputUsdPerMillion: "0.15",
    outputUsdPerMillion: "0.60",
    supportsStreaming: true,
  },
  {
    model: "gpt-4o",
    providerType: "openai",
    inputUsdPerMillion: "2.50",
    outputUsdPerMillion: "10.00",
    supportsStreaming: true,
  },
  {
    model: "claude-3-5-sonnet-latest",
    providerType: "anthropic",
    inputUsdPerMillion: "3.00",
    outputUsdPerMillion: "15.00",
    supportsStreaming: true,
  },
  {
    model: "claude-3-5-haiku-latest",
    providerType: "anthropic",
    inputUsdPerMillion: "0.80",
    outputUsdPerMillion: "4.00",
    supportsStreaming: true,
  },
  {
    model: "claude-3-haiku",
    providerType: "anthropic",
    inputUsdPerMillion: "0.25",
    outputUsdPerMillion: "1.25",
    supportsStreaming: true,
  },
  {
    model: "gemini-1.5-pro",
    providerType: "google",
    inputUsdPerMillion: "3.50",
    outputUsdPerMillion: "10.50",
    supportsStreaming: true,
  },
  {
    model: "gemini-1.5-flash",
    providerType: "google",
    inputUsdPerMillion: "0.35",
    outputUsdPerMillion: "0.70",
    supportsStreaming: true,
  },
];

export function defaultCatalogForProvider(type: ProviderType): ProviderCatalogEntry[] {
  return CATALOG.filter((entry) => entry.providerType === type);
}

export function findCatalogEntry(model: string): ProviderCatalogEntry | null {
  const normalized = model.trim().toLowerCase();
  if (normalized === "gpt-fallback-demo") {
    return findCatalogEntry("gpt-4o-mini");
  }
  return (
    CATALOG.find((entry) => entry.model.toLowerCase() === normalized) ?? null
  );
}

export function inferProviderTypeFromModel(model: string): ProviderType | null {
  const normalized = model.trim().toLowerCase();
  if (normalized === "gpt-fallback-demo") return "openai";
  if (normalized.startsWith("gpt-")) return "openai";
  if (normalized.startsWith("claude")) return "anthropic";
  if (normalized.startsWith("gemini")) return "google";
  return null;
}
