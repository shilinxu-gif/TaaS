import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  api,
  gatewayChat,
  type AppKeyAvailableModel,
  type AppKeyCreateResponse,
  type AppKeyListRow,
} from "../api";

function statusBadge(status: string) {
  if (status === "active") {
    return <span className="keys-badge keys-badge--ok">启用</span>;
  }
  if (status === "disabled") {
    return <span className="keys-badge keys-badge--off">禁用</span>;
  }
  if (status === "revoked") {
    return <span className="keys-badge keys-badge--revoked">已撤销</span>;
  }
  return <span className="keys-badge">{status}</span>;
}

export function ApiKeys() {
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
          throw new Error("QPS 限制须为正整数或留空");
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
          messages: [{ role: "user", content: "你好，请返回一条连通性测试结果。" }],
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
      setPlayErr(e instanceof Error ? e.message : "调用失败");
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

  if (keysQuery.isLoading) return <p className="muted keys-page-pad">加载中…</p>;
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
          <h1 className="keys-title">API 密钥</h1>
          <p className="keys-subtitle muted">
            使用 AppKey 调用{" "}
            <code className="keys-inline-code">POST /v1/chat/completions</code>{" "}
           （OpenAI 兼容，多供应商真实网关）
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreateModal}>
          创建密钥
        </button>
      </header>

      <div className="keys-table-card">
        <div className="keys-table-scroll">
          <table className="keys-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>密钥前缀</th>
                <th>租户</th>
                <th>状态</th>
                <th>环境</th>
                <th>QPS 限制</th>
                <th>日预算 (USD)</th>
                <th>月预算 (USD)</th>
                <th>允许模型</th>
                <th>权限域</th>
                <th>创建时间</th>
                <th>最近来源</th>
                <th>启用</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="keys-table-empty muted">
                    暂无密钥，点击「创建密钥」新建
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
                    <td>{statusBadge(row.status)}</td>
                    <td>{row.environment}</td>
                    <td className="tabular-nums">
                      {row.qpsLimit != null ? row.qpsLimit : "—"}
                    </td>
                    <td className="tabular-nums">
                      {row.dailyBudgetUsd != null ? row.dailyBudgetUsd : "—"}
                    </td>
                    <td className="tabular-nums">
                      {row.monthlyBudgetUsd != null ? row.monthlyBudgetUsd : "—"}
                    </td>
                    <td className="keys-td-models">
                      {row.allowedModels.length === 0 ? (
                        <span className="muted">全部</span>
                      ) : (
                        <span title={row.allowedModels.join(", ")}>
                          {row.allowedModels.length} 个
                        </span>
                      )}
                    </td>
                    <td>{row.scopes.join(", ")}</td>
                    <td className="keys-td-time">
                      {new Date(row.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td>{row.lastUsedIp ?? "—"}</td>
                    <td>
                      {row.status === "revoked" ? (
                        <span className="muted">—</span>
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
        <summary>网关试用</summary>
        <p className="muted keys-details-hint">
          粘贴完整 <code className="keys-inline-code">sk-…</code>{" "}
          密钥。若密钥配置了模型白名单，请选用允许的 model。
        </p>
        <div className="keys-play-grid">
          <input
            className="input-plain"
            placeholder="Bearer AppKey（完整密钥）"
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
                <option value="">暂无已配置模型</option>
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
              placeholder="Idempotency-Key（可选）"
              value={idem}
              onChange={(e) => setIdem(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={availableModels.length === 0}
              onClick={() => void runPlayground()}
            >
              发送请求
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
              <h2 id="keys-modal-title">创建 API 密钥</h2>
              <button
                type="button"
                className="keys-modal-close btn btn-ghost"
                onClick={() => setModalOpen(false)}
              >
                关闭
              </button>
            </div>
            <form className="keys-form" onSubmit={submitCreate}>
              <label className="keys-field">
                <span className="keys-label">名称</span>
                <input
                  className="input-plain"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如：生产网关"
                  required
                  autoFocus
                />
              </label>
              <label className="keys-field">
                <span className="keys-label">描述</span>
                <textarea
                  className="input-plain keys-textarea"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="可选，方便团队识别用途"
                  rows={2}
                />
              </label>
              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">QPS 限制</span>
                  <input
                    className="input-plain"
                    type="number"
                    min={1}
                    step={1}
                    value={formQps}
                    onChange={(e) => setFormQps(e.target.value)}
                    placeholder="留空表示不限制"
                  />
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">日预算 (USD)</span>
                  <input
                    className="input-plain"
                    inputMode="decimal"
                    value={formBudget}
                    onChange={(e) => setFormBudget(e.target.value)}
                    placeholder="留空表示不限制"
                  />
                </label>
              </div>
              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">月预算 (USD)</span>
                  <input
                    className="input-plain"
                    inputMode="decimal"
                    value={formMonthlyBudget}
                    onChange={(e) => setFormMonthlyBudget(e.target.value)}
                    placeholder="留空表示不限制"
                  />
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">环境</span>
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
                <span className="keys-label">允许模型</span>
                {availableModels.length === 0 ? (
                  <div className="keys-models-empty muted">
                    当前没有已配置 URL 和 API Key 的模型可选，请先联系管理员完成供应商配置。
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
                  仅展示已启用且已配置 URL、API Key 的模型；如果全部不勾选，表示该 AppKey 不限制模型。
                </span>
              </label>
              <label className="keys-field">
                <span className="keys-label">权限域</span>
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
                <span className="keys-label">状态</span>
                <select
                  className="input-plain"
                  value={formStatus}
                  onChange={(e) =>
                    setFormStatus(e.target.value as "active" | "disabled")
                  }
                >
                  <option value="active">启用</option>
                  <option value="disabled">禁用</option>
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
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMut.isPending || availableModelsQuery.isLoading}
                >
                  {createMut.isPending ? "创建中…" : "创建"}
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
              请保存密钥
            </h2>
            <p className="muted keys-reveal-hint">
              完整密钥仅显示这一次，关闭后请在列表中通过前缀辨认。
            </p>
            <div className="keys-reveal-box">
              <code className="keys-reveal-token">{revealToken}</code>
            </div>
            <div className="keys-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void navigator.clipboard.writeText(revealToken)}
              >
                复制密钥
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRevealToken(null)}
              >
                已保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
