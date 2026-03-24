import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { api, type Opportunity } from "../api";

const STAGES = [
  { id: "discovery", label: "初步沟通" },
  { id: "proposal", label: "方案/报价" },
  { id: "negotiation", label: "谈判" },
  { id: "won", label: "赢单" },
  { id: "lost", label: "输单" },
];

export function Opportunities() {
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
            商机看板
          </button>
        </div>
        <button
          type="button"
          className="btn btn-success"
          onClick={() => setOpen(true)}
        >
          + 新建商机
        </button>
      </div>
      {open ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>新建商机</h3>
          <div className="field">
            <label>名称 *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>阶段</label>
            <select
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>金额（可选）</label>
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
            保存
          </button>{" "}
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      ) : null}
      {isLoading ? (
        <p className="muted">加载中…</p>
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
                {col.label}（{(byStage.get(col.id) ?? []).length}）
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
                    {o.account?.name ?? "无关联客户"}
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
