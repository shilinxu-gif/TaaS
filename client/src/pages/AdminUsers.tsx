import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type AdminUserRow, type AppKeyAvailableModel } from "../api";
import { formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

export function AdminUsers() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [selectedMembership, setSelectedMembership] = useState<{
    userId: string;
    userName: string;
    tenantId: string;
    tenantName: string;
    allowedModels: string[];
  } | null>(null);
  const [modelSelection, setModelSelection] = useState<string[]>([]);
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api<AdminUserRow[]>("/admin/users"),
  });
  const modelOptionsQuery = useQuery({
    queryKey: ["admin", "users", "available-models"],
    queryFn: () => api<AppKeyAvailableModel[]>("/admin/users/available-models"),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selectedMembership) return;
      const allModels = modelOptions.map((item) => item.model);
      const normalizedSelection =
        allModels.length > 0 && modelSelection.length === allModels.length
          ? []
          : modelSelection;
      return api<{ ok: boolean }>(
        `/admin/users/${selectedMembership.userId}/tenants/${selectedMembership.tenantId}/allowed-models`,
        {
          method: "PATCH",
          body: JSON.stringify({ allowedModels: normalizedSelection }),
        }
      );
    },
    onSuccess: async () => {
      setConfigOpen(false);
      setSelectedMembership(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (usersQuery.data ?? []).filter((row) => {
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.memberships.some(
          (item) =>
            item.tenantName.toLowerCase().includes(q) ||
            item.tenantSlug.toLowerCase().includes(q),
        )
      );
    });
  }, [search, usersQuery.data]);

  const modelOptions = modelOptionsQuery.data ?? [];

  useEffect(() => {
    if (!configOpen || !selectedMembership) {
      return;
    }
    if (selectedMembership.allowedModels.length > 0 || modelOptions.length === 0) {
      return;
    }
    setModelSelection(modelOptions.map((item) => item.model));
  }, [configOpen, modelOptions, selectedMembership]);

  function openConfig(
    user: Pick<AdminUserRow, "id" | "name">,
    membership: AdminUserRow["memberships"][number]
  ) {
    setSelectedMembership({
      userId: user.id,
      userName: user.name,
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      allowedModels: membership.allowedModels,
    });
    setModelSelection(membership.allowedModels);
    setConfigOpen(true);
    saveMut.reset();
  }

  if (usersQuery.isLoading) {
    return <p className="muted usage-page-pad">{text("加载中…", "Loading…")}</p>;
  }
  if (usersQuery.error) {
    return (
      <p className="error usage-page-pad">
        {(usersQuery.error as Error).message}
      </p>
    );
  }

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">{text("用户管理", "User Management")}</h1>
          <p className="usage-subtitle muted">
            {text("查看全平台账号、平台角色和租户归属关系", "Review platform accounts, platform roles, and tenant membership")}
          </p>
        </div>
      </header>

      <section className="bill-section">
        <div className="pane-search" style={{ maxWidth: 420 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
            />
          </svg>
          <input
            placeholder={text("搜索姓名 / 邮箱 / 租户", "Search by name / email / tenant")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("账号列表", "Account List")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{text("姓名", "Name")}</th>
                <th>{text("邮箱", "Email")}</th>
                <th>{text("平台角色", "Platform Role")}</th>
                <th>{text("租户", "Tenants")}</th>
                <th>{text("请求数", "Requests")}</th>
                <th>{text("总 Token", "Total Tokens")}</th>
                <th>{text("充值次数", "Recharge Count")}</th>
                <th>{text("成功充值(CNY)", "Successful Recharge (CNY)")}</th>
                <th>{text("邮箱验证", "Email Verification")}</th>
                <th>{text("创建时间", "Created At")}</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={10} className="bill-table-empty muted">
                    {text("暂无符合条件的用户", "No users match the current filters")}
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{row.platformRole}</td>
                    <td>
                      {row.memberships.length === 0
                        ? text("—", "—")
                        : row.memberships.map((item) => (
                            <div
                              key={`${row.id}-${item.tenantId}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "0.5rem",
                                padding: "0.2rem 0",
                              }}
                            >
                              <span>
                                {`${item.tenantName}（${item.role} / ${item.tenantStatus}）`}
                                {" · "}
                                <span className="muted">
                                  {item.allowedModels.length === 0
                                    ? text("全部模型", "All models")
                                    : text(
                                        `${item.allowedModels.length} 个模型`,
                                        `${item.allowedModels.length} models`
                                      )}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => openConfig(row, item)}
                              >
                                {text("配置模型", "Configure models")}
                              </button>
                            </div>
                          ))}
                    </td>
                    <td>{row.requestCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.rechargeCount}</td>
                    <td>{row.rechargeSuccessCny}</td>
                    <td>{row.emailVerifiedAt ? text("已验证", "Verified") : text("未验证", "Unverified")}</td>
                    <td>{formatDateTime(row.createdAt, i18n.resolvedLanguage)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {configOpen && selectedMembership ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-user-models-title"
        >
          <div className="keys-modal">
            <div className="keys-modal-hd">
              <h2 id="admin-user-models-title">
                {text("配置用户可用模型", "Configure user model access")}
              </h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => {
                  setConfigOpen(false);
                  setSelectedMembership(null);
                }}
                disabled={saveMut.isPending}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <div className="provider-delete-warning">
                <p className="provider-delete-title">
                  {text(
                    `${selectedMembership.userName} / ${selectedMembership.tenantName}`,
                    `${selectedMembership.userName} / ${selectedMembership.tenantName}`
                  )}
                </p>
                <p className="muted provider-delete-text">
                  {text(
                    "弹窗会默认勾选全部模型，表示该用户在当前租户下默认可使用全部模型；如果你想排除某个模型，直接取消勾选即可。保存后，用户新建 AppKey 时会自动继承这里配置的模型范围。",
                    "This dialog checks all models by default, which means the user can access all models in this tenant. If you want to exclude a model, simply uncheck it. New AppKeys created by this user will inherit this model scope automatically."
                  )}
                </p>
              </div>

              {modelOptionsQuery.isLoading ? (
                <p className="muted">{text("模型列表加载中…", "Loading models…")}</p>
              ) : modelOptions.length === 0 ? (
                <div className="keys-models-empty muted">
                  {text(
                    "当前没有可配置的模型，请先完成供应商模型配置。",
                    "No models are available to configure yet. Please finish provider model setup first."
                  )}
                </div>
              ) : (
                <div className="keys-models-list">
                  {modelOptions.map((item) => (
                    <label key={item.id} className="keys-model-option">
                      <input
                        type="checkbox"
                        checked={modelSelection.includes(item.model)}
                        onChange={(e) =>
                          setModelSelection((current) =>
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

              {saveMut.error ? <p className="error">{(saveMut.error as Error).message}</p> : null}

              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setConfigOpen(false);
                    setSelectedMembership(null);
                  }}
                  disabled={saveMut.isPending}
                >
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => saveMut.mutate()}
                  disabled={saveMut.isPending || modelOptionsQuery.isLoading}
                >
                  {saveMut.isPending ? text("保存中…", "Saving…") : text("保存配置", "Save settings")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
