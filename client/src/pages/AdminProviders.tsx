import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ProviderConfigRow } from "../api";

type ProviderForm = {
  enabled: boolean;
  priority: string;
  timeoutMs: string;
  baseUrl: string;
  healthStatus: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiKeyDirty: boolean;
  modelCatalogText: string;
};

type CreateProviderForm = {
  name: string;
  slug: string;
  providerType: "openai" | "anthropic" | "google";
  enabled: boolean;
  priority: string;
  timeoutMs: string;
  baseUrl: string;
  healthStatus: string;
  apiKey: string;
  modelCatalogText: string;
  supportsStreaming: boolean;
};

const API_KEY_MASK = "••••••••••••••••";

function defaultCatalogForType(providerType: CreateProviderForm["providerType"]): string {
  const model =
    providerType === "anthropic"
      ? "claude-3-5-sonnet-latest"
      : providerType === "google"
        ? "gemini-1.5-flash"
        : "gpt-4o-mini";
  return JSON.stringify(
    [
      {
        model,
        providerType,
        inputUsdPerMillion: "0.15",
        outputUsdPerMillion: "0.60",
        supportsStreaming: true,
      },
    ],
    null,
    2,
  );
}

function defaultCreateForm(): CreateProviderForm {
  return {
    name: "",
    slug: "",
    providerType: "openai",
    enabled: true,
    priority: "100",
    timeoutMs: "30000",
    baseUrl: "",
    healthStatus: "unknown",
    apiKey: "",
    modelCatalogText: defaultCatalogForType("openai"),
    supportsStreaming: true,
  };
}

function buildForm(row: ProviderConfigRow): ProviderForm {
  return {
    enabled: row.enabled,
    priority: String(row.priority),
    timeoutMs: String(row.timeoutMs),
    baseUrl: row.baseUrl ?? "",
    healthStatus: row.healthStatus,
    apiKey: "",
    apiKeyConfigured: row.configured,
    apiKeyDirty: false,
    modelCatalogText: JSON.stringify(row.modelCatalog, null, 2),
  };
}

