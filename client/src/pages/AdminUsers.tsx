import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminUserRow,
  type AdminUserTenantOption,
  type AppKeyAvailableModel,
} from "../api";
import { formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

const DEFAULT_TOKEN_BALANCE = "250000";

type CreateUserForm = {
  name: string;
  email: string;
  password: string;
  platformRole: "user" | "platform_admin";
  tenantMode: "new" | "existing";
  tenantRole: "owner" | "admin" | "developer" | "billing" | "member";
  tenantName: string;
  tenantId: string;
  tokenBalance: string;
};

type TenantBalanceForm = {
  tenantId: string;
  tenantName: string;
  userName: string;
  tokenBalance: string;
};

function defaultCreateForm(): CreateUserForm {
  return {
    name: "",
    email: "",
    password: "",
    platformRole: "user",
    tenantMode: "new",
    tenantRole: "owner",
    tenantName: "",
    tenantId: "",
    tokenBalance: DEFAULT_TOKEN_BALANCE,
  };
}

export function AdminUsers() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(() => defaultCreateForm());
  const [configOpen, setConfigOpen] = useState(false);
  const [tokenDialog, setTokenDialog] = useState<TenantBalanceForm | null>(null);
  const [selectedMembership, setSelectedMembership] = useState<{
    userId: string;
    userName: string;
    tenantId: string;
    tenantName: string;
    balanceTokens: string;
    allowedModels: string[];
  } | null>(null);
  const [modelSelection, setModelSelection] = useState<string[]>([]);
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api<AdminUserRow[]>("/admin/users"),
  });
  const tenantOptionsQuery = useQuery({
    queryKey: ["admin", "users", "tenant-options"],
    queryFn: () => api<AdminUserTenantOption[]>("/admin/users/tenant-options"),
  });
  const modelOptionsQuery = useQuery({
    queryKey: ["admin", "users", "available-models"],
    queryFn: () => api<AppKeyAvailableModel[]>("/admin/users/available-models"),
  });
  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/admin/users", {
        method: "POST",
        body: JSON.stringify(createForm),
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      setCreateForm(defaultCreateForm());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "users"] }),
        qc.invalidateQueries({ queryKey: ["admin", "users", "tenant-options"] }),
      ]);
    },
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

  const tokenBalanceMut = useMutation({
    mutationFn: async () => {
      if (!tokenDialog) return;
      return api<{ ok: boolean; balanceTokens: string }>(
        `/admin/users/tenants/${tokenDialog.tenantId}/token-balance`,
        {
          method: "PATCH",
          body: JSON.stringify({ tokenBalance: tokenDialog.tokenBalance }),
        }
      );
    },
    onSuccess: async () => {
      setTokenDialog(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin", "users"] }),
        qc.invalidateQueries({ queryKey: ["admin", "users", "tenant-options"] }),
      ]);
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
  const tenantOptions = tenantOptionsQuery.data ?? [];

  useEffect(() => {
    if (!configOpen || !selectedMembership) {
      return;
    }
    if (selectedMembership.allowedModels.length > 0 || modelOptions.length === 0) {
      return;
    }
    setModelSelection(modelOptions.map((item) => item.model));
  }, [configOpen, modelOptions, selectedMembership]);

  useEffect(() => {
    if (
      !createOpen ||
      createForm.tenantMode !== "existing" ||
      createForm.tenantId ||
      tenantOptions.length === 0
    ) {
      return;
    }
    const first = tenantOptions[0];
    setCreateForm((current) => ({
      ...current,
      tenantId: first.id,
      tokenBalance: first.balanceTokens,
    }));
  }, [createOpen, createForm.tenantId, createForm.tenantMode, tenantOptions]);

  function openCreateModal() {
    setCreateOpen(true);
    setCreateForm(defaultCreateForm());
    createMut.reset();
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateForm(defaultCreateForm());
    createMut.reset();
  }

  function updateCreateForm(patch: Partial<CreateUserForm>) {
    setCreateForm((current) => ({ ...current, ...patch }));
  }

  function applyExistingTenant(tenantId: string) {
    const selected = tenantOptions.find((item) => item.id === tenantId);
    updateCreateForm({
      tenantMode: "existing",
      tenantId,
      tokenBalance: selected?.balanceTokens ?? createForm.tokenBalance,
    });
  }

  function openConfig(
    user: Pick<AdminUserRow, "id" | "name">,
    membership: AdminUserRow["memberships"][number]
  ) {
    setSelectedMembership({
      userId: user.id,
      userName: user.name,
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      balanceTokens: membership.balanceTokens,
      allowedModels: membership.allowedModels,
    });
    setModelSelection(membership.allowedModels);
    setConfigOpen(true);
    saveMut.reset();
  }

  function openTokenDialog(
    user: Pick<AdminUserRow, "name">,
    membership: AdminUserRow["memberships"][number]
  ) {
    setTokenDialog({
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      userName: user.name,
      tokenBalance: membership.balanceTokens,
    });
    tokenBalanceMut.reset();
  }

  function closeTokenDialog() {
    setTokenDialog(null);
    tokenBalanceMut.reset();
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
            {text(
              "查看全平台账号、平台角色、租户归属关系，并支持直接新增用户或管理员账号",
              "Review platform accounts, platform roles, tenant membership, and create users or admins directly"
            )}
          </p>
        </div>
      </header>

      <section className="bill-section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.9rem",
            flexWrap: "wrap",
          }}
        >
          <div className="pane-search" style={{ maxWidth: 420, minWidth: 280 }}>
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
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            {text("新增账号", "Create account")}
          </button>
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
                <th>{text("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={11} className="bill-table-empty muted">
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
                              className="admin-users-membership"
                            >
                              <span>
                                {`${item.tenantName}（${item.role} / ${item.tenantStatus}）`}
                                {" · "}
                                <span className="muted">
                                  {text(
                                    `余额 ${formatNumber(Number(item.balanceTokens), i18n.resolvedLanguage)} Token`,
                                    `Balance ${formatNumber(Number(item.balanceTokens), i18n.resolvedLanguage)} tokens`
                                  )}
                                </span>
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
                            </div>
                          ))}
                    </td>
                    <td>{row.requestCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.rechargeCount}</td>
                    <td>{row.rechargeSuccessCny}</td>
                    <td>{row.emailVerifiedAt ? text("已验证", "Verified") : text("未验证", "Unverified")}</td>
                    <td>{formatDateTime(row.createdAt, i18n.resolvedLanguage)}</td>
                    <td>
                      {row.memberships.length === 0
                        ? text("—", "—")
                        : row.memberships.map((item) => (
                            <div
                              key={`${row.id}-${item.tenantId}-actions`}
                              className="admin-users-membership admin-users-membership--actions"
                            >
                              <div className="admin-users-actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => openTokenDialog(row, item)}
                                >
                                  {text("修改 Token", "Edit tokens")}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => openConfig(row, item)}
                                >
                                  {text("配置模型", "Configure models")}
                                </button>
                              </div>
                            </div>
                          ))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-user-create-title"
        >
          <div className="keys-modal keys-modal--wide">
            <div className="keys-modal-hd">
              <h2 id="admin-user-create-title">{text("新增用户 / 管理员", "Create user / admin")}</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={closeCreateModal}
                disabled={createMut.isPending}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <div className="provider-delete-warning">
                <p className="provider-delete-title">
                  {text("创建后可立即登录控制台", "New account can sign in immediately")}
                </p>
                <p className="muted provider-delete-text">
                  {text(
                    "支持两种方式：1）自动创建一个新租户并绑定给该账号；2）加入已有租户。这里配置的 Token 余额实际属于租户余额，如果选择已有租户，保存时会同步更新该租户当前余额。",
                    "Two modes are supported: create a new tenant for the account, or join an existing tenant. The token balance configured here belongs to the tenant. If you choose an existing tenant, saving will update that tenant's current balance."
                  )}
                </p>
              </div>

              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("姓名", "Name")}</span>
                  <input
                    value={createForm.name}
                    onChange={(e) => updateCreateForm({ name: e.target.value })}
                    placeholder={text("例如：张三", "Example: Jane Doe")}
                    disabled={createMut.isPending}
                  />
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("邮箱", "Email")}</span>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => updateCreateForm({ email: e.target.value })}
                    placeholder="name@example.com"
                    disabled={createMut.isPending}
                  />
                </label>
              </div>

              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("登录密码", "Password")}</span>
                  <input
                    type="password"
                    minLength={6}
                    value={createForm.password}
                    onChange={(e) => updateCreateForm({ password: e.target.value })}
                    placeholder={text("至少 6 位", "At least 6 characters")}
                    disabled={createMut.isPending}
                  />
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("平台角色", "Platform Role")}</span>
                  <select
                    value={createForm.platformRole}
                    onChange={(e) =>
                      updateCreateForm({
                        platformRole: e.target.value as CreateUserForm["platformRole"],
                      })
                    }
                    disabled={createMut.isPending}
                  >
                    <option value="user">{text("普通用户", "User")}</option>
                    <option value="platform_admin">{text("平台管理员", "Platform Admin")}</option>
                  </select>
                </label>
              </div>

              <div className="keys-field-row">
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("租户模式", "Tenant Mode")}</span>
                  <select
                    value={createForm.tenantMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as CreateUserForm["tenantMode"];
                      if (nextMode === "new") {
                        updateCreateForm({
                          tenantMode: "new",
                          tenantId: "",
                          tenantName: "",
                          tokenBalance:
                            createForm.tenantMode === "existing"
                              ? DEFAULT_TOKEN_BALANCE
                              : createForm.tokenBalance,
                        });
                        return;
                      }
                      if (tenantOptions.length > 0) {
                        applyExistingTenant(tenantOptions[0].id);
                      } else {
                        updateCreateForm({ tenantMode: "existing", tenantId: "" });
                      }
                    }}
                    disabled={createMut.isPending}
                  >
                    <option value="new">{text("自动创建新租户", "Create new tenant")}</option>
                    <option value="existing">{text("加入已有租户", "Join existing tenant")}</option>
                  </select>
                </label>
                <label className="keys-field keys-field--half">
                  <span className="keys-label">{text("租户角色", "Tenant Role")}</span>
                  <select
                    value={createForm.tenantRole}
                    onChange={(e) =>
                      updateCreateForm({
                        tenantRole: e.target.value as CreateUserForm["tenantRole"],
                      })
                    }
                    disabled={createMut.isPending}
                  >
                    <option value="owner">{text("所有者", "Owner")}</option>
                    <option value="admin">{text("管理员", "Admin")}</option>
                    <option value="developer">{text("开发者", "Developer")}</option>
                    <option value="billing">{text("财务", "Billing")}</option>
                    <option value="member">{text("成员", "Member")}</option>
                  </select>
                </label>
              </div>

              {createForm.tenantMode === "new" ? (
                <label className="keys-field">
                  <span className="keys-label">{text("新租户名称", "New Tenant Name")}</span>
                  <input
                    value={createForm.tenantName}
                    onChange={(e) => updateCreateForm({ tenantName: e.target.value })}
                    placeholder={text("例如：某某科技", "Example: Acme AI")}
                    disabled={createMut.isPending}
                  />
                </label>
              ) : (
                <label className="keys-field">
                  <span className="keys-label">{text("选择已有租户", "Select Existing Tenant")}</span>
                  <select
                    value={createForm.tenantId}
                    onChange={(e) => applyExistingTenant(e.target.value)}
                    disabled={createMut.isPending || tenantOptionsQuery.isLoading}
                  >
                    {tenantOptions.length === 0 ? (
                      <option value="">{text("暂无可选租户", "No tenant available")}</option>
                    ) : (
                      tenantOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {text(
                            `${item.name}（${item.slug} / 余额 ${formatNumber(Number(item.balanceTokens), i18n.resolvedLanguage)}）`,
                            `${item.name} (${item.slug} / balance ${formatNumber(Number(item.balanceTokens), i18n.resolvedLanguage)})`
                          )}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              )}

              <label className="keys-field">
                <span className="keys-label">{text("Token 余额", "Token Balance")}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={createForm.tokenBalance}
                  onChange={(e) => updateCreateForm({ tokenBalance: e.target.value })}
                  disabled={createMut.isPending}
                />
                <span className="muted">
                  {text(
                    "该值会写入租户当前 token 余额。创建新租户时表示初始余额；加入已有租户时表示更新后的租户余额。",
                    "This value will be stored as the tenant's current token balance. For a new tenant, it becomes the initial balance. For an existing tenant, it becomes the updated balance."
                  )}
                </span>
              </label>

              {createMut.error ? <p className="error">{(createMut.error as Error).message}</p> : null}

              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeCreateModal}
                  disabled={createMut.isPending}
                >
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => createMut.mutate()}
                  disabled={
                    createMut.isPending ||
                    (createForm.tenantMode === "existing" &&
                      (tenantOptionsQuery.isLoading || tenantOptions.length === 0))
                  }
                >
                  {createMut.isPending ? text("创建中…", "Creating…") : text("确认创建", "Create")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tokenDialog ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-user-token-title"
        >
          <div className="keys-modal">
            <div className="keys-modal-hd">
              <h2 id="admin-user-token-title">
                {text("修改租户 Token 余额", "Update tenant token balance")}
              </h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={closeTokenDialog}
                disabled={tokenBalanceMut.isPending}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <div className="provider-delete-warning">
                <p className="provider-delete-title">
                  {text(
                    `${tokenDialog.userName} / ${tokenDialog.tenantName}`,
                    `${tokenDialog.userName} / ${tokenDialog.tenantName}`
                  )}
                </p>
                <p className="muted provider-delete-text">
                  {text(
                    "这里修改的是租户当前 Token 余额，保存后该租户下所有成员都会看到新的余额。",
                    "This updates the tenant's current token balance. All members in the tenant will see the new balance after saving."
                  )}
                </p>
              </div>

              <label className="keys-field">
                <span className="keys-label">{text("Token 余额", "Token Balance")}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={tokenDialog.tokenBalance}
                  onChange={(e) =>
                    setTokenDialog((current) =>
                      current ? { ...current, tokenBalance: e.target.value } : current
                    )
                  }
                  disabled={tokenBalanceMut.isPending}
                />
              </label>

              {tokenBalanceMut.error ? (
                <p className="error">{(tokenBalanceMut.error as Error).message}</p>
              ) : null}

              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeTokenDialog}
                  disabled={tokenBalanceMut.isPending}
                >
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => tokenBalanceMut.mutate()}
                  disabled={tokenBalanceMut.isPending}
                >
                  {tokenBalanceMut.isPending
                    ? text("保存中…", "Saving…")
                    : text("保存余额", "Save balance")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
