import type { Provider } from "@prisma/client";

export type ChatMessageInput = {
  role: string;
  content: string | null | unknown[];
};

export type GatewayRequestBody = {
  model?: string;
  messages?: ChatMessageInput[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
};

export type ProviderCallInput = {
  provider: Provider & {
    providerType: string;
    apiKeyCiphertext: string | null;
    timeoutMs: number;
  };
  model: string;
  body: GatewayRequestBody & Record<string, unknown>;
};

export type ProviderCallSuccess = {
  upstreamStatusCode: number;
  requestId: string | null;
  providerErrorCode: string | null;
  payload: Record<string, unknown>;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export class ProviderCallError extends Error {
  statusCode: number;
  providerErrorCode: string | null;

  constructor(message: string, statusCode: number, providerErrorCode: string | null) {
    super(message);
    this.statusCode = statusCode;
    this.providerErrorCode = providerErrorCode;
  }
}
