import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Activity, type Opportunity } from "../api";
import { pickText } from "../i18n/inline";

const STAGES = [
  { id: "discovery", zhCN: "初步沟通", enUS: "Discovery" },
  { id: "proposal", zhCN: "方案/报价", enUS: "Proposal / Quote" },
  { id: "negotiation", zhCN: "谈判", enUS: "Negotiation" },
  { id: "won", zhCN: "赢单", enUS: "Won" },
  { id: "lost", zhCN: "输单", enUS: "Lost" },
];

const ACT_TYPES = [
  { value: "note", zhCN: "备注", enUS: "Note" },
  { value: "call", zhCN: "电话", enUS: "Call" },
  { value: "email", zhCN: "邮件", enUS: "Email" },
  { value: "meeting", zhCN: "会议", enUS: "Meeting" },
];

export function OpportunityDetail() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
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
  if (isLoading || !opp) return <p className="muted">{text("加载中…", "Loading...")}</p>;

  const currentStage = stage ?? opp.stage;
  const activityTypeText = (value: string) =>
    text(
      ACT_TYPES.find((t) => t.value === value)?.zhCN ?? value,
      ACT_TYPES.find((t) => t.value === value)?.enUS ?? value
    );

  return (
    <div className="shell-card">
      <div className="page-title">
        <h2>{opp.name}</h2>
        <Link to="/opportunities" className="btn">
          {text("返回看板", "Back to board")}
        </Link>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>{text("商机信息", "Opportunity information")}</h3>
        <p>
          <span className="muted">{text("客户：", "Account: ")}</span>
          {opp.account ? (
            <Link to={`/accounts`}>{opp.account.name}</Link>
          ) : (
            "—"
          )}
        </p>
        <div className="field">
          <label>{text("阶段", "Stage")}</label>
          <select
            value={currentStage}
            onChange={(e) => setStage(e.target.value)}
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {text(s.zhCN, s.enUS)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{text("金额", "Amount")}</label>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder={opp.amount == null ? "" : String(opp.amount)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {currentStage === "lost" ? (
          <div className="field">
            <label>{text("输单原因", "Loss reason")}</label>
            <input
              value={lossReason || opp.lossReason || ""}
              onChange={(e) => setLossReason(e.target.value)}
              placeholder={text("记录原因", "Record reason")}
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
          {text("保存", "Save")}
        </button>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{text("跟进记录", "Follow-up records")}</h3>
        <div className="field">
          <label>{text("类型", "Type")}</label>
          <select value={actType} onChange={(e) => setActType(e.target.value)}>
            {ACT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {text(t.zhCN, t.enUS)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{text("内容", "Content")}</label>
          <textarea
            value={actBody}
            onChange={(e) => setActBody(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{text("下次跟进（可选）", "Next follow-up (optional)")}</label>
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
          {text("添加跟进", "Add follow-up")}
        </button>
        <div className="timeline" style={{ marginTop: "1.25rem" }}>
          {(activities ?? []).map((a) => (
            <div key={a.id} className="timeline-item">
              <div className="muted">
                {new Date(a.occurredAt).toLocaleString()} · {activityTypeText(a.type)}
              </div>
              <div>{a.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