export function AdminProviders() {
  const qc = useQueryClient();
  const providersQuery = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => api<ProviderConfigRow[]>("/providers"),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [jsonError, setJsonError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateProviderForm>(() => defaultCreateForm());
  const [createJsonError, setCreateJsonError] = useState("");
  const rows = providersQuery.data ?? [];
  const selected =
    rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setSelectedId(null);
      setForm(null);
      setDeleteOpen(false);
      return;
    }
    if (selectedId == null) {
      setSelectedId(selected.id);
      setForm(buildForm(selected));
      return;
    }
    if (selected.id !== selectedId) {
      setForm(buildForm(selected));
    }
  }, [selected, selectedId]);

  useEffect(() => {
    if (!deleteOpen) {
      setDeleteCountdown(10);
      return;
    }
    setDeleteCountdown(10);
    const timer = window.setInterval(() => {
      setDeleteCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deleteOpen, selected?.id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selected || !form) return;
      let modelCatalog: unknown;
      try {
        modelCatalog = JSON.parse(form.modelCatalogText);
        setJsonError("");
      } catch {
        setJsonError("模型目录 JSON 格式不正确");
        throw new Error("模型目录 JSON 格式不正确");
      }
      return api<ProviderConfigRow>(`/providers/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: form.enabled,
          priority: Number(form.priority),
          timeoutMs: Number(form.timeoutMs),
          baseUrl: form.baseUrl.trim() || undefined,
          healthStatus: form.healthStatus,
          apiKey: form.apiKeyDirty ? form.apiKey.trim() || undefined : undefined,
          modelCatalog,
        }),
      });
    },
    onSuccess: () => {
      setJsonError("");
      if (selected) {
        const next = rows.find((row) => row.id === selected.id);
        if (next) setForm(buildForm(next));
      }
      void qc.invalidateQueries({ queryKey: ["admin", "providers"] });
      void qc.invalidateQueries({ queryKey: ["routing"] });
      void qc.invalidateQueries({ queryKey: ["ops", "overview"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      return api<{ id: string; name: string; deleted: boolean }>(
        `/providers/${selected.id}`,
        {
          method: "DELETE",
        },
      );
    },
    onSuccess: () => {
      setDeleteOpen(false);
      setSelectedId(null);
      setForm(null);
      setJsonError("");
      void qc.invalidateQueries({ queryKey: ["admin", "providers"] });
      void qc.invalidateQueries({ queryKey: ["routing"] });
      void qc.invalidateQueries({ queryKey: ["ops", "overview"] });
      void qc.invalidateQueries({ queryKey: ["app-keys", "available-models"] });
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      let modelCatalog: unknown;
      try {
        modelCatalog = JSON.parse(createForm.modelCatalogText);
        setCreateJsonError("");
      } catch {
        setCreateJsonError("模型目录 JSON 格式不正确");
        throw new Error("模型目录 JSON 格式不正确");
      }
      const payload: Record<string, unknown> = {
        name: createForm.name.trim(),
        slug: createForm.slug.trim(),
        providerType: createForm.providerType,
        enabled: createForm.enabled,
        priority: Number(createForm.priority),
        timeoutMs: Number(createForm.timeoutMs),
        healthStatus: createForm.healthStatus,
        modelCatalog,
        supportsStreaming: createForm.supportsStreaming,
      };
      const bu = createForm.baseUrl.trim();
      if (bu) payload.baseUrl = bu;
      const key = createForm.apiKey.trim();
      if (key) payload.apiKey = key;
      return api<ProviderConfigRow>("/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (created) => {
      setCreateOpen(false);
      setCreateForm(defaultCreateForm());
      setCreateJsonError("");
      setSelectedId(created.id);
      setForm(buildForm(created));
      setJsonError("");
      void qc.invalidateQueries({ queryKey: ["admin", "providers"] });
      void qc.invalidateQueries({ queryKey: ["routing"] });
      void qc.invalidateQueries({ queryKey: ["ops", "overview"] });
      void qc.invalidateQueries({ queryKey: ["app-keys", "available-models"] });
    },
  });

  const healthOptions = useMemo(
    () => ["healthy", "degraded", "unknown"],
    [],
  );

  if (providersQuery.isLoading) {
    return <p className="muted usage-page-pad">加载中…</p>;
  }
  if (providersQuery.error) {
    return (
      <p className="error usage-page-pad">
        {(providersQuery.error as Error).message}
      </p>
    );
  }

  return (
    <div className="usage-page">
      <header
        className="usage-header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="usage-title">供应商与模型接入</h1>
          <p className="usage-subtitle muted">
            平台管理员可在这里维护上游供应商、API Key、模型目录和超时策略
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setCreateForm(defaultCreateForm());
            setCreateJsonError("");
            createMut.reset();
            setCreateOpen(true);
          }}
        >
          新增供应商
        </button>
      </header>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">供应商列表</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>供应商</th>
                <th>类型</th>
                <th>优先级</th>
                <th>状态</th>
                <th>已配置 Key</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: "1.25rem", textAlign: "center" }}>
                    暂无供应商配置，请点击「新增供应商」创建第一条上游。
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      setSelectedId(row.id);
                      setForm(buildForm(row));
                      setJsonError("");
                    }}
                    style={{
                      cursor: "pointer",
                      background:
                        selected?.id === row.id ? "rgba(40, 120, 255, 0.08)" : "",
                    }}
                  >
                    <td>{row.name}</td>
                    <td>{row.providerType}</td>
                    <td>{row.priority}</td>
                    <td>{row.healthStatus}</td>
                    <td>{row.configured ? "是" : "否"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && form ? (
        <section className="bill-section">
          <h2 className="bill-section-title">编辑：{selected.name}</h2>
          <div className="form-grid-2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>启用状态</label>
              <select
                value={form.enabled ? "true" : "false"}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, enabled: e.target.value === "true" }
                      : prev,
                  )
                }
              >
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>健康状态</label>
              <select
                value={form.healthStatus}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, healthStatus: e.target.value } : prev,
                  )
                }
              >
                {healthOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>优先级</label>
              <input
                type="number"
                min={1}
                max={999}
                value={form.priority}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, priority: e.target.value } : prev,
                  )
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>超时（ms）</label>
              <input
                type="number"
                min={1000}
                max={120000}
                value={form.timeoutMs}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, timeoutMs: e.target.value } : prev,
                  )
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label>Base URL（可选）</label>
              <input
                placeholder="留空表示沿用当前地址"
                value={form.baseUrl}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, baseUrl: e.target.value } : prev,
                  )
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label>API Key（留空表示不修改）</label>
              <input
                type="password"
                placeholder={form.apiKeyConfigured ? API_KEY_MASK : "输入新的上游 API Key"}
                value={
                  form.apiKeyDirty
                    ? form.apiKey
                    : form.apiKeyConfigured
                      ? API_KEY_MASK
                      : ""
                }
                onFocus={() =>
                  setForm((prev) =>
                    prev && prev.apiKeyConfigured && !prev.apiKeyDirty
                      ? { ...prev, apiKeyDirty: true, apiKey: "" }
                      : prev,
                  )
                }
                onBlur={() =>
                  setForm((prev) =>
                    prev && prev.apiKeyDirty && !prev.apiKey.trim()
                      ? { ...prev, apiKeyDirty: false, apiKey: "" }
                      : prev,
                  )
                }
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, apiKeyDirty: true, apiKey: e.target.value }
                      : prev,
                  )
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label>模型目录 JSON</label>
              <textarea
                rows={14}
                value={form.modelCatalogText}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, modelCatalogText: e.target.value }
                      : prev,
                  )
                }
              />
            </div>
          </div>
          {jsonError ? <p className="error">{jsonError}</p> : null}
          {saveMut.error ? (
            <p className="error">{(saveMut.error as Error).message}</p>
          ) : null}
          {deleteMut.error ? (
            <p className="error">{(deleteMut.error as Error).message}</p>
          ) : null}
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              保存配置
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setForm(buildForm(selected))}
            >
              重置
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginLeft: "auto" }}
              disabled={saveMut.isPending || deleteMut.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              删除供应商
            </button>
          </div>
        </section>
      ) : null}

      {createOpen ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-create-title"
        >
          <div className="keys-modal" style={{ maxWidth: 560 }}>
            <div className="keys-modal-hd">
              <h2 id="provider-create-title">新增供应商</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setCreateOpen(false)}
                disabled={createMut.isPending}
              >
                关闭
              </button>
            </div>
            <div className="keys-form">
              <p className="muted" style={{ marginTop: 0 }}>
                创建后可在列表中选中该供应商，补充或修改 API Key、模型目录与 Base URL。slug
                用于内部标识，仅支持小写字母、数字与连字符，且全局唯一。
              </p>
              <div className="form-grid-2">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>显示名称</label>
                  <input
                    value={createForm.name}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="例如：自建 OpenAI 兼容网关"
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>slug（唯一）</label>
                  <input
                    value={createForm.slug}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, slug: e.target.value }))
                    }
                    placeholder="例如：my-openai-proxy"
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>协议类型 provider_type</label>
                  <select
                    value={createForm.providerType}
                    onChange={(e) => {
                      const providerType = e.target.value as CreateProviderForm["providerType"];
                      setCreateForm((prev) => ({
                        ...prev,
                        providerType,
                        modelCatalogText: defaultCatalogForType(providerType),
                      }));
                    }}
                  >
                    <option value="openai">openai</option>
                    <option value="anthropic">anthropic</option>
                    <option value="google">google</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>启用</label>
                  <select
                    value={createForm.enabled ? "true" : "false"}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        enabled: e.target.value === "true",
                      }))
                    }
                  >
                    <option value="true">启用</option>
                    <option value="false">停用</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>优先级</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={createForm.priority}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, priority: e.target.value }))
                    }
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>超时（ms）</label>
                  <input
                    type="number"
                    min={1000}
                    max={120000}
                    value={createForm.timeoutMs}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, timeoutMs: e.target.value }))
                    }
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label>Base URL（可选）</label>
                  <input
                    placeholder="https://api.openai.com/v1"
                    value={createForm.baseUrl}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                    }
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>健康状态</label>
                  <select
                    value={createForm.healthStatus}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        healthStatus: e.target.value,
                      }))
                    }
                  >
                    {healthOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>支持流式</label>
                  <select
                    value={createForm.supportsStreaming ? "true" : "false"}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        supportsStreaming: e.target.value === "true",
                      }))
                    }
                  >
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label>API Key（可选，至少 10 字符；可创建后再编辑补全）</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={createForm.apiKey}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, apiKey: e.target.value }))
                    }
                    placeholder="留空则仅创建配置，稍后在编辑中填写"
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label>模型目录 JSON</label>
                  <textarea
                    rows={10}
                    value={createForm.modelCatalogText}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        modelCatalogText: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              {createJsonError ? <p className="error">{createJsonError}</p> : null}
              {createMut.error ? (
                <p className="error">{(createMut.error as Error).message}</p>
              ) : null}
              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCreateOpen(false)}
                  disabled={createMut.isPending}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createMut.isPending || !createForm.name.trim() || !createForm.slug.trim()}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending ? "创建中…" : "创建"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen && selected ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-delete-title"
        >
          <div className="keys-modal keys-modal--narrow">
            <div className="keys-modal-hd">
              <h2 id="provider-delete-title">确认删除供应商</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteMut.isPending}
              >
                关闭
              </button>
            </div>
            <div className="keys-form">
              <div className="provider-delete-warning">
                <p className="provider-delete-title">
                  你将删除供应商「{selected.name}」
                </p>
                <p className="muted provider-delete-text">
                  删除后将移除该上游配置与模型目录；如果该供应商已有历史调用记录，系统会拒绝删除。
                </p>
                <p className="muted provider-delete-text">
                  为避免误操作，确认按钮将在 <strong>{deleteCountdown}</strong> 秒后可点击。
                </p>
              </div>
              {deleteMut.error ? (
                <p className="error">{(deleteMut.error as Error).message}</p>
              ) : null}
              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteMut.isPending}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={deleteMut.isPending || deleteCountdown > 0}
                  onClick={() => deleteMut.mutate()}
                >
                  {deleteMut.isPending
                    ? "删除中..."
                    : deleteCountdown > 0
                      ? `确认删除（${deleteCountdown}s）`
                      : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
