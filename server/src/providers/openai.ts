import { decryptSecret } from "../crypto.js";
import {
  ProviderCallError,
  type ProviderCallInput,
  type ProviderCallSuccess,
} from "./types.js";

function resolveOpenAiBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export async function callOpenAiProvider(
  input: ProviderCallInput
): Promise<ProviderCallSuccess> {
  const apiKey = decryptSecret(input.provider.apiKeyCiphertext);
  if (!apiKey) {
    throw new ProviderCallError("Provider is not configured", 503, "provider_not_configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.provider.timeoutMs || 30000);
  try {
    const res = await fetch(`${resolveOpenAiBaseUrl(input.provider.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...input.body,
        model: input.model,
        stream: false,
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) {
      const errorCode =
        json && typeof json.error === "object" && json.error !== null && "code" in json.error
          ? String((json.error as Record<string, unknown>).code ?? "")
          : null;
      const message =
        json && typeof json.error === "object" && json.error !== null && "message" in json.error
          ? String((json.error as Record<string, unknown>).message ?? "OpenAI request failed")
          : `OpenAI request failed (${res.status})`;
      throw new ProviderCallError(message, res.status || 502, errorCode);
    }
    const usage =
      typeof json.usage === "object" && json.usage !== null
        ? (json.usage as Record<string, unknown>)
        : null;
    const headers = res.headers;
    return {
      upstreamStatusCode: res.status,
      requestId: headers.get("x-request-id"),
      providerErrorCode: null,
      payload: json,
      promptTokens:
        usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completionTokens:
        usage && typeof usage.completion_tokens === "number"
          ? usage.completion_tokens
          : null,
      totalTokens:
        usage && typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    };
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderCallError("OpenAI request timed out", 504, "timeout");
    }
    throw new ProviderCallError(
      error instanceof Error ? error.message : "OpenAI request failed",
      502,
      "network_error"
    );
  } finally {
    clearTimeout(timeout);
  }
}
