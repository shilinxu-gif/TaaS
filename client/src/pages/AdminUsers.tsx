import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type AdminUserRow } from "../api";
import { formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

export function AdminUsers() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const [search, setSearch] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api<AdminUserRow[]>("/admin/users"),
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
                        : row.memberships
                            .map(
                              (item) =>
                                `${item.tenantName}（${item.role} / ${item.tenantStatus}）`,
                            )
                            .join("；")}
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
    </div>
  );
}
