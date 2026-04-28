import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Opportunity } from "../api";
import { pickText } from "../i18n/inline";

const STAGES = [
  { id: "discovery", zhCN: "初步沟通", enUS: "Discovery" },
  { id: "proposal", zhCN: "方案/报价", enUS: "Proposal / Quote" },
  { id: "negotiation", zhCN: "谈判", enUS: "Negotiation" },
  { id: "won", zhCN: "赢单", enUS: "Won" },
  { id: "lost", zhCN: "输单", enUS: "Lost" },
];

export function Opportunities() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    stage: "discovery",
    amount: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => api<Opportunity[]>("/opportunities"),
  });

  const byStage = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const s of STAGES) m.set(s.id, []);
    for (const o of data ?? []) {
      const list = m.get(o.stage) ?? [];
      list.push(o);
      m.set(o.stage, list);
    }
    return m;
  }, [data]);

  const moveStage = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api<Opportunity>(`/opportunities/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opportunities"] }),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Opportunity>("/opportunities", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          stage: form.stage,
          amount: form.amount ? Number(form.amount) : undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setForm({ name: "", stage: "discovery", amount: "" });
    },
  });

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("oppId", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData("oppId");
    if (!id) return;
    moveStage.mutate({ id, stage });
  }

  return (
    <div className="shell-card">
      <div className="page-title" style={{ marginTop: 0 }}>
        <div className="tabs-bar" style={{ margin: 0, border: "none", flex: 1 }}>
          <button type="button" className="active">
            {text("商机看板", "Opportunity board")}
          </button>
        </div>
        <button
          type="button"
          className="btn btn-success"
          onClick={() => setOpen(true)}
        >
          {text("+ 新建商机", "+ New opportunity")}
        </button>
      </div>
      {open ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>{text("新建商机", "New opportunity")}</h3>
          <div className="field">
            <label>{text("名称 *", "Name *")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>{text("阶段", "Stage")}</label>
            <select
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {text(s.zhCN, s.enUS)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{text("金额（可选）", "Amount (optional)")}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          {create.error ? (
            <p className="error">{(create.error as Error).message}</p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending || !form.name.trim()}
            onClick={() => create.mutate()}
          >
            {text("保存", "Save")}
          </button>{" "}
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            {text("取消", "Cancel")}
          </button>
        </div>
      ) : null}
      {isLoading ? (
        <p className="muted">{text("加载中…", "Loading...")}</p>
      ) : (
        <div className="kanban">
          {STAGES.map((col) => (
            <div
              key={col.id}
              className="kanban-col"
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, col.id)}
            >
              <h3>
                {text(
                  `${col.zhCN}（${(byStage.get(col.id) ?? []).length}）`,
                  `${col.enUS} (${(byStage.get(col.id) ?? []).length})`
                )}
              </h3>
              {(byStage.get(col.id) ?? []).map((o) => (
                <div
                  key={o.id}
                  className="kanban-card"
                  draggable
                  onDragStart={(e) => onDragStart(e, o.id)}
                >
                  <Link to={`/opportunities/${o.id}`}>{o.name}</Link>
                  <div className="muted" style={{ marginTop: "0.25rem" }}>
                    {o.account?.name ?? text("无关联客户", "No linked account")}
                    {o.amount ? ` · ¥${o.amount}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {moveStage.error ? (
        <p className="error" style={{ marginTop: "0.5rem" }}>
          {(moveStage.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
