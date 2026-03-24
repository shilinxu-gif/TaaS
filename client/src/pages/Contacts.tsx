import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Contact } from "../api";

export function Contacts() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api<Contact[]>("/contacts"),
  });

  const list = (data ?? []).filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.account.name.toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q)
    );
  });
  const selected = list.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="workspace-columns">
      <aside className="pane-list">
        <div className="pane-list-header">联系人（{list.length}）</div>
        <div className="pane-list-tools">
          <div className="pane-search">
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
            <input
              placeholder="搜索姓名 / 公司 / 手机"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="pane-list-scroll">
          {isLoading ? (
            <p className="muted" style={{ padding: "1rem" }}>加载中…</p>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pane-list-item${selectedId === c.id ? " active" : ""}`}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="pane-avatar">{c.name.charAt(0)}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="pane-item-title">{c.name}</div>
                  <div className="pane-item-sub">{c.account.name}</div>
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
            <p className="section-cap">联系人资料</p>
            <div className="form-grid-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>姓名</label>
                <input readOnly value={selected.name} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>所属公司</label>
                <input readOnly value={selected.account.name} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>邮箱</label>
                <input readOnly value={selected.email ?? ""} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>手机</label>
                <input readOnly value={selected.phone ?? ""} />
              </div>
            </div>
          </>
        ) : (
          <p className="muted">请选择左侧联系人。</p>
        )}
      </section>
    </div>
  );
}
