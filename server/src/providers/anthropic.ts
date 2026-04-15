import { decryptSecret } from "../crypto.js";
import {
  ProviderCallError,
  type ChatMessageInput,
  type ProviderCallInput,
  type ProviderCallSuccess,
} from "./types.js";

function resolveAnthropicBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

function mapMessagesToAnthropic(messages: ChatMessageInput[]) {
  const systemChunks: string[] = [];
  const result: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of messages) {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? JSON.stringify(msg.content)
          : "";
    if (!text.trim()) continue;
    if (msg.role === "system") {
      systemChunks.push(text);
      continue;
    }
    result.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: text,
    });
  }
  return {
    system: systemChunks.join("\n\n").trim() || undefined,
    messages: result,
  };
}

export async function callAnthropicProvider(
  input: ProviderCallInput
): Promise<ProviderCallSuccess> {
  const apiKey = decryptSecret(input.provider.apiKeyCiphertext);
  if (!apiKey) {
    throw new ProviderCallError("Provider is not configured", 503, "provider_not_configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.provider.timeoutMs || 30000);
  try {
    const normalized = mapMessagesToAnthropic(input.body.messages ?? []);
    const res = await fetch(`${resolveAnthropicBaseUrl(input.provider.baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.model,
        system: normalized.system,
        messages: normalized.messages,
        max_tokens:
          typeof input.body.max_completion_tokens === "number"
            ? input.body.max_completion_tokens
            : typeof input.body.max_tokens === "number"
              ? input.body.max_tokens
              : 512,
        temperature: input.body.temperature,
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
          : `Anthropic request failed (${res.status})`;
      const errorCode = error && typeof error.type === "string" ? error.type : null;
      throw new ProviderCallError(message, res.status || 502, errorCode);
    }
    const usage =
      typeof json.usage === "object" && json.usage !== null
        ? (json.usage as Record<string, unknown>)
        : null;
    return {
      upstreamStatusCode: res.status,
      requestId: res.headers.get("request-id"),
      providerErrorCode: null,
      payload: json,
      promptTokens:
        usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      completionTokens:
        usage && typeof usage.output_tokens === "number" ? usage.output_tokens : null,
      totalTokens:
        usage &&
        typeof usage.input_tokens === "number" &&
        typeof usage.output_tokens === "number"
          ? usage.input_tokens + usage.output_tokens
          : null,
    };
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderCallError("Anthropic request timed out", 504, "timeout");
    }
    throw new ProviderCallError(
      error instanceof Error ? error.message : "Anthropic request failed",
      502,
      "network_error"
    );
  } finally {
    clearTimeout(timeout);
  }
}
