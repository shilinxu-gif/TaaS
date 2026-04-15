import { useQuery } from "@tanstack/react-query";
import { api, type AuditLogRow, type OpsOverview } from "../api";

function statusText(configured: boolean, enabled: boolean, healthStatus: string): string {
  if (!configured) return "未配置";
  if (!enabled) return "已停用";
  return healthStatus;
}

export function Ops() {
  const overviewQuery = useQuery({
    queryKey: ["ops", "overview"],
    queryFn: () => api<OpsOverview>("/ops/overview"),
  });
  const auditQuery = useQuery({
    queryKey: ["ops", "audit"],
    queryFn: () => api<AuditLogRow[]>("/ops/audit-logs"),
  });

  if (overviewQuery.isLoading) return <p className="muted usage-page-pad">加载中…</p>;
  if (overviewQuery.error) {
    return <p className="error usage-page-pad">{(overviewQuery.error as Error).message}</p>;
  }

  const overview = overviewQuery.data!;
  const audits = auditQuery.data ?? [];

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">运营与审计</h1>
          <p className="usage-subtitle muted">
            面向企业管理员的健康态势、预算运行和关键操作审计
          </p>
        </div>
      </header>

      <section className="bill-summary" aria-label="运营概览">
        <article className="bill-kpi bill-kpi--usage">
          <div className="bill-kpi-label">24h 请求数</div>
          <div className="bill-kpi-value">{overview.requests24h}</div>
        </article>
        <article className="bill-kpi bill-kpi--save">
          <div className="bill-kpi-label">客户成功率</div>
          <div className="bill-kpi-value bill-kpi-value--save">
            {overview.customerSuccessRate.toFixed(1)}%
          </div>
        </article>
        <article className="bill-kpi bill-kpi--spend">
          <div className="bill-kpi-label">24h 失败数</div>
          <div className="bill-kpi-value">{overview.failed24h}</div>
        </article>
        <article className="bill-kpi bill-kpi--bal">
          <div className="bill-kpi-label">本月费用</div>
          <div className="bill-kpi-value bill-kpi-value--bal">
            ${Number(overview.spendUsdMonth).toLocaleString("zh-CN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
          </div>
        </article>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">供应商健康</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>供应商</th>
                <th>类型</th>
                <th>优先级</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {overview.providers.map((provider) => (
                <tr key={provider.slug}>
                  <td>{provider.slug}</td>
                  <td>{provider.type}</td>
                  <td>{provider.priority}</td>
                  <td>{statusText(provider.configured, provider.enabled, provider.healthStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">最近审计日志</h2>
        <p className="bill-section-desc muted">近 100 条关键变更与登录行为</p>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>对象</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {audits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="bill-table-empty muted">
                    暂无审计记录
                  </td>
                </tr>
              ) : (
                audits.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString("zh-CN")}</td>
                    <td>{row.action}</td>
                    <td>
                      {row.entityType}
                      {row.entityId ? ` · ${row.entityId}` : ""}
                    </td>
                    <td>{row.ip ?? "—"}</td>
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
