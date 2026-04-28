import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Contact } from "../api";
import { pickText } from "../i18n/inline";

export function Contacts() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
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
        <div className="pane-list-header">
          {text(`联系人（${list.length}）`, `Contacts (${list.length})`)}
        </div>
        <div className="pane-list-tools">
          <div className="pane-search">
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
            <input
              placeholder={text("搜索姓名 / 公司 / 手机", "Search name / company / phone")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="pane-list-scroll">
          {isLoading ? (
            <p className="muted" style={{ padding: "1rem" }}>
              {text("加载中…", "Loading...")}
            </p>
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
            {text("信息", "Info")}
          </button>
        </div>
        {selected ? (
          <>
            <p className="section-cap">{text("联系人资料", "Contact profile")}</p>
            <div className="form-grid-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("姓名", "Name")}</label>
                <input readOnly value={selected.name} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("所属公司", "Company")}</label>
                <input readOnly value={selected.account.name} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("邮箱", "Email")}</label>
                <input readOnly value={selected.email ?? ""} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("手机", "Phone")}</label>
                <input readOnly value={selected.phone ?? ""} />
              </div>
            </div>
          </>
        ) : (
          <p className="muted">{text("请选择左侧联系人。", "Select a contact on the left.")}</p>
        )}
      </section>
    </div>
  );
}
