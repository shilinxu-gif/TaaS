import "dotenv/config";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildAppKeyPreview, hashAppKey } from "../src/appKeys.js";
import { commercialConfig } from "../src/config.js";
import { encryptSecret } from "../src/crypto.js";
import { defaultCatalogForProvider } from "../src/providerCatalog.js";

const prisma = new PrismaClient();

const PASS = "123456";

function envSecret(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? encryptSecret(raw) : null;
}

/** 与 Dashboard 7 日图对齐：按 UTC 日历天散布 */
function utcDayOffset(dayAgo: number, hourUTC = 12, minUTC = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dayAgo);
  d.setUTCHours(hourUTC, minUTC, 0, 0);
  return d;
}

type LogSeed = {
  tenantId: string;
  appKeyId: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cacheHit: boolean;
  routingPrimary: string | null;
  routingActual: string | null;
  routingReason: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  /** 写入账单的说明，便于 Billing 表可读 */
  billDescription?: string;
};

async function insertLogBundle(
  L: LogSeed,
  pricePerM: Prisma.Decimal
): Promise<void> {
  const total = L.promptTokens + L.completionTokens;
  const amountUsd = new Prisma.Decimal(total).div(1_000_000).mul(pricePerM);
  const subtotalUsd = amountUsd;
  const createdAt = L.createdAt;

  const logRow = await prisma.apiRequestLog.create({
    data: {
      tenantId: L.tenantId,
      appKeyId: L.appKeyId,
      providerId: L.providerId,
      model: L.model,
      promptTokens: L.promptTokens,
      completionTokens: L.completionTokens,
      totalTokens: total,
      latencyMs: L.latencyMs,
      cacheHit: L.cacheHit,
      routingPrimary: L.routingPrimary,
      routingActual: L.routingActual,
      routingReason: L.routingReason,
      statusCode: 200,
      idempotencyKey: L.idempotencyKey,
      createdAt,
    },
  });
  await prisma.usageRecord.create({
    data: {
      logId: logRow.id,
      tenantId: L.tenantId,
      period: createdAt.toISOString().slice(0, 10),
      totalTokens: total,
      createdAt,
    },
  });
  const desc =
    L.billDescription ??
    (L.cacheHit
      ? "缓存命中 — 幂等/语义缓存，计费 0（演示）"
      : `LLM 用量 — ${L.model}（演示种子）`);
  await prisma.billingRecord.create({
    data: {
      logId: logRow.id,
      tenantId: L.tenantId,
      amountUsd: L.cacheHit ? new Prisma.Decimal(0) : amountUsd,
      subtotalUsd: L.cacheHit ? new Prisma.Decimal(0) : subtotalUsd,
      inputUnitPriceUsd: L.cacheHit ? new Prisma.Decimal(0) : pricePerM,
      outputUnitPriceUsd: L.cacheHit ? new Prisma.Decimal(0) : pricePerM,
      quantityPromptTokens: L.promptTokens,
      quantityCompletionTokens: L.completionTokens,
      taxRatePct: new Prisma.Decimal(0),
      taxAmountUsd: new Prisma.Decimal(0),
      reconciliationStatus: "reconciled",
      invoiceStatus: "not_requested",
      description: desc,
      type: L.cacheHit ? "cache_hit" : "usage",
      createdAt,
    },
  });
}

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.invoiceRequest.deleteMany();
  await prisma.walletRechargeOrder.deleteMany();
  await prisma.billingRecord.deleteMany();
  await prisma.usageRecord.deleteMany();
  await prisma.apiRequestLog.deleteMany();
  await prisma.appKey.deleteMany();
  await prisma.tenantCacheSettings.deleteMany();
  await prisma.tenantRoutingStrategy.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.promptTemplate.deleteMany();
  await prisma.tenantMember.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.user.deleteMany();

  const [planStarter, planScale] = await Promise.all([
    prisma.plan.create({
      data: {
        name: "Starter",
        code: "starter",
        monthlyTokenQuota: 100_000,
        pricePerMillionTokens: new Prisma.Decimal("1.2000"),
        description: "初创团队入门套餐，适合联调与小流量 PoC。",
      },
    }),
    prisma.plan.create({
      data: {
        name: "Scale",
        code: "scale",
        monthlyTokenQuota: 2_000_000,
        pricePerMillionTokens: new Prisma.Decimal("0.9500"),
        description: "生产级配额与更优单价，Acme 已上线客服与工单场景。",
      },
    }),
  ]);

  const [pOpenai, pGemini, pClaude] = await Promise.all([
    prisma.provider.create({
      data: {
        name: "OpenAI",
        slug: "openai",
        providerType: "openai",
        status: "active",
        baseUrl: "https://api.openai.com/v1",
        enabled: true,
        apiKeyCiphertext: envSecret("OPENAI_API_KEY"),
        modelCatalog: defaultCatalogForProvider("openai"),
        priority: 10,
        timeoutMs: 25000,
        healthStatus: "healthy",
        supportsStreaming: true,
      },
    }),
    prisma.provider.create({
      data: {
        name: "Google Gemini",
        slug: "gemini",
        providerType: "google",
        status: "active",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        enabled: true,
        apiKeyCiphertext: envSecret("GOOGLE_API_KEY"),
        modelCatalog: defaultCatalogForProvider("google"),
        priority: 20,
        timeoutMs: 25000,
        healthStatus: "healthy",
        supportsStreaming: true,
      },
    }),
    prisma.provider.create({
      data: {
        name: "Anthropic Claude",
        slug: "claude",
        providerType: "anthropic",
        status: "active",
        baseUrl: "https://api.anthropic.com/v1",
        enabled: true,
        apiKeyCiphertext: envSecret("ANTHROPIC_API_KEY"),
        modelCatalog: defaultCatalogForProvider("anthropic"),
        priority: 15,
        timeoutMs: 30000,
        healthStatus: "healthy",
        supportsStreaming: true,
      },
    }),
  ]);

  const passHash = await bcrypt.hash(PASS, 10);

  const userWang = await prisma.user.create({
    data: {
      email: "wangqiang@crm.local",
      passwordHash: passHash,
      name: "王强",
      emailVerifiedAt: new Date(),
      platformRole: "support",
    },
  });
  const userLi = await prisma.user.create({
    data: {
      email: "liwei@crm.local",
      passwordHash: passHash,
      name: "李蔚",
      emailVerifiedAt: new Date(),
      platformRole: "user",
    },
  });

  const tenantAcme = await prisma.tenant.create({
    data: {
      name: "Acme 智能客服",
      slug: "acme-support",
      status: "active",
      planId: planScale.id,
      balanceTokens: new Prisma.Decimal(428_391),
      billingEmail: "finance@acme-demo.example",
      contactSalesEmail: commercialConfig.salesEmail,
      monthlyBudgetUsd: new Prisma.Decimal("1200.0000"),
      spendCapEnforced: true,
      contractCode: "ACME-2026-ENTERPRISE",
      trialEndsAt: utcDayOffset(-30),
    },
  });
  const tenantBeta = await prisma.tenant.create({
    data: {
      name: "Beta 制造业数智化",
      slug: "beta-mfg",
      status: "trial",
      planId: planStarter.id,
      balanceTokens: new Prisma.Decimal(51_200),
      billingEmail: "ops@beta-demo.example",
      contactSalesEmail: commercialConfig.salesEmail,
      monthlyBudgetUsd: new Prisma.Decimal("200.0000"),
      spendCapEnforced: true,
      contractCode: "BETA-TRIAL-2026",
      trialEndsAt: utcDayOffset(-14),
    },
  });

  await prisma.tenantMember.createMany({
    data: [
      { userId: userWang.id, tenantId: tenantAcme.id, role: "owner" },
      { userId: userLi.id, tenantId: tenantBeta.id, role: "owner" },
    ],
  });

  await prisma.tenantRoutingStrategy.createMany({
    data: [
      {
        tenantId: tenantAcme.id,
        mode: "balance",
        primaryProviderType: "openai",
        fallbackProviderTypes: ["anthropic", "google"],
        maxRetries: 2,
        timeoutMs: 25000,
      },
      {
        tenantId: tenantBeta.id,
        mode: "cost",
        primaryProviderType: "google",
        fallbackProviderTypes: ["openai", "anthropic"],
        maxRetries: 1,
        timeoutMs: 20000,
      },
    ],
  });

  await prisma.tenantCacheSettings.createMany({
    data: [
      {
        tenantId: tenantAcme.id,
        enabled: true,
        mode: "hybrid",
        similarityThreshold: new Prisma.Decimal("0.920"),
        ttlSeconds: 86400,
      },
      {
        tenantId: tenantBeta.id,
        enabled: true,
        mode: "semantic",
        similarityThreshold: new Prisma.Decimal("0.900"),
        ttlSeconds: 43200,
      },
    ],
  });

  /** 每租户 3 个密钥：生产 / 内部 / 集成，业务上对应不同系统调用 */
  const [keyAcmeProd, keyAcmeOps, keyAcmeMobile] = await Promise.all([
    prisma.appKey.create({
      data: {
        tenantId: tenantAcme.id,
        name: "生产网关 · 在线客服",
        description: "官网与 APP 用户会话，走 OpenAI/Gemini 主线路",
        token: null,
        tokenHash: hashAppKey("sk-demo-acme-prod-gateway"),
        tokenPreview: buildAppKeyPreview("sk-demo-acme-prod-gateway"),
        status: "active",
        environment: "production",
        scopes: ["chat:complete", "usage:read", "billing:read"],
        qpsLimit: 120,
        dailyBudgetUsd: new Prisma.Decimal("500.0000"),
        monthlyBudgetUsd: new Prisma.Decimal("9000.0000"),
        allowedModels: [
          "gpt-4o-mini",
          "gpt-4o",
          "gemini-1.5-pro",
          "gemini-1.5-flash",
          "gpt-fallback-demo",
        ],
        lastUsedAt: utcDayOffset(0, 10, 5),
        lastUsedIp: "203.0.113.8",
      },
    }),
    prisma.appKey.create({
      data: {
        tenantId: tenantAcme.id,
        name: "内部运营台 · QA",
        description: "工单摘要、知识库抽检；含降级演练 traffic",
        token: null,
        tokenHash: hashAppKey("sk-demo-acme-internal-qa"),
        tokenPreview: buildAppKeyPreview("sk-demo-acme-internal-qa"),
        status: "active",
        environment: "production",
        scopes: ["chat:complete", "usage:read", "admin:ops"],
        qpsLimit: 45,
        dailyBudgetUsd: new Prisma.Decimal("120.0000"),
        monthlyBudgetUsd: new Prisma.Decimal("2000.0000"),
        allowedModels: ["gpt-4o-mini", "claude-3-5-sonnet-latest", "gpt-fallback-demo"],
        lastUsedAt: utcDayOffset(2, 9, 30),
        lastUsedIp: "203.0.113.19",
      },
    }),
    prisma.appKey.create({
      data: {
        tenantId: tenantAcme.id,
        name: "移动端 SDK",
        description: "推送文案与短轮对话",
        token: null,
        tokenHash: hashAppKey("sk-demo-acme-mobile-sdk"),
        tokenPreview: buildAppKeyPreview("sk-demo-acme-mobile-sdk"),
        status: "active",
        environment: "staging",
        scopes: ["chat:complete"],
        qpsLimit: 60,
        dailyBudgetUsd: new Prisma.Decimal("90.0000"),
        monthlyBudgetUsd: new Prisma.Decimal("1500.0000"),
        allowedModels: ["gpt-4o-mini", "claude-3-haiku"],
        lastUsedAt: utcDayOffset(4, 14, 0),
        lastUsedIp: "198.51.100.20",
      },
    }),
  ]);

  const [keyBetaCrm, keyBetaBatch, keyBetaStg] = await Promise.all([
    prisma.appKey.create({
      data: {
        tenantId: tenantBeta.id,
        name: "CRM 连接器",
        description: "销售助手与邮件润色，Starter 套餐",
        token: null,
        tokenHash: hashAppKey("sk-demo-beta-crm-connector"),
        tokenPreview: buildAppKeyPreview("sk-demo-beta-crm-connector"),
        status: "active",
        environment: "production",
        scopes: ["chat:complete", "usage:read"],
        qpsLimit: 20,
        dailyBudgetUsd: new Prisma.Decimal("35.0000"),
        monthlyBudgetUsd: new Prisma.Decimal("500.0000"),
        allowedModels: ["gpt-4o-mini", "gemini-1.5-pro"],
        lastUsedAt: utcDayOffset(1, 11, 0),
        lastUsedIp: "198.51.100.80",
      },
    }),
    prisma.appKey.create({
      data: {
        tenantId: tenantBeta.id,
        name: "批处理 Worker",
        description: "夜间报表生成与标签批注",
        token: null,
        tokenHash: hashAppKey("sk-demo-beta-batch-worker"),
        tokenPreview: buildAppKeyPreview("sk-demo-beta-batch-worker"),
        status: "active",
        environment: "production",
        scopes: ["chat:complete", "usage:read"],
        qpsLimit: 15,
        dailyBudgetUsd: new Prisma.Decimal("25.0000"),
        monthlyBudgetUsd: new Prisma.Decimal("350.0000"),
        allowedModels: [],
        lastUsedAt: utcDayOffset(3, 22, 0),
        lastUsedIp: "198.51.100.81",
      },
    }),
    prisma.appKey.create({
      data: {
        tenantId: tenantBeta.id,
        name: "预发环境",
        description: "与 Acme 同模型矩阵，用于对照测试",
        token: null,
        tokenHash: hashAppKey("sk-demo-beta-staging"),
        tokenPreview: buildAppKeyPreview("sk-demo-beta-staging"),
        status: "active",
        environment: "staging",
        scopes: ["chat:complete"],
        qpsLimit: 10,
        dailyBudgetUsd: new Prisma.Decimal("12.0000"),
        monthlyBudgetUsd: new Prisma.Decimal("120.0000"),
        allowedModels: ["gpt-4o-mini", "gpt-fallback-demo"],
        lastUsedAt: utcDayOffset(5, 8, 45),
        lastUsedIp: "198.51.100.82",
      },
    }),
  ]);

  /** 演示用订阅：Acme 已购 Scale，当前账期为本自然月 */
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  await prisma.subscription.create({
    data: {
      tenantId: tenantAcme.id,
      planId: planScale.id,
      status: "active",
      externalRef: "sub_demo_acme_scale_2025Q1",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    },
  });

  /** 平台级 Prompt 模板（Optimization 页读库展示） */
  await prisma.promptTemplate.createMany({
    data: [
      {
        tenantId: null,
        name: "客服首轮应答",
        description: "与 Acme 在线客服生产密钥配套，统一问候与澄清话术",
        snippet:
          "你是 Acme 官方客服。用户问题：{user_msg}\n请先复述诉求类别，再给不超过 3 步的解决方案。",
        usesHint: 842,
        savedUsdHint: "126.40",
        sortOrder: 1,
      },
      {
        tenantId: null,
        name: "工单摘要（内部 QA）",
        description: "与 internal-qa 密钥联动，结构化抽取字段供 CRM 回填",
        snippet:
          "将工单正文压缩为 JSON：{category, urgency, owner_hint, next_action}。\n正文：{ticket_body}",
        usesHint: 531,
        savedUsdHint: "58.20",
        sortOrder: 2,
      },
      {
        tenantId: null,
        name: "合规审查清单",
        description: "法务抽检用固定模板，利于语义缓存命中",
        snippet:
          "按 ISO27001 与内部数据分级制度，对以下段落给出「合规风险提示」列表：\n{excerpt}",
        usesHint: 297,
        savedUsdHint: "41.05",
        sortOrder: 3,
      },
    ],
  });

  /** Acme：10 条请求 — 覆盖 7 天图表、1 次缓存命中、1 次 fallback */
  const logsAcme: LogSeed[] = [
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeProd.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 920,
      completionTokens: 240,
      latencyMs: 410,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(0, 10, 5),
      billDescription: "用量 · 在线客服首轮应答（gpt-4o-mini / OpenAI）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeProd.id,
      providerId: pGemini.id,
      model: "gemini-1.5-pro",
      promptTokens: 1180,
      completionTokens: 330,
      latencyMs: 590,
      cacheHit: false,
      routingPrimary: "gemini",
      routingActual: "gemini",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(1, 11, 20),
      billDescription: "用量 · 知识库问答（gemini-1.5-pro）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeOps.id,
      providerId: pClaude.id,
      model: "gpt-fallback-demo",
      promptTokens: 640,
      completionTokens: 190,
      latencyMs: 870,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "claude",
      routingReason: "fallback_primary_unavailable",
      idempotencyKey: null,
      createdAt: utcDayOffset(2, 9, 30),
      billDescription:
        "用量 · 主路由 OpenAI 不可用演示 — 由 Claude 承载（gpt-fallback-demo）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeProd.id,
      providerId: pOpenai.id,
      model: "gpt-4o",
      promptTokens: 410,
      completionTokens: 118,
      latencyMs: 360,
      cacheHit: true,
      routingPrimary: "cache",
      routingActual: "cache",
      routingReason: null,
      idempotencyKey: "acme-idem-contract-v3",
      createdAt: utcDayOffset(3, 15, 40),
      billDescription: "缓存命中 · 合同条款比对重复提交（Idempotency-Key）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeMobile.id,
      providerId: pClaude.id,
      model: "claude-3-5-sonnet",
      promptTokens: 1880,
      completionTokens: 490,
      latencyMs: 720,
      cacheHit: false,
      routingPrimary: "claude",
      routingActual: "claude",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(4, 14, 10),
      billDescription: "用量 · 移动端长会话摘要（Claude）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeProd.id,
      providerId: pOpenai.id,
      model: "gpt-4o",
      promptTokens: 1520,
      completionTokens: 420,
      latencyMs: 540,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(5, 13, 0),
      billDescription: "用量 · 工单升级 — 长文本推理（gpt-4o）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeProd.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 560,
      completionTokens: 130,
      latencyMs: 320,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(6, 16, 25),
      billDescription: "用量 · 夜间巡检抽样（gpt-4o-mini）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeProd.id,
      providerId: pGemini.id,
      model: "gemini-1.5-flash",
      promptTokens: 240,
      completionTokens: 90,
      latencyMs: 270,
      cacheHit: false,
      routingPrimary: "gemini",
      routingActual: "gemini",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(0, 18, 50),
      billDescription: "用量 · 实时多语寒暄（gemini-1.5-flash）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeMobile.id,
      providerId: pClaude.id,
      model: "claude-3-haiku",
      promptTokens: 720,
      completionTokens: 210,
      latencyMs: 480,
      cacheHit: false,
      routingPrimary: "claude",
      routingActual: "claude",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(2, 20, 15),
      billDescription: "用量 · 推送标题 A/B 文案（Claude Haiku）",
    },
    {
      tenantId: tenantAcme.id,
      appKeyId: keyAcmeOps.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 480,
      completionTokens: 110,
      latencyMs: 305,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(4, 8, 0),
      billDescription: "用量 · 内部质检 — 会话标签建议",
    },
  ];

  /** Beta：10 条请求 — 独立业务线，仍含 1 缓存 + 1 fallback，便於 Optimization / Routing */
  const logsBeta: LogSeed[] = [
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaCrm.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 310,
      completionTokens: 95,
      latencyMs: 285,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(0, 9, 10),
      billDescription: "用量 · 销售邮件润色（Beta / gpt-4o-mini）",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaCrm.id,
      providerId: pGemini.id,
      model: "gemini-1.5-pro",
      promptTokens: 460,
      completionTokens: 180,
      latencyMs: 505,
      cacheHit: false,
      routingPrimary: "gemini",
      routingActual: "gemini",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(1, 10, 40),
      billDescription: "用量 · 设备手册问答（Gemini）",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaStg.id,
      providerId: pClaude.id,
      model: "gpt-fallback-demo",
      promptTokens: 390,
      completionTokens: 125,
      latencyMs: 760,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "claude",
      routingReason: "fallback_primary_unavailable",
      idempotencyKey: null,
      createdAt: utcDayOffset(2, 14, 0),
      billDescription: "用量 · 预发降级演练（与 Acme 相同网关规则）",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaBatch.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 140,
      completionTokens: 48,
      latencyMs: 195,
      cacheHit: true,
      routingPrimary: "cache",
      routingActual: "cache",
      routingReason: null,
      idempotencyKey: "beta-batch-report-dedup",
      createdAt: utcDayOffset(3, 21, 30),
      billDescription: "缓存命中 · 夜间报表任务重复提交",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaBatch.id,
      providerId: pClaude.id,
      model: "claude-3-5-sonnet",
      promptTokens: 800,
      completionTokens: 205,
      latencyMs: 695,
      cacheHit: false,
      routingPrimary: "claude",
      routingActual: "claude",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(4, 7, 15),
      billDescription: "用量 · 设备故障单根因分析",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaCrm.id,
      providerId: pOpenai.id,
      model: "gpt-4o",
      promptTokens: 1980,
      completionTokens: 460,
      latencyMs: 880,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(5, 12, 0),
      billDescription: "用量 · 投标技术章节草稿",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaStg.id,
      providerId: pGemini.id,
      model: "gemini-1.5-flash",
      promptTokens: 220,
      completionTokens: 78,
      latencyMs: 265,
      cacheHit: false,
      routingPrimary: "gemini",
      routingActual: "gemini",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(6, 17, 45),
      billDescription: "用量 · 产线告警摘要",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaCrm.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 190,
      completionTokens: 52,
      latencyMs: 232,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(0, 22, 10),
      billDescription: "用量 · 客户拜访纪要关键词",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaBatch.id,
      providerId: pGemini.id,
      model: "gemini", // routing maps gemini-* to gemini
      promptTokens: 500,
      completionTokens: 120,
      latencyMs: 420,
      cacheHit: false,
      routingPrimary: "gemini",
      routingActual: "gemini",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(2, 6, 0),
      billDescription: "用量 · 批量翻译产线编号（gemini）",
    },
    {
      tenantId: tenantBeta.id,
      appKeyId: keyBetaStg.id,
      providerId: pOpenai.id,
      model: "gpt-4o-mini",
      promptTokens: 430,
      completionTokens: 100,
      latencyMs: 340,
      cacheHit: false,
      routingPrimary: "openai",
      routingActual: "openai",
      routingReason: null,
      idempotencyKey: null,
      createdAt: utcDayOffset(5, 19, 20),
      billDescription: "用量 · 预发环境与生产对齐验证",
    },
  ];

  for (const L of logsAcme) {
    await insertLogBundle(L, planScale.pricePerMillionTokens);
  }
  for (const L of logsBeta) {
    await insertLogBundle(L, planStarter.pricePerMillionTokens);
  }

  const cnyToTokens = (cny: number) => new Prisma.Decimal(Math.floor(cny * 1200));
  const usdToTokens = (usd: number) => new Prisma.Decimal(Math.floor(usd * 8500));

  await prisma.walletRechargeOrder.createMany({
    data: [
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503180001",
        amountCny: new Prisma.Decimal("10000.00"),
        currency: "CNY",
        payChannel: "bank_transfer",
        status: "success",
        creditedTokens: cnyToTokens(10000),
        payerName: "Acme 智能客服",
        needInvoice: true,
        remark: "对公季度预付 · 财务已核销",
        paidAt: utcDayOffset(14, 10, 0),
        createdAt: utcDayOffset(14, 9, 15),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503190002",
        amountCny: new Prisma.Decimal("8000.00"),
        currency: "CNY",
        payChannel: "bank_transfer",
        status: "pending_review",
        creditedTokens: cnyToTokens(8000),
        payerName: "Acme 智能客服",
        needInvoice: true,
        remark: "对公打款待核销 · 附言含合同号",
        createdAt: utcDayOffset(1, 11, 0),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503200003",
        amountCny: new Prisma.Decimal("2000.00"),
        currency: "CNY",
        payChannel: "wechat",
        status: "success",
        creditedTokens: cnyToTokens(2000),
        payerName: "上海艾科姆贸易有限公司",
        needInvoice: false,
        remark: "微信扫码（演示）",
        paidAt: utcDayOffset(5, 16, 40),
        createdAt: utcDayOffset(5, 16, 10),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503210004",
        amountCny: new Prisma.Decimal("500.00"),
        currency: "CNY",
        payChannel: "wechat",
        status: "pending_payment",
        creditedTokens: cnyToTokens(500),
        payerName: "Acme 智能客服",
        needInvoice: false,
        remark: "待扫码确认",
        createdAt: utcDayOffset(0, 9, 5),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503150005",
        amountCny: new Prisma.Decimal("1500.00"),
        currency: "CNY",
        payChannel: "alipay",
        status: "success",
        creditedTokens: cnyToTokens(1500),
        payerName: "Acme 智能客服",
        needInvoice: true,
        remark: "支付宝即时到账（演示）",
        paidAt: utcDayOffset(7, 20, 10),
        createdAt: utcDayOffset(7, 19, 50),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503220006",
        amountCny: new Prisma.Decimal("300.00"),
        currency: "CNY",
        payChannel: "alipay",
        status: "pending_payment",
        creditedTokens: cnyToTokens(300),
        payerName: "Acme 智能客服",
        needInvoice: false,
        createdAt: utcDayOffset(0, 8, 40),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503120007",
        amountCny: new Prisma.Decimal("100.00"),
        currency: "USD",
        payChannel: "apple_pay",
        status: "success",
        creditedTokens: usdToTokens(100),
        payerName: "Acme Intelligent Support Ltd.",
        needInvoice: false,
        remark: "国际支付 Demo · 模拟成功",
        paidAt: utcDayOffset(9, 14, 0),
        createdAt: utcDayOffset(9, 13, 30),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503080008",
        amountCny: new Prisma.Decimal("50.00"),
        currency: "USD",
        payChannel: "google_pay",
        status: "success",
        creditedTokens: usdToTokens(50),
        payerName: "Acme Intelligent Support Ltd.",
        needInvoice: false,
        remark: "国际支付 Demo · Google Pay",
        paidAt: utcDayOffset(11, 18, 20),
        createdAt: utcDayOffset(11, 18, 0),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503100009",
        amountCny: new Prisma.Decimal("400.00"),
        currency: "CNY",
        payChannel: "wechat",
        status: "cancelled",
        creditedTokens: cnyToTokens(400),
        payerName: "Acme 智能客服",
        needInvoice: false,
        remark: "用户关闭支付页",
        createdAt: utcDayOffset(3, 18, 30),
      },
      {
        tenantId: tenantAcme.id,
        orderNo: "RCH-ACM-202503070010",
        amountCny: new Prisma.Decimal("900.00"),
        currency: "CNY",
        payChannel: "alipay",
        status: "failed",
        creditedTokens: cnyToTokens(900),
        payerName: "Acme 智能客服",
        needInvoice: false,
        remark: "渠道超时关闭（演示）",
        createdAt: utcDayOffset(8, 12, 0),
      },
      {
        tenantId: tenantBeta.id,
        orderNo: "RCH-BTA-202503160011",
        amountCny: new Prisma.Decimal("1200.00"),
        currency: "CNY",
        payChannel: "bank_transfer",
        status: "success",
        creditedTokens: cnyToTokens(1200),
        payerName: "Beta 制造业数智化",
        needInvoice: true,
        paidAt: utcDayOffset(8, 15, 0),
        createdAt: utcDayOffset(8, 14, 30),
      },
      {
        tenantId: tenantBeta.id,
        orderNo: "RCH-BTA-202503210012",
        amountCny: new Prisma.Decimal("800.00"),
        currency: "CNY",
        payChannel: "wechat",
        status: "pending_payment",
        creditedTokens: cnyToTokens(800),
        payerName: "Beta 制造业数智化",
        needInvoice: false,
        createdAt: utcDayOffset(0, 16, 10),
      },
    ],
  });

  await prisma.invoiceRequest.createMany({
    data: [
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250320001",
        titleType: "enterprise",
        invoiceType: "vat_special",
        buyerName: "上海某某科技有限公司",
        buyerTaxNo: "91310000MA1FL0XXXX",
        buyerAddressPhone: "上海市浦东新区xx路xx号 021-5xxxxxxx",
        buyerBankAccount: "中国工商银行上海分行 6222xxxxxxxxxxxx",
        amountCny: new Prisma.Decimal("42800.00"),
        email: "finance@acme-demo.example",
        status: "issued",
        invoiceNo: "3100231130xxxxxxxx",
        invoiceCode: "3100231130",
        pdfUrl: "#demo-pdf-acme-01",
        issuedAt: utcDayOffset(4, 14, 0),
        createdAt: utcDayOffset(6, 9, 0),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250321002",
        titleType: "enterprise",
        invoiceType: "vat_normal",
        buyerName: "上海某某科技有限公司",
        buyerTaxNo: "91310000MA1FL0XXXX",
        buyerAddressPhone: "上海市浦东新区xx路xx号",
        buyerBankAccount: "招商银行上海分行 xx账号",
        amountCny: new Prisma.Decimal("9600.50"),
        email: "ap@acme-demo.example",
        status: "processing",
        createdAt: utcDayOffset(2, 11, 30),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250322003",
        titleType: "enterprise",
        invoiceType: "e_normal",
        buyerName: "深圳联合创新中心（演示）",
        buyerTaxNo: "91440300MA5EXXXX",
        amountCny: new Prisma.Decimal("12000.00"),
        email: "invoice-recv@partner-demo.example",
        status: "submitted",
        createdAt: utcDayOffset(1, 15, 20),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250315004",
        titleType: "enterprise",
        invoiceType: "vat_special",
        buyerName: "杭州云图信息技术有限公司",
        buyerTaxNo: "91330100MA2XXXXXX",
        buyerAddressPhone: "杭州市余杭区xx街道",
        buyerBankAccount: "农业银行杭州xx支行",
        amountCny: new Prisma.Decimal("21500.00"),
        email: "zhang@yunmap-demo.example",
        status: "rejected",
        rejectReason: "购方税号与企业名不一致，请核对三证信息后重新提交。",
        createdAt: utcDayOffset(9, 10, 0),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250310005",
        titleType: "enterprise",
        invoiceType: "vat_normal",
        buyerName: "上海某某科技有限公司",
        buyerTaxNo: "91310000MA1FL0XXXX",
        amountCny: new Prisma.Decimal("3800.00"),
        email: "finance@acme-demo.example",
        status: "issued",
        invoiceNo: "3100231130yyyyyyyy",
        invoiceCode: "3100231130",
        pdfUrl: "#demo-pdf-acme-02",
        issuedAt: utcDayOffset(14, 16, 0),
        createdAt: utcDayOffset(14, 9, 0),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250308006",
        titleType: "personal",
        invoiceType: "e_normal",
        buyerName: "张敏（个人）",
        buyerTaxNo: "31010119900101XXXX",
        amountCny: new Prisma.Decimal("600.00"),
        email: "zhangmin-demo@example.com",
        status: "void",
        rejectReason: "用户发起红冲（演示）",
        issuedAt: utcDayOffset(16, 11, 0),
        createdAt: utcDayOffset(16, 9, 30),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250323007",
        titleType: "enterprise",
        invoiceType: "vat_special",
        buyerName: "北京信安合规科技发展有限公司",
        buyerTaxNo: "91110105MA02XXXX",
        buyerAddressPhone: "北京市朝阳区xx园x号楼",
        buyerBankAccount: "建设银行北京营业部",
        amountCny: new Prisma.Decimal("56000.00"),
        email: "ap-xinan@demo.example",
        status: "submitted",
        createdAt: utcDayOffset(0, 13, 45),
      },
      {
        tenantId: tenantAcme.id,
        requestNo: "INV-ACM-20250228008",
        titleType: "enterprise",
        invoiceType: "e_normal",
        buyerName: "上海某某科技有限公司",
        buyerTaxNo: "91310000MA1FL0XXXX",
        amountCny: new Prisma.Decimal("1890.00"),
        email: "finance@acme-demo.example",
        status: "issued",
        invoiceNo: "3100231120zzzzzzzz",
        invoiceCode: "3100231120",
        pdfUrl: "#demo-pdf-acme-03",
        issuedAt: utcDayOffset(24, 17, 0),
        createdAt: utcDayOffset(25, 8, 0),
      },
      {
        tenantId: tenantBeta.id,
        requestNo: "INV-BTA-20250318001",
        titleType: "enterprise",
        invoiceType: "vat_normal",
        buyerName: "苏州智造工业互联网有限公司",
        buyerTaxNo: "91320500MA1RXXXX",
        amountCny: new Prisma.Decimal("4800.00"),
        email: "caiwu@sz-maker.example",
        status: "issued",
        invoiceNo: "3200231130aaaaaaaa",
        invoiceCode: "3200231130",
        pdfUrl: "#demo-pdf-beta-01",
        issuedAt: utcDayOffset(6, 15, 0),
        createdAt: utcDayOffset(7, 9, 0),
      },
      {
        tenantId: tenantBeta.id,
        requestNo: "INV-BTA-20250319002",
        titleType: "enterprise",
        invoiceType: "vat_special",
        buyerName: "无锡精密零部件集团（演示）",
        buyerTaxNo: "91320200MA7XXXX",
        buyerAddressPhone: "无锡市新吴区xx路",
        buyerBankAccount: "中国银行无锡分行",
        amountCny: new Prisma.Decimal("32000.00"),
        email: "ap@wx-parts.example",
        status: "processing",
        createdAt: utcDayOffset(5, 10, 20),
      },
      {
        tenantId: tenantBeta.id,
        requestNo: "INV-BTA-20250321003",
        titleType: "enterprise",
        invoiceType: "e_normal",
        buyerName: "常州数转服务中心",
        buyerTaxNo: "91320400MABXXXX",
        amountCny: new Prisma.Decimal("2100.00"),
        email: "invoice@cz-sz.example",
        status: "submitted",
        createdAt: utcDayOffset(2, 14, 0),
      },
      {
        tenantId: tenantBeta.id,
        requestNo: "INV-BTA-20250305004",
        titleType: "personal",
        invoiceType: "e_normal",
        buyerName: "李蔚",
        buyerTaxNo: "320xxx1992xxxxxx",
        amountCny: new Prisma.Decimal("299.00"),
        email: "liwei@crm.local",
        status: "rejected",
        rejectReason: "个人开票金额与实名信息不匹配（演示）。",
        createdAt: utcDayOffset(19, 9, 0),
      },
      {
        tenantId: tenantBeta.id,
        requestNo: "INV-BTA-20250312005",
        titleType: "enterprise",
        invoiceType: "vat_normal",
        buyerName: "南通港联供应链管理有限公司",
        buyerTaxNo: "91320600MA3XXXX",
        amountCny: new Prisma.Decimal("7500.00"),
        email: "ap@nt-gl.example",
        status: "issued",
        invoiceNo: "3200231120bbbbbbbb",
        issuedAt: utcDayOffset(12, 11, 0),
        createdAt: utcDayOffset(12, 8, 30),
      },
      {
        tenantId: tenantBeta.id,
        requestNo: "INV-BTA-20250322006",
        titleType: "enterprise",
        invoiceType: "e_normal",
        buyerName: "泰州工业互联网促进中心",
        buyerTaxNo: "91321200MA4XXXX",
        amountCny: new Prisma.Decimal("1500.00"),
        email: "fapiao@tz-iiot.example",
        status: "submitted",
        createdAt: utcDayOffset(0, 17, 10),
      },
    ],
  });

  console.log(
    [
      "Seed OK — 演示数据（业务一致）",
      "登录：wangqiang / 123456（Acme 智能客服 · Scale）| liwei / 123456（Beta 制造业 · Starter）",
      "Acme AppKey：sk-demo-acme-prod-gateway | sk-demo-acme-internal-qa | sk-demo-acme-mobile-sdk",
      "Beta AppKey：sk-demo-beta-crm-connector | sk-demo-beta-batch-worker | sk-demo-beta-staging",
      "每租户 10 条 API 日志 + usage + billing；含缓存命中与 fallback 各 1+；Dashboard 7 日图有分散；Optimization / Routing / Billing / Usage 均有内容。",
      "订阅：Acme 1 条 Scale 周期；Prompt 模板 3 条（平台级）。",
      "财务演示：在线充值（WalletRechargeOrder）与自动化开票（InvoiceRequest）每租户 6–8 条种子数据。",
    ].join("\n")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
