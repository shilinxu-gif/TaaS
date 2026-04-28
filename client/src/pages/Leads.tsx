import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Lead } from "../api";
import { pickText } from "../i18n/inline";

const STATUSES = [
  { value: "", zhCN: "全部", enUS: "All" },
  { value: "new", zhCN: "新建", enUS: "New" },
  { value: "contacting", zhCN: "联系中", enUS: "Contacting" },
  { value: "qualified", zhCN: "已确认", enUS: "Qualified" },
  { value: "converted", zhCN: "已转化", enUS: "Converted" },
  { value: "disqualified", zhCN: "无效", enUS: "Disqualified" },
];

export function Leads() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"info" | "follow">("info");
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    source: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["leads", status, search],
    queryFn: () => {
      const q = new URLSearchParams();
      if (status) q.set("status", status);
      if (search.trim()) q.set("search", search.trim());
      return api<Lead[]>(`/leads?${q.toString()}`);
    },
  });

  const selected = (data ?? []).find((l) => l.id === selectedId) ?? null;

  const create = useMutation({
    mutationFn: () =>
      api<Lead>("/leads", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          company: form.company || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          source: form.source || undefined,
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      setCreating(false);
      setForm({ name: "", company: "", email: "", phone: "", source: "" });
      setSelectedId(row.id);
    },
  });

  const list = data ?? [];
  const n = list.length;
  const statusText = (value: string) =>
    text(
      STATUSES.find((s) => s.value === value)?.zhCN ?? value,
      STATUSES.find((s) => s.value === value)?.enUS ?? value
    );

  return (
    <div className="workspace-columns">
      <aside className="pane-list">
        <div className="pane-list-header">{text(`线索（${n}）`, `Leads (${n})`)}</div>
        <div style={{ padding: "0 1rem 0.5rem" }}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              width: "100%",
              padding: "0.45rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--crm-border)",
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {text(s.zhCN, s.enUS)}
              </option>
            ))}
          </select>
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
              placeholder={text("搜索", "Search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-add-green"
            title={text("新建线索", "Create lead")}
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
              setTab("info");
            }}
          >
            +
          </button>
        </div>
        <div className="pane-list-scroll">
          {isLoading ? (
            <p className="muted" style={{ padding: "1rem" }}>
              {text("加载中…", "Loading...")}
            </p>
          ) : (
            list.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`pane-list-item${selectedId === l.id && !creating ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(l.id);
                  setCreating(false);
                }}
              >
                <span className="pane-avatar">{l.name.charAt(0)}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="pane-item-title">{l.name}</div>
                  <div className="pane-item-sub">
                    <span className="badge">{statusText(l.status)}</span>{" "}
                    {l.company ?? text("无公司", "No company")}
                  </div>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="pane-detail">
        <div className="tabs-bar">
          <button
            type="button"
            className={tab === "info" ? "active" : ""}
            onClick={() => setTab("info")}
          >
            {text("信息", "Info")}
          </button>
          <button
            type="button"
            className={tab === "follow" ? "active" : ""}
            onClick={() => setTab("follow")}
          >
            {text("跟进", "Follow-up")}
          </button>
        </div>

        {creating ? (
          <>
            <p className="section-cap">{text("新建线索", "Create lead")}</p>
            <div className="form-grid-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("姓名 *", "Name *")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("公司", "Company")}</label>
                <input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("邮箱", "Email")}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>{text("手机", "Phone")}</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                <label>{text("来源", "Source")}</label>
                <input
                  placeholder={text("官网、展会等", "Website, trade show, etc.")}
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                />
              </div>
            </div>
            {create.error ? (
              <p className="error">{(create.error as Error).message}</p>
            ) : null}
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={create.isPending || !form.name.trim()}
                onClick={() => create.mutate()}
              >
                {text("保存", "Save")}
              </button>
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                {text("取消", "Cancel")}
              </button>
            </div>
          </>
        ) : selected ? (
          tab === "info" ? (
            <>
              <p className="section-cap">{text("线索概要", "Lead summary")}</p>
              <div className="form-grid-2">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("姓名", "Name")}</label>
                  <input readOnly value={selected.name} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("状态", "Status")}</label>
                  <input readOnly value={statusText(selected.status)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("公司", "Company")}</label>
                  <input readOnly value={selected.company ?? ""} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("手机", "Phone")}</label>
                  <input readOnly value={selected.phone ?? ""} />
                </div>
              </div>
              <Link
                className="btn btn-primary"
                style={{ marginTop: "1.25rem", display: "inline-flex" }}
                to={`/leads/${selected.id}`}
              >
                {text("打开完整跟进页", "Open full follow-up page")}
              </Link>
            </>
          ) : (
            <p className="muted">
              {text(
                "时间轴与跟进记录在完整页面维护。",
                "Timeline and follow-up records are managed on the full page."
              )}
              <br />
              <Link to={`/leads/${selected.id}`}>{text("前往跟进 →", "Go to follow-up ->")}</Link>
            </p>
          )
        ) : (
          <p className="muted">
            {text("请从左侧选择一条线索，或点击「+」新建。", "Select a lead on the left, or click + to create one.")}
          </p>
        )}
      </section>
    </div>
  );
}
