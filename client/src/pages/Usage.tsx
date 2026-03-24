import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type UsageRow } from "../api";

function statusBadge(code: number) {
  if (code >= 200 && code < 300) {
    return <span className="usage-badge usage-badge--ok">{code}</span>;
  }
  return <span className="usage-badge usage-badge--err">{code}</span>;
}

function cacheBadge(hit: boolean) {
  if (hit) {
    return <span className="usage-badge usage-badge--hit">命中</span>;
  }
  return <span className="usage-badge usage-badge--miss">未命中</span>;
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

  if (isLoading) return <p className="muted usage-page-pad">加载中…</p>;
  if (error) return <p className="error usage-page-pad">{(error as Error).message}</p>;

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">用量</h1>
          <p className="usage-subtitle muted">
            按网关请求聚合 · 支持本地筛选 · 演示数据来自种子与实时调用
          </p>
        </div>
      </header>

      <section className="usage-filters" aria-label="筛选条件">
        <div className="usage-filter-grid">
          <div className="usage-filter-block">
            <span className="usage-filter-label">时间范围</span>
            <div className="usage-date-row">
              <input
                type="date"
                className="input-plain usage-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="开始日期"
              />
              <span className="usage-date-sep">至</span>
              <input
                type="date"
                className="input-plain usage-input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="结束日期"
              />
            </div>
            <div className="usage-preset-row">
              <button type="button" className="btn btn-ghost usage-chip" onClick={() => setPresetRange(7)}>
                近 7 天
              </button>
              <button type="button" className="btn btn-ghost usage-chip" onClick={() => setPresetRange(30)}>
                近 30 天
              </button>
              <button type="button" className="btn btn-ghost usage-chip" onClick={clearRange}>
                清除
              </button>
            </div>
          </div>
          <label className="usage-filter-field">
            <span className="usage-filter-label">模型</span>
            <select
              className="input-plain"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <option value="">全部模型</option>
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
              <option value="">全部密钥</option>
              {appKeyOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="usage-filter-field">
            <span className="usage-filter-label">缓存命中</span>
            <select
              className="input-plain"
              value={cacheFilter}
              onChange={(e) =>
                setCacheFilter(e.target.value as "all" | "hit" | "miss")
              }
            >
              <option value="all">全部</option>
              <option value="hit">仅命中</option>
              <option value="miss">仅未命中</option>
            </select>
          </label>
        </div>
        <p className="usage-filter-meta muted">
          共 <strong>{filtered.length}</strong> 条
          {(data?.length ?? 0) !== filtered.length
            ? `（已筛选，原始 ${data?.length ?? 0} 条）`
            : null}
        </p>
      </section>

      <div className="usage-table-card">
        <div className="usage-table-scroll">
          <table className="usage-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>AppKey</th>
                <th>租户</th>
                <th>模型</th>
                <th>输入</th>
                <th>输出</th>
                <th>总计</th>
                <th>费用 (USD)</th>
                <th>缓存</th>
                <th>供应商</th>
                <th>延迟</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="usage-table-empty muted">
                    无匹配记录，请调整筛选条件
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
                    aria-label="打开详情"
                  >
                    <td className="usage-td-time">
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="usage-td-name">{r.appKey.name}</td>
                    <td>{r.tenantName}</td>
                    <td>
                      <code className="usage-code">{r.model}</code>
                    </td>
                    <td className="tabular-nums">
                      {r.promptTokens.toLocaleString("zh-CN")}
                    </td>
                    <td className="tabular-nums">
                      {r.completionTokens.toLocaleString("zh-CN")}
                    </td>
                    <td className="tabular-nums usage-td-strong">
                      {r.totalTokens.toLocaleString("zh-CN")}
                    </td>
                    <td className="tabular-nums">
                      $
                      {Number(r.costUsd).toLocaleString("zh-CN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </td>
                    <td>{cacheBadge(r.cacheHit)}</td>
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
              <h2 id="usage-drawer-title">请求详情</h2>
              <button
                type="button"
                className="btn btn-ghost usage-drawer-close"
                onClick={() => setSelected(null)}
              >
                关闭
              </button>
            </div>
            <div className="usage-drawer-body">
              <dl className="usage-dl">
                <dt>时间</dt>
                <dd>{new Date(selected.createdAt).toLocaleString("zh-CN")}</dd>
                <dt>日志 ID</dt>
                <dd>
                  <code className="usage-code-sm">{selected.id}</code>
                </dd>
                <dt>租户</dt>
                <dd>{selected.tenantName}</dd>
                <dt>AppKey</dt>
                <dd>{selected.appKey.name}</dd>
                <dt>模型</dt>
                <dd>
                  <code className="usage-code-sm">{selected.model}</code>
                </dd>
                <dt>输入 Token</dt>
                <dd>{selected.promptTokens.toLocaleString("zh-CN")}</dd>
                <dt>输出 Token</dt>
                <dd>{selected.completionTokens.toLocaleString("zh-CN")}</dd>
                <dt>总计 Token</dt>
                <dd>{selected.totalTokens.toLocaleString("zh-CN")}</dd>
                <dt>费用</dt>
                <dd>
                  {selected.currency}{" "}
                  {Number(selected.costUsd).toLocaleString("zh-CN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                  })}
                  {selected.billingType ? (
                    <span className="muted usage-dl-note">
                      （{selected.billingType}）
                    </span>
                  ) : null}
                </dd>
                <dt>缓存</dt>
                <dd>{selected.cacheHit ? "命中" : "未命中"}</dd>
                <dt>供应商</dt>
                <dd>
                  {selected.provider.name}{" "}
                  <span className="muted">({selected.provider.slug})</span>
                </dd>
                <dt>延迟</dt>
                <dd>{selected.latencyMs} ms</dd>
                <dt>HTTP 状态</dt>
                <dd>{statusBadge(selected.statusCode)}</dd>
                <dt>路由</dt>
                <dd>
                  {selected.routingPrimary ?? "—"} → {selected.routingActual ?? "—"}
                  {selected.routingReason ? (
                    <span className="usage-reason">{selected.routingReason}</span>
                  ) : null}
                </dd>
                <dt>幂等键</dt>
                <dd>{selected.idempotencyKey ?? "—"}</dd>
                <dt>账期</dt>
                <dd>{selected.period}</dd>
              </dl>
              {selected.billingDescription ? (
                <div className="usage-drawer-note">
                  <span className="usage-drawer-note-cap">计费说明</span>
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
