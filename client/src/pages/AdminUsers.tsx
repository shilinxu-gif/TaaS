import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AdminUserRow } from "../api";

export function AdminUsers() {
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
    return <p className="muted usage-page-pad">加载中…</p>;
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
          <h1 className="usage-title">用户管理</h1>
          <p className="usage-subtitle muted">
            查看全平台账号、平台角色和租户归属关系
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
            placeholder="搜索姓名 / 邮箱 / 租户"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">账号列表</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>邮箱</th>
                <th>平台角色</th>
                <th>租户</th>
                <th>请求数</th>
                <th>总 Token</th>
                <th>充值次数</th>
                <th>成功充值(CNY)</th>
                <th>邮箱验证</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={10} className="bill-table-empty muted">
                    暂无符合条件的用户
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
                        ? "—"
                        : row.memberships
                            .map(
                              (item) =>
                                `${item.tenantName}（${item.role} / ${item.tenantStatus}）`,
                            )
                            .join("；")}
                    </td>
                    <td>{row.requestCount}</td>
                    <td>{row.totalTokens.toLocaleString("zh-CN")}</td>
                    <td>{row.rechargeCount}</td>
                    <td>{row.rechargeSuccessCny}</td>
                    <td>{row.emailVerifiedAt ? "已验证" : "未验证"}</td>
                    <td>{new Date(row.createdAt).toLocaleString("zh-CN")}</td>
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
