import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Customer } from "../api";
import { IconCalendar, IconMessage, IconPhone, IconUser } from "../icons";

export function Customers() {
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
        <div className="pane-list-header">客户登记（{n}）</div>
        <div className="pane-list-tools">
          <div className="pane-search">
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
            <input
              placeholder="搜索姓名 / 手机 / QQ"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-add-green"
            title="新建客户"
            onClick={startNew}
          >
            +
          </button>
        </div>
        <div className="pane-list-scroll">
          {isLoading ? (
            <p className="muted" style={{ padding: "1rem" }}>
              加载中…
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
                    {c.phone ?? "未填手机"} · {c.age != null ? `${c.age} 岁` : "年龄未填"}
                  </div>
                </span>
              </button>
            ))
          )}
          {!isLoading && n === 0 ? (
            <p className="muted" style={{ padding: "1rem" }}>
              暂无数据，点击「+」登记
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
            基本信息
          </button>
          <button
            type="button"
            className={tab === "note" ? "active" : ""}
            onClick={() => setTab("note")}
          >
            说明
          </button>
        </div>

        {tab === "info" ? (
          <>
            <p className="section-cap">General info · 客户资料</p>
            <div className="form-grid-2">
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  姓名 <span style={{ color: "var(--crm-danger)" }}>*</span>
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconUser />
                  </span>
                  <input
                    placeholder="请输入姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  手机号
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconPhone />
                  </span>
                  <input
                    placeholder="请输入手机号"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  QQ 号
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconMessage />
                  </span>
                  <input
                    placeholder="请输入 QQ 号"
                    inputMode="numeric"
                    value={qq}
                    onChange={(e) => setQq(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  年龄
                </label>
                <div className="input-row" style={{ marginBottom: 0 }}>
                  <span className="input-icon">
                    <IconCalendar />
                  </span>
                  <input
                    placeholder="请输入年龄"
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
                  : "保存失败"}
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
                {selectedId ? "保存修改" : "保存登记"}
              </button>
              {!selectedId ? null : (
                <span className="muted" style={{ alignSelf: "center" }}>
                  已选择客户，修改后点击保存
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="muted">
            在此登记的客户用于销售跟进与统计，信息仅本人可见。执行数据库种子后，将自动带有「【演示】」前缀的示例数据。
          </p>
        )}
      </section>
    </div>
  );
}
