import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type AuditLogRow, type OpsOverview } from "../api";
import { formatCurrencyAmount, formatDateTime } from "../i18n/format";
import { pickText } from "../i18n/inline";

function statusText(configured: boolean, enabled: boolean, healthStatus: string, language: string | undefined): string {
  if (!configured) return pickText(language, "未配置", "Not configured");
  if (!enabled) return pickText(language, "已停用", "Disabled");
  return healthStatus;
}

export function Ops() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) =>
    pickText(i18n.resolvedLanguage, zhCN, enUS);
  const overviewQuery = useQuery({
    queryKey: ["ops", "overview"],
    queryFn: () => api<OpsOverview>("/ops/overview"),
  });
  const auditQuery = useQuery({
    queryKey: ["ops", "audit"],
    queryFn: () => api<AuditLogRow[]>("/ops/audit-logs"),
  });

  if (overviewQuery.isLoading) return <p className="muted usage-page-pad">{text("加载中…", "Loading…")}</p>;
  if (overviewQuery.error) {
    return <p className="error usage-page-pad">{(overviewQuery.error as Error).message}</p>;
  }

  const overview = overviewQuery.data!;
  const audits = auditQuery.data ?? [];

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">{text("运营与审计", "Operations & Audit")}</h1>
          <p className="usage-subtitle muted">
            {text("面向企业管理员的健康态势、预算运行和关键操作审计", "Health posture, budget status, and key operation audit for enterprise admins")}
          </p>
        </div>
      </header>

      <section className="bill-summary" aria-label={text("运营概览", "Operations Overview")}>
        <article className="bill-kpi bill-kpi--usage">
          <div className="bill-kpi-label">{text("24h 请求数", "24h Requests")}</div>
          <div className="bill-kpi-value">{overview.requests24h}</div>
        </article>
        <article className="bill-kpi bill-kpi--save">
          <div className="bill-kpi-label">{text("客户成功率", "Customer Success Rate")}</div>
          <div className="bill-kpi-value bill-kpi-value--save">
            {overview.customerSuccessRate.toFixed(1)}%
          </div>
        </article>
        <article className="bill-kpi bill-kpi--spend">
          <div className="bill-kpi-label">{text("24h 失败数", "24h Failures")}</div>
          <div className="bill-kpi-value">{overview.failed24h}</div>
        </article>
        <article className="bill-kpi bill-kpi--bal">
          <div className="bill-kpi-label">{text("本月费用", "Spend This Month")}</div>
          <div className="bill-kpi-value bill-kpi-value--bal">
            ${formatCurrencyAmount(overview.spendUsdMonth, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
          </div>
        </article>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("供应商健康", "Provider Health")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{text("供应商", "Provider")}</th>
                <th>{text("类型", "Type")}</th>
                <th>{text("优先级", "Priority")}</th>
                <th>{text("状态", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.providers.map((provider) => (
                <tr key={provider.slug}>
                  <td>{provider.slug}</td>
                  <td>{provider.type}</td>
                  <td>{provider.priority}</td>
                  <td>{statusText(provider.configured, provider.enabled, provider.healthStatus, i18n.resolvedLanguage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("最近审计日志", "Recent Audit Logs")}</h2>
        <p className="bill-section-desc muted">{text("近 100 条关键变更与登录行为", "Latest 100 key changes and sign-in activities")}</p>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{text("时间", "Time")}</th>
                <th>{text("动作", "Action")}</th>
                <th>{text("对象", "Target")}</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {audits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="bill-table-empty muted">
                    {text("暂无审计记录", "No audit logs")}
                  </td>
                </tr>
              ) : (
                audits.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt, i18n.resolvedLanguage)}</td>
                    <td>{row.action}</td>
                    <td>
                      {row.entityType}
                      {row.entityId ? ` · ${row.entityId}` : ""}
                    </td>
                    <td>{row.ip ?? text("—", "—")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
