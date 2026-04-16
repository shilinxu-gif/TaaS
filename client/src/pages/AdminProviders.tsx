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
  modelCatalogText: string;
};

function buildForm(row: ProviderConfigRow): ProviderForm {
  return {
    enabled: row.enabled,
    priority: String(row.priority),
    timeoutMs: String(row.timeoutMs),
    baseUrl: row.baseUrl ?? "",
    healthStatus: row.healthStatus,
    apiKey: "",
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
  const rows = providersQuery.data ?? [];
  const selected =
    rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setSelectedId(null);
      setForm(null);
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
          apiKey: form.apiKey.trim() || undefined,
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
      <header className="usage-header">
        <div>
          <h1 className="usage-title">供应商与模型接入</h1>
          <p className="usage-subtitle muted">
            平台管理员可在这里维护上游供应商、API Key、模型目录和超时策略
          </p>
        </div>
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
              {rows.map((row) => (
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
              ))}
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
                placeholder="输入新的上游 API Key"
                value={form.apiKey}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, apiKey: e.target.value } : prev,
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
          </div>
        </section>
      ) : null}
    </div>
  );
}
