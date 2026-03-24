import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Account } from "../api";

export function Accounts() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/accounts"),
  });

  const list = (data ?? []).filter((a) =>
    search.trim()
      ? a.name.toLowerCase().includes(search.trim().toLowerCase())
      : true
  );
  const selected = list.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="workspace-columns">
      <aside className="pane-list">
        <div className="pane-list-header">客户公司（{list.length}）</div>
        <div className="pane-list-tools">
          <div className="pane-search">
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
            <input
              placeholder="搜索公司名称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="pane-list-scroll">
          {isLoading ? (
            <p className="muted" style={{ padding: "1rem" }}>加载中…</p>
          ) : (
            list.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`pane-list-item${selectedId === a.id ? " active" : ""}`}
                onClick={() => setSelectedId(a.id)}
              >
                <span className="pane-avatar">{a.name.charAt(0)}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="pane-item-title">{a.name}</div>
                  <div className="pane-item-sub">公司档案</div>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
      <section className="pane-detail">
        <div className="tabs-bar">
          <button type="button" className="active">
            信息
          </button>
        </div>
        {selected ? (
          <>
            <p className="section-cap">公司信息</p>
            <div className="form-grid-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>名称</label>
                <input readOnly value={selected.name} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>最近更新</label>
                <input
                  readOnly
                  value={new Date(selected.updatedAt).toLocaleString()}
                />
              </div>
            </div>
            <p className="muted" style={{ marginTop: "1rem" }}>
              公司记录可由线索「转化为商机」时自动创建。
            </p>
          </>
        ) : (
          <p className="muted">请选择左侧公司查看详情。</p>
        )}
      </section>
    </div>
  );
}
