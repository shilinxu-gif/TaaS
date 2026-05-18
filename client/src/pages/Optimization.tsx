import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type CacheStrategySettings,
  type OptimizationSummary,
} from "../api";
import { formatCurrencyAmount, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

export function Optimization() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
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
    return <p className="muted opt-page-pad">{text("加载中…", "Loading…")}</p>;
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
          <h1 className="opt-title">{text("成本优化", "Cost Optimization")}</h1>
          <p className="opt-lead">{d.valueLine}</p>
          <p className="opt-meta muted">
            {text(`统计窗口：最近 ${d.windowDays} 天`, `Window: last ${d.windowDays} days`)}
            {totalCalls > 0
              ? text(` · 样本请求 ${formatNumber(totalCalls)} 次`, ` · ${formatNumber(totalCalls)} sampled requests`)
              : ""}
          </p>
        </div>
        <div className="opt-hero-badge" aria-hidden>
          <span className="opt-hero-badge-cap">{text("为客户省钱", "Saving money")}</span>
          <span className="opt-hero-badge-val">
            ${formatCurrencyAmount(d.estimatedSavedUsd, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span className="opt-hero-badge-sub muted">{text("估算累计节省（USD）", "Estimated cumulative savings (USD)")}</span>
        </div>
      </header>

      <section className="opt-kpi-row" aria-label={text("核心指标", "Key Metrics")}>
        <article className="opt-kpi opt-kpi--rate">
          <div className="opt-kpi-label">{text("缓存命中率", "Cache Hit Rate")}</div>
          <div className="opt-kpi-value">
            {formatNumber(d.cacheHitRate, i18n.resolvedLanguage)}
            <span className="opt-kpi-unit">%</span>
          </div>
          <div className="opt-kpi-foot muted">
            {text(
              `${formatNumber(d.cacheHits)} 次命中 / ${formatNumber(totalCalls)} 次请求`,
              `${formatNumber(d.cacheHits)} hits / ${formatNumber(totalCalls)} requests`,
            )}
          </div>
        </article>
        <article className="opt-kpi opt-kpi--tokens">
          <div className="opt-kpi-label">{text("节省 Token", "Saved Tokens")}</div>
          <div className="opt-kpi-value opt-kpi-value--tokens">
            {formatNumber(d.savedTokens, i18n.resolvedLanguage)}
          </div>
          <div className="opt-kpi-foot muted">{text("命中请求未走向上游的累计 Token", "Accumulated tokens avoided by cache hits")}</div>
        </article>
        <article className="opt-kpi opt-kpi--money">
          <div className="opt-kpi-label">{text("节省金额（估算）", "Estimated Savings")}</div>
          <div className="opt-kpi-value opt-kpi-value--money">
            <span className="opt-money-sym">$</span>
            {formatCurrencyAmount(d.estimatedSavedUsd, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="opt-kpi-foot muted">{d.note}</div>
        </article>
      </section>

      <div className="opt-grid-2">
        <section className="opt-card">
          <div className="opt-card-hd">
          <h2 className="opt-card-title">{text("高频重复 Prompt", "High-Frequency Repeated Prompts")}</h2>
            <p className="opt-card-desc muted">
              {text("基于幂等键聚类统计；后续可扩展为向量指纹与语义聚类", "Clustered by idempotency key; can later expand to vector fingerprints and semantic clustering")}
            </p>
          </div>
          <div className="opt-table-wrap">
            <table className="opt-table">
              <thead>
                <tr>
                  <th>{text("Prompt 摘要", "Prompt Summary")}</th>
                  <th>{text("来源", "Source")}</th>
                  <th>{text("命中次数", "Hits")}</th>
                  <th>{text("节省 Token", "Saved Tokens")}</th>
                </tr>
              </thead>
              <tbody>
                {d.topRepeatedPrompts.map((row) => (
                  <tr key={row.id}>
                    <td className="opt-td-preview">{row.preview}</td>
                    <td>
                      <span className="opt-pill opt-pill--db">{text("幂等键", "Idempotency Key")}</span>
                    </td>
                    <td className="tabular-nums">{formatNumber(row.hits, i18n.resolvedLanguage)}</td>
                    <td className="tabular-nums opt-td-em">
                      {formatNumber(row.savedTokens, i18n.resolvedLanguage)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="opt-card">
          <div className="opt-card-hd">
            <h2 className="opt-card-title">{text("推荐 Prompt 模板", "Suggested Prompt Templates")}</h2>
            <p className="opt-card-desc muted">
              {text("统一口径的模板更易命中缓存，降低试错成本", "Consistent templates improve cache hit rate and reduce trial-and-error costs")}
            </p>
          </div>
          <ul className="opt-template-list">
            {d.promptTemplates.map((t) => (
              <li key={t.id} className="opt-template-item">
                <div className="opt-template-top">
                  <span className="opt-template-name">{t.name}</span>
                  <span className="opt-template-saved">
                    {text("约省 ", "Approx. ")}${formatCurrencyAmount(t.savedUsd, i18n.resolvedLanguage, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <p className="opt-template-desc muted">{t.description}</p>
                <pre className="opt-template-snippet">{t.snippet}</pre>
                <div className="opt-template-foot muted">
                  {text(`建议使用 ${formatNumber(t.uses)} 次`, `Suggested usage: ${formatNumber(t.uses)}`)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="opt-card opt-card--form">
        <div className="opt-card-hd">
          <h2 className="opt-card-title">{text("缓存策略", "Cache Strategy")}</h2>
          <p className="opt-card-desc muted">
            {text("缓存配置保存在服务端；可继续与网关、向量库和审计流程联动", "Cache settings are stored on the server and can later integrate with the gateway, vector store, and audit flow")}
          </p>
        </div>
        {settingsQuery.isLoading || !form ? (
          <p className="muted">{text("加载策略…", "Loading strategy…")}</p>
        ) : (
          <form className="opt-form" onSubmit={submitSettings}>
            <label className="opt-switch-row">
              <span className="opt-form-label">{text("启用智能缓存", "Enable Smart Cache")}</span>
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
              <span className="opt-form-label">{text("缓存模式", "Cache Mode")}</span>
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
                <option value="exact">{text("精确匹配（请求指纹一致）", "Exact match (same request fingerprint)")}</option>
                <option value="semantic">{text("语义相似（向量/阈值）", "Semantic similarity (vector / threshold)")}</option>
                <option value="hybrid">{text("混合（先精确再语义）", "Hybrid (exact first, then semantic)")}</option>
              </select>
            </label>

            <label className="opt-field">
              <span className="opt-form-label">
                {text("相似度阈值", "Similarity Threshold")}{" "}
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
                {text("越高越「严格」，误命中更少；略低可换更多节省", "Higher is stricter with fewer false hits; lower may yield more savings")}
              </span>
            </label>

            <label className="opt-field">
              <span className="opt-form-label">{text("TTL（秒）", "TTL (seconds)")}</span>
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
                {text("默认 86400（24h）；最长 7 天（604800）", "Default 86400 (24h); max 7 days (604800)")}
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
                  {saveMut.isPending ? text("保存中…", "Saving…") : text("保存策略", "Save Strategy")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
