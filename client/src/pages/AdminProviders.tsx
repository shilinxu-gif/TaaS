import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type ProviderConfigRow } from "../api";
import { pickText } from "../i18n/inline";

type ProviderForm = {
  enabled: boolean;
  priority: string;
  timeoutMs: string;
  modelVendor: string;
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
  modelVendor: string;
  baseUrl: string;
  healthStatus: string;
  apiKey: string;
  modelCatalogText: string;
  supportsStreaming: boolean;
};

const API_KEY_MASK = "••••••••••••••••";
const BASE_URL_DATALIST_ID = "provider-base-url-options";
const MODEL_VENDOR_DATALIST_ID = "provider-model-vendor-options";
const MODEL_VENDOR_OPTIONS = [
  "Anthropic",
  "Google",
  "OpenAI",
  "DeepSeek",
  "Qwen",
  "BAAI",
  "Tongyi",
  "BytePlus",
  "xAI",
  "Zhipu",
  "MiniMax",
  "Kling",
  "Moonshot",
];

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
        capabilityTags: ["chat", "streaming"],
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
    modelVendor: "",
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
    modelVendor: row.modelVendor ?? "",
    baseUrl: row.baseUrl ?? "",
    healthStatus: row.healthStatus,
    apiKey: "",
    apiKeyConfigured: row.configured,
    apiKeyDirty: false,
    modelCatalogText: JSON.stringify(row.modelCatalog, null, 2),
  };
}

