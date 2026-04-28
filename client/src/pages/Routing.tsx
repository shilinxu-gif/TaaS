import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type RoutingStrategyMode, type RoutingSummary } from "../api";
import { formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

function statusBadge(
  status: RoutingSummary["providerPriority"][0]["status"],
  language: string | undefined,
) {
  if (status === "active") {
    return <span className="rt-badge rt-badge--ok">{pickText(language, "正常", "Healthy")}</span>;
  }
  if (status === "degraded") {
    return <span className="rt-badge rt-badge--warn">{pickText(language, "降级", "Degraded")}</span>;
  }
  return <span className="rt-badge rt-badge--muted">{pickText(language, "只读", "Read-only")}</span>;
}

export function Routing() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["routing"],
    queryFn: () => api<RoutingSummary>("/routing/summary"),
  });

  const strategyMut = useMutation({
    mutationFn: (mode: RoutingStrategyMode) =>
      api<{ strategyMode: RoutingStrategyMode; strategyNote: string }>(
        "/routing/strategy",
        {
          method: "PATCH",
          body: JSON.stringify({ mode }),
        }
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["routing"] }),
  });

  if (isLoading) return <p className="muted rt-page-pad">{text("加载中…", "Loading…")}</p>;
  if (error) return <p className="error rt-page-pad">{(error as Error).message}</p>;

  const d = data!;
  const maxRoute = Math.max(1, ...d.routes.map((r) => r.count));

  const modes: { id: RoutingStrategyMode; label: string; sub: string }[] = [
    {
      id: "cost",
      label: text("成本优先", "Cost First"),
      sub: text("经济性评分优先", "Prioritize cost score"),
    },
    {
      id: "quality",
      label: text("质量优先", "Quality First"),
      sub: text("成功率与延迟优先", "Prioritize success rate and latency"),
    },
    {
      id: "balance",
      label: text("均衡", "Balanced"),
      sub: text("加权综合（默认）", "Weighted mix (default)"),
    },
  ];

  return (
    <div className="rt-page">
      <header className="rt-header">
        <div>
          <h1 className="rt-title">{text("路由调度", "Routing")}</h1>
          <p className="rt-lead muted">
            {text(
              `查看策略模式、降级链路、供应商优先级与真实请求分布（近 ${d.windowDays} 天）`,
              `Review strategy mode, fallback chains, provider priority, and real request distribution (last ${d.windowDays} days)`,
            )}
          </p>
        </div>
      </header>

      <section className="rt-card rt-card--strategy">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">{text("当前模型策略", "Current Routing Strategy")}</h2>
          <p className="rt-card-desc muted">{d.strategyNote}</p>
        </div>
        <p className="muted rt-strategy-hint">
          {text("首选供应商：", "Primary provider: ")}{d.config?.primaryProviderType ?? text("自动", "Auto")}
          {d.config?.fallbackProviderTypes?.length
            ? ` · fallback：${d.config.fallbackProviderTypes.join(" → ")}`
            : ""}
          {d.config ? text(` · 重试 ${d.config.maxRetries} 次 · 超时 ${d.config.timeoutMs} ms`, ` · ${d.config.maxRetries} retries · ${d.config.timeoutMs} ms timeout`) : ""}
        </p>
        <div className="rt-mode-row" role="radiogroup" aria-label={text("策略模式", "Strategy Mode")}>
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={d.strategyMode === m.id}
              className={`rt-mode-pill${d.strategyMode === m.id ? " rt-mode-pill--active" : ""}`}
              disabled={strategyMut.isPending}
              onClick={() => strategyMut.mutate(m.id)}
            >
              <span className="rt-mode-label">{m.label}</span>
              <span className="rt-mode-sub">{m.sub}</span>
            </button>
          ))}
        </div>
        <p className="rt-strategy-hint muted">
          {text("切换后下方「供应商优先级」表格会按对应规则重新排序。", "After switching, the provider priority table below will be re-sorted according to the selected rule.")}
        </p>
        {strategyMut.error ? (
          <p className="error rt-strategy-err">
            {(strategyMut.error as Error).message}
          </p>
        ) : null}
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">{text("Fallback 降级链", "Fallback Chains")}</h2>
          <p className="rt-card-desc muted">
            {text("主模型不可用或超时时按链条依次尝试，保证业务连续性", "When the primary model is unavailable or times out, the system tries the chain in order to keep traffic flowing")}
          </p>
        </div>
        <div className="rt-chain-grid">
          {d.fallbackChains.map((c) => (
            <div key={c.id} className="rt-chain-card">
              <div className="rt-chain-cap">{c.title}</div>
              <p className="rt-chain-desc muted">{c.description}</p>
              <div className="rt-chain-track" aria-label={text("模型链路", "Model Chain")}>
                {c.models.map((step, i) => (
                  <span key={`${c.id}-${i}`} className="rt-chain-step-wrap">
                    {i > 0 ? (
                      <span className="rt-chain-arrow" aria-hidden>
                        →
                      </span>
                    ) : null}
                    <span className="rt-chain-step">{step}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">{text("供应商优先级", "Provider Priority")}</h2>
          <p className="rt-card-desc muted">
            {text(
              `基于当前「${modes.find((x) => x.id === d.strategyMode)?.label}」策略排序；延迟与成功率基于租户近 ${d.windowDays} 天日志聚合`,
              `Sorted by the current “${modes.find((x) => x.id === d.strategyMode)?.label}” strategy. Latency and success rate are aggregated from the tenant's logs over the last ${d.windowDays} days`,
            )}
          </p>
        </div>
        <div className="rt-table-wrap">
          <table className="rt-table">
            <thead>
              <tr>
                <th>{text("优先级", "Priority")}</th>
                <th>{text("供应商", "Provider")}</th>
                <th>{text("类型", "Type")}</th>
                <th>{text("模型", "Model")}</th>
                <th>{text("经济性评分", "Cost Score")}</th>
                <th>{text("延迟", "Latency")}</th>
                <th>{text("成功率", "Success Rate")}</th>
                <th>{text("状态", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {d.providerPriority.map((row) => (
                <tr key={row.providerSlug}>
                  <td className="rt-priority">{row.priority}</td>
                  <td className="rt-td-name">{row.providerName}</td>
                  <td>{row.providerType}</td>
                  <td>
                    <code className="rt-code">{row.model}</code>
                  </td>
                  <td className="tabular-nums rt-td-score">{row.costScore}</td>
                  <td className="tabular-nums">{row.latencyMs} ms</td>
                  <td className="tabular-nums rt-td-rate">
                    {formatNumber(row.successRate, i18n.resolvedLanguage, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </td>
                  <td>
                    {statusBadge(row.status, i18n.resolvedLanguage)}
                    <span className="muted rt-route-sub">
                      {row.configured ? ` · ${row.healthStatus}` : text(" · 未配置", " · Not configured")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">{text("实际路由分布", "Actual Routing Distribution")}</h2>
          <p className="rt-card-desc muted">
            {text("各请求最终落到的供应商（routingActual），与主路由对比可观察降级", "The provider each request finally reached (routingActual). Compare it with the primary route to observe fallbacks.")}
          </p>
        </div>
        <div className="rt-route-bars">
          {d.routes.map((r) => (
            <div key={r.actualSlug} className="rt-route-item">
              <div className="rt-route-top">
                <span className="rt-route-slug">{r.actualSlug}</span>
                <span className="rt-route-count">{text(`${r.count} 次`, `${r.count}`)}</span>
              </div>
              <div className="rt-route-bar">
                <span
                  style={{ width: `${Math.round((r.count / maxRoute) * 100)}%` }}
                />
              </div>
              {r.sampleReason ? (
                <span className="rt-route-reason">{r.sampleReason}</span>
              ) : (
                <span className="muted rt-route-sub">{text("主路径", "Primary path")}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">{text("近期降级记录", "Recent Fallback Events")}</h2>
          <p className="rt-card-desc muted">{text("展示最近发生的真实降级与切换原因", "Shows recent real fallback events and the reasons for switching")}</p>
        </div>
        <div className="rt-table-wrap">
          <table className="rt-table rt-table--compact">
            <thead>
              <tr>
                <th>{text("时间", "Time")}</th>
                <th>{text("模型", "Model")}</th>
                <th>{text("主路由", "Primary")}</th>
                <th>{text("实际", "Actual")}</th>
                <th>{text("原因", "Reason")}</th>
              </tr>
            </thead>
            <tbody>
              {d.recentFallbacks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted rt-empty">
                    {text("暂无降级记录", "No fallback records")}
                  </td>
                </tr>
              ) : (
                d.recentFallbacks.map((row) => (
                  <tr
                    key={`${row.createdAt}-${row.model}-${row.routingReason ?? ""}`}
                  >
                    <td className="rt-td-time">
                      {formatDateTime(row.createdAt, i18n.resolvedLanguage)}
                    </td>
                    <td>
                      <code className="rt-code">{row.model}</code>
                    </td>
                    <td>{row.routingPrimary ?? text("—", "—")}</td>
                    <td>{row.routingActual ?? text("—", "—")}</td>
                    <td>
                      <span className="rt-reason">{row.routingReason}</span>
                    </td>
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
