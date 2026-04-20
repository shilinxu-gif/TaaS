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
      "无法连接后端（请确认已启动 Java API：根目录执行 npm run dev:server，默认端口 3001）"
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
      msg = `${msg} · 请确认 Java API 已启动（端口 3001），且 PostgreSQL / Redis 可用。`;
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

export type User = {
  id: string;
  email: string;
  name: string;
  platformRole?: string;
};

export type MeUser = User & {
  role?: string;
  platformRole?: string;
  emailVerifiedAt?: string | null;
  tenant?: {
    id: string;
    name: string;
    slug: string;
    status: string;
    balanceTokens: string;
    trialEndsAt?: string | null;
    billingEmail?: string | null;
    contactSalesEmail?: string | null;
    monthlyBudgetUsd?: string | null;
    spendCapEnforced?: boolean;
    contractCode?: string | null;
    plan: { name: string; code: string } | null;
  } | null;
};

export type Account = {
  id: string;
  name: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  account: {
    id?: string;
    name: string;
  };
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  qq: string | null;
  age: number | null;
};

export type Lead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
};

export type Opportunity = {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  lossReason?: string | null;
  account: {
    id: string;
    name: string;
  } | null;
};

export type Activity = {
  id: string;
  type: string;
  body: string;
  occurredAt: string;
  nextFollowUpAt: string | null;
};

export type DashboardSummary = {
  tenant: {
    name: string;
    slug: string;
    status: string;
    balanceTokens: string;
    trialEndsAt?: string | null;
    trialDaysRemaining?: number | null;
    billingEmail?: string | null;
    contactSalesEmail?: string | null;
    monthlyBudgetUsd?: string | null;
    plan: { name: string; code: string } | null;
  };
  kpis: {
    requests24h: number;
    tokens24h: number;
    spendUsd24h: string;
    cacheHitRate: number;
    averageLatencyMs: number;
    customerSuccessRate: number;
    providerSuccessRate: number;
    failedRequests24h: number;
  };
  today: {
    spendUsd: string;
    tokens: number;
    cacheSavingsUsd: string;
  };
  tenantsOverview: { name: string; slug: string; requests24h: number }[];
  chartSeries7d: { date: string; tokens: number }[];
  modelMix7d: { model: string; tokens: number }[];
  serviceTargets?: { latencySloMs: number; successSloPct: number };
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
  environment: string;
  scopes: string[];
  qpsLimit: number | null;
  dailyBudgetUsd: string | null;
  monthlyBudgetUsd: string | null;
  allowedModels: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
};

/** 创建成功后返回完整 token（仅此次展示） */
export type AppKeyCreateResponse = Omit<AppKeyListRow, "keyPrefix"> & {
  token: string;
};

export type AppKeyAvailableModel = {
  id: string;
  model: string;
  label: string;
  providerName: string;
  providerSlug: string;
  providerType: string;
  priority: number;
  supportsStreaming: boolean;
};

/** @deprecated 使用 AppKeyListRow */
export type AppKeyRow = AppKeyListRow;

/** 用量明细（按请求日志，含计费） */
export type UsageRow = {
  id: string;
  requestId: string | null;
  traceId: string | null;
  createdAt: string;
  period: string;
  tenantName: string;
  appKey: { id: string; name: string };
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: string;
  subtotalUsd: string;
  currency: string;
  billingType: string | null;
  billingDescription: string | null;
  inputUnitPriceUsd: string;
  outputUnitPriceUsd: string;
  reconciliationStatus: string | null;
  invoiceStatus: string | null;
  cacheHit: boolean;
  provider: { name: string; slug: string };
  latencyMs: number;
  providerErrorCode: string | null;
  retryCount: number;
  requestSourceIp: string | null;
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
  subtotalUsd: string;
  inputUnitPriceUsd: string;
  outputUnitPriceUsd: string;
  quantityPromptTokens: number;
  quantityCompletionTokens: number;
  currency: string;
  status: string;
  reconciliationStatus: string;
  invoiceStatus: string;
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
    trialEndsAt?: string | null;
    trialDaysRemaining?: number | null;
    tenantStatus?: string;
    billingEmail?: string | null;
    monthlyBudgetUsd?: string | null;
    contractCode?: string | null;
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
  providerType: string;
  model: string;
  priority: number;
  costScore: number;
  latencyMs: number;
  successRate: number;
  status: "active" | "degraded" | "readonly";
  enabled: boolean;
  healthStatus: string;
  configured: boolean;
};

