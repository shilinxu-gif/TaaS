import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  api,
  gatewayChat,
  type AppKeyCreateResponse,
  type AppKeyListRow,
} from "../api";

function parseModelsFromText(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  const [formModelsText, setFormModelsText] = useState("");
  const [formStatus, setFormStatus] = useState<"active" | "disabled">("active");

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
          allowedModels: parseModelsFromText(formModelsText),
          status: formStatus,
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
      setFormModelsText("");
      setFormStatus("active");
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
          messages: [{ role: "user", content: "你好，这是一次演示调用。" }],
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
           （OpenAI 兼容，演示供应商）
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
                <th>QPS 限制</th>
                <th>日预算 (USD)</th>
                <th>允许模型</th>
                <th>创建时间</th>
                <th>启用</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="keys-table-empty muted">
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
                    <td className="tabular-nums">
                      {row.qpsLimit != null ? row.qpsLimit : "—"}
                    </td>
                    <td className="tabular-nums">
                      {row.dailyBudgetUsd != null ? row.dailyBudgetUsd : "—"}
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
                    <td className="keys-td-time">
                      {new Date(row.createdAt).toLocaleString("zh-CN")}
                    </td>
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
        <summary>网关试用（演示）</summary>
        <p className="muted keys-details-hint">
          粘贴完整 <code className="keys-inline-code">sk-demo-…</code>{" "}
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
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro</option>
              <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
              <option value="gpt-fallback-demo">gpt-fallback-demo</option>
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
              <label className="keys-field">
                <span className="keys-label">允许模型</span>
                <textarea
                  className="input-plain keys-textarea"
                  value={formModelsText}
                  onChange={(e) => setFormModelsText(e.target.value)}
                  placeholder="每行一个 model id，或用英文逗号分隔。留空表示不限制。"
                  rows={3}
                />
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
                  disabled={createMut.isPending}
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
