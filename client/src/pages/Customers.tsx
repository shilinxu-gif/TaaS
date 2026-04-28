import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Customer } from "../api";
import { IconCalendar, IconMessage, IconPhone, IconUser } from "../icons";
import { pickText } from "../i18n/inline";

export function Customers() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const [listSearch, setListSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"info" | "note">("info");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [qq, setQq] = useState("");
  const [age, setAge] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customers", listSearch],
    queryFn: () => {
      const q = listSearch.trim()
        ? `?search=${encodeURIComponent(listSearch.trim())}`
        : "";
      return api<Customer[]>(`/customers${q}`);
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["customer", selectedId],
    queryFn: () => api<Customer>(`/customers/${selectedId}`),
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (!selectedId) {
      setName("");
      setPhone("");
      setQq("");
      setAge("");
      return;
    }
    if (detail) {
      setName(detail.name);
      setPhone(detail.phone ?? "");
      setQq(detail.qq ?? "");
      setAge(detail.age != null ? String(detail.age) : "");
    }
  }, [selectedId, detail]);

  const create = useMutation({
    mutationFn: () =>
      api<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          qq: qq.trim() || undefined,
          age: age.trim() === "" ? undefined : Number(age),
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSelectedId(row.id);
    },
  });

  const update = useMutation({
    mutationFn: () =>
      api<Customer>(`/customers/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          qq: qq.trim() || null,
          age: age.trim() === "" ? null : Number(age),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", selectedId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  function startNew() {
    setSelectedId(null);
    setTab("info");
  }

  function save() {
    if (!name.trim()) return;
    if (selectedId) update.mutate();
    else create.mutate();
  }

  const list = data ?? [];
  const n = list.length;

  return (
    <div className="workspace-columns">
      <aside className="pane-list">
        <div className="pane-list-header">
          {text(`客户登记（${n}）`, `Customer registrations (${n})`)}
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
              placeholder={text("搜索姓名 / 手机 / QQ", "Search name / phone / QQ")}
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-add-green"
            title={text("新建客户", "Create customer")}
            onClick={startNew}
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
            list.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pane-list-item${selectedId === c.id ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(c.id);
                  setTab("info");
                }}
              >
                <span className="pane-avatar">{c.name.charAt(0)}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="pane-item-title">{c.name}</div>
                  <div className="pane-item-sub">
                    {c.phone ?? text("未填手机", "No phone")} ·{" "}
                    {c.age != null ? text(`${c.age} 岁`, `${c.age} years old`) : text("年龄未填", "Age not set")}
                  </div>
                </span>
              </button>
            ))
          )}
          {!isLoading && n === 0 ? (
            <p className="muted" style={{ padding: "1rem" }}>
              {text("暂无数据，点击「+」登记", "No data yet. Click + to register.")}
            </p>
          ) : null}
        </div>
      </aside>

      <section className="pane-detail">
        <div className="tabs-bar">
          <button
            type="button"
            className={tab === "info" ? "active" : ""}
            onClick={() => setTab("info")}
          >
            {text("基本信息", "Basic information")}
          </button>
          <button
            type="button"
            className={tab === "note" ? "active" : ""}
            onClick={() => setTab("note")}
          >
            {text("说明", "Notes")}
          </button>
        </div>

        {tab === "info" ? (
          <>
            <p className="section-cap">{text("客户资料", "General info")}</p>
            <div className="form-grid-2">
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  {text("姓名", "Name")} <span style={{ color: "var(--crm-danger)" }}>*</span>
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconUser />
                  </span>
                  <input
                    placeholder={text("请输入姓名", "Enter name")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  {text("手机号", "Phone number")}
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconPhone />
                  </span>
                  <input
                    placeholder={text("请输入手机号", "Enter phone number")}
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  {text("QQ 号", "QQ")}
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconMessage />
                  </span>
                  <input
                    placeholder={text("请输入 QQ 号", "Enter QQ")}
                    inputMode="numeric"
                    value={qq}
                    onChange={(e) => setQq(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  {text("年龄", "Age")}
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconCalendar />
                  </span>
                  <input
                    placeholder={text("请输入年龄", "Enter age")}
                    inputMode="numeric"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {(create.error || update.error) && (
              <p className="error" style={{ marginTop: "0.75rem" }}>
                {(create.error ?? update.error) instanceof Error
                  ? (create.error ?? update.error)!.message
                  : text("保存失败", "Save failed")}
              </p>
            )}
            <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  create.isPending || update.isPending || !name.trim()
                }
                onClick={save}
              >
                {selectedId ? text("保存修改", "Save changes") : text("保存登记", "Save registration")}
              </button>
              {!selectedId ? null : (
                <span className="muted" style={{ alignSelf: "center" }}>
                  {text("已选择客户，修改后点击保存", "Customer selected. Save after editing.")}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="muted">
            {text(
              "在此登记的客户用于销售跟进与统计，信息仅本人可见",
              "Customers registered here are used for sales follow-up and statistics. Information is visible only to you."
            )}
          </p>
        )}
      </section>
    </div>
  );
}
