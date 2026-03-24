import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  api,
  type CacheStrategySettings,
  type OptimizationSummary,
} from "../api";

function formatUsd(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export function Optimization() {
  const qc = useQueryClient();
  const summaryQuery = useQuery({
    queryKey: ["optimization", "summary"],
    queryFn: () => api<OptimizationSummary>("/optimization/summary"),
  });
  const settingsQuery = useQuery({
    queryKey: ["optimization", "cache-settings"],
    queryFn: () => api<CacheStrategySettings>("/optimization/cache-settings"),
  });

  const [form, setForm] = useState<CacheStrategySettings | null>(null);

  useEffect(() => {
    if (settingsQuery.data) {
      setForm(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const saveMut = useMutation({
    mutationFn: (body: CacheStrategySettings) =>
      api<CacheStrategySettings>("/optimization/cache-settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setForm(data);
      void qc.invalidateQueries({ queryKey: ["optimization", "cache-settings"] });
    },
  });

  if (summaryQuery.isLoading) {
    return <p className="muted opt-page-pad">加载中…</p>;
  }
  if (summaryQuery.error) {
    return (
      <p className="error opt-page-pad">
        {(summaryQuery.error as Error).message}
      </p>
    );
  }

  const d = summaryQuery.data!;
  const totalCalls = d.cacheHits + d.nonCacheRequests;

  function submitSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    saveMut.mutate(form);
  }

  return (
    <div className="opt-page">
      <header className="opt-header opt-header--hero">
        <div className="opt-header-main">
          <h1 className="opt-title">成本优化</h1>
          <p className="opt-lead">{d.valueLine}</p>
          <p className="opt-meta muted">
            统计窗口：最近 {d.windowDays} 天
            {totalCalls > 0
              ? ` · 样本请求 ${totalCalls.toLocaleString("zh-CN")} 次`
              : ""}
          </p>
        </div>
        <div className="opt-hero-badge" aria-hidden>
          <span className="opt-hero-badge-cap">为客户省钱</span>
          <span className="opt-hero-badge-val">
            ${formatUsd(d.estimatedSavedUsd)}
          </span>
          <span className="opt-hero-badge-sub muted">估算累计节省（USD）</span>
        </div>
      </header>

      <section className="opt-kpi-row" aria-label="核心指标">
        <article className="opt-kpi opt-kpi--rate">
          <div className="opt-kpi-label">缓存命中率</div>
          <div className="opt-kpi-value">
            {d.cacheHitRate.toLocaleString("zh-CN")}
            <span className="opt-kpi-unit">%</span>
          </div>
          <div className="opt-kpi-foot muted">
            {d.cacheHits.toLocaleString("zh-CN")} 次命中 /{" "}
            {totalCalls.toLocaleString("zh-CN")} 次请求
          </div>
        </article>
        <article className="opt-kpi opt-kpi--tokens">
          <div className="opt-kpi-label">节省 Token</div>
          <div className="opt-kpi-value opt-kpi-value--tokens">
            {d.savedTokens.toLocaleString("zh-CN")}
          </div>
          <div className="opt-kpi-foot muted">命中请求未走向上游的累计 Token</div>
        </article>
        <article className="opt-kpi opt-kpi--money">
          <div className="opt-kpi-label">节省金额（估算）</div>
          <div className="opt-kpi-value opt-kpi-value--money">
            <span className="opt-money-sym">$</span>
            {formatUsd(d.estimatedSavedUsd)}
          </div>
          <div className="opt-kpi-foot muted">{d.note}</div>
        </article>
      </section>

      <div className="opt-grid-2">
        <section className="opt-card">
          <div className="opt-card-hd">
            <h2 className="opt-card-title">高频重复 Prompt</h2>
            <p className="opt-card-desc muted">
              来自幂等键聚类与平台演示数据；真实环境可对接向量指纹
            </p>
          </div>
          <div className="opt-table-wrap">
            <table className="opt-table">
              <thead>
                <tr>
                  <th>Prompt 摘要</th>
                  <th>来源</th>
                  <th>命中次数</th>
                  <th>节省 Token</th>
                </tr>
              </thead>
              <tbody>
                {d.topRepeatedPrompts.map((row) => (
                  <tr key={row.id}>
                    <td className="opt-td-preview">{row.preview}</td>
                    <td>
                      {row.source === "idempotency" ? (
                        <span className="opt-pill opt-pill--db">幂等键</span>
                      ) : (
                        <span className="opt-pill opt-pill--demo">示例</span>
                      )}
                    </td>
                    <td className="tabular-nums">{row.hits.toLocaleString("zh-CN")}</td>
                    <td className="tabular-nums opt-td-em">
                      {row.savedTokens.toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="opt-card">
          <div className="opt-card-hd">
            <h2 className="opt-card-title">推荐 Prompt 模板</h2>
            <p className="opt-card-desc muted">
              统一口径的模板更易命中缓存，降低试错成本
            </p>
          </div>
          <ul className="opt-template-list">
            {d.promptTemplates.map((t) => (
              <li key={t.id} className="opt-template-item">
                <div className="opt-template-top">
                  <span className="opt-template-name">{t.name}</span>
                  <span className="opt-template-saved">
                    约省 ${formatUsd(t.savedUsd)}
                  </span>
                </div>
                <p className="opt-template-desc muted">{t.description}</p>
                <pre className="opt-template-snippet">{t.snippet}</pre>
                <div className="opt-template-foot muted">
                  建议使用 {t.uses.toLocaleString("zh-CN")} 次（演示）
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="opt-card opt-card--form">
        <div className="opt-card-hd">
          <h2 className="opt-card-title">缓存策略</h2>
          <p className="opt-card-desc muted">
            演示配置保存在服务端内存，重启后恢复默认；生产可落库并与网关联动
          </p>
        </div>
        {settingsQuery.isLoading || !form ? (
          <p className="muted">加载策略…</p>
        ) : (
          <form className="opt-form" onSubmit={submitSettings}>
            <label className="opt-switch-row">
              <span className="opt-form-label">启用智能缓存</span>
              <span className="opt-switch">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                <span className="opt-switch-ui" aria-hidden />
              </span>
            </label>

            <label className="opt-field">
              <span className="opt-form-label">缓存模式</span>
              <select
                className="input-plain"
                value={form.mode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    mode: e.target.value as CacheStrategySettings["mode"],
                  })
                }
              >
                <option value="exact">精确匹配（请求指纹一致）</option>
                <option value="semantic">语义相似（向量/阈值）</option>
                <option value="hybrid">混合（先精确再语义）</option>
              </select>
            </label>

            <label className="opt-field">
              <span className="opt-form-label">
                相似度阈值{" "}
                <strong className="opt-threshold-val">
                  {form.similarityThreshold.toFixed(2)}
                </strong>
              </span>
              <input
                type="range"
                className="opt-range"
                min={0.75}
                max={0.99}
                step={0.01}
                value={form.similarityThreshold}
                onChange={(e) =>
                  setForm({
                    ...form,
                    similarityThreshold: Number(e.target.value),
                  })
                }
              />
              <span className="opt-hint muted">
                越高越「严格」，误命中更少；略低可换更多节省
              </span>
            </label>

            <label className="opt-field">
              <span className="opt-form-label">TTL（秒）</span>
              <input
                type="number"
                className="input-plain"
                min={60}
                max={604800}
                step={60}
                value={form.ttlSeconds}
                onChange={(e) =>
                  setForm({
                    ...form,
                    ttlSeconds: Number(e.target.value) || form.ttlSeconds,
                  })
                }
              />
              <span className="opt-hint muted">
                默认 86400（24h）；最长 7 天（604800）
              </span>
            </label>

            {saveMut.error ? (
              <p className="error">{(saveMut.error as Error).message}</p>
            ) : null}

            <div className="opt-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? "保存中…" : "保存策略"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
