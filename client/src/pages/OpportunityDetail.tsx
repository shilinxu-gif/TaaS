import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { api, type Activity, type Opportunity } from "../api";

const STAGES = [
  { id: "discovery", label: "初步沟通" },
  { id: "proposal", label: "方案/报价" },
  { id: "negotiation", label: "谈判" },
  { id: "won", label: "赢单" },
  { id: "lost", label: "输单" },
];

const ACT_TYPES = [
  { value: "note", label: "备注" },
  { value: "call", label: "电话" },
  { value: "email", label: "邮件" },
  { value: "meeting", label: "会议" },
];

export function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [actType, setActType] = useState("note");
  const [actBody, setActBody] = useState("");
  const [nextFollow, setNextFollow] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [lossReason, setLossReason] = useState("");

  const { data: opp, isLoading } = useQuery({
    queryKey: ["opportunity", id],
    queryFn: () => api<Opportunity & { account: { id: string; name: string } | null }>(`/opportunities/${id}`),
    enabled: !!id,
  });

  const { data: activities } = useQuery({
    queryKey: ["activities", "opp", id],
    queryFn: () => api<Activity[]>(`/activities?opportunityId=${id}`),
    enabled: !!id,
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Opportunity>(`/opportunities/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunity", id] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setStage(null);
    },
  });

  const addActivity = useMutation({
    mutationFn: () =>
      api<Activity>("/activities", {
        method: "POST",
        body: JSON.stringify({
          type: actType,
          body: actBody,
          opportunityId: id,
          nextFollowUpAt: nextFollow
            ? new Date(nextFollow).toISOString()
            : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities", "opp", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setActBody("");
      setNextFollow("");
    },
  });

  if (!id) return null;
  if (isLoading || !opp) return <p className="muted">加载中…</p>;

  const currentStage = stage ?? opp.stage;

  return (
    <div className="shell-card">
      <div className="page-title">
        <h2>{opp.name}</h2>
        <Link to="/opportunities" className="btn">
          返回看板
        </Link>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>商机信息</h3>
        <p>
          <span className="muted">客户：</span>
          {opp.account ? (
            <Link to={`/accounts`}>{opp.account.name}</Link>
          ) : (
            "—"
          )}
        </p>
        <div className="field">
          <label>阶段</label>
          <select
            value={currentStage}
            onChange={(e) => setStage(e.target.value)}
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>金额</label>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder={opp.amount ?? ""}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {currentStage === "lost" ? (
          <div className="field">
            <label>输单原因</label>
            <input
              value={lossReason || opp.lossReason || ""}
              onChange={(e) => setLossReason(e.target.value)}
              placeholder="记录原因"
            />
          </div>
        ) : null}
        {patch.error ? (
          <p className="error">{(patch.error as Error).message}</p>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={patch.isPending}
          onClick={() => {
            const body: Record<string, unknown> = { stage: currentStage };
            if (amount !== "") {
              body.amount = amount ? Number(amount) : null;
            }
            if (currentStage === "lost") {
              body.lossReason = lossReason || opp.lossReason || null;
            }
            patch.mutate(body);
          }}
        >
          保存
        </button>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>跟进记录</h3>
        <div className="field">
          <label>类型</label>
          <select value={actType} onChange={(e) => setActType(e.target.value)}>
            {ACT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>内容</label>
          <textarea
            value={actBody}
            onChange={(e) => setActBody(e.target.value)}
          />
        </div>
        <div className="field">
          <label>下次跟进（可选）</label>
          <input
            type="datetime-local"
            value={nextFollow}
            onChange={(e) => setNextFollow(e.target.value)}
          />
        </div>
        {addActivity.error ? (
          <p className="error">{(addActivity.error as Error).message}</p>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={addActivity.isPending || !actBody.trim()}
          onClick={() => addActivity.mutate()}
        >
          添加跟进
        </button>
        <div className="timeline" style={{ marginTop: "1.25rem" }}>
          {(activities ?? []).map((a) => (
            <div key={a.id} className="timeline-item">
              <div className="muted">
                {new Date(a.occurredAt).toLocaleString()} · {a.type}
              </div>
              <div>{a.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
