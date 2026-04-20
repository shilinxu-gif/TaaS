import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type DashboardSummary, type LogRow } from "../api";
import { formatCurrencyAmount, formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

export function Dashboard() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) =>
    pickText(i18n.resolvedLanguage, zhCN, enUS);
  const summaryQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardSummary>("/dashboard/summary"),
  });
  const logsQuery = useQuery({
    queryKey: ["logs", "dash"],
    queryFn: () => api<LogRow[]>("/logs"),
  });

  if (summaryQuery.isLoading) return <p className="muted dash-pad">{text("加载中…", "Loading…")}</p>;
  if (summaryQuery.error)
    return (
      <p className="error dash-pad">{(summaryQuery.error as Error).message}</p>
    );

  const d = summaryQuery.data!;
  const today = d.today ?? {
    spendUsd: "0",
    tokens: 0,
    cacheSavingsUsd: "0",
  };
  const recent = (logsQuery.data ?? []).slice(0, 10);
  const series = d.chartSeries7d ?? [];
  const maxTok = Math.max(1, ...series.map((s) => s.tokens));
  const mix = d.modelMix7d ?? [];
  const maxMix = Math.max(1, ...mix.map((m) => m.tokens));
  const risks = d.risks ?? [];

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <h1 className="dash-title">{text("工作台", "Dashboard")}</h1>
          <p className="dash-subtitle muted">
            {d.tenant.name}
            {d.tenant.plan ? (
              <span className="dash-plan">{d.tenant.plan.name}</span>
            ) : null}
          </p>
          {d.tenant.status === "trial" ? (
            <p className="muted">
              {text("试用中", "Trial")}
              {d.tenant.trialDaysRemaining != null
                ? text(` · 剩余 ${d.tenant.trialDaysRemaining} 天`, ` · ${d.tenant.trialDaysRemaining} days left`)
                : ""}
              {d.tenant.contactSalesEmail
                ? text(` · 升级联系 ${d.tenant.contactSalesEmail}`, ` · Contact sales: ${d.tenant.contactSalesEmail}`)
                : ""}
            </p>
          ) : null}
        </div>
      </header>

      <section className="dash-kpi-row">
        <div className="dash-kpi dash-kpi--blue">
          <div className="dash-kpi-label">{text("当前余额", "Current Balance")}</div>
          <div className="dash-kpi-value">
            {formatNumber(Number(d.tenant.balanceTokens), i18n.resolvedLanguage)}
            <span className="dash-kpi-unit">tokens</span>
          </div>
        </div>
        <div className="dash-kpi dash-kpi--blue">
          <div className="dash-kpi-label">{text("今日消耗", "Today's Spend")}</div>
          <div className="dash-kpi-value">
            ${formatCurrencyAmount(today.spendUsd, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
            <span className="dash-kpi-unit">USD</span>
          </div>
        </div>
        <div className="dash-kpi dash-kpi--blue">
          <div className="dash-kpi-label">{text("今日 Token", "Today's Tokens")}</div>
          <div className="dash-kpi-value">
            {formatNumber(today.tokens, i18n.resolvedLanguage)}
          </div>
        </div>
        <div className="dash-kpi dash-kpi--green">
          <div className="dash-kpi-label">{text("缓存节省金额", "Cache Savings")}</div>
          <div className="dash-kpi-value dash-kpi-value--green">
            ${formatCurrencyAmount(today.cacheSavingsUsd, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
            <span className="dash-kpi-unit">USD</span>
          </div>
          <div className="dash-kpi-hint">
            {text("基于缓存命中与单价估算的节省金额", "Estimated savings based on cache hits and unit pricing")}
          </div>
        </div>
      </section>

      <div className="dash-grid-2">
        <section className="dash-card">
          <h2 className="dash-card-title">{text("服务水平", "Service Level")}</h2>
          <p className="dash-card-desc muted">
            {text(
              `客户成功率 ${d.kpis.customerSuccessRate.toFixed(1)}% · 上游成功率 ${d.kpis.providerSuccessRate.toFixed(1)}% · 平均延迟 ${d.kpis.averageLatencyMs} ms`,
              `Customer success ${d.kpis.customerSuccessRate.toFixed(1)}% · Provider success ${d.kpis.providerSuccessRate.toFixed(1)}% · Avg latency ${d.kpis.averageLatencyMs} ms`,
            )}
          </p>
          <ul className="dash-chart-list">
            <li className="dash-chart-item">
              <span className="dash-chart-model">{text("SLO 目标", "SLO Target")}</span>
              <span className="dash-chart-num">
                {d.serviceTargets?.successSloPct ?? 99.5}% /{" "}
                {d.serviceTargets?.latencySloMs ?? 1500} ms
              </span>
            </li>
            <li className="dash-chart-item">
              <span className="dash-chart-model">{text("24h 失败请求", "24h Failed Requests")}</span>
              <span className="dash-chart-num">{d.kpis.failedRequests24h}</span>
            </li>
          </ul>
        </section>

        <section className="dash-card">
          <h2 className="dash-card-title">{text("近 7 天用量趋势", "Usage Trend (Last 7 Days)")}</h2>
          <p className="dash-card-desc muted">{text("按日汇总 Token 消耗", "Daily aggregated token consumption")}</p>
          <ul className="dash-chart-list">
            {series.map((s) => (
              <li key={s.date} className="dash-chart-item">
                <span className="dash-chart-date">
                  {s.date.slice(5).replace("-", "/")}
                </span>
                <div className="dash-chart-track">
                  <div
                    className="dash-chart-fill dash-chart-fill--blue"
                    style={{
                      width: `${Math.max(6, Math.round((s.tokens / maxTok) * 100))}%`,
                    }}
                  />
                </div>
                <span className="dash-chart-num">
                  {formatNumber(s.tokens, i18n.resolvedLanguage)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dash-card">
          <h2 className="dash-card-title">{text("模型消耗分布", "Model Consumption Mix")}</h2>
          <p className="dash-card-desc muted">{text("近 7 天按模型 Token 占比", "Token share by model over the last 7 days")}</p>
          {mix.length === 0 ? (
            <p className="muted">{text("暂无数据", "No data")}</p>
          ) : (
            <ul className="dash-chart-list">
              {mix.map((m) => (
                <li key={m.model} className="dash-chart-item">
                  <span className="dash-chart-model" title={m.model}>
                    {m.model}
                  </span>
                  <div className="dash-chart-track">
                    <div
                      className="dash-chart-fill dash-chart-fill--indigo"
                      style={{
                        width: `${Math.max(6, Math.round((m.tokens / maxMix) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="dash-chart-num">
                    {formatNumber(m.tokens, i18n.resolvedLanguage)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="dash-card dash-card--risks">
        <h2 className="dash-card-title">{text("风险提醒", "Risk Alerts")}</h2>
        <p className="dash-card-desc muted">{text("基于余额、用量与错误率的实时规则", "Real-time rules based on balance, usage, and error rate")}</p>
        <ul className="dash-risk-list">
          {risks.map((r, i) => (
            <li
              key={`${r.title}-${i}`}
              className={`dash-risk dash-risk--${r.level}`}
            >
              <div className="dash-risk-title">{r.title}</div>
              <p className="dash-risk-detail muted">{r.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="dash-card">
        <h2 className="dash-card-title">{text("最近请求", "Recent Requests")}</h2>
        <p className="dash-card-desc muted">{text("最新 10 条网关调用记录", "Latest 10 gateway request logs")}</p>
        {logsQuery.isLoading ? (
          <p className="muted">{text("加载中…", "Loading…")}</p>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>{text("时间", "Time")}</th>
                  <th>{text("模型", "Model")}</th>
                  <th>{text("供应商", "Provider")}</th>
                  <th>Token</th>
                  <th>{text("延迟", "Latency")}</th>
                  <th>{text("缓存", "Cache")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className="dash-td-time">
                      {formatDateTime(row.createdAt, i18n.resolvedLanguage)}
                    </td>
                    <td>
                      <code className="dash-code">{row.model}</code>
                    </td>
                    <td>{row.provider.slug}</td>
                    <td className="dash-td-num">
                      {formatNumber(row.totalTokens, i18n.resolvedLanguage)}
                    </td>
                    <td>{row.latencyMs} ms</td>
                    <td>
                      {row.cacheHit ? (
                        <span className="dash-badge dash-badge--ok">{text("命中", "Hit")}</span>
                      ) : (
                        <span className="dash-badge">{text("未命中", "Miss")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
