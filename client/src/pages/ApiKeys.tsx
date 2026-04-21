import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  api,
  gatewayChat,
  type AppKeyAvailableModel,
  type AppKeyCreateResponse,
  type AppKeyListRow,
} from "../api";
import { formatDateTime } from "../i18n/format";
import { pickText } from "../i18n/inline";
import { copyText } from "../utils/clipboard";

function statusBadge(status: string, language: string | undefined) {
  if (status === "active") {
    return <span className="keys-badge keys-badge--ok">{pickText(language, "启用", "Active")}</span>;
  }
  if (status === "disabled") {
    return <span className="keys-badge keys-badge--off">{pickText(language, "禁用", "Disabled")}</span>;
  }
  if (status === "revoked") {
    return <span className="keys-badge keys-badge--revoked">{pickText(language, "已撤销", "Revoked")}</span>;
  }
  return <span className="keys-badge">{status}</span>;
}

export function ApiKeys() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) =>
    pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [revealToken, setRevealToken] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formQps, setFormQps] = useState("");
  const [formBudget, setFormBudget] = useState("");
  const [formMonthlyBudget, setFormMonthlyBudget] = useState("");
  const [formAllowedModels, setFormAllowedModels] = useState<string[]>([]);
  const [formStatus, setFormStatus] = useState<"active" | "disabled">("active");
  const [formEnvironment, setFormEnvironment] = useState<
    "production" | "staging" | "development" | "sandbox"
  >("production");
  const [formScopes, setFormScopes] = useState<string[]>(["chat:complete"]);

  const [playKey, setPlayKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [idem, setIdem] = useState("");
  const [playResult, setPlayResult] = useState<string | null>(null);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const keysQuery = useQuery({
    queryKey: ["app-keys"],
    queryFn: () => api<AppKeyListRow[]>("/app-keys"),
  });

  const availableModelsQuery = useQuery({
    queryKey: ["app-keys", "available-models"],
    queryFn: () => api<AppKeyAvailableModel[]>("/app-keys/available-models"),
  });
  const availableModels = availableModelsQuery.data ?? [];

  useEffect(() => {
    if (availableModels.length === 0) return;
    setModel((current) =>
      availableModels.some((item) => item.model === current)
        ? current
        : availableModels[0].model
    );
  }, [availableModels]);

  const createMut = useMutation({
    mutationFn: () => {
      const qpsRaw = formQps.trim();
      let qpsLimit: number | null = null;
      if (qpsRaw !== "") {
        const n = Number(qpsRaw);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(text("QPS 限制须为正整数或留空", "QPS limit must be a positive integer or left blank"));
        }
        qpsLimit = n;
      }
      const budgetRaw = formBudget.trim();
      return api<AppKeyCreateResponse>("/app-keys", {
        method: "POST",
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim() || null,
          qpsLimit,
          dailyBudgetUsd: budgetRaw === "" ? null : budgetRaw,
          monthlyBudgetUsd: formMonthlyBudget.trim() || null,
          allowedModels: formAllowedModels,
          status: formStatus,
          environment: formEnvironment,
          scopes: formScopes,
        }),
      });
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["app-keys"] });
      setRevealToken(data.token);
      setCopyFeedback("idle");
      setModalOpen(false);
      setFormName("");
      setFormDesc("");
      setFormQps("");
      setFormBudget("");
      setFormMonthlyBudget("");
      setFormAllowedModels([]);
      setFormStatus("active");
      setFormEnvironment("production");
      setFormScopes(["chat:complete"]);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) =>
      api<AppKeyListRow>(`/app-keys/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["app-keys"] }),
  });

  async function runPlayground() {
    setPlayErr(null);
    setPlayResult(null);
    try {
      const res = await gatewayChat(
        playKey.trim(),
        {
          model,
          messages: [{ role: "user", content: text("你好，请返回一条连通性测试结果。", "Hello, please return a connectivity test result.") }],
        },
        idem.trim() || undefined
      );
      setPlayResult(JSON.stringify(res, null, 2));
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["usage"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
      void qc.invalidateQueries({ queryKey: ["logs"] });
      void keysQuery.refetch();
    } catch (e) {
      setPlayErr(e instanceof Error ? e.message : text("调用失败", "Request failed"));
    }
  }

  function openCreateModal() {
    createMut.reset();
    setModalOpen(true);
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    createMut.mutate();
  }

  if (keysQuery.isLoading) return <p className="muted keys-page-pad">{text("加载中…", "Loading…")}</p>;
  if (keysQuery.error)
    return (
      <p className="error keys-page-pad">
        {(keysQuery.error as Error).message}
      </p>
    );

  const rows = keysQuery.data ?? [];

  return (
    <div className="keys-page">
      <header className="keys-header">
        <div>
          <h1 className="keys-title">{text("API 密钥", "API Keys")}</h1>
          <p className="keys-subtitle muted">
            {text("使用 AppKey 调用", "Use AppKey with")}{" "}
            <code className="keys-inline-code">POST /v1/chat/completions</code>{" "}
           {text("（OpenAI 兼容，多供应商真实网关）", "(OpenAI-compatible, real multi-provider gateway)")}
          </p>
        </div>
        <div className="keys-header-actions">
          <Link to="/integration-docs" className="btn btn-ghost">
            {text("查看 SDK 文档中心", "Open SDK docs")}
          </Link>
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            {text("创建密钥", "Create key")}
          </button>
        </div>
      </header>

      <div className="keys-table-card">
        <div className="keys-table-scroll">
          <table className="keys-table">
            <thead>
              <tr>
                  <th>{text("名称", "Name")}</th>
                  <th>{text("密钥前缀", "Key Prefix")}</th>
                  <th>{text("租户", "Tenant")}</th>
                  <th>{text("状态", "Status")}</th>
                  <th>{text("环境", "Environment")}</th>
                  <th>{text("QPS 限制", "QPS Limit")}</th>
                  <th>{text("日预算 (USD)", "Daily Budget (USD)")}</th>
                  <th>{text("月预算 (USD)", "Monthly Budget (USD)")}</th>
                  <th>{text("允许模型", "Allowed Models")}</th>
                  <th>{text("权限域", "Scopes")}</th>
                  <th>{text("创建时间", "Created At")}</th>
                  <th>{text("最近来源", "Last Source")}</th>
                  <th>{text("启用", "Enabled")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="keys-table-empty muted">
                    {text("暂无密钥，点击「创建密钥」新建", "No keys yet. Click “Create key” to add one.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="keys-td-strong">{row.name}</td>
                    <td>
                      <code className="keys-mono">{row.keyPrefix}</code>
                    </td>
                    <td>{row.tenantName}</td>
                    <td>{statusBadge(row.status, i18n.resolvedLanguage)}</td>
                    <td>{row.environment}</td>
                    <td className="tabular-nums">
                      {row.qpsLimit != null ? row.qpsLimit : text("—", "—")}
                    </td>
                    <td className="tabular-nums">
                      {row.dailyBudgetUsd != null ? row.dailyBudgetUsd : text("—", "—")}
                    </td>
                    <td className="tabular-nums">
                      {row.monthlyBudgetUsd != null ? row.monthlyBudgetUsd : text("—", "—")}
                    </td>
                    <td className="keys-td-models">
                      {row.allowedModels.length === 0 ? (
                        <span className="muted">{text("全部", "All")}</span>
                      ) : (
                        <span title={row.allowedModels.join(", ")}>
                          {text(`${row.allowedModels.length} 个`, `${row.allowedModels.length}`)}
                        </span>
                      )}
                    </td>
                    <td>{row.scopes.join(", ")}</td>
                    <td className="keys-td-time">
                      {formatDateTime(row.createdAt, i18n.resolvedLanguage)}
                    </td>
                    <td>{row.lastUsedIp ?? text("—", "—")}</td>
                    <td>
                      {row.status === "revoked" ? (
                        <span className="muted">{text("—", "—")}</span>
                      ) : (
                        <label className="keys-switch">
                          <input
                            type="checkbox"
                            checked={row.status === "active"}
                            disabled={toggleMut.isPending}
                            onChange={(e) => {
                              toggleMut.mutate({
                                id: row.id,
                                status: e.target.checked ? "active" : "disabled",
                              });
                            }}
                          />
                          <span className="keys-switch-ui" aria-hidden />
                        </label>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <details className="keys-details">
        <summary>{text("网关试用", "Gateway Playground")}</summary>
        <p className="muted keys-details-hint">
          {text("粘贴完整 ", "Paste the full ")}<code className="keys-inline-code">sk-…</code>{" "}
          {text("密钥。若密钥配置了模型白名单，请选用允许的 model。", "key. If a model allowlist is configured, choose an allowed model.")}
        </p>
        <div className="keys-play-grid">
          <input
            className="input-plain"
            placeholder={text("Bearer AppKey（完整密钥）", "Bearer AppKey (full key)")}
            value={playKey}
            onChange={(e) => setPlayKey(e.target.value)}
            autoComplete="off"
          />
          <div className="keys-play-row">
            <select
              className="input-plain"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {availableModels.length === 0 ? (
                <option value="">{text("暂无已配置模型", "No configured models")}</option>
              ) : (
                availableModels.map((item) => (
                  <option key={item.id} value={item.model}>
                    {item.model}
                  </option>
                ))
              )}
            </select>
            <input
              className="input-plain"
              placeholder={text("Idempotency-Key（可选）", "Idempotency-Key (optional)")}
              value={idem}
              onChange={(e) => setIdem(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={availableModels.length === 0}
              onClick={() => void runPlayground()}
            >
              {text("发送请求", "Send request")}
            </button>
          </div>
        </div>
        {playErr ? <p className="error">{playErr}</p> : null}
        {playResult ? <pre className="keys-pre">{playResult}</pre> : null}
      </details>

      {modalOpen ? (
        <div
          className="keys-modal-backdrop"
          role="presentation"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="keys-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keys-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="keys-modal-hd">
              <h2 id="keys-modal-title">{text("创建 API 密钥", "Create API Key")}</h2>
              <button
                type="button"
                className="keys-modal-close btn btn-ghost"
                onClick={() => setModalOpen(false)}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <form className="keys-form" onSubmit={submitCreate}>
              <label className="keys-field">
                <span className="keys-label">{text("名称", "Name")}</span>
                <input
                  className="input-plain"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={text("例如：生产网关", "e.g. Production gateway")}
                  required
                  autoFocus
                />
              </label>
              <label className="keys-field">
                <span className="keys-label">{text("描述", "Description")}</span>
                <textarea
                  className="input-plain keys-textarea"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder={text("可选，方便团队识别用途", "Optional, helps the team identify its purpose")}
                  rows={2}
                />
              </label>
              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("QPS 限制", "QPS Limit")}</span>
                  <input
                    className="input-plain"
                    type="number"
                    min={1}
                    step={1}
                    value={formQps}
                    onChange={(e) => setFormQps(e.target.value)}
                    placeholder={text("留空表示不限制", "Leave blank for no limit")}
                  />
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("日预算 (USD)", "Daily Budget (USD)")}</span>
                  <input
                    className="input-plain"
                    inputMode="decimal"
                    value={formBudget}
                    onChange={(e) => setFormBudget(e.target.value)}
                    placeholder={text("留空表示不限制", "Leave blank for no limit")}
                  />
                </label>
              </div>
              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("月预算 (USD)", "Monthly Budget (USD)")}</span>
                  <input
                    className="input-plain"
                    inputMode="decimal"
                    value={formMonthlyBudget}
                    onChange={(e) => setFormMonthlyBudget(e.target.value)}
                    placeholder={text("留空表示不限制", "Leave blank for no limit")}
                  />
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("环境", "Environment")}</span>
                  <select
                    className="input-plain"
                    value={formEnvironment}
                    onChange={(e) =>
                      setFormEnvironment(
                        e.target.value as
                          | "production"
                          | "staging"
                          | "development"
                          | "sandbox"
                      )
                    }
                  >
                    <option value="production">production</option>
                    <option value="staging">staging</option>
                    <option value="development">development</option>
                    <option value="sandbox">sandbox</option>
                  </select>
                </label>
              </div>
              <label className="keys-field">
                <span className="keys-label">{text("允许模型", "Allowed Models")}</span>
                {availableModels.length === 0 ? (
                  <div className="keys-models-empty muted">
                    {text("当前没有已配置 URL 和 API Key 的模型可选，请先联系管理员完成供应商配置。", "No models with configured URL and API key are available. Please ask an administrator to finish provider setup first.")}
                  </div>
                ) : (
                  <div className="keys-models-list">
                    {availableModels.map((item) => (
                      <label key={item.id} className="keys-model-option">
                        <input
                          type="checkbox"
                          checked={formAllowedModels.includes(item.model)}
                          onChange={(e) =>
                            setFormAllowedModels((current) =>
                              e.target.checked
                                ? [...new Set([...current, item.model])]
                                : current.filter((modelId) => modelId !== item.model)
                            )
                          }
                        />
                        <span className="keys-model-option-text">
                          <strong>{item.providerName}</strong>
                          <code className="keys-inline-code">{item.model}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="muted">
                  {text("仅展示已启用且已配置 URL、API Key 的模型；如果全部不勾选，表示该 AppKey 不限制模型。", "Only enabled models with configured URL and API key are shown. If none are selected, this AppKey has no model restriction.")}
                </span>
              </label>
              <label className="keys-field">
                <span className="keys-label">{text("权限域", "Scopes")}</span>
                <div className="keys-play-row">
                  {["chat:complete", "usage:read", "billing:read", "admin:ops"].map(
                    (scope) => (
                      <label key={scope} className="muted">
                        <input
                          type="checkbox"
                          checked={formScopes.includes(scope)}
                          onChange={(e) =>
                            setFormScopes((current) =>
                              e.target.checked
                                ? [...new Set([...current, scope])]
                                : current.filter((item) => item !== scope)
                            )
                          }
                        />{" "}
                        {scope}
                      </label>
                    )
                  )}
                </div>
              </label>
              <label className="keys-field">
                <span className="keys-label">{text("状态", "Status")}</span>
                <select
                  className="input-plain"
                  value={formStatus}
                  onChange={(e) =>
                    setFormStatus(e.target.value as "active" | "disabled")
                  }
                >
                  <option value="active">{text("启用", "Active")}</option>
                  <option value="disabled">{text("禁用", "Disabled")}</option>
                </select>
              </label>
              {createMut.error ? (
                <p className="error keys-form-error">
                  {(createMut.error as Error).message}
                </p>
              ) : null}
              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModalOpen(false)}
                >
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMut.isPending || availableModelsQuery.isLoading}
                >
                  {createMut.isPending ? text("创建中…", "Creating…") : text("创建", "Create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {revealToken ? (
        <div
          className="keys-modal-backdrop"
          role="presentation"
          onClick={() => setRevealToken(null)}
        >
          <div
            className="keys-modal keys-modal--narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keys-reveal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="keys-reveal-title" className="keys-reveal-title">
              {text("请保存密钥", "Save this key")}
            </h2>
            <p className="muted keys-reveal-hint">
              {text("完整密钥仅显示这一次，关闭后请在列表中通过前缀辨认。", "The full key is shown only once. After closing, identify it by its prefix in the list.")}
            </p>
            <div className="keys-reveal-box">
              <code className="keys-reveal-token">{revealToken}</code>
            </div>
            <div className="keys-modal-actions">
              <Link
                to="/integration-docs"
                className="btn btn-ghost"
                onClick={() => setRevealToken(null)}
              >
                {text("查看 SDK 文档中心", "Open SDK docs")}
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const copied = await copyText(revealToken);
                  setCopyFeedback(copied ? "copied" : "failed");
                }}
              >
                {copyFeedback === "copied"
                  ? text("已复制", "Copied")
                  : copyFeedback === "failed"
                    ? text("复制失败", "Copy failed")
                    : text("复制密钥", "Copy key")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRevealToken(null)}
              >
                {text("已保存", "Saved")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
