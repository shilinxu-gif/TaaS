import { Prisma, type Provider } from "@prisma/client";
import { findCatalogEntry, inferProviderTypeFromModel } from "./providerCatalog.js";
import { callAnthropicProvider } from "./providers/anthropic.js";
import { callGoogleProvider } from "./providers/google.js";
import { callOpenAiProvider } from "./providers/openai.js";
import {
  ProviderCallError,
  type GatewayRequestBody,
  type ProviderCallSuccess,
} from "./providers/types.js";

export type RoutingMode = "cost" | "quality" | "balance";

type ProviderRow = Provider & {
  providerType: string;
  modelCatalog: Prisma.JsonValue;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  healthStatus: string;
};

export function estimatePromptTokens(messages: unknown): number {
  const len = JSON.stringify(messages ?? []).length;
  return Math.max(16, Math.min(12000, Math.ceil(len / 4)));
}

export function providerSupportsModel(provider: ProviderRow, model: string): boolean {
  if (model.trim().toLowerCase() === "gpt-fallback-demo") {
    return provider.providerType === "openai" || provider.providerType === "anthropic";
  }
  const raw = provider.modelCatalog;
  if (!Array.isArray(raw) || raw.length === 0) {
    const inferred = inferProviderTypeFromModel(model);
    return inferred === provider.providerType;
  }
  return raw.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return (
      typeof item.model === "string" &&
      item.model.toLowerCase() === model.trim().toLowerCase()
    );
  });
}

export function chooseCandidateProviders(
  providers: ProviderRow[],
  model: string,
  mode: RoutingMode
): ProviderRow[] {
  const candidates = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.status === "active" &&
      providerSupportsModel(provider, model)
  );
  const catalog = findCatalogEntry(model);
  const score = (provider: ProviderRow) => {
    const healthScore =
      provider.healthStatus === "healthy"
        ? 100
        : provider.healthStatus === "degraded"
          ? 75
          : 40;
    const priceScore = catalog
      ? 200 - Number(catalog.inputUsdPerMillion) - Number(catalog.outputUsdPerMillion)
      : 100;
    const priorityScore = Math.max(0, 100 - provider.priority);
    if (mode === "quality") return healthScore * 2 + priorityScore;
    if (mode === "cost") return priceScore * 2 + priorityScore;
    return healthScore + priceScore + priorityScore;
  };
  return [...candidates].sort((a, b) => score(b) - score(a));
}

export function usageFromCatalog(
  model: string,
  promptTokens: number,
  completionTokens: number
): {
  inputUnitPriceUsd: Prisma.Decimal;
  outputUnitPriceUsd: Prisma.Decimal;
  subtotalUsd: Prisma.Decimal;
} {
  const entry = findCatalogEntry(model);
  const inputUnitPriceUsd = new Prisma.Decimal(entry?.inputUsdPerMillion ?? "0");
  const outputUnitPriceUsd = new Prisma.Decimal(entry?.outputUsdPerMillion ?? "0");
  const subtotalUsd = new Prisma.Decimal(promptTokens)
    .div(1_000_000)
    .mul(inputUnitPriceUsd)
    .add(
      new Prisma.Decimal(completionTokens).div(1_000_000).mul(outputUnitPriceUsd)
    );
  return { inputUnitPriceUsd, outputUnitPriceUsd, subtotalUsd };
}

function normalizeOpenAiLikePayload(
  model: string,
  payload: Record<string, unknown>,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number
): Record<string, unknown> {
  if (Array.isArray(payload.choices)) {
    return payload;
  }
  const text =
    Array.isArray(payload.content)
      ? payload.content
          .map((item) =>
            item && typeof item === "object" && "text" in item
              ? String((item as Record<string, unknown>).text ?? "")
              : ""
          )
          .join("")
      : typeof payload.output_text === "string"
        ? payload.output_text
        : typeof payload.text === "string"
          ? payload.text
          : "";
  return {
    id: `chatcmpl-proxy-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
    upstream: payload,
  };
}

export async function executeGatewayCall(
  providers: ProviderRow[],
  model: string,
  requestBody: GatewayRequestBody & Record<string, unknown>,
  mode: RoutingMode
): Promise<{
  provider: ProviderRow;
  attempts: number;
  result: ProviderCallSuccess;
  responsePayload: Record<string, unknown>;
}> {
  const candidates = chooseCandidateProviders(providers, model, mode);
  if (candidates.length === 0) {
    throw new ProviderCallError(
      "No enabled provider can serve the requested model",
      503,
      "no_provider_for_model"
    );
  }

  const errors: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const provider = candidates[index]!;
    try {
      const result =
        provider.providerType === "openai"
          ? await callOpenAiProvider({ provider, model, body: requestBody })
          : provider.providerType === "anthropic"
            ? await callAnthropicProvider({ provider, model, body: requestBody })
            : provider.providerType === "google"
              ? await callGoogleProvider({ provider, model, body: requestBody })
              : (() => {
                  throw new ProviderCallError(
                    `Unsupported provider type: ${provider.providerType}`,
                    503,
                    "unsupported_provider_type"
                  );
                })();
      const promptTokens =
        result.promptTokens ?? estimatePromptTokens(requestBody.messages ?? []);
      const completionTokens = result.completionTokens ?? 256;
      const totalTokens = result.totalTokens ?? promptTokens + completionTokens;
      const responsePayload = normalizeOpenAiLikePayload(
        model,
        result.payload,
        promptTokens,
        completionTokens,
        totalTokens
      );
      return {
        provider,
        attempts: index + 1,
        result: {
          ...result,
          promptTokens,
          completionTokens,
          totalTokens,
        },
        responsePayload,
      };
    } catch (error) {
      const message =
        error instanceof ProviderCallError
          ? `${provider.slug}:${error.providerErrorCode ?? error.message}`
          : `${provider.slug}:unknown_error`;
      errors.push(message);
    }
  }
  throw new ProviderCallError(
    `All providers failed: ${errors.join(", ")}`,
    502,
    "all_providers_failed"
  );
}
