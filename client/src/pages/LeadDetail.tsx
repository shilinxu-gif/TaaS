import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Activity, type Lead } from "../api";
import { pickText } from "../i18n/inline";

const STATUSES = [
  "new",
  "contacting",
  "qualified",
  "converted",
  "disqualified",
];

const ACT_TYPES = [
  { value: "note", zhCN: "备注", enUS: "Note" },
  { value: "call", zhCN: "电话", enUS: "Call" },
  { value: "email", zhCN: "邮件", enUS: "Email" },
  { value: "meeting", zhCN: "会议", enUS: "Meeting" },
];

export function LeadDetail() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
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
  if (isLoading || !lead) return <p className="muted">{text("加载中…", "Loading...")}</p>;

  const currentStatus = status ?? lead.status;
  const statusText = (value: string) => {
    switch (value) {
      case "new":
        return text("新建", "New");
      case "contacting":
        return text("联系中", "Contacting");
      case "qualified":
        return text("已确认", "Qualified");
      case "converted":
        return text("已转化", "Converted");
      case "disqualified":
        return text("无效", "Disqualified");
      default:
        return value;
    }
  };
  const activityTypeText = (value: string) =>
    text(
      ACT_TYPES.find((t) => t.value === value)?.zhCN ?? value,
      ACT_TYPES.find((t) => t.value === value)?.enUS ?? value
    );

  return (
    <div className="shell-card">
      <div className="page-title">
        <h2>{lead.name}</h2>
        <Link to="/leads" className="btn">
          {text("返回列表", "Back to list")}
        </Link>
      </div>
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 320px" }}>
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ marginTop: 0 }}>{text("基本信息", "Basic information")}</h3>
            <p>
              <span className="muted">{text("公司：", "Company: ")}</span>
              {lead.company ?? "—"}
            </p>
            <p>
              <span className="muted">{text("邮箱：", "Email: ")}</span>
              {lead.email ?? "—"}
            </p>
            <p>
              <span className="muted">{text("手机：", "Phone: ")}</span>
              {lead.phone ?? "—"}
            </p>
            <p>
              <span className="muted">{text("来源：", "Source: ")}</span>
              {lead.source ?? "—"}
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{text("状态", "Status")}</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <select
                  value={currentStatus}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusText(s)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={patch.isPending || currentStatus === lead.status}
                  onClick={() => patch.mutate({ status: currentStatus })}
                >
                  {text("保存状态", "Save status")}
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
                    {text("转化为商机", "Convert to opportunity")}
                  </button>
                ) : (
                  <div>
                    <div className="field">
                      <label>{text("商机名称（可选）", "Opportunity name (optional)")}</label>
                      <input
                        value={oppName}
                        onChange={(e) => setOppName(e.target.value)}
                        placeholder={text("默认使用公司与联系人生成", "Defaults to company and contact")}
                      />
                    </div>
                    <div className="field">
                      <label>{text("预估金额（可选）", "Estimated amount (optional)")}</label>
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
                      {text("确认转化", "Confirm conversion")}
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConvertOpen(false)}
                    >
                      {text("取消", "Cancel")}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
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
                  {a.nextFollowUpAt ? (
                    <div className="muted">
                      {text("下次跟进：", "Next follow-up: ")}
                      {new Date(a.nextFollowUpAt).toLocaleString()}
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
