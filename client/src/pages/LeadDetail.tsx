import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { api, type Activity, type Lead } from "../api";

const STATUSES = [
  "new",
  "contacting",
  "qualified",
  "converted",
  "disqualified",
];

const ACT_TYPES = [
  { value: "note", label: "备注" },
  { value: "call", label: "电话" },
  { value: "email", label: "邮件" },
  { value: "meeting", label: "会议" },
];

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [actType, setActType] = useState("note");
  const [actBody, setActBody] = useState("");
  const [nextFollow, setNextFollow] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [oppName, setOppName] = useState("");
  const [amount, setAmount] = useState("");

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => api<Lead>(`/leads/${id}`),
    enabled: !!id,
  });

  const { data: activities } = useQuery({
    queryKey: ["activities", "lead", id],
    queryFn: () => api<Activity[]>(`/activities?leadId=${id}`),
    enabled: !!id,
  });

  const patch = useMutation({
    mutationFn: (body: Partial<Pick<Lead, "status" | "name" | "company">>) =>
      api<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      setStatus(null);
    },
  });

  const addActivity = useMutation({
    mutationFn: () =>
      api<Activity>("/activities", {
        method: "POST",
        body: JSON.stringify({
          type: actType,
          body: actBody,
          leadId: id,
          nextFollowUpAt: nextFollow
            ? new Date(nextFollow).toISOString()
            : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities", "lead", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setActBody("");
      setNextFollow("");
    },
  });

  const convert = useMutation({
    mutationFn: () =>
      api<{ opportunity: { id: string } }>(`/leads/${id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          opportunityName: oppName || undefined,
          amount: amount ? Number(amount) : undefined,
        }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setConvertOpen(false);
      navigate(`/opportunities/${res.opportunity.id}`);
    },
  });

  if (!id) return null;
  if (isLoading || !lead) return <p className="muted">加载中…</p>;

  const currentStatus = status ?? lead.status;

  return (
    <div className="shell-card">
      <div className="page-title">
        <h2>{lead.name}</h2>
        <Link to="/leads" className="btn">
          返回列表
        </Link>
      </div>
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 320px" }}>
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ marginTop: 0 }}>基本信息</h3>
            <p>
              <span className="muted">公司：</span>
              {lead.company ?? "—"}
            </p>
            <p>
              <span className="muted">邮箱：</span>
              {lead.email ?? "—"}
            </p>
            <p>
              <span className="muted">手机：</span>
              {lead.phone ?? "—"}
            </p>
            <p>
              <span className="muted">来源：</span>
              {lead.source ?? "—"}
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>状态</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <select
                  value={currentStatus}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={patch.isPending || currentStatus === lead.status}
                  onClick={() => patch.mutate({ status: currentStatus })}
                >
                  保存状态
                </button>
              </div>
            </div>
            {lead.status !== "converted" ? (
              <div style={{ marginTop: "1rem" }}>
                {!convertOpen ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setConvertOpen(true)}
                  >
                    转化为商机
                  </button>
                ) : (
                  <div>
                    <div className="field">
                      <label>商机名称（可选）</label>
                      <input
                        value={oppName}
                        onChange={(e) => setOppName(e.target.value)}
                        placeholder="默认使用公司与联系人生成"
                      />
                    </div>
                    <div className="field">
                      <label>预估金额（可选）</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </div>
                    {convert.error ? (
                      <p className="error">{(convert.error as Error).message}</p>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={convert.isPending}
                      onClick={() => convert.mutate()}
                    >
                      确认转化
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConvertOpen(false)}
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            ) : null}
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
                  {a.nextFollowUpAt ? (
                    <div className="muted">
                      下次跟进：{new Date(a.nextFollowUpAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