export type ProviderConfigRow = {
  id: string;
  name: string;
  slug: string;
  providerType: string;
  status: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  baseUrl: string | null;
  healthStatus: string;
  configured: boolean;
  supportsStreaming: boolean;
  modelCatalog: Array<Record<string, unknown>>;
  lastCheckedAt: string | null;
};

export type RoutingSummary = {
  windowDays: number;
  strategyMode: RoutingStrategyMode;
  strategyNote: string;
  config?: {
    mode: RoutingStrategyMode;
    primaryProviderType: string | null;
    fallbackProviderTypes: string[];
    maxRetries: number;
    timeoutMs: number;
  };
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
  source: "idempotency";
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

/* —— 在线充值 / 自动化开票 —— */

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

export type OpsOverview = {
  requests24h: number;
  failed24h: number;
  customerSuccessRate: number;
  spendUsdMonth: string;
  auditEvents24h: number;
  providers: {
    slug: string;
    type: string;
    configured: boolean;
    enabled: boolean;
    healthStatus: string;
    priority: number;
  }[];
};

export type AuditLogRow = {
  id: string;
  tenantId: string | null;
  userId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
};

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  platformRole: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  tenantCount: number;
  requestCount: number;
  totalTokens: number;
  rechargeCount: number;
  rechargeSuccessCny: string;
  rechargeTokens: string;
  lastRequestAt: string | null;
  lastRechargeAt: string | null;
  memberships: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    tenantStatus: string;
    role: string;
  }[];
};

export type AdminAppKeyUsageRow = {
  id: string;
  name: string;
  tenantName: string;
  environment: string;
  requestCount: number;
  totalTokens: number;
  successCount: number;
  spendUsd: string;
  lastCalledAt: string | null;
};

export type AdminModelUsageRow = {
  model: string;
  providerSlug: string;
  requestCount: number;
  totalTokens: number;
  spendUsd: string;
  avgLatencyMs: number;
  successRate: number;
};

export type AdminRechargeOverviewRow = {
  tenantId: string;
  tenantName: string;
  rechargeCount: number;
  successAmountCny: string;
  successTokens: string;
  lastRechargeAt: string | null;
};

export type AdminUsageDimension = "user" | "tenant";

export type AdminUsageSummaryRow = {
  id: string;
  name: string;
  email?: string | null;
  platformRole?: string | null;
  tenantCount?: number | null;
  tenantSlug?: string | null;
  tenantStatus?: string | null;
  memberCount?: number | null;
  requestCount: number;
  totalTokens: number;
  rechargeCount: number;
  rechargeSuccessCny: string;
  rechargeTokens: string;
  lastRequestAt: string | null;
  lastRechargeAt: string | null;
};

export type AdminTrendPoint = {
  date: string;
  requestCount: number;
};

export type AdminTrendSeries = {
  key: string;
  label: string;
  requestCount: number;
  points: AdminTrendPoint[];
};

export type AdminRechargeOrderRow = {
  id: string;
  orderNo: string;
  tenantId: string;
  tenantName: string;
  amount: string;
  currency: string;
  payChannel: string;
  status: string;
  creditedTokens: string;
  payerName: string | null;
  needInvoice: boolean;
  remark: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AdminUsageOverview = {
  from: string;
  to: string;
  dimension: AdminUsageDimension;
  summaries: AdminUsageSummaryRow[];
  appKeys: AdminAppKeyUsageRow[];
  models: AdminModelUsageRow[];
  appKeyTrends: AdminTrendSeries[];
  modelTrends: AdminTrendSeries[];
  recharges: AdminRechargeOverviewRow[];
  rechargeOrders: AdminRechargeOrderRow[];
};
