import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminRechargeOrderRow,
  type AdminTrendSeries,
  type AdminUsageDimension,
  type AdminUsageOverview,
} from "../api";
import {
  formatCurrencyAmount,
  formatDateTime as formatDateTimeValue,
  formatNumber,
} from "../i18n/format";
import { pickText } from "../i18n/inline";

const DEFAULT_TO = new Date().toISOString().slice(0, 10);
const DEFAULT_FROM = shiftDate(DEFAULT_TO, -13);

const CHANNEL_LABELS: Record<string, string> = {
  alipay: "支付宝",
  wechat: "微信",
  bank_transfer: "对公转账",
  stripe: "国际支付",
};

const STATUS_LABELS: Record<string, string> = {
  success: "已到账",
  pending_review: "待审核",
  pending_payment: "待支付",
  pending: "处理中",
  processing: "处理中",
  cancelled: "已取消",
  failed: "失败",
};

const emptyOverview: AdminUsageOverview = {
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  dimension: "tenant",
  summaries: [],
  appKeys: [],
  models: [],
  userModels: [],
  appKeyTrends: [],
  modelTrends: [],
  recharges: [],
  rechargeOrders: [],
};

export function AdminUsage() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const [search, setSearch] = useState("");
  const [dimension, setDimension] = useState<AdminUsageDimension>("tenant");
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["admin", "usage-overview", dimension, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ dimension, from, to });
      return api<AdminUsageOverview>(`/admin/usage-overview?${params.toString()}`);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = overviewQuery.data;
    if (!data || !q) {
      return data ?? emptyOverview;
    }
    const matchesOrder = (row: AdminRechargeOrderRow) =>
      row.tenantName.toLowerCase().includes(q) ||
      row.orderNo.toLowerCase().includes(q) ||
      (row.payerName ?? "").toLowerCase().includes(q) ||
      (row.remark ?? "").toLowerCase().includes(q);
    const rechargeOrders = data.rechargeOrders.filter(matchesOrder);
    const orderTenantIds = new Set(rechargeOrders.map((row) => row.tenantId));
    return {
      ...data,
      summaries: data.summaries.filter(
        (row) =>
          row.name.toLowerCase().includes(q) ||
          (row.email ?? "").toLowerCase().includes(q) ||
          (row.platformRole ?? "").toLowerCase().includes(q) ||
          (row.tenantSlug ?? "").toLowerCase().includes(q) ||
          (row.tenantStatus ?? "").toLowerCase().includes(q),
      ),
      appKeys: data.appKeys.filter(
        (row) =>
          row.name.toLowerCase().includes(q) ||
          row.tenantName.toLowerCase().includes(q) ||
          row.environment.toLowerCase().includes(q),
      ),
      models: data.models.filter(
        (row) =>
          row.model.toLowerCase().includes(q) ||
          row.providerSlug.toLowerCase().includes(q),
      ),
      userModels: data.userModels.filter(
        (row) =>
          row.userName.toLowerCase().includes(q) ||
          (row.email ?? "").toLowerCase().includes(q) ||
          row.model.toLowerCase().includes(q),
      ),
      appKeyTrends: data.appKeyTrends.filter((row) =>
        row.label.toLowerCase().includes(q),
      ),
      modelTrends: data.modelTrends.filter((row) =>
        row.label.toLowerCase().includes(q),
      ),
      recharges: data.recharges.filter(
        (row) => row.tenantName.toLowerCase().includes(q) || orderTenantIds.has(row.tenantId),
      ),
      rechargeOrders,
    };
  }, [overviewQuery.data, search]);

  const summaryStats = useMemo(() => {
    return {
      totalRequests: filtered.summaries.reduce((sum, row) => sum + row.requestCount, 0),
      totalTokens: filtered.summaries.reduce((sum, row) => sum + row.totalTokens, 0),
      rechargeCount: filtered.summaries.reduce((sum, row) => sum + row.rechargeCount, 0),
      rechargeAmount: filtered.summaries.reduce(
        (sum, row) => sum + Number.parseFloat(row.rechargeSuccessCny || "0"),
        0,
      ),
    };
  }, [filtered]);

  if (overviewQuery.isLoading) {
    return <p className="muted usage-page-pad">{text("加载中…", "Loading…")}</p>;
  }
  if (overviewQuery.error) {
    return (
      <p className="error usage-page-pad">
        {(overviewQuery.error as Error).message}
      </p>
    );
  }

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">调用与充值统计</h1>
          <p className="usage-subtitle muted">
            支持按时间筛选、用户/租户维度切换，并查看 AppKey / 模型趋势与充值单明细
          </p>
        </div>
      </header>

      <section className="usage-filters">
        <div className="usage-filter-grid admin-usage-filter-grid">
          <div className="usage-filter-block">
            <span className="usage-filter-label">搜索</span>
            <div className="pane-search" style={{ maxWidth: "100%" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
                <path
                  fill="currentColor"
                  d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                />
              </svg>
              <input
                placeholder="搜索用户 / 租户 / AppKey / 模型 / 订单号"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="usage-filter-field">
            <span className="usage-filter-label">统计维度</span>
            <div className="admin-usage-toggle">
              <button
                className={`btn ${dimension === "tenant" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDimension("tenant")}
                type="button"
              >
                租户
              </button>
              <button
                className={`btn ${dimension === "user" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDimension("user")}
                type="button"
              >
                用户
              </button>
            </div>
          </div>

          <div className="usage-filter-field">
            <span className="usage-filter-label">时间范围</span>
            <div className="usage-date-row">
              <input
                className="input-plain usage-input"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="usage-date-sep">至</span>
              <input
                className="input-plain usage-input"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="usage-filter-field">
            <span className="usage-filter-label">快捷范围</span>
            <div className="usage-preset-row">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  className="btn btn-ghost usage-chip"
                  onClick={() => {
                    setTo(DEFAULT_TO);
                    setFrom(shiftDate(DEFAULT_TO, -(days - 1)));
                  }}
                  type="button"
                >
                  最近 {days} 天
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="usage-filter-meta muted">
          当前区间：{filtered.from} 至 {filtered.to}，默认按 UTC 自然日统计。
        </p>
      </section>

      <section className="bill-summary">
        <article className="bill-kpi bill-kpi--usage">
          <div className="bill-kpi-label">维度实体数</div>
          <div className="bill-kpi-value">{filtered.summaries.length}</div>
          <div className="bill-kpi-hint muted">
            当前按{dimension === "tenant" ? "租户" : "用户"}聚合
          </div>
        </article>
        <article className="bill-kpi bill-kpi--spend">
          <div className="bill-kpi-label">请求总数</div>
          <div className="bill-kpi-value">
            {formatNumber(summaryStats.totalRequests, i18n.resolvedLanguage)}
          </div>
          <div className="bill-kpi-hint muted">
            Token {text("总量", "total")} {formatNumber(summaryStats.totalTokens, i18n.resolvedLanguage)}
          </div>
        </article>
        <article className="bill-kpi bill-kpi--bal">
          <div className="bill-kpi-label">充值订单数</div>
          <div className="bill-kpi-value">{summaryStats.rechargeCount}</div>
          <div className="bill-kpi-hint muted">
            成功金额 ¥{formatMoney(summaryStats.rechargeAmount)}
          </div>
        </article>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">
          {dimension === "tenant" ? "租户维度统计" : "用户维度统计"}
        </h2>
        <p className="bill-section-desc muted">
          可快速切换运营视角，观察请求量、Token 用量与充值结果。
        </p>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{dimension === "tenant" ? "租户" : "用户"}</th>
                <th>{dimension === "tenant" ? "Slug / 状态" : "邮箱 / 平台角色"}</th>
                <th>{dimension === "tenant" ? "成员数" : "关联租户"}</th>
                <th>请求数</th>
                <th>总 Token</th>
                <th>充值次数</th>
                <th>成功金额(CNY)</th>
                <th>到账 Tokens</th>
                <th>最近调用</th>
                <th>最近充值</th>
              </tr>
            </thead>
            <tbody>
              {filtered.summaries.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={10}>
                    当前筛选条件下暂无数据
                  </td>
                </tr>
              ) : (
                filtered.summaries.map((row) => (
                  <tr key={row.id}>
                    <td className="usage-td-strong">{row.name}</td>
                    <td>
                      {dimension === "tenant" ? (
                        <div>
                          <div className="usage-code-sm">{row.tenantSlug || "—"}</div>
                          <span className="admin-usage-subtle">
                            {formatTenantStatus(row.tenantStatus)}
                          </span>
                        </div>
                      ) : (
                        <div>
                          <div className="usage-code-sm">{row.email || "—"}</div>
                          <span className="admin-usage-subtle">
                            {formatPlatformRole(row.platformRole)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>{dimension === "tenant" ? row.memberCount ?? 0 : row.tenantCount ?? 0}</td>
                    <td>{formatNumber(row.requestCount, i18n.resolvedLanguage)}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.rechargeCount}</td>
                    <td>{row.rechargeSuccessCny}</td>
                    <td>{formatIntegerString(row.rechargeTokens)}</td>
                    <td className="bill-td-date">{formatDateTime(row.lastRequestAt)}</td>
                    <td className="bill-td-date">{formatDateTime(row.lastRechargeAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <TrendChart
        title="AppKey 调用趋势"
        description="展示当前筛选区间内请求量最高的 AppKey 日趋势。"
        series={filtered.appKeyTrends}
      />

      <TrendChart
        title="模型调用趋势"
        description="展示当前筛选区间内调用量最高的模型日趋势。"
        series={filtered.modelTrends}
      />

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">AppKey 调用情况</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>AppKey</th>
                <th>租户</th>
                <th>环境</th>
                <th>请求数</th>
                <th>成功数</th>
                <th>总 Token</th>
                <th>费用(USD)</th>
                <th>最近调用</th>
              </tr>
            </thead>
            <tbody>
              {filtered.appKeys.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={8}>
                    当前筛选条件下暂无数据
                  </td>
                </tr>
              ) : (
                filtered.appKeys.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.tenantName}</td>
                    <td>{row.environment}</td>
                    <td>{row.requestCount}</td>
                    <td>{row.successCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.spendUsd}</td>
                    <td>{formatDateTime(row.lastCalledAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">模型调用情况</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>供应商</th>
                <th>请求数</th>
                <th>总 Token</th>
                <th>费用(USD)</th>
                <th>平均延迟</th>
                <th>成功率</th>
              </tr>
            </thead>
            <tbody>
              {filtered.models.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={7}>
                    当前筛选条件下暂无数据
                  </td>
                </tr>
              ) : (
                filtered.models.map((row) => (
                  <tr key={`${row.model}-${row.providerSlug}`}>
                    <td>{row.model}</td>
                    <td>{row.providerSlug}</td>
                    <td>{row.requestCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.spendUsd}</td>
                    <td>{row.avgLatencyMs} ms</td>
                    <td>{row.successRate.toFixed(1)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">用户模型调用情况</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>邮箱</th>
                <th>模型</th>
                <th>请求数</th>
                <th>总 Token</th>
                <th>费用(USD)</th>
                <th>最近调用</th>
              </tr>
            </thead>
            <tbody>
              {filtered.userModels.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={7}>
                    当前筛选条件下暂无用户模型调用数据
                  </td>
                </tr>
              ) : (
                filtered.userModels.map((row) => (
                  <tr key={`${row.userId}-${row.model}`}>
                    <td>{row.userName}</td>
                    <td>{row.email ?? "—"}</td>
                    <td>{row.model}</td>
                    <td>{row.requestCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.spendUsd}</td>
                    <td>{formatDateTime(row.lastCalledAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">租户充值情况</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th></th>
                <th>租户</th>
                <th>充值次数</th>
                <th>成功金额(CNY)</th>
                <th>到账 Tokens</th>
                <th>最近充值</th>
              </tr>
            </thead>
            <tbody>
              {filtered.recharges.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={6}>
                    当前筛选条件下暂无充值数据
                  </td>
                </tr>
              ) : (
                filtered.recharges.map((row) => {
                  const tenantOrders = filtered.rechargeOrders.filter(
                    (order) => order.tenantId === row.tenantId,
                  );
                  const expanded = expandedTenantId === row.tenantId;
                  return (
                    <Fragment key={row.tenantId}>
                      <tr>
                        <td>
                          <button
                            className="btn btn-ghost admin-usage-expand"
                            onClick={() =>
                              setExpandedTenantId(expanded ? null : row.tenantId)
                            }
                            type="button"
                          >
                            {expanded ? "收起" : `展开 ${tenantOrders.length || ""}`.trim()}
                          </button>
                        </td>
                        <td>{row.tenantName}</td>
                        <td>{row.rechargeCount}</td>
                        <td>{row.successAmountCny}</td>
                        <td>{formatIntegerString(row.successTokens)}</td>
                        <td>{formatDateTime(row.lastRechargeAt)}</td>
                      </tr>
                      {expanded ? (
                        <tr className="admin-usage-detail-row">
                          <td colSpan={6}>
                            <div className="admin-usage-detail-wrap">
                              {tenantOrders.length === 0 ? (
                                <p className="muted admin-usage-detail-empty">
                                  当前租户在此筛选条件下没有充值单明细。
                                </p>
                              ) : (
                                <table className="admin-usage-detail-table">
                                  <thead>
                                    <tr>
                                      <th>订单号</th>
                                      <th>金额</th>
                                      <th>渠道</th>
                                      <th>状态</th>
                                      <th>到账 Tokens</th>
                                      <th>付款人</th>
                                      <th>创建时间</th>
                                      <th>备注</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {tenantOrders.map((order) => (
                                      <tr key={order.id}>
                                        <td className="usage-code-sm">{order.orderNo}</td>
                                        <td>
                                          {order.currency === "USD" ? "$" : "¥"}
                                          {order.amount}
                                        </td>
                                        <td>{CHANNEL_LABELS[order.payChannel] || order.payChannel}</td>
                                        <td>{STATUS_LABELS[order.status] || order.status}</td>
                                        <td>{formatIntegerString(order.creditedTokens)}</td>
                                        <td>{order.payerName || "—"}</td>
                                        <td className="bill-td-date">
                                          {formatDateTime(order.createdAt)}
                                        </td>
                                        <td className="bill-td-desc">
                                          {[
                                            order.needInvoice ? "需发票" : null,
                                            order.remark,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ") || "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TrendChart({
  title,
  description,
  series,
}: {
  title: string;
  description: string;
  series: AdminTrendSeries[];
}) {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const maxCount = Math.max(
    1,
    ...series.flatMap((item) => item.points.map((point) => point.requestCount)),
  );
  return (
    <section className="bill-section">
      <h2 className="bill-section-title">{title}</h2>
      <p className="bill-section-desc muted">{description}</p>
      <div className="admin-usage-trend-grid">
        {series.length === 0 ? (
          <div className="admin-usage-trend-empty muted">当前筛选条件下暂无趋势数据</div>
        ) : (
          series.map((item) => (
            <article className="admin-usage-trend-card" key={item.key}>
              <div className="admin-usage-trend-head">
                <div className="admin-usage-trend-name">{item.label}</div>
                <div className="admin-usage-trend-total">
                  {text(`${formatNumber(item.requestCount, i18n.resolvedLanguage)} 请求`, `${formatNumber(item.requestCount, i18n.resolvedLanguage)} requests`)}
                </div>
              </div>
              <div className="admin-usage-trend-bars">
                {item.points.map((point) => (
                  <div
                    className="admin-usage-trend-bar-col"
                    key={`${item.key}-${point.date}`}
                    title={`${point.date} · ${point.requestCount} 请求`}
                  >
                    <span
                      style={{
                        height:
                          point.requestCount === 0
                            ? "0%"
                            : `${Math.max((point.requestCount / maxCount) * 100, 8)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="admin-usage-trend-axis">
                <span>{item.points[0]?.date || "—"}</span>
                <span>{item.points[item.points.length - 1]?.date || "—"}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  return value ? formatDateTimeValue(value) : "—";
}

function formatMoney(value: number) {
  return formatCurrencyAmount(value, undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatIntegerString(value: string) {
  const numeric = Number.parseFloat(value || "0");
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return formatNumber(numeric, undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPlatformRole(value?: string | null) {
  if (value === "platform_admin") {
    return "平台管理员";
  }
  if (value === "user") {
    return "普通用户";
  }
  return value || "—";
}

function formatTenantStatus(value?: string | null) {
  if (!value) {
    return "—";
  }
  if (value === "active") {
    return "启用中";
  }
  if (value === "trial") {
    return "试用中";
  }
  return value;
}
