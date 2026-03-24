import { useQuery } from "@tanstack/react-query";
import { api, type DashboardSummary, type LogRow } from "../api";

function formatUsd(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function Dashboard() {
  const summaryQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardSummary>("/dashboard/summary"),
  });
  const logsQuery = useQuery({
    queryKey: ["logs", "dash"],
    queryFn: () => api<LogRow[]>("/logs"),
  });

  if (summaryQuery.isLoading) return <p className="muted dash-pad">加载中…</p>;
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
          <h1 className="dash-title">工作台</h1>
          <p className="dash-subtitle muted">
            {d.tenant.name}
            {d.tenant.plan ? (
              <span className="dash-plan">{d.tenant.plan.name}</span>
            ) : null}
          </p>
        </div>
      </header>

      <section className="dash-kpi-row">
        <div className="dash-kpi dash-kpi--blue">
          <div className="dash-kpi-label">当前余额</div>
          <div className="dash-kpi-value">
            {Number(d.tenant.balanceTokens).toLocaleString("zh-CN")}
            <span className="dash-kpi-unit">tokens</span>
          </div>
        </div>
        <div className="dash-kpi dash-kpi--blue">
          <div className="dash-kpi-label">今日消耗</div>
          <div className="dash-kpi-value">
            ${formatUsd(today.spendUsd)}
            <span className="dash-kpi-unit">USD</span>
          </div>
        </div>
        <div className="dash-kpi dash-kpi--blue">
          <div className="dash-kpi-label">今日 Token</div>
          <div className="dash-kpi-value">
            {today.tokens.toLocaleString("zh-CN")}
          </div>
        </div>
        <div className="dash-kpi dash-kpi--green">
          <div className="dash-kpi-label">缓存节省金额</div>
          <div className="dash-kpi-value dash-kpi-value--green">
            ${formatUsd(today.cacheSavingsUsd)}
            <span className="dash-kpi-unit">USD</span>
          </div>
          <div className="dash-kpi-hint">
            基于缓存命中与单价估算的节省金额
          </div>
        </div>
      </section>

      <div className="dash-grid-2">
        <section className="dash-card">
          <h2 className="dash-card-title">近 7 天用量趋势</h2>
          <p className="dash-card-desc muted">按日汇总 Token 消耗</p>
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
                  {s.tokens.toLocaleString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dash-card">
          <h2 className="dash-card-title">模型消耗分布</h2>
          <p className="dash-card-desc muted">近 7 天按模型 Token 占比</p>
          {mix.length === 0 ? (
            <p className="muted">暂无数据</p>
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
                    {m.tokens.toLocaleString("zh-CN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="dash-card dash-card--risks">
        <h2 className="dash-card-title">风险提醒</h2>
        <p className="dash-card-desc muted">基于余额、用量与错误率的演示规则</p>
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
        <h2 className="dash-card-title">最近请求</h2>
        <p className="dash-card-desc muted">最新 10 条网关调用记录</p>
        {logsQuery.isLoading ? (
          <p className="muted">加载中…</p>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模型</th>
                  <th>供应商</th>
                  <th>Token</th>
                  <th>延迟</th>
                  <th>缓存</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className="dash-td-time">
                      {new Date(row.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td>
                      <code className="dash-code">{row.model}</code>
                    </td>
                    <td>{row.provider.slug}</td>
                    <td className="dash-td-num">
                      {row.totalTokens.toLocaleString("zh-CN")}
                    </td>
                    <td>{row.latencyMs} ms</td>
                    <td>
                      {row.cacheHit ? (
                        <span className="dash-badge dash-badge--ok">命中</span>
                      ) : (
                        <span className="dash-badge">未命中</span>
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
