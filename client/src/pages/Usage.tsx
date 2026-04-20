import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type UsageRow } from "../api";
import { formatCurrencyAmount, formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

function statusBadge(code: number) {
  if (code >= 200 && code < 300) {
    return <span className="usage-badge usage-badge--ok">{code}</span>;
  }
  return <span className="usage-badge usage-badge--err">{code}</span>;
}

function cacheBadge(hit: boolean, language: string | undefined) {
  if (hit) {
    return <span className="usage-badge usage-badge--hit">{pickText(language, "命中", "Hit")}</span>;
  }
  return <span className="usage-badge usage-badge--miss">{pickText(language, "未命中", "Miss")}</span>;
}

function inDateRange(iso: string, from: string, to: string): boolean {
  const d = new Date(iso).getTime();
  if (from) {
    const s = new Date(`${from}T00:00:00`).getTime();
    if (d < s) return false;
  }
  if (to) {
    const e = new Date(`${to}T23:59:59.999`).getTime();
    if (d > e) return false;
  }
  return true;
}

export function Usage() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) =>
    pickText(i18n.resolvedLanguage, zhCN, enUS);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [appKeyFilter, setAppKeyFilter] = useState("");
  const [cacheFilter, setCacheFilter] = useState<"all" | "hit" | "miss">(
    "all"
  );
  const [selected, setSelected] = useState<UsageRow | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["usage"],
    queryFn: () => api<UsageRow[]>("/usage"),
  });

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data ?? []) set.add(r.model);
    return Array.from(set).sort();
  }, [data]);

  const appKeyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data ?? []) map.set(r.appKey.id, r.appKey.name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (dateFrom || dateTo) {
      rows = rows.filter((r) => inDateRange(r.createdAt, dateFrom, dateTo));
    }
    if (modelFilter) {
      rows = rows.filter((r) => r.model === modelFilter);
    }
    if (appKeyFilter) {
      rows = rows.filter((r) => r.appKey.id === appKeyFilter);
    }
    if (cacheFilter === "hit") {
      rows = rows.filter((r) => r.cacheHit);
    } else if (cacheFilter === "miss") {
      rows = rows.filter((r) => !r.cacheHit);
    }
    return rows;
  }, [data, dateFrom, dateTo, modelFilter, appKeyFilter, cacheFilter]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function setPresetRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setDateTo(end.toISOString().slice(0, 10));
    setDateFrom(start.toISOString().slice(0, 10));
  }

  function clearRange() {
    setDateFrom("");
    setDateTo("");
  }

  if (isLoading) return <p className="muted usage-page-pad">{text("加载中…", "Loading…")}</p>;
  if (error) return <p className="error usage-page-pad">{(error as Error).message}</p>;

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">{text("用量", "Usage")}</h1>
          <p className="usage-subtitle muted">
            {text("按网关请求聚合 · 支持本地筛选 · 数据来自真实请求日志", "Aggregated by gateway request · Supports local filters · Data comes from real request logs")}
          </p>
        </div>
      </header>

      <section className="usage-filters" aria-label={text("筛选条件", "Filters")}>
        <div className="usage-filter-grid">
          <div className="usage-filter-block">
            <span className="usage-filter-label">{text("时间范围", "Date Range")}</span>
            <div className="usage-date-row">
              <input
                type="date"
                className="input-plain usage-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label={text("开始日期", "Start date")}
              />
              <span className="usage-date-sep">{text("至", "to")}</span>
              <input
                type="date"
                className="input-plain usage-input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label={text("结束日期", "End date")}
              />
            </div>
            <div className="usage-preset-row">
              <button type="button" className="btn btn-ghost usage-chip" onClick={() => setPresetRange(7)}>
                {text("近 7 天", "Last 7 days")}
              </button>
              <button type="button" className="btn btn-ghost usage-chip" onClick={() => setPresetRange(30)}>
                {text("近 30 天", "Last 30 days")}
              </button>
              <button type="button" className="btn btn-ghost usage-chip" onClick={clearRange}>
                {text("清除", "Clear")}
              </button>
            </div>
          </div>
          <label className="usage-filter-field">
            <span className="usage-filter-label">{text("模型", "Model")}</span>
            <select
              className="input-plain"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <option value="">{text("全部模型", "All models")}</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="usage-filter-field">
            <span className="usage-filter-label">AppKey</span>
            <select
              className="input-plain"
              value={appKeyFilter}
              onChange={(e) => setAppKeyFilter(e.target.value)}
            >
              <option value="">{text("全部密钥", "All keys")}</option>
              {appKeyOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="usage-filter-field">
            <span className="usage-filter-label">{text("缓存命中", "Cache")}</span>
            <select
              className="input-plain"
              value={cacheFilter}
              onChange={(e) =>
                setCacheFilter(e.target.value as "all" | "hit" | "miss")
              }
            >
              <option value="all">{text("全部", "All")}</option>
              <option value="hit">{text("仅命中", "Hits only")}</option>
              <option value="miss">{text("仅未命中", "Misses only")}</option>
            </select>
          </label>
        </div>
        <p className="usage-filter-meta muted">
          {text("共 ", "Total ")}<strong>{filtered.length}</strong>{text(" 条", "")}
          {(data?.length ?? 0) !== filtered.length
            ? text(`（已筛选，原始 ${data?.length ?? 0} 条）`, ` (filtered from ${data?.length ?? 0})`)
            : null}
        </p>
      </section>

      <div className="usage-table-card">
        <div className="usage-table-scroll">
          <table className="usage-table">
            <thead>
              <tr>
                  <th>{text("时间", "Time")}</th>
                <th>AppKey</th>
                  <th>{text("租户", "Tenant")}</th>
                  <th>{text("模型", "Model")}</th>
                  <th>{text("输入", "Input")}</th>
                  <th>{text("输出", "Output")}</th>
                  <th>{text("总计", "Total")}</th>
                  <th>{text("费用 (USD)", "Cost (USD)")}</th>
                  <th>{text("缓存", "Cache")}</th>
                  <th>{text("供应商", "Provider")}</th>
                  <th>{text("延迟", "Latency")}</th>
                  <th>{text("状态", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="usage-table-empty muted">
                    {text("无匹配记录，请调整筛选条件", "No matching records. Try adjusting the filters.")}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="usage-row"
                    onClick={() => setSelected(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(r);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={text("打开详情", "Open details")}
                  >
                    <td className="usage-td-time">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="usage-td-name">{r.appKey.name}</td>
                    <td>{r.tenantName}</td>
                    <td>
                      <code className="usage-code">{r.model}</code>
                    </td>
                    <td className="tabular-nums">
                      {formatNumber(r.promptTokens)}
                    </td>
                    <td className="tabular-nums">
                      {formatNumber(r.completionTokens)}
                    </td>
                    <td className="tabular-nums usage-td-strong">
                      {formatNumber(r.totalTokens)}
                    </td>
                    <td className="tabular-nums">
                      $
                      {formatCurrencyAmount(r.costUsd, undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </td>
                    <td>{cacheBadge(r.cacheHit, i18n.resolvedLanguage)}</td>
                    <td>{r.provider.name}</td>
                    <td className="tabular-nums">{r.latencyMs} ms</td>
                    <td>{statusBadge(r.statusCode)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <>
          <div
            className="usage-drawer-backdrop"
            role="presentation"
            onClick={() => setSelected(null)}
          />
          <aside
            className="usage-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="usage-drawer-title"
          >
            <div className="usage-drawer-hd">
              <h2 id="usage-drawer-title">{text("请求详情", "Request Details")}</h2>
              <button
                type="button"
                className="btn btn-ghost usage-drawer-close"
                onClick={() => setSelected(null)}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="usage-drawer-body">
              <dl className="usage-dl">
                <dt>{text("时间", "Time")}</dt>
                <dd>{formatDateTime(selected.createdAt)}</dd>
                <dt>{text("日志 ID", "Log ID")}</dt>
                <dd>
                  <code className="usage-code-sm">{selected.id}</code>
                </dd>
                <dt>{text("请求 ID", "Request ID")}</dt>
                <dd>{selected.requestId ?? text("—", "—")}</dd>
                <dt>{text("链路追踪", "Trace ID")}</dt>
                <dd>{selected.traceId ?? text("—", "—")}</dd>
                <dt>{text("租户", "Tenant")}</dt>
                <dd>{selected.tenantName}</dd>
                <dt>AppKey</dt>
                <dd>{selected.appKey.name}</dd>
                <dt>{text("模型", "Model")}</dt>
                <dd>
                  <code className="usage-code-sm">{selected.model}</code>
                </dd>
                <dt>{text("输入 Token", "Input Tokens")}</dt>
                <dd>{formatNumber(selected.promptTokens)}</dd>
                <dt>{text("输出 Token", "Output Tokens")}</dt>
                <dd>{formatNumber(selected.completionTokens)}</dd>
                <dt>{text("总计 Token", "Total Tokens")}</dt>
                <dd>{formatNumber(selected.totalTokens)}</dd>
                <dt>{text("费用", "Cost")}</dt>
                <dd>
                  {selected.currency}{" "}
                  {formatCurrencyAmount(selected.costUsd, undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                  })}
                  {selected.billingType ? (
                    <span className="muted usage-dl-note">
                      {text(`（${selected.billingType}）`, ` (${selected.billingType})`)}
                    </span>
                  ) : null}
                </dd>
                <dt>{text("计费快照", "Billing Snapshot")}</dt>
                <dd>
                  {text(
                    `输入 $${selected.inputUnitPriceUsd} / 百万，输出 $${selected.outputUnitPriceUsd} / 百万`,
                    `Input $${selected.inputUnitPriceUsd} / million, output $${selected.outputUnitPriceUsd} / million`,
                  )}
                </dd>
                <dt>{text("缓存", "Cache")}</dt>
                <dd>{selected.cacheHit ? text("命中", "Hit") : text("未命中", "Miss")}</dd>
                <dt>{text("供应商", "Provider")}</dt>
                <dd>
                  {selected.provider.name}{" "}
                  <span className="muted">({selected.provider.slug})</span>
                </dd>
                <dt>{text("延迟", "Latency")}</dt>
                <dd>{selected.latencyMs} ms</dd>
                <dt>{text("HTTP 状态", "HTTP Status")}</dt>
                <dd>{statusBadge(selected.statusCode)}</dd>
                <dt>{text("供应商错误码", "Provider Error Code")}</dt>
                <dd>{selected.providerErrorCode ?? text("—", "—")}</dd>
                <dt>{text("重试次数", "Retry Count")}</dt>
                <dd>{selected.retryCount}</dd>
                <dt>{text("路由", "Routing")}</dt>
                <dd>
                  {selected.routingPrimary ?? text("—", "—")} → {selected.routingActual ?? text("—", "—")}
                  {selected.routingReason ? (
                    <span className="usage-reason">{selected.routingReason}</span>
                  ) : null}
                </dd>
                <dt>{text("幂等键", "Idempotency Key")}</dt>
                <dd>{selected.idempotencyKey ?? text("—", "—")}</dd>
                <dt>{text("账期", "Billing Period")}</dt>
                <dd>{selected.period}</dd>
                <dt>{text("对账状态", "Reconciliation Status")}</dt>
                <dd>{selected.reconciliationStatus ?? text("—", "—")}</dd>
                <dt>{text("开票状态", "Invoice Status")}</dt>
                <dd>{selected.invoiceStatus ?? text("—", "—")}</dd>
                <dt>{text("来源 IP", "Source IP")}</dt>
                <dd>{selected.requestSourceIp ?? text("—", "—")}</dd>
              </dl>
              {selected.billingDescription ? (
                <div className="usage-drawer-note">
                  <span className="usage-drawer-note-cap">{text("计费说明", "Billing Notes")}</span>
                  <p className="muted">{selected.billingDescription}</p>
                </div>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
