import { decryptSecret } from "../crypto.js";
import {
  ProviderCallError,
  type ChatMessageInput,
  type ProviderCallInput,
  type ProviderCallSuccess,
} from "./types.js";

function resolveGoogleBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function mapMessagesToGoogle(messages: ChatMessageInput[]) {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? JSON.stringify(msg.content)
            : "";
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text }],
      };
    });
}

export async function callGoogleProvider(
  input: ProviderCallInput
): Promise<ProviderCallSuccess> {
  const apiKey = decryptSecret(input.provider.apiKeyCiphertext);
  if (!apiKey) {
    throw new ProviderCallError("Provider is not configured", 503, "provider_not_configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.provider.timeoutMs || 30000);
  try {
    const endpoint = `${resolveGoogleBaseUrl(input.provider.baseUrl)}/models/${encodeURIComponent(
      input.model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: mapMessagesToGoogle(input.body.messages ?? []),
        generationConfig: {
          temperature: input.body.temperature,
          maxOutputTokens:
            typeof input.body.max_completion_tokens === "number"
              ? input.body.max_completion_tokens
              : typeof input.body.max_tokens === "number"
                ? input.body.max_tokens
                : 512,
        },
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) {
      const error =
        json && typeof json.error === "object" && json.error !== null
          ? (json.error as Record<string, unknown>)
          : null;
      const message =
        error && typeof error.message === "string"
          ? error.message
          : `Google request failed (${res.status})`;
      const errorCode = error && typeof error.status === "string" ? error.status : null;
      throw new ProviderCallError(message, res.status || 502, errorCode);
    }
    const usage =
      typeof json.usageMetadata === "object" && json.usageMetadata !== null
        ? (json.usageMetadata as Record<string, unknown>)
        : null;
    return {
      upstreamStatusCode: res.status,
      requestId: res.headers.get("x-request-id"),
      providerErrorCode: null,
      payload: json,
      promptTokens:
        usage && typeof usage.promptTokenCount === "number"
          ? usage.promptTokenCount
          : null,
      completionTokens:
        usage && typeof usage.candidatesTokenCount === "number"
          ? usage.candidatesTokenCount
          : null,
      totalTokens:
        usage && typeof usage.totalTokenCount === "number"
          ? usage.totalTokenCount
          : null,
    };
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderCallError("Google request timed out", 504, "timeout");
    }
    throw new ProviderCallError(
      error instanceof Error ? error.message : "Google request failed",
      502,
      "network_error"
    );
  } finally {
    clearTimeout(timeout);
  }
}
