const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("crm_token");
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error(
      "无法连接后端（请确认已在本机启动 API：server 目录执行 npm run dev，端口 3001）"
    );
  }
  if (res.status === 401) {
    localStorage.removeItem("crm_token");
    window.dispatchEvent(new Event("crm:unauthorized"));
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    let msg: string;
    if (data && typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error: unknown }).error;
      msg = typeof e === "string" ? e : JSON.stringify(e);
    } else if (text && text.trim() && !text.trim().startsWith("{")) {
      msg = text.trim().slice(0, 280);
    } else {
      msg = res.statusText || `HTTP ${res.status}`;
    }
    const fromJson =
      data && typeof data === "object" && data !== null && "error" in data;
    if (
      !fromJson &&
      (res.status === 500 || res.status === 502 || res.status === 504)
    ) {
      msg = `${msg} · 请确认已启动 server（端口 3001）、PostgreSQL 可用，并已执行 prisma migrate deploy 与 prisma db seed。`;
    }
    throw new Error(msg);
  }
  return data as T;
}

/** 调用统一网关（使用 AppKey，不走 JWT） */
export async function gatewayChat(
  appKey: string,
  body: unknown,
  idempotencyKey?: string
): Promise<unknown> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${appKey}`);
  if (idempotencyKey?.trim()) {
    headers.set("Idempotency-Key", idempotencyKey.trim());
  }
  const res = await fetch("/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    let msg: string;
    if (data && typeof data === "object" && data !== null && "error" in data) {
      const e = (data as { error: unknown }).error;
      msg = typeof e === "string" ? e : JSON.stringify(e);
    } else {
      msg = res.statusText || `HTTP ${res.status}`;
    }
    throw new Error(msg);
  }
  return data;
}

export type User = { id: string; email: string; name: string };

export type MeUser = User & {
  tenant?: {
    id: string;
    name: string;
    slug: string;
    balanceTokens: string;
    plan: { name: string; code: string } | null;
  } | null;
};

export type DashboardSummary = {
  tenant: {
    name: string;
    slug: string;
    balanceTokens: string;
    plan: { name: string; code: string } | null;
  };
  kpis: {
    requests24h: number;
    tokens24h: number;
    spendUsd24h: string;
    cacheHitRate: number;
  };
  today: {
    spendUsd: string;
    tokens: number;
    cacheSavingsUsd: string;
  };
  tenantsOverview: { name: string; slug: string; requests24h: number }[];
  chartSeries7d: { date: string; tokens: number }[];
  modelMix7d: { model: string; tokens: number }[];
  risks: { level: "info" | "warning" | "critical"; title: string; detail: string }[];
};

/** AppKey 列表项（不含完整密钥） */
export type AppKeyListRow = {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  tenantName: string;
  status: string;
  qpsLimit: number | null;
  dailyBudgetUsd: string | null;
  allowedModels: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

/** 创建成功后返回完整 token（仅此次展示） */
export type AppKeyCreateResponse = Omit<AppKeyListRow, "keyPrefix"> & {
  token: string;
};

/** @deprecated 使用 AppKeyListRow */
export type AppKeyRow = AppKeyListRow;

/** 用量明细（按请求日志，含计费） */
export type UsageRow = {
  id: string;
  createdAt: string;
  period: string;
  tenantName: string;
  appKey: { id: string; name: string };
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: string;
  currency: string;
  billingType: string | null;
  billingDescription: string | null;
  cacheHit: boolean;
  provider: { name: string; slug: string };
  latencyMs: number;
  statusCode: number;
  routingPrimary: string | null;
  routingActual: string | null;
  routingReason: string | null;
  idempotencyKey: string | null;
};

export type BillingRow = {
  id: string;
  amountUsd: string;
  currency: string;
  type: string;
  description: string;
  createdAt: string;
  model: string;
  cacheHit: boolean;
};

export type BillingPlanDto = {
  id: string;
  name: string;
  code: string;
  monthlyTokenQuota: number;
  pricePerMillionTokens: string;
  description: string | null;
};

export type BillingRecordRow = {
  id: string;
  createdAt: string;
  type: string;
  typeLabel: string;
  amountUsd: string;
  currency: string;
  status: string;
  description: string;
  model: string;
};

export type BillingOverview = {
  summary: {
    totalSpendUsd: string;
    remainingBalanceTokens: string;
    currentMonthUsageTokens: number;
    estimatedSavingUsd: string;
    currency: string;
  };
  currentPlan: BillingPlanDto | null;
  plans: BillingPlanDto[];
  records: BillingRecordRow[];
};

export type LogRow = {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  cacheHit: boolean;
  routingPrimary: string | null;
  routingActual: string | null;
  routingReason: string | null;
  statusCode: number;
  createdAt: string;
  provider: { name: string; slug: string };
  appKey: { name: string };
};

export type RoutingStrategyMode = "cost" | "quality" | "balance";

export type RoutingFallbackChain = {
  id: string;
  title: string;
  description: string;
  models: string[];
};

export type RoutingProviderRow = {
  providerSlug: string;
  providerName: string;
  model: string;
  priority: number;
  costScore: number;
  latencyMs: number;
  successRate: number;
  status: "active" | "degraded" | "readonly";
};

export type RoutingSummary = {
  windowDays: number;
  strategyMode: RoutingStrategyMode;
  strategyNote: string;
  fallbackChains: RoutingFallbackChain[];
  providerPriority: RoutingProviderRow[];
  routes: {
    actualSlug: string;
    count: number;
    samplePrimary: string | null;
    sampleReason: string | null;
  }[];
  recentFallbacks: {
    model: string;
    routingPrimary: string | null;
    routingActual: string | null;
    routingReason: string | null;
    createdAt: string;
  }[];
};

export type OptimizationRepeatedPrompt = {
  id: string;
  preview: string;
  hits: number;
  savedTokens: number;
  source: "idempotency" | "demo";
};

export type OptimizationPromptTemplate = {
  id: string;
  name: string;
  description: string;
  snippet: string;
  uses: number;
  savedUsd: string;
};

export type OptimizationSummary = {
  windowDays: number;
  /** 0–100，一位小数 */
  cacheHitRate: number;
  savedTokens: number;
  estimatedSavedUsd: string;
  cacheHits: number;
  nonCacheRequests: number;
  note: string;
  valueLine: string;
  topRepeatedPrompts: OptimizationRepeatedPrompt[];
  promptTemplates: OptimizationPromptTemplate[];
};

export type CacheStrategySettings = {
  enabled: boolean;
  mode: "exact" | "semantic" | "hybrid";
  similarityThreshold: number;
  ttlSeconds: number;
};

/* —— 在线充值 / 自动化开票（演示） —— */

export type RechargeBankAccount = {
  companyName: string;
  bankName: string;
  accountNo: string;
  accountName: string;
};

export type RechargeSummary = {
  balanceTokens: string;
  pendingCount: number;
  monthRechargeCny: string;
  monthRechargeNote: string;
  note: string;
  bankAccount: RechargeBankAccount;
  recommendedChannels: string[];
};

export type RechargePayChannel =
  | "bank_transfer"
  | "wechat"
  | "alipay"
  | "apple_pay"
  | "google_pay";

export type RechargeOrderRow = {
  id: string;
  orderNo: string;
  amount: string;
  currency: string;
  amountDisplay: string;
  tenantName: string;
  payChannel: string;
  payChannelLabel: string;
  status: string;
  statusLabel: string;
  creditedTokens: string;
  payerName: string | null;
  needInvoice: boolean;
  remark: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type RechargeCreateResponse = RechargeOrderRow & {
  hint?: string;
  flow?: "bank" | "qr" | "intl_success";
  bankAccount?: RechargeBankAccount;
};

export type InvoiceSummary = {
  pendingCount: number;
  issuedThisMonth: number;
  issuedAmountMonthCny: string;
  note: string;
};

export type InvoiceRequestRow = {
  id: string;
  requestNo: string;
  titleType: string;
  titleTypeLabel: string;
  invoiceType: string;
  invoiceTypeLabel: string;
  buyerName: string;
  buyerTaxNo: string;
  amountCny: string;
  email: string;
  status: string;
  statusLabel: string;
  invoiceNo: string | null;
  invoiceCode: string | null;
  pdfUrl: string | null;
  rejectReason: string | null;
  issuedAt: string | null;
  createdAt: string;
};

export type InvoiceRequestDetail = InvoiceRequestRow & {
  buyerAddressPhone: string | null;
  buyerBankAccount: string | null;
  updatedAt: string;
};
