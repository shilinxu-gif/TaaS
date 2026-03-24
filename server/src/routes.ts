import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  authMiddleware,
  hashPassword,
  signToken,
  verifyPassword,
  type AuthedRequest,
} from "./auth.js";
import { prisma } from "./db.js";
import { getIdempotency, setIdempotency } from "./idempotency.js";

/** 演示：租户级缓存策略（内存，重启后恢复默认） */
type CacheStrategySettings = {
  enabled: boolean;
  mode: "exact" | "semantic" | "hybrid";
  similarityThreshold: number;
  ttlSeconds: number;
};

const DEFAULT_CACHE_SETTINGS: CacheStrategySettings = {
  enabled: true,
  mode: "semantic",
  similarityThreshold: 0.92,
  ttlSeconds: 86400,
};

const cacheSettingsByTenant = new Map<string, CacheStrategySettings>();

function getCacheSettings(tenantId: string): CacheStrategySettings {
  return cacheSettingsByTenant.get(tenantId) ?? { ...DEFAULT_CACHE_SETTINGS };
}

type RoutingStrategyMode = "cost" | "quality" | "balance";

const ROUTING_STRATEGY_NOTES: Record<RoutingStrategyMode, string> = {
  cost:
    "优先经济性评分（越高越省），在可接受延迟内将流量引向低价模型组合；适合批量与成本敏感业务。",
  quality:
    "优先成功率与延迟稳定性，必要时接受较高单价；适合对结果一致性要求高的生产链路。",
  balance:
    "综合成功率、成本评分与延迟加权排序，适合大多数默认生产流量（演示默认）。",
};

const ROUTING_FALLBACK_CHAINS: {
  id: string;
  title: string;
  description: string;
  models: string[];
}[] = [
  {
    id: "chain-primary",
    title: "旗舰通用链",
    description: "高能力模型优先，逐级降级，保障长尾请求仍可响应。",
    models: ["GPT-4o", "GPT-3.5 Turbo", "Gemini 1.5 Pro"],
  },
  {
    id: "chain-eco",
    title: "经济型链",
    description: "低价模型优先，适合测试、批处理与内部工具场景。",
    models: ["Gemini 1.5 Flash", "GPT-4o Mini", "Claude 3 Haiku"],
  },
  {
    id: "chain-failover",
    title: "故障转移（与网关规则一致）",
    description:
      "示例模型 gpt-fallback-demo：控制台显示主路由 OpenAI，实际由 Claude 承载（演示调度）。",
    models: ["主路由：OpenAI（GPT 家族）", "实发：Anthropic Claude", "标记：fallback_primary_unavailable"],
  },
];

const MODEL_COST_SCORE: Record<string, number> = {
  "gpt-4o": 72,
  "gpt-4o-mini": 90,
  "gpt-4": 74,
  "gpt-3.5-turbo": 93,
  "gemini-1.5-pro": 84,
  "gemini-1.5-flash": 94,
  "claude-3-5-sonnet": 80,
  "claude-3-haiku": 91,
  "gpt-fallback-demo": 86,
};

const DEFAULT_MODEL_FOR_SLUG: Record<string, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-pro",
  claude: "claude-3-5-sonnet",
};

const DEFAULT_ROUTING_STRATEGY: RoutingStrategyMode = "balance";
const routingStrategyByTenant = new Map<string, RoutingStrategyMode>();

function getRoutingStrategy(tenantId: string): RoutingStrategyMode {
  return routingStrategyByTenant.get(tenantId) ?? DEFAULT_ROUTING_STRATEGY;
}

/** 与日志无关的演示模板（中文业务文案） */
const PROMPT_TEMPLATE_MOCK = [
  {
    id: "tpl-1",
    name: "客服首轮应答",
    description: "标准寒暄与问题澄清，减少重复调用",
    snippet: "你是专业客服。用户说：{user_msg}。请先确认诉求再给方案。",
    uses: 1280,
    savedUsd: "126.40",
  },
  {
    id: "tpl-2",
    name: "工单摘要",
    description: "结构化抽取关键字段，命中率高",
    snippet: "请将下列工单内容整理为：类型、紧急度、建议动作。内容：{ticket}",
    uses: 956,
    savedUsd: "88.15",
  },
  {
    id: "tpl-3",
    name: "合规审查清单",
    description: "固定 checklist，适合语义缓存",
    snippet: "按 GDPR 与本地监管要求，逐条检查：{document_excerpt}",
    uses: 412,
    savedUsd: "52.80",
  },
  {
    id: "tpl-4",
    name: "代码 Review 提示",
    description: "团队统一评审口径",
    snippet: "对以下 diff 做安全与性能点评，输出严重级别：\n```{lang}\n{code}\n```",
    uses: 630,
    savedUsd: "41.20",
  },
] as const;

const REPEATED_PROMPT_PAD = [
  {
    preview: "请用三句话总结以下产品说明，突出差异化卖点。",
    hits: 842,
    savedTokens: 384200,
  },
  {
    preview: "将下列会议纪要保持原意压缩为 150 字以内。",
    hits: 651,
    savedTokens: 219800,
  },
  {
    preview: "根据接口文档生成 curl 示例，并标注必填 header。",
    hits: 523,
    savedTokens: 176400,
  },
  {
    preview: "把用户口语 query 改写为检索友好的关键词列表。",
    hits: 498,
    savedTokens: 99300,
  },
  {
    preview: "输出 JSON：{ title, severity, action }，仅基于给定日志片段。",
    hits: 377,
    savedTokens: 128600,
  },
  {
    preview: "用非技术人员能懂的话解释这段错误堆栈的可能原因。",
    hits: 289,
    savedTokens: 87200,
  },
  {
    preview: "将表格数据转为 Markdown 表，并校验列数一致。",
    hits: 241,
    savedTokens: 55800,
  },
  {
    preview: "中英互译：保持敬语级别与术语表一致。",
    hits: 198,
    savedTokens: 42100,
  },
] as const;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

const CRM_LOCAL_SUFFIX = "@crm.local";

function resolveLoginEmail(login: string): string {
  const t = login.trim();
  if (!t) return t;
  return t.includes("@") ? t : `${t}${CRM_LOCAL_SUFFIX}`;
}

const loginSchema = z
  .object({
    login: z.string().min(1).optional(),
    email: z.string().optional(),
    password: z.string().min(1),
  })
  .refine((b) => !!(b.login?.trim() || b.email?.trim()), {
    message: "login or email required",
  });

function authed(req: AuthedRequest): { userId: string; tenantId: string } {
  return { userId: req.userId, tenantId: req.tenantId };
}

function money(n: Prisma.Decimal): string {
  return n.toString();
}

function parseAllowedModels(json: Prisma.JsonValue): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

function appKeyPrefix(token: string): string {
  const n = Math.min(12, Math.max(8, Math.floor(token.length / 3)));
  return token.length > n ? `${token.slice(0, n)}…` : `${token}…`;
}

function parseDailyBudget(
  raw: unknown
): { ok: true; value: Prisma.Decimal | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const s = typeof raw === "number" ? String(raw) : String(raw).trim();
  if (!s) return { ok: true, value: null };
  const n = Number(s);
  if (Number.isNaN(n) || n < 0) {
    return { ok: false, message: "日预算 (USD) 格式无效" };
  }
  return { ok: true, value: new Prisma.Decimal(s) };
}

function dayPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const chartDays = 7;