export function AdminProviders() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
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
  const baseUrlOptions = useMemo(() => {
    const options = new Map<string, Set<string>>();
    for (const row of rows) {
      const url = row.baseUrl?.trim();
      if (!url) continue;
      const labels = options.get(url) ?? new Set<string>();
      const models = row.modelCatalog
        .map((item) => (typeof item.model === "string" ? item.model.trim() : ""))
        .filter(Boolean)
        .slice(0, 3);
      labels.add(models.length ? `${row.name}: ${models.join(", ")}` : row.name);
      options.set(url, labels);
    }
    return Array.from(options, ([url, labels]) => ({
      url,
      label: Array.from(labels).join(" / "),
    }));
  }, [rows]);
  const modelVendorOptions = useMemo(() => {
    const options = new Set(MODEL_VENDOR_OPTIONS);
    for (const row of rows) {
      const vendor = row.modelVendor?.trim();
      if (vendor) options.add(vendor);
    }
    const editingVendor = form?.modelVendor.trim();
    if (editingVendor) options.add(editingVendor);
    const creatingVendor = createForm.modelVendor.trim();
    if (creatingVendor) options.add(creatingVendor);
    return Array.from(options);
  }, [createForm.modelVendor, form?.modelVendor, rows]);

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
        const message = text("模型目录 JSON 格式不正确", "Model catalog JSON is invalid");
        setJsonError(message);
        throw new Error(message);
      }
      return api<ProviderConfigRow>(`/providers/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: form.enabled,
          priority: Number(form.priority),
          timeoutMs: Number(form.timeoutMs),
          modelVendor: form.modelVendor.trim() || undefined,
          baseUrl: form.baseUrl.trim() || undefined,
          healthStatus: form.healthStatus,
          apiKey: form.apiKeyDirty ? form.apiKey.trim() || undefined : undefined,
          modelCatalog,
        }),
      });
    },
    onSuccess: (updated) => {
      setJsonError("");
      // 必须用接口返回值更新表单：invalidate 后 refetch 尚未完成时，rows 仍是旧缓存，
      // 用 rows.find 会误把 modelCatalogText 覆盖成保存前的 JSON
      if (updated) {
        setForm(buildForm(updated));
        qc.setQueryData(["admin", "providers"], (old: ProviderConfigRow[] | undefined) => {
          if (!old?.length) return old;
          const idx = old.findIndex((r) => r.id === updated.id);
          if (idx < 0) return old;
          const next = [...old];
          next[idx] = updated;
          return next;
        });
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
        const message = text("模型目录 JSON 格式不正确", "Model catalog JSON is invalid");
        setCreateJsonError(message);
        throw new Error(message);
      }
      const payload: Record<string, unknown> = {
        name: createForm.name.trim(),
        slug: createForm.slug.trim(),
        providerType: createForm.providerType,
        modelVendor: createForm.modelVendor.trim() || undefined,
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
    return <p className="muted usage-page-pad">{text("加载中…", "Loading…")}</p>;
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
          <h1 className="usage-title">{text("供应商与模型接入", "Providers & Models")}</h1>
          <p className="usage-subtitle muted">
            {text(
              "平台管理员可在这里维护上游供应商、API Key、模型目录和超时策略",
              "Platform admins can manage upstream providers, API keys, model catalogs, and timeout policies here.",
            )}
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
          {text("新增供应商", "Create provider")}
        </button>
      </header>
      <datalist id={MODEL_VENDOR_DATALIST_ID}>
        {modelVendorOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("供应商列表", "Provider List")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{text("供应商", "Provider")}</th>
                <th>{text("模型厂商", "Model Vendor")}</th>
                <th>{text("类型", "Type")}</th>
                <th>{text("优先级", "Priority")}</th>
                <th>{text("状态", "Status")}</th>
                <th>{text("已配置 Key", "Key Configured")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: "1.25rem", textAlign: "center" }}>
                    {text(
                      "暂无供应商配置，请点击「新增供应商」创建第一条上游",
                      "No provider configuration yet. Click “Create provider” to add the first upstream.",
                    )}
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
                    <td>{row.modelVendor || text("未填写", "Not set")}</td>
                    <td>{row.providerType}</td>
                    <td>{row.priority}</td>
                    <td>{row.healthStatus}</td>
                    <td>{row.configured ? text("是", "Yes") : text("否", "No")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && form ? (
        <section className="bill-section admin-provider-edit-section">
          <h2 className="bill-section-title">
            {text(`编辑：${selected.name}`, `Edit: ${selected.name}`)}
          </h2>
          <div className="form-grid-2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{text("启用状态", "Enabled")}</label>
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
                <option value="true">{text("启用", "Enabled")}</option>
                <option value="false">{text("停用", "Disabled")}</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{text("健康状态", "Health Status")}</label>
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
              <label>{text("优先级", "Priority")}</label>
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
              <label>{text("模型厂商", "Model Vendor")}</label>
              <input
                list={MODEL_VENDOR_DATALIST_ID}
                placeholder={text(
                  "例如：Anthropic / Google / OpenAI / DeepSeek",
                  "e.g. Anthropic / Google / OpenAI / DeepSeek",
                )}
                value={form.modelVendor}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, modelVendor: e.target.value } : prev,
                  )
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{text("超时（ms）", "Timeout (ms)")}</label>
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
              <label>{text("Base URL（可选）", "Base URL (optional)")}</label>
              <input
                placeholder={text("留空表示沿用当前地址", "Leave blank to keep the current address")}
                value={form.baseUrl}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, baseUrl: e.target.value } : prev,
                  )
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label>{text("API Key（留空表示不修改）", "API Key (leave blank to keep unchanged)")}</label>
              <input
                type="password"
                placeholder={
                  form.apiKeyConfigured
                    ? API_KEY_MASK
                    : text("输入新的上游 API Key", "Enter a new upstream API key")
                }
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
              <label>{text("模型目录 JSON", "Model Catalog JSON")}</label>
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
              <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                {text(
                  "可在每个模型项配置 capabilityTags，例如：\"capabilityTags\": [\"chat\", \"reasoning\", \"text_to_image\"]",
                  "You can configure capabilityTags per model item, for example: \"capabilityTags\": [\"chat\", \"reasoning\", \"text_to_image\"].",
                )}
              </p>
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
              {text("保存配置", "Save configuration")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setForm(buildForm(selected))}
            >
              {text("重置", "Reset")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginLeft: "auto" }}
              disabled={saveMut.isPending || deleteMut.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              {text("删除供应商", "Delete provider")}
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
              <h2 id="provider-create-title">{text("新增供应商", "Create provider")}</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setCreateOpen(false)}
                disabled={createMut.isPending}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <p className="muted" style={{ marginTop: 0 }}>
                {text(
                  "创建后可在列表中选中该供应商，补充或修改 API Key、模型目录与 Base URLslug 用于内部标识，仅支持小写字母、数字与连字符，且全局唯一",
                  "After creation, select this provider in the list to add or update its API key, model catalog, and Base URL. The slug is an internal unique identifier and only supports lowercase letters, numbers, and hyphens.",
                )}
              </p>
              <div className="form-grid-2">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("显示名称", "Display Name")}</label>
                  <input
                    value={createForm.name}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={text("例如：自建 OpenAI 兼容网关", "e.g. Self-hosted OpenAI-compatible gateway")}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("slug（唯一）", "slug (unique)")}</label>
                  <input
                    value={createForm.slug}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, slug: e.target.value }))
                    }
                    placeholder={text("例如：my-openai-proxy", "e.g. my-openai-proxy")}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("协议类型 provider_type", "Protocol type provider_type")}</label>
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
                  <label>{text("模型厂商", "Model Vendor")}</label>
                  <input
                    list={MODEL_VENDOR_DATALIST_ID}
                    placeholder={text("例如：DeepSeek", "e.g. DeepSeek")}
                    value={createForm.modelVendor}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, modelVendor: e.target.value }))
                    }
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("启用", "Enabled")}</label>
                  <select
                    value={createForm.enabled ? "true" : "false"}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        enabled: e.target.value === "true",
                      }))
                    }
                  >
                    <option value="true">{text("启用", "Enabled")}</option>
                    <option value="false">{text("停用", "Disabled")}</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("优先级", "Priority")}</label>
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
                  <label>{text("超时（ms）", "Timeout (ms)")}</label>
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
                  <label>{text("Base URL（可选）", "Base URL (optional)")}</label>
                  <input
                    list={BASE_URL_DATALIST_ID}
                    placeholder="https://api.openai.com/v1"
                    value={createForm.baseUrl}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                    }
                  />
                  <datalist id={BASE_URL_DATALIST_ID}>
                    {baseUrlOptions.map((option) => (
                      <option key={option.url} value={option.url} label={option.label} />
                    ))}
                  </datalist>
                  <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                    {text(
                      "可从已有模型供应商地址中选择，也可以直接输入新的 Base URL",
                      "Choose from existing model provider addresses, or enter a new Base URL directly.",
                    )}
                  </p>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>{text("健康状态", "Health Status")}</label>
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
                  <label>{text("支持流式", "Supports Streaming")}</label>
                  <select
                    value={createForm.supportsStreaming ? "true" : "false"}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        supportsStreaming: e.target.value === "true",
                      }))
                    }
                  >
                    <option value="true">{text("是", "Yes")}</option>
                    <option value="false">{text("否", "No")}</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label>
                    {text(
                      "API Key（可选，至少 10 字符；可创建后再编辑补全）",
                      "API Key (optional, at least 10 characters; can be added after creation)",
                    )}
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={createForm.apiKey}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, apiKey: e.target.value }))
                    }
                    placeholder={text(
                      "留空则仅创建配置，稍后在编辑中填写",
                      "Leave blank to create the configuration only and fill it in later",
                    )}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label>{text("模型目录 JSON", "Model Catalog JSON")}</label>
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
                  <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                    {text(
                      "可在每个模型项配置 capabilityTags，例如：\"capabilityTags\": [\"chat\", \"reasoning\", \"text_to_image\"]",
                      "You can configure capabilityTags per model item, for example: \"capabilityTags\": [\"chat\", \"reasoning\", \"text_to_image\"].",
                    )}
                  </p>
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
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createMut.isPending || !createForm.name.trim() || !createForm.slug.trim()}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending ? text("创建中…", "Creating…") : text("创建", "Create")}
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
              <h2 id="provider-delete-title">{text("确认删除供应商", "Confirm provider deletion")}</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteMut.isPending}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <div className="provider-delete-warning">
                <p className="provider-delete-title">
                  {text(`你将删除供应商「${selected.name}」`, `You are deleting provider “${selected.name}”`)}
                </p>
                <p className="muted provider-delete-text">
                  {text(
                    "删除后将移除该上游配置与模型目录；如果该供应商已有历史调用记录，系统会拒绝删除",
                    "Deleting removes this upstream configuration and model catalog. If the provider has historical request logs, the system will reject the deletion.",
                  )}
                </p>
                <p className="muted provider-delete-text">
                  {text("为避免误操作，确认按钮将在 ", "To prevent mistakes, the confirm button will be enabled in ")}
                  <strong>{deleteCountdown}</strong>
                  {text(" 秒后可点击", " seconds.")}
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
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={deleteMut.isPending || deleteCountdown > 0}
                  onClick={() => deleteMut.mutate()}
                >
                  {deleteMut.isPending
                    ? text("删除中...", "Deleting...")
                    : deleteCountdown > 0
                      ? text(`确认删除（${deleteCountdown}s）`, `Confirm delete (${deleteCountdown}s)`)
                      : text("确认删除", "Confirm delete")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
