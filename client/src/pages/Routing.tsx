import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type RoutingStrategyMode, type RoutingSummary } from "../api";

function statusBadge(status: RoutingSummary["providerPriority"][0]["status"]) {
  if (status === "active") {
    return <span className="rt-badge rt-badge--ok">正常</span>;
  }
  if (status === "degraded") {
    return <span className="rt-badge rt-badge--warn">降级</span>;
  }
  return <span className="rt-badge rt-badge--muted">只读</span>;
}

export function Routing() {
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

  if (isLoading) return <p className="muted rt-page-pad">加载中…</p>;
  if (error) return <p className="error rt-page-pad">{(error as Error).message}</p>;

  const d = data!;
  const maxRoute = Math.max(1, ...d.routes.map((r) => r.count));

  const modes: { id: RoutingStrategyMode; label: string; sub: string }[] = [
    {
      id: "cost",
      label: "成本优先",
      sub: "经济性评分优先",
    },
    {
      id: "quality",
      label: "质量优先",
      sub: "成功率与延迟优先",
    },
    {
      id: "balance",
      label: "均衡",
      sub: "加权综合（默认）",
    },
  ];

  return (
    <div className="rt-page">
      <header className="rt-header">
        <div>
          <h1 className="rt-title">路由调度</h1>
          <p className="rt-lead muted">
            向项目组演示：策略模式、降级链路、供应商优先级与真实请求分布（近{" "}
            {d.windowDays} 天）
          </p>
        </div>
      </header>

      <section className="rt-card rt-card--strategy">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">当前模型策略</h2>
          <p className="rt-card-desc muted">{d.strategyNote}</p>
        </div>
        <div className="rt-mode-row" role="radiogroup" aria-label="策略模式">
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
          切换后下方「供应商优先级」表格将按对应规则重新排序（演示用，策略保存在服务端内存）。
        </p>
        {strategyMut.error ? (
          <p className="error rt-strategy-err">
            {(strategyMut.error as Error).message}
          </p>
        ) : null}
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">Fallback 降级链</h2>
          <p className="rt-card-desc muted">
            主模型不可用或超时时按链条依次尝试，保证业务连续性
          </p>
        </div>
        <div className="rt-chain-grid">
          {d.fallbackChains.map((c) => (
            <div key={c.id} className="rt-chain-card">
              <div className="rt-chain-cap">{c.title}</div>
              <p className="rt-chain-desc muted">{c.description}</p>
              <div className="rt-chain-track" aria-label="模型链路">
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
          <h2 className="rt-card-title">供应商优先级</h2>
          <p className="rt-card-desc muted">
            基于当前「{modes.find((x) => x.id === d.strategyMode)?.label}
            」策略排序；延迟与成功率为租户近 {d.windowDays} 天日志聚合（无流量时为演示基线）
          </p>
        </div>
        <div className="rt-table-wrap">
          <table className="rt-table">
            <thead>
              <tr>
                <th>优先级</th>
                <th>供应商</th>
                <th>模型</th>
                <th>经济性评分</th>
                <th>延迟</th>
                <th>成功率</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {d.providerPriority.map((row) => (
                <tr key={row.providerSlug}>
                  <td className="rt-priority">{row.priority}</td>
                  <td className="rt-td-name">{row.providerName}</td>
                  <td>
                    <code className="rt-code">{row.model}</code>
                  </td>
                  <td className="tabular-nums rt-td-score">{row.costScore}</td>
                  <td className="tabular-nums">{row.latencyMs} ms</td>
                  <td className="tabular-nums rt-td-rate">
                    {row.successRate.toLocaleString("zh-CN", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </td>
                  <td>{statusBadge(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">实际路由分布</h2>
          <p className="rt-card-desc muted">
            各请求最终落到的供应商（routingActual），与主路由对比可观察降级
          </p>
        </div>
        <div className="rt-route-bars">
          {d.routes.map((r) => (
            <div key={r.actualSlug} className="rt-route-item">
              <div className="rt-route-top">
                <span className="rt-route-slug">{r.actualSlug}</span>
                <span className="rt-route-count">{r.count} 次</span>
              </div>
              <div className="rt-route-bar">
                <span
                  style={{ width: `${Math.round((r.count / maxRoute) * 100)}%` }}
                />
              </div>
              {r.sampleReason ? (
                <span className="rt-route-reason">{r.sampleReason}</span>
              ) : (
                <span className="muted rt-route-sub">主路径</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rt-card">
        <div className="rt-card-hd">
          <h2 className="rt-card-title">近期降级记录</h2>
          <p className="rt-card-desc muted">含 gpt-fallback-demo 等触发原因的样本</p>
        </div>
        <div className="rt-table-wrap">
          <table className="rt-table rt-table--compact">
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>主路由</th>
                <th>实际</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {d.recentFallbacks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted rt-empty">
                    暂无降级记录
                  </td>
                </tr>
              ) : (
                d.recentFallbacks.map((row) => (
                  <tr
                    key={`${row.createdAt}-${row.model}-${row.routingReason ?? ""}`}
                  >
                    <td className="rt-td-time">
                      {new Date(row.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td>
                      <code className="rt-code">{row.model}</code>
                    </td>
                    <td>{row.routingPrimary ?? "—"}</td>
                    <td>{row.routingActual ?? "—"}</td>
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