function last7IsoDays(): string[] {
  const out: string[] = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function estPromptTokens(messages: unknown): number {
  const len = JSON.stringify(messages ?? []).length;
  return Math.max(16, Math.min(12000, Math.ceil(len / 4)));
}

/** model -> { actual provider slug, primary route label, optional forced fallback reason } */
function resolveRouting(model: string): {
  actualSlug: string;
  primaryLabel: string;
  reason: string | null;
} {
  const m = model.trim().toLowerCase();
  if (m === "gpt-fallback-demo") {
    return {
      primaryLabel: "openai",
      actualSlug: "claude",
      reason: "fallback_primary_unavailable",
    };
  }
  if (m.startsWith("gemini")) {
    return { primaryLabel: "gemini", actualSlug: "gemini", reason: null };
  }
  if (m.startsWith("claude")) {
    return { primaryLabel: "claude", actualSlug: "claude", reason: null };
  }
  return { primaryLabel: "openai", actualSlug: "openai", reason: null };
}

async function pickProvider(slug: string) {
  const p = await prisma.provider.findUnique({ where: { slug } });
  if (!p) {
    return prisma.provider.findFirst({ where: { slug: "openai" } });
  }
  return p;
}

const chatBodySchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(
        z.object({
          role: z.string(),
          content: z.union([z.string(), z.null(), z.array(z.unknown())]).optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  /** 仅进程存活（供 Docker HEALTHCHECK）；不包含 DB，避免未就绪时误判 unhealthy */
  app.get("/health/live", async (_request, reply) => {
    reply.send({ ok: true, live: true });
  });

  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const [users, tenantMembers] = await Promise.all([
        prisma.user.count(),
        prisma.tenantMember.count(),
      ]);
      reply.send({
        ok: true,
        database: "up",
        users,
        tenantMembers,
      });
    } catch (e) {
      reply.status(503).send({
        ok: false,
        database: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.flatten() });
      return;
    }
    const { email, password, name } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      reply.status(409).send({ error: "Email already registered" });
      return;
    }
    const passwordHash = await hashPassword(password);
    const starter = await prisma.plan.findUnique({ where: { code: "starter" } });
    const planId = starter?.id ?? null;
    const slugTail = randomBytes(4).toString("hex");
    const tenantName = `${name} 租户`;
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, name },
      });
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug: `t-${slugTail}`,
          planId,
          balanceTokens: new Prisma.Decimal(250000),
        },
      });
      await tx.tenantMember.create({
        data: { userId: user.id, tenantId: tenant.id, role: "admin" },
      });
      return { user, tenant };
    });
    const token = signToken({ sub: result.user.id, tenantId: result.tenant.id });
    reply.send({
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      tenantId: result.tenant.id,
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.flatten() });
      return;
    }
    const rawLogin = parsed.data.login?.trim() || parsed.data.email?.trim() || "";
    const email = resolveLoginEmail(rawLogin);
    const { password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      reply.status(401).send({ error: "Invalid credentials" });
      return;
    }
    const member = await prisma.tenantMember.findFirst({
      where: { userId: user.id },
      orderBy: { id: "asc" },
    });
    if (!member) {
      reply.status(403).send({ error: "No tenant membership" });
      return;
    }
    const token = signToken({ sub: user.id, tenantId: member.tenantId });
    reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: member.tenantId,
    });
  });

  app.get("/me", { preHandler: authMiddleware }, async (request, reply) => {
    const { userId, tenantId } = authed(request as AuthedRequest);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      reply.status(404).send({ error: "Not found" });
      return;
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true },
    });
    reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            balanceTokens: money(tenant.balanceTokens),
            plan: tenant.plan
              ? { name: tenant.plan.name, code: tenant.plan.code }
              : null,
          }
        : null,
    });
  });

  app.get("/dashboard/summary", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true },
    });
    if (!tenant) {
      reply.status(404).send({ error: "Tenant not found" });
      return;
    }

    const [requests24h, tokenSum, billed, cacheStats, allTenants] = await Promise.all([
      prisma.apiRequestLog.count({
        where: { tenantId, createdAt: { gte: since } },
      }),
      prisma.apiRequestLog.aggregate({
        where: { tenantId, createdAt: { gte: since } },
        _sum: { totalTokens: true },
      }),
      prisma.billingRecord.aggregate({
        where: { tenantId, createdAt: { gte: since } },
        _sum: { amountUsd: true },
      }),
      prisma.apiRequestLog.groupBy({
        by: ["cacheHit"],
        where: { tenantId, createdAt: { gte: since } },
        _count: true,
      }),
      prisma.tenant.findMany({
        select: { id: true, name: true, slug: true },
      }),
    ]);

    const cacheHits = cacheStats.find((c) => c.cacheHit === true)?._count ?? 0;
    const nonCache = cacheStats.find((c) => c.cacheHit === false)?._count ?? 0;
    const denom = cacheHits + nonCache;
    const cacheHitRate = denom === 0 ? 0 : Math.round((cacheHits / denom) * 1000) / 10;

    const tenantReqCounts = await prisma.apiRequestLog.groupBy({
      by: ["tenantId"],
      where: { createdAt: { gte: since } },
      _count: true,
    });
    const idToCount = new Map(tenantReqCounts.map((t) => [t.tenantId, t._count]));

    const sevenAgo = new Date(Date.now() - chartDays * 24 * 60 * 60 * 1000);
    const logs7d = await prisma.apiRequestLog.findMany({
      where: { tenantId, createdAt: { gte: sevenAgo } },
      select: { totalTokens: true, createdAt: true },
    });
    const dayOrder = last7IsoDays();
    const tokenByDay: Record<string, number> = Object.fromEntries(
      dayOrder.map((d) => [d, 0])
    );
    for (const row of logs7d) {
      const k = new Date(row.createdAt).toISOString().slice(0, 10);
      if (k in tokenByDay) tokenByDay[k] += row.totalTokens;
    }
    const chartSeries7d = dayOrder.map((date) => ({
      date,
      tokens: tokenByDay[date] ?? 0,
    }));

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [todayTokensAgg, todayBillingUsage, todayCacheLogs, modelAgg7d] =
      await Promise.all([
        prisma.apiRequestLog.aggregate({
          where: { tenantId, createdAt: { gte: startOfDay } },
          _sum: { totalTokens: true },
        }),
        prisma.billingRecord.aggregate({
          where: {
            tenantId,
            createdAt: { gte: startOfDay },
            type: "usage",
          },
          _sum: { amountUsd: true },
        }),
        prisma.apiRequestLog.findMany({
          where: {
            tenantId,
            createdAt: { gte: startOfDay },
            cacheHit: true,
          },
          select: { totalTokens: true },
        }),
        prisma.apiRequestLog.groupBy({
          by: ["model"],
          where: { tenantId, createdAt: { gte: sevenAgo } },
          _sum: { totalTokens: true },
        }),
      ]);

    const pricePerM =
      tenant.plan?.pricePerMillionTokens ?? new Prisma.Decimal("1.2");
    let cacheSavingsToday = new Prisma.Decimal(0);
    for (const row of todayCacheLogs) {
      cacheSavingsToday = cacheSavingsToday.add(
        new Prisma.Decimal(row.totalTokens).div(1_000_000).mul(pricePerM)
      );
    }

    const modelMix7d = modelAgg7d
      .map((m) => ({
        model: m.model,
        tokens: m._sum.totalTokens ?? 0,
      }))
      .filter((m) => m.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens);

    const balanceNum = Number(tenant.balanceTokens);
    const tokensToday = todayTokensAgg._sum.totalTokens ?? 0;
    const monthlyQuota = tenant.plan?.monthlyTokenQuota ?? 0;

    const risks: {
      level: "info" | "warning" | "critical";
      title: string;
      detail: string;
    }[] = [];

    if (balanceNum < 200_000) {
      risks.push({
        level: "warning",
        title: "余额偏低",
        detail: `当前余额约 ${money(tenant.balanceTokens)} tokens，建议关注充值或配额，避免影响生产调用（演示）。`,
      });
    }
    if (monthlyQuota > 0 && tokensToday > monthlyQuota * 0.08) {
      risks.push({
        level: "warning",
        title: "今日 Token 用量较高",
        detail: `今日已用 ${tokensToday.toLocaleString()} tokens，接近当月套餐日均可用的参考阈值（演示告警）。`,
      });
    }
    const err24h = await prisma.apiRequestLog.count({
      where: { tenantId, createdAt: { gte: since }, statusCode: { gte: 400 } },
    });
    if (err24h > 0) {
      risks.push({
        level: "critical",
        title: "近期存在失败请求",
        detail: `近 24 小时内有 ${err24h} 条 HTTP≥400 的请求日志，建议在「用量」中排查（演示）。`,
      });
    }
    if (risks.length === 0) {
      risks.push({
        level: "info",
        title: "暂无异常",
        detail: "路由与计费链路运行正常，可持续观察用量与余额（演示）。",
      });
    }

    reply.send({
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        balanceTokens: money(tenant.balanceTokens),
        plan: tenant.plan ? { name: tenant.plan.name, code: tenant.plan.code } : null,
      },
      kpis: {
        requests24h,
        tokens24h: tokenSum._sum.totalTokens ?? 0,
        spendUsd24h: money(billed._sum.amountUsd ?? new Prisma.Decimal(0)),
        cacheHitRate,
      },
      today: {
        spendUsd: money(todayBillingUsage._sum.amountUsd ?? new Prisma.Decimal(0)),
        tokens: tokensToday,
        cacheSavingsUsd: money(cacheSavingsToday),
      },
      tenantsOverview: allTenants.map((t) => ({
        name: t.name,
        slug: t.slug,
        requests24h: idToCount.get(t.id) ?? 0,
      })),
      chartSeries7d,
      modelMix7d,
      risks,
    });
  });

  app.get("/app-keys", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const keys = await prisma.appKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { tenant: { select: { name: true } } },
    });
    reply.send(
      keys.map((k) => ({
        id: k.id,
        name: k.name,
        description: k.description,
        keyPrefix: appKeyPrefix(k.token),
        tenantName: k.tenant.name,
        status: k.status,
        qpsLimit: k.qpsLimit,
        dailyBudgetUsd: k.dailyBudgetUsd != null ? money(k.dailyBudgetUsd) : null,
        allowedModels: parseAllowedModels(k.allowedModels),
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }))
    );
  });

  const appKeyCreateSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    qpsLimit: z.number().int().positive().nullable().optional(),
    dailyBudgetUsd: z.union([z.string(), z.number(), z.null()]).optional(),
    allowedModels: z.array(z.string().min(1)).optional().default([]),
    status: z.enum(["active", "disabled"]).optional().default("active"),
  });

  app.post("/app-keys", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const parsed = appKeyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.flatten() });
      return;
    }
    const budget = parseDailyBudget(parsed.data.dailyBudgetUsd);
    if (!budget.ok) {
      reply.status(400).send({ error: budget.message });
      return;
    }
    const token = `sk-demo-${randomBytes(24).toString("hex")}`;
    const row = await prisma.appKey.create({
      data: {
        tenantId,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        token,
        status: parsed.data.status,
        qpsLimit: parsed.data.qpsLimit ?? null,
        dailyBudgetUsd: budget.value,
        allowedModels: parsed.data.allowedModels ?? [],
      },
    });
    reply.status(201).send({
      id: row.id,
      name: row.name,
      description: row.description,
      token: row.token,
      tenantName: (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }))
        .name,
      status: row.status,
      qpsLimit: row.qpsLimit,
      dailyBudgetUsd: row.dailyBudgetUsd != null ? money(row.dailyBudgetUsd) : null,
      allowedModels: parseAllowedModels(row.allowedModels),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    });
  });

  const appKeyPatchSchema = z.object({
    status: z.enum(["active", "disabled"]).optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    qpsLimit: z.number().int().positive().nullable().optional(),
    dailyBudgetUsd: z.union([z.string(), z.number(), z.null()]).optional(),
    allowedModels: z.array(z.string().min(1)).optional(),
  });

  app.patch("/app-keys/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const { id } = request.params as { id: string };
    const parsed = appKeyPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.flatten() });
      return;
    }

    const existing = await prisma.appKey.findFirst({
      where: { id, tenantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!existing) {
      reply.status(404).send({ error: "Not found" });
      return;
    }

    if (parsed.data.status !== undefined && existing.status === "revoked") {
      reply.status(400).send({ error: "已撤销的密钥无法切换启用状态" });
      return;
    }

    const data: Prisma.AppKeyUpdateInput = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) {
      data.description =
        parsed.data.description === null || parsed.data.description === ""
          ? null
          : parsed.data.description.trim();
    }
    if (parsed.data.qpsLimit !== undefined) {
      data.qpsLimit = parsed.data.qpsLimit;
    }
    if (parsed.data.dailyBudgetUsd !== undefined) {
      const budget = parseDailyBudget(parsed.data.dailyBudgetUsd);
      if (!budget.ok) {
        reply.status(400).send({ error: budget.message });
        return;
      }
      data.dailyBudgetUsd = budget.value;
    }
    if (parsed.data.allowedModels !== undefined) {
      data.allowedModels = parsed.data.allowedModels;
    }

    if (Object.keys(data).length === 0) {
      reply.status(400).send({ error: "未提供可更新字段" });
      return;
    }

    const row = await prisma.appKey.update({
      where: { id },
      data,
    });

    reply.send({
      id: row.id,
      name: row.name,
      description: row.description,
      keyPrefix: appKeyPrefix(row.token),
      tenantName: existing.tenant.name,
      status: row.status,
      qpsLimit: row.qpsLimit,
      dailyBudgetUsd: row.dailyBudgetUsd != null ? money(row.dailyBudgetUsd) : null,
      allowedModels: parseAllowedModels(row.allowedModels),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    });
  });

  app.patch("/app-keys/:id/revoke", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const { id } = request.params as { id: string };
    const updated = await prisma.appKey.updateMany({
      where: { id, tenantId },
      data: { status: "revoked" },
    });
    if (updated.count === 0) {
      reply.status(404).send({ error: "Not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.get("/usage", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const rows = await prisma.apiRequestLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        provider: { select: { name: true, slug: true } },
        appKey: { select: { id: true, name: true } },
        tenant: { select: { name: true } },
        billing: {
          select: {
            amountUsd: true,
            currency: true,
            type: true,
            description: true,
          },
        },
      },
    });
    reply.send(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        period: dayPeriod(r.createdAt),
        tenantName: r.tenant.name,
        appKey: { id: r.appKey.id, name: r.appKey.name },
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        costUsd: r.billing ? money(r.billing.amountUsd) : "0",
        currency: r.billing?.currency ?? "USD",
        billingType: r.billing?.type ?? null,
        billingDescription: r.billing?.description ?? null,
        cacheHit: r.cacheHit,
        provider: r.provider,
        latencyMs: r.latencyMs,
        statusCode: r.statusCode,
        routingPrimary: r.routingPrimary,
        routingActual: r.routingActual,
        routingReason: r.routingReason,
        idempotencyKey: r.idempotencyKey,
      }))
    );
  });

  function billingTypeLabel(type: string): string {
    if (type === "usage") return "用量结算";
    if (type === "cache_hit") return "缓存减免";
    return type;
  }

  function billingRecordStatus(type: string): string {
    if (type === "cache_hit") return "已减免";
    return "已结算";
  }

  app.get("/billing/overview", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true },
    });
    if (!tenant) {
      reply.status(404).send({ error: "Tenant not found" });
      return;
    }

    const pricePerM =
      tenant.plan?.pricePerMillionTokens ?? new Prisma.Decimal("1.2000");

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [allBillRows, monthLogsAgg, monthCacheLogs, plans] = await Promise.all([
      prisma.billingRecord.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { log: { select: { model: true, cacheHit: true } } },
      }),
      prisma.apiRequestLog.aggregate({
        where: { tenantId, createdAt: { gte: monthStart } },
        _sum: { totalTokens: true },
      }),
      prisma.apiRequestLog.findMany({
        where: { tenantId, createdAt: { gte: monthStart }, cacheHit: true },
        select: { totalTokens: true },
      }),
      prisma.plan.findMany({ orderBy: { monthlyTokenQuota: "asc" } }),
    ]);

    let totalSpend = new Prisma.Decimal(0);
    for (const r of allBillRows) {
      if (r.type === "usage") {
        totalSpend = totalSpend.add(r.amountUsd);
      }
    }

    let estimatedSaving = new Prisma.Decimal(0);
    for (const row of monthCacheLogs) {
      estimatedSaving = estimatedSaving.add(
        new Prisma.Decimal(row.totalTokens).div(1_000_000).mul(pricePerM)
      );
    }

    const currentMonthUsageTokens = monthLogsAgg._sum.totalTokens ?? 0;

    const planDto = (p: {
      id: string;
      name: string;
      code: string;
      monthlyTokenQuota: number;
      pricePerMillionTokens: Prisma.Decimal;
      description: string | null;
    }) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      monthlyTokenQuota: p.monthlyTokenQuota,
      pricePerMillionTokens: money(p.pricePerMillionTokens),
      description: p.description,
    });

    reply.send({
      summary: {
        totalSpendUsd: money(totalSpend),
        remainingBalanceTokens: money(tenant.balanceTokens),
        currentMonthUsageTokens,
        estimatedSavingUsd: money(estimatedSaving),
        currency: "USD",
      },
      currentPlan: tenant.plan ? planDto(tenant.plan) : null,
      plans: plans.map(planDto),
      records: allBillRows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        type: r.type,
        typeLabel: billingTypeLabel(r.type),
        amountUsd: money(r.amountUsd),
        currency: r.currency,
        status: billingRecordStatus(r.type),
        description: r.description,
        model: r.log.model,
      })),
    });
  });

  app.get("/billing", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const rows = await prisma.billingRecord.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        log: { select: { model: true, cacheHit: true } },
      },
    });
    reply.send(
      rows.map((r) => ({
        id: r.id,
        amountUsd: money(r.amountUsd),
        currency: r.currency,
        type: r.type,
        description: r.description,
        createdAt: r.createdAt,
        model: r.log.model,
        cacheHit: r.log.cacheHit,
      }))
    );
  });

  const RECHARGE_BANK_INFO = {
    companyName: "算力无限（上海）科技有限公司",
    bankName: "招商银行股份有限公司上海分行营业部",
    accountNo: "1219 1523 8888 6666 0123",
    accountName: "算力无限（上海）科技有限公司",
  } as const;

  const rechargeChannelLabel: Record<string, string> = {
    bank_transfer: "对公打款",
    wechat: "微信支付",
    alipay: "支付宝支付",
    apple_pay: "苹果支付",
    google_pay: "谷歌支付",
    corporate_online: "企业网银",
    aggregate_demo: "聚合支付（演示）",
  };

  const rechargeStatusLabel: Record<string, string> = {
    pending_payment: "待支付",
    pending_review: "待审核",
    success: "已到账",
    failed: "失败",
    cancelled: "已取消",
    pending: "待支付",
    processing: "待支付",
  };

  /** 演示折算 tokens：CNY 1:1200；USD 1:8500 */
  function rechargeCreditedTokens(amount: number, currency: string): Prisma.Decimal {
    const n = currency === "USD" ? Math.floor(amount * 8500) : Math.floor(amount * 1200);
    return new Prisma.Decimal(n);
  }

  function monthRechargeCnyApprox(rows: { amountCny: Prisma.Decimal; currency: string }[]): Prisma.Decimal {
    let sum = new Prisma.Decimal(0);
    const usdRate = new Prisma.Decimal("7.2");
    for (const r of rows) {
      if (r.currency === "USD") {
        sum = sum.add(new Prisma.Decimal(r.amountCny).mul(usdRate));
      } else {
        sum = sum.add(r.amountCny);
      }
    }
    return sum;
  }

  function nextRechargeOrderNo(): string {
    return `RCH-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex")}`;
  }

  function nextInvoiceRequestNo(): string {
    return `INV-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex")}`;
  }

  const invoiceStatusLabel: Record<string, string> = {
    draft: "草稿",
    submitted: "已提交",
    processing: "开票中",
    issued: "已开票",
    rejected: "已驳回",
    void: "已作废",
  };

  const invoiceTitleTypeLabel: Record<string, string> = {
    enterprise: "企业",
    personal: "个人",
  };

  const invoiceTypeLabel: Record<string, string> = {
    vat_special: "增值税专用发票",
    vat_normal: "增值税普通发票",
    e_normal: "增值税电子普通发票",
  };

  function mapRechargeRow(
    r: {
      id: string;
      orderNo: string;
      amountCny: Prisma.Decimal;
      currency: string;
      payChannel: string;
      status: string;
      creditedTokens: Prisma.Decimal;
      payerName: string | null;
      needInvoice: boolean;
      remark: string | null;
      paidAt: Date | null;
      createdAt: Date;
      tenant?: { name: string };
    }
  ) {
    const label = rechargeStatusLabel[r.status] ?? r.status;
    return {
      id: r.id,
      orderNo: r.orderNo,
      amount: money(r.amountCny),
      currency: r.currency,
      amountDisplay: `${r.currency === "USD" ? "$" : "¥"}${money(r.amountCny)}`,
      tenantName: r.tenant?.name ?? "",
      payChannel: r.payChannel,
      payChannelLabel: rechargeChannelLabel[r.payChannel] ?? r.payChannel,
      status: r.status,
      statusLabel: label,
      creditedTokens: money(r.creditedTokens),
      payerName: r.payerName,
      needInvoice: r.needInvoice,
      remark: r.remark,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
    };
  }

  app.get("/finance/recharges/summary", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      reply.status(404).send({ error: "Tenant not found" });
      return;
    }

    const monthSuccessRows = await prisma.walletRechargeOrder.findMany({
      where: { tenantId, status: "success", paidAt: { gte: monthStart } },
      select: { amountCny: true, currency: true },
    });

    const pendingCount = await prisma.walletRechargeOrder.count({
      where: {
        tenantId,
        status: { in: ["pending_payment", "pending_review", "pending", "processing"] },
      },
    });

    reply.send({
      balanceTokens: money(tenant.balanceTokens),
      pendingCount,
      monthRechargeCny: money(monthRechargeCnyApprox(monthSuccessRows)),
      monthRechargeNote: "本月成功充值金额已按 USD×7.2 折合为人民币展示（演示汇率）。",
      bankAccount: RECHARGE_BANK_INFO,
      recommendedChannels: ["bank_transfer", "alipay"],
      note: "演示环境：CNY 按 1 元≈1,200 tokens、USD 按 1≈8,500 tokens 折算到账；不产生真实支付。",
    });
  });

  app.get("/finance/recharges", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const rows = await prisma.walletRechargeOrder.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { tenant: { select: { name: true } } },
    });
    reply.send(rows.map((r) => mapRechargeRow(r)));
  });

  const createRechargeSchema = z.object({
    amount: z.coerce.number().positive().max(9_999_999),
    currency: z.enum(["CNY", "USD"]),
    payChannel: z.enum(["bank_transfer", "wechat", "alipay", "apple_pay", "google_pay"]),
    payerName: z.string().min(2).max(120),
    remark: z.string().max(500).optional(),
    needInvoice: z.boolean().optional().default(false),
  });

  async function finalizeRechargeSuccess(
    tenantId: string,
    rowId: string,
    extraRemark?: string
  ): Promise<void> {
    const paidAt = new Date();
    const row = await prisma.walletRechargeOrder.findUnique({ where: { id: rowId } });
    if (!row) throw new Error("订单不存在");
    await prisma.$transaction([
      prisma.walletRechargeOrder.update({
        where: { id: rowId },
        data: {
          status: "success",
          paidAt,
          remark: extraRemark ? `${row.remark ?? ""} ${extraRemark}`.trim() : row.remark,
        },
      }),
      prisma.tenant.update({
        where: { id: tenantId },
        data: { balanceTokens: { increment: row.creditedTokens } },
      }),
    ]);
  }

  app.post("/finance/recharges", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const parsed = createRechargeSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "参数无效", details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const amountDec = new Prisma.Decimal(b.amount.toFixed(2));
    const credited = rechargeCreditedTokens(b.amount, b.currency);
    const remarkParts = [b.remark?.trim()].filter(Boolean);
    if (b.needInvoice) remarkParts.push("需开具发票");

    let status: string;
    if (b.payChannel === "bank_transfer") status = "pending_review";
    else if (b.payChannel === "wechat" || b.payChannel === "alipay") status = "pending_payment";
    else status = "success";

    const baseData = {
      tenantId,
      orderNo: nextRechargeOrderNo(),
      amountCny: amountDec,
      currency: b.currency,
      payChannel: b.payChannel,
      creditedTokens: credited,
      payerName: b.payerName.trim(),
      needInvoice: b.needInvoice ?? false,
      remark: remarkParts.length ? remarkParts.join(" · ") : null,
    };

    if (b.payChannel === "apple_pay" || b.payChannel === "google_pay") {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.walletRechargeOrder.create({
          data: {
            ...baseData,
            status: "success",
            paidAt: new Date(),
            remark:
              (baseData.remark ? `${baseData.remark} · ` : "") +
              "国际支付 Demo：模拟即时成功",
          },
        });
        await tx.tenant.update({
          where: { id: tenantId },
          data: { balanceTokens: { increment: credited } },
        });
        return created;
      });
      const withTenant = await prisma.walletRechargeOrder.findUnique({
        where: { id: row.id },
        include: { tenant: { select: { name: true } } },
      });
      reply.status(201).send({
        ...mapRechargeRow(withTenant!),
        hint: "演示：国际支付已模拟入账。",
        flow: "intl_success",
      });
      return;
    }

    const row = await prisma.walletRechargeOrder.create({
      data: {
        ...baseData,
        status,
      },
    });
    const withTenant = await prisma.walletRechargeOrder.findUnique({
      where: { id: row.id },
      include: { tenant: { select: { name: true } } },
    });
    const hint =
      b.payChannel === "bank_transfer"
        ? "请使用下方对公账户打款，到账后财务一般在 1 个工作日内完成核销。"
        : "请使用微信/支付宝扫码完成支付（演示可点击「模拟支付成功」）。";
    reply.status(201).send({
      ...mapRechargeRow(withTenant!),
      hint,
      flow: b.payChannel === "bank_transfer" ? "bank" : "qr",
      bankAccount: b.payChannel === "bank_transfer" ? RECHARGE_BANK_INFO : undefined,
    });
  });

  app.post(
    "/finance/recharges/:id/mock-bank-approve",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = authed(request as AuthedRequest);
      const { id } = request.params as { id: string };
      const row = await prisma.walletRechargeOrder.findFirst({
        where: { id, tenantId },
      });
      if (!row) {
        reply.status(404).send({ error: "订单不存在" });
        return;
      }
      if (row.status !== "pending_review") {
        reply.status(400).send({ error: "仅「待审核」对公单可模拟审核通过" });
        return;
      }
      await finalizeRechargeSuccess(tenantId, row.id, "财务审核通过（演示）");
      const updated = await prisma.walletRechargeOrder.findUnique({
        where: { id: row.id },
        include: { tenant: { select: { name: true } } },
      });
      reply.send(mapRechargeRow(updated!));
    }
  );

  app.post(
    "/finance/recharges/:id/mock-pay-success",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = authed(request as AuthedRequest);
      const { id } = request.params as { id: string };
      const row = await prisma.walletRechargeOrder.findFirst({
        where: { id, tenantId },
      });
      if (!row) {
        reply.status(404).send({ error: "订单不存在" });
        return;
      }
      if (
        row.status !== "pending_payment" &&
        row.status !== "pending" &&
        row.status !== "processing"
      ) {
        reply.status(400).send({ error: "仅待支付订单可模拟支付成功" });
        return;
      }
      await finalizeRechargeSuccess(tenantId, row.id, "扫码支付成功（演示）");
      const updated = await prisma.walletRechargeOrder.findUnique({
        where: { id: row.id },
        include: { tenant: { select: { name: true } } },
      });
      reply.send(mapRechargeRow(updated!));
    }
  );

  app.post(
    "/finance/recharges/:id/mock-pay-cancel",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = authed(request as AuthedRequest);
      const { id } = request.params as { id: string };
      const row = await prisma.walletRechargeOrder.findFirst({
        where: { id, tenantId },
      });
      if (!row) {
        reply.status(404).send({ error: "订单不存在" });
        return;
      }
      if (
        row.status !== "pending_payment" &&
        row.status !== "pending" &&
        row.status !== "processing"
      ) {
        reply.status(400).send({ error: "仅待支付订单可取消" });
        return;
      }
      const updated = await prisma.walletRechargeOrder.update({
        where: { id: row.id },
        data: { status: "cancelled", remark: row.remark ?? "用户取消（演示）" },
      });
      const withTenant = await prisma.walletRechargeOrder.findUnique({
        where: { id: updated.id },
        include: { tenant: { select: { name: true } } },
      });
      reply.send(mapRechargeRow(withTenant!));
    }
  );

  /** 兼容旧客户端：等同于 mock-bank-approve + mock-pay-success */
  app.post(
    "/finance/recharges/:id/mock-complete",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = authed(request as AuthedRequest);
      const { id } = request.params as { id: string };
      const row = await prisma.walletRechargeOrder.findFirst({
        where: { id, tenantId },
      });
      if (!row) {
        reply.status(404).send({ error: "订单不存在" });
        return;
      }
      if (row.status === "pending_review") {
        await finalizeRechargeSuccess(tenantId, row.id, "财务审核通过（演示）");
      } else if (
        row.status === "pending_payment" ||
        row.status === "pending" ||
        row.status === "processing"
      ) {
        await finalizeRechargeSuccess(tenantId, row.id, "模拟入账");
      } else {
        reply.status(400).send({ error: "当前状态不可完成" });
        return;
      }
      const updated = await prisma.walletRechargeOrder.findUnique({
        where: { id: row.id },
        include: { tenant: { select: { name: true } } },
      });
      reply.send(mapRechargeRow(updated!));
    }
  );

  app.get("/finance/invoices/summary", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [pendingCount, issuedThisMonth, issuedSum] = await Promise.all([
      prisma.invoiceRequest.count({
        where: { tenantId, status: { in: ["submitted", "processing"] } },
      }),
      prisma.invoiceRequest.count({
        where: { tenantId, status: "issued", issuedAt: { gte: monthStart } },
      }),
      prisma.invoiceRequest.aggregate({
        where: { tenantId, status: "issued", issuedAt: { gte: monthStart } },
        _sum: { amountCny: true },
      }),
    ]);

    reply.send({
      pendingCount,
      issuedThisMonth,
      issuedAmountMonthCny: money(issuedSum._sum.amountCny ?? new Prisma.Decimal(0)),
      note: "演示环境：发票号码与 PDF 为模拟数据；可点击「模拟开票完成」体验状态流转。",
    });
  });

  app.get("/finance/invoices", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const rows = await prisma.invoiceRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    reply.send(
      rows.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        titleType: r.titleType,
        titleTypeLabel: invoiceTitleTypeLabel[r.titleType] ?? r.titleType,
        invoiceType: r.invoiceType,
        invoiceTypeLabel: invoiceTypeLabel[r.invoiceType] ?? r.invoiceType,
        buyerName: r.buyerName,
        buyerTaxNo: r.buyerTaxNo,
        amountCny: money(r.amountCny),
        email: r.email,
        status: r.status,
        statusLabel: invoiceStatusLabel[r.status] ?? r.status,
        invoiceNo: r.invoiceNo,
        invoiceCode: r.invoiceCode,
        pdfUrl: r.pdfUrl,
        rejectReason: r.rejectReason,
        issuedAt: r.issuedAt,
        createdAt: r.createdAt,
      }))
    );
  });

  app.get("/finance/invoices/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const { id } = request.params as { id: string };
    const r = await prisma.invoiceRequest.findFirst({ where: { id, tenantId } });
    if (!r) {
      reply.status(404).send({ error: "记录不存在" });
      return;
    }
    reply.send({
      id: r.id,
      requestNo: r.requestNo,
      titleType: r.titleType,
      titleTypeLabel: invoiceTitleTypeLabel[r.titleType] ?? r.titleType,
      invoiceType: r.invoiceType,
      invoiceTypeLabel: invoiceTypeLabel[r.invoiceType] ?? r.invoiceType,
      buyerName: r.buyerName,
      buyerTaxNo: r.buyerTaxNo,
      buyerAddressPhone: r.buyerAddressPhone,
      buyerBankAccount: r.buyerBankAccount,
      amountCny: money(r.amountCny),
      email: r.email,
      status: r.status,
      statusLabel: invoiceStatusLabel[r.status] ?? r.status,
      invoiceNo: r.invoiceNo,
      invoiceCode: r.invoiceCode,
      pdfUrl: r.pdfUrl,
      rejectReason: r.rejectReason,
      issuedAt: r.issuedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  });

  const createInvoiceSchema = z.object({
    titleType: z.enum(["enterprise", "personal"]),
    invoiceType: z.enum(["vat_special", "vat_normal", "e_normal"]),
    buyerName: z.string().min(2).max(120),
    buyerTaxNo: z.string().min(6).max(32),
    buyerAddressPhone: z.string().max(280).optional(),
    buyerBankAccount: z.string().max(280).optional(),
    amountCny: z.coerce.number().positive().max(9_999_999),
    email: z.string().email(),
  });

  app.post("/finance/invoices", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const parsed = createInvoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "参数无效", details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const row = await prisma.invoiceRequest.create({
      data: {
        tenantId,
        requestNo: nextInvoiceRequestNo(),
        titleType: b.titleType,
        invoiceType: b.invoiceType,
        buyerName: b.buyerName,
        buyerTaxNo: b.buyerTaxNo,
        buyerAddressPhone: b.buyerAddressPhone?.trim() || null,
        buyerBankAccount: b.buyerBankAccount?.trim() || null,
        amountCny: new Prisma.Decimal(b.amountCny.toFixed(2)),
        email: b.email.trim(),
        status: "submitted",
      },
    });
    reply.status(201).send({
      id: row.id,
      requestNo: row.requestNo,
      titleType: row.titleType,
      titleTypeLabel: invoiceTitleTypeLabel[row.titleType] ?? row.titleType,
      invoiceType: row.invoiceType,
      invoiceTypeLabel: invoiceTypeLabel[row.invoiceType] ?? row.invoiceType,
      buyerName: row.buyerName,
      buyerTaxNo: row.buyerTaxNo,
      amountCny: money(row.amountCny),
      email: row.email,
      status: row.status,
      statusLabel: invoiceStatusLabel.submitted,
      invoiceNo: row.invoiceNo,
      invoiceCode: row.invoiceCode,
      pdfUrl: row.pdfUrl,
      rejectReason: row.rejectReason,
      issuedAt: row.issuedAt,
      createdAt: row.createdAt,
    });
  });

  app.post(
    "/finance/invoices/:id/mock-accept",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = authed(request as AuthedRequest);
      const { id } = request.params as { id: string };
      const row = await prisma.invoiceRequest.findFirst({ where: { id, tenantId } });
      if (!row) {
        reply.status(404).send({ error: "记录不存在" });
        return;
      }
      if (row.status !== "submitted") {
        reply.status(400).send({ error: "仅「已提交」状态可模拟税局受理" });
        return;
      }
      const updated = await prisma.invoiceRequest.update({
        where: { id: row.id },
        data: { status: "processing" },
      });
      reply.send({
        id: updated.id,
        requestNo: updated.requestNo,
        status: updated.status,
        statusLabel: invoiceStatusLabel.processing,
      });
    }
  );

  app.post(
    "/finance/invoices/:id/mock-issue",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tenantId } = authed(request as AuthedRequest);
      const { id } = request.params as { id: string };
      const row = await prisma.invoiceRequest.findFirst({ where: { id, tenantId } });
      if (!row) {
        reply.status(404).send({ error: "记录不存在" });
        return;
      }
      if (row.status !== "submitted" && row.status !== "processing") {
        reply.status(400).send({ error: "仅待开票/开票中的申请可模拟开票完成" });
        return;
      }
      const issuedAt = new Date();
      const invoiceNo = `31${Date.now().toString().slice(-10)}${randomBytes(2).toString("hex")}`;
      const invoiceCode = `${3200000000 + Math.floor(Math.random() * 99_999)}`;
      const updated = await prisma.invoiceRequest.update({
        where: { id: row.id },
        data: {
          status: "issued",
          invoiceNo,
          invoiceCode,
          pdfUrl: `#mock-invoice-${row.id.slice(-6)}`,
          issuedAt,
        },
      });
      reply.send({
        id: updated.id,
        requestNo: updated.requestNo,
        titleType: updated.titleType,
        titleTypeLabel: invoiceTitleTypeLabel[updated.titleType] ?? updated.titleType,
        invoiceType: updated.invoiceType,
        invoiceTypeLabel: invoiceTypeLabel[updated.invoiceType] ?? updated.invoiceType,
        buyerName: updated.buyerName,
        buyerTaxNo: updated.buyerTaxNo,
        amountCny: money(updated.amountCny),
        email: updated.email,
        status: updated.status,
        statusLabel: invoiceStatusLabel.issued,
        invoiceNo: updated.invoiceNo,
        invoiceCode: updated.invoiceCode,
        pdfUrl: updated.pdfUrl,
        rejectReason: updated.rejectReason,
        issuedAt: updated.issuedAt,
        createdAt: updated.createdAt,
      });
    }
  );

  app.get("/logs", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const rows = await prisma.apiRequestLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        provider: { select: { name: true, slug: true } },
        appKey: { select: { name: true } },
      },
    });
    reply.send(rows);
  });

  app.get("/routing/summary", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const windowDays = 14;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const strategyMode = getRoutingStrategy(tenantId);

    const [routeRows, providers, logStats, recentFallbacks] = await Promise.all([
      prisma.apiRequestLog.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: {
          routingPrimary: true,
          routingActual: true,
          routingReason: true,
          providerId: true,
        },
      }),
      prisma.provider.findMany({ orderBy: { slug: "asc" } }),
      prisma.apiRequestLog.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: {
          providerId: true,
          model: true,
          statusCode: true,
          latencyMs: true,
        },
      }),
      prisma.apiRequestLog.findMany({
        where: { tenantId, routingReason: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          model: true,
          routingPrimary: true,
          routingActual: true,
          routingReason: true,
          createdAt: true,
        },
      }),
    ]);

    const byRoute = new Map<
      string,
      { count: number; primary: string | null; reason: string | null }
    >();
    for (const r of routeRows) {
      const key = r.routingActual ?? "unknown";
      const cur = byRoute.get(key) ?? {
        count: 0,
        primary: r.routingPrimary,
        reason: r.routingReason,
      };
      cur.count += 1;
      byRoute.set(key, cur);
    }

    type ProvAgg = {
      modelCounts: Map<string, number>;
      latencies: number[];
      ok: number;
      total: number;
    };
    const byProvider = new Map<string, ProvAgg>();
    for (const row of logStats) {
      const cur = byProvider.get(row.providerId) ?? {
        modelCounts: new Map<string, number>(),
        latencies: [],
        ok: 0,
        total: 0,
      };
      cur.total += 1;
      if (row.statusCode < 400) cur.ok += 1;
      cur.latencies.push(row.latencyMs);
      cur.modelCounts.set(row.model, (cur.modelCounts.get(row.model) ?? 0) + 1);
      byProvider.set(row.providerId, cur);
    }

    function topModel(agg: ProvAgg | undefined, slug: string): string {
      if (!agg || agg.modelCounts.size === 0) {
        return DEFAULT_MODEL_FOR_SLUG[slug] ?? "—";
      }
      return [...agg.modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    }

    const baseRows = providers.map((p) => {
      const agg = byProvider.get(p.id);
      const model = topModel(agg, p.slug);
      const latencyMs =
        agg && agg.latencies.length > 0
          ? Math.round(
              agg.latencies.reduce((a, b) => a + b, 0) / agg.latencies.length
            )
          : slugDemoLatency(p.slug);
      const successRate =
        agg && agg.total > 0
          ? Math.round((1000 * agg.ok) / agg.total) / 10
          : slugDemoSuccess(p.slug);
      const costScore = MODEL_COST_SCORE[model] ?? 76;
      let status: "active" | "degraded" | "readonly" = "active";
      if (p.status !== "active") status = "readonly";
      else if (successRate < 92) status = "degraded";
      return {
        providerSlug: p.slug,
        providerName: p.name,
        model,
        costScore,
        latencyMs,
        successRate,
        status,
      };
    });

    function slugDemoLatency(slug: string): number {
      if (slug === "gemini") return 455;
      if (slug === "claude") return 720;
      return 380;
    }
    function slugDemoSuccess(slug: string): number {
      if (slug === "gemini") return 97.2;
      if (slug === "claude") return 98.1;
      return 99.0;
    }

    const balanceScore = (r: (typeof baseRows)[0]) =>
      0.45 * r.successRate +
      0.35 * r.costScore +
      0.2 * Math.max(0, 100 - Math.min(r.latencyMs / 12, 100));

    const sorted = [...baseRows].sort((a, b) => {
      if (strategyMode === "cost") {
        return b.costScore - a.costScore;
      }
      if (strategyMode === "quality") {
        if (b.successRate !== a.successRate) return b.successRate - a.successRate;
        return a.latencyMs - b.latencyMs;
      }
      return balanceScore(b) - balanceScore(a);
    });

    const providerPriority = sorted.map((r, i) => ({
      ...r,
      priority: i + 1,
    }));

    reply.send({
      windowDays,
      strategyMode,
      strategyNote: ROUTING_STRATEGY_NOTES[strategyMode],
      fallbackChains: ROUTING_FALLBACK_CHAINS.map((c) => ({ ...c })),
      providerPriority,
      routes: [...byRoute.entries()].map(([actualSlug, v]) => ({
        actualSlug,
        count: v.count,
        samplePrimary: v.primary,
        sampleReason: v.reason,
      })),
      recentFallbacks,
    });
  });

  const routingStrategyPatchSchema = z.object({
    mode: z.enum(["cost", "quality", "balance"]),
  });

  app.patch("/routing/strategy", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const parsed = routingStrategyPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.flatten() });
      return;
    }
    routingStrategyByTenant.set(tenantId, parsed.data.mode);
    reply.send({
      strategyMode: parsed.data.mode,
      strategyNote: ROUTING_STRATEGY_NOTES[parsed.data.mode],
    });
  });

  app.get("/optimization/summary", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const windowDays = 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true },
    });
    const pricePerM =
      tenant?.plan?.pricePerMillionTokens ?? new Prisma.Decimal("1.2000");

    const [hits, misses, tokenAgg, idemRows] = await Promise.all([
      prisma.apiRequestLog.count({
        where: { tenantId, createdAt: { gte: since }, cacheHit: true },
      }),
      prisma.apiRequestLog.count({
        where: { tenantId, createdAt: { gte: since }, cacheHit: false },
      }),
      prisma.apiRequestLog.aggregate({
        where: { tenantId, createdAt: { gte: since }, cacheHit: true },
        _sum: { totalTokens: true },
      }),
      prisma.apiRequestLog.findMany({
        where: {
          tenantId,
          createdAt: { gte: since },
          cacheHit: true,
          idempotencyKey: { not: null },
        },
        select: { idempotencyKey: true, totalTokens: true },
      }),
    ]);

    const savedTokens = tokenAgg._sum.totalTokens ?? 0;
    const savedUsd = new Prisma.Decimal(savedTokens)
      .div(1_000_000)
      .mul(pricePerM);
    const totalCalls = hits + misses;
    const cacheHitRate =
      totalCalls === 0 ? 0 : Math.round((1000 * hits) / totalCalls) / 10;

    const idemMap = new Map<string, { hits: number; savedTokens: number }>();
    for (const row of idemRows) {
      const key = row.idempotencyKey!;
      const cur = idemMap.get(key) ?? { hits: 0, savedTokens: 0 };
      cur.hits += 1;
      cur.savedTokens += row.totalTokens;
      idemMap.set(key, cur);
    }
    const fromDb = [...idemMap.entries()]
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, 12)
      .map(([key, v]) => ({
        id: `idem:${key}`,
        preview: key.length > 40 ? `${key.slice(0, 40)}…` : key,
        hits: v.hits,
        savedTokens: v.savedTokens,
        source: "idempotency" as const,
      }));

    const padded: {
      id: string;
      preview: string;
      hits: number;
      savedTokens: number;
      source: "idempotency" | "demo";
    }[] = [...fromDb];
    let padIdx = 0;
    while (padded.length < 8 && padIdx < REPEATED_PROMPT_PAD.length) {
      const r = REPEATED_PROMPT_PAD[padIdx];
      padded.push({
        id: `demo-${padIdx}`,
        preview: r.preview,
        hits: r.hits,
        savedTokens: r.savedTokens,
        source: "demo",
      });
      padIdx += 1;
    }

    const topRepeatedPrompts = padded.slice(0, 12);

    let promptTemplates: {
      id: string;
      name: string;
      description: string;
      snippet: string;
      uses: number;
      savedUsd: string;
    }[];
    try {
      const tplRows = await prisma.promptTemplate.findMany({
        where: { OR: [{ tenantId: null }, { tenantId }] },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      promptTemplates =
        tplRows.length > 0
          ? tplRows.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description ?? "",
              snippet: t.snippet,
              uses: t.usesHint,
              savedUsd: t.savedUsdHint,
            }))
          : PROMPT_TEMPLATE_MOCK.map((t) => ({ ...t }));
    } catch {
      promptTemplates = PROMPT_TEMPLATE_MOCK.map((t) => ({ ...t }));
    }

    reply.send({
      windowDays,
      cacheHitRate,
      savedTokens,
      estimatedSavedUsd: money(savedUsd),
      cacheHits: hits,
      nonCacheRequests: misses,
      note: "节省金额按「缓存命中累计 Token × 当前套餐每百万 Token 单价」估算；命中率=命中次数/（命中+未命中）。",
      valueLine:
        "平台通过语义与幂等缓存拦截重复流量，将本将消耗的 Token 与上游成本转化为可核算的节省项。",
      topRepeatedPrompts,
      promptTemplates,
    });
  });

  const cacheSettingsPatchSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(["exact", "semantic", "hybrid"]),
    similarityThreshold: z.number().min(0).max(1),
    ttlSeconds: z.number().int().min(60).max(604800),
  });

  app.get("/optimization/cache-settings", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    reply.send(getCacheSettings(tenantId));
  });

  app.patch("/optimization/cache-settings", { preHandler: authMiddleware }, async (request, reply) => {
    const { tenantId } = authed(request as AuthedRequest);
    const parsed = cacheSettingsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.flatten() });
      return;
    }
    const next = { ...getCacheSettings(tenantId), ...parsed.data };
    cacheSettingsByTenant.set(tenantId, next);
    reply.send(next);
  });

  app.get("/providers", { preHandler: authMiddleware }, async (_request, reply) => {
    const rows = await prisma.provider.findMany({ orderBy: { name: "asc" } });
    reply.send(rows);
  });

  const handleChatCompletions = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      reply.status(401).send({ error: "Missing Bearer AppKey" });
      return;
    }
    const rawKey = header.slice("Bearer ".length).trim();
    const appKey = await prisma.appKey.findFirst({
      where: { token: rawKey, status: "active" },
      include: { tenant: { include: { plan: true } } },
    });
    if (!appKey) {
      reply.status(401).send({ error: "Invalid or revoked AppKey" });
      return;
    }

    const parsedBody = chatBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      reply.status(400).send({ error: parsedBody.error.flatten() });
      return;
    }
    const model = parsedBody.data.model?.trim() || "gpt-4o-mini";
    const allowed = parseAllowedModels(appKey.allowedModels);
    if (allowed.length > 0 && !allowed.includes(model)) {
      reply
        .status(403)
        .send({ error: "此 AppKey 未授权使用该 model", allowedModels: allowed });
      return;
    }
    const messages = parsedBody.data.messages ?? [];
    const idemRaw = (request.headers["idempotency-key"] as string | undefined)?.trim();
    const idemKey = idemRaw ? `${appKey.id}:${idemRaw}` : null;

    if (idemKey) {
      const cached = getIdempotency(idemKey);
      if (cached) {
        const openai = await pickProvider("openai");
        if (!openai) {
          reply.status(500).send({ error: "No provider configured" });
          return;
        }
        const latencyMs = 8;
        await prisma.$transaction(async (tx) => {
          const logRow = await tx.apiRequestLog.create({
            data: {
              tenantId: appKey.tenantId,
              appKeyId: appKey.id,
              providerId: openai.id,
              model,
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              latencyMs,
              cacheHit: true,
              routingPrimary: "cache",
              routingActual: "cache",
              routingReason: null,
              statusCode: 200,
              idempotencyKey: idemRaw ?? null,
            },
          });
          await tx.usageRecord.create({
            data: {
              logId: logRow.id,
              tenantId: appKey.tenantId,
              period: dayPeriod(),
              totalTokens: 0,
            },
          });
          await tx.billingRecord.create({
            data: {
              logId: logRow.id,
              tenantId: appKey.tenantId,
              amountUsd: new Prisma.Decimal(0),
              description: "Idempotent cache hit — no charge",
              type: "cache_hit",
            },
          });
          await tx.appKey.update({
            where: { id: appKey.id },
            data: { lastUsedAt: new Date() },
          });
        });
        return reply.send(cached.response);
      }
    }

    const routing = resolveRouting(model);
    const provider = await pickProvider(routing.actualSlug);
    if (!provider) {
      reply.status(500).send({ error: "Provider not found" });
      return;
    }

    const promptTokens = estPromptTokens(messages);
    const completionTokens = 96 + Math.floor(Math.random() * 48);
    const totalTokens = promptTokens + completionTokens;
    const latencyMs = 36 + Math.floor(Math.random() * 55);

    const plan = appKey.tenant.plan;
    const pricePerM = plan?.pricePerMillionTokens ?? new Prisma.Decimal("1.5");
    const amountUsd = new Prisma.Decimal(totalTokens)
      .div(1_000_000)
      .mul(pricePerM);

    const content = `[mock:${provider.slug}] Demo completion for ${model} (~${totalTokens} tokens).`;

    const resPayload = {
      id: `chatcmpl-${randomBytes(12).toString("hex")}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content },
          finish_reason: "stop" as const,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };

    await prisma.$transaction(async (tx) => {
      const logRow = await tx.apiRequestLog.create({
        data: {
          tenantId: appKey.tenantId,
          appKeyId: appKey.id,
          providerId: provider.id,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs,
          cacheHit: false,
          routingPrimary: routing.primaryLabel,
          routingActual: provider.slug,
          routingReason: routing.reason,
          statusCode: 200,
          idempotencyKey: idemRaw ?? null,
        },
      });
      await tx.usageRecord.create({
        data: {
          logId: logRow.id,
          tenantId: appKey.tenantId,
          period: dayPeriod(),
          totalTokens,
        },
      });
      await tx.billingRecord.create({
        data: {
          logId: logRow.id,
          tenantId: appKey.tenantId,
          amountUsd,
          description: `LLM usage — ${model} via ${provider.slug}`,
          type: "usage",
        },
      });
      await tx.tenant.update({
        where: { id: appKey.tenantId },
        data: { balanceTokens: { decrement: new Prisma.Decimal(totalTokens) } },
      });
      await tx.appKey.update({
        where: { id: appKey.id },
        data: { lastUsedAt: new Date() },
      });
    });

    if (idemKey) {
      setIdempotency(idemKey, { response: resPayload, tokens: totalTokens });
    }

    return reply.send(resPayload);
  };

  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/gateway/v1/chat/completions", handleChatCompletions);
}