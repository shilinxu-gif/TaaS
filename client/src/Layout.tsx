import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import {
  IcBolt,
  IcChart,
  IcDashboard,
  IcInvoiceDoc,
  IcKey,
  IcOps,
  IcPeople,
  IcReceipt,
  IcRoute,
  IcWallet,
} from "./navIcons";
import { BrandLogo } from "./BrandLogo";

const NAV_COLLAPSED_KEY = "taas-nav-collapsed";

const tenantLinks: {
  to: string;
  label: string;
  end?: boolean;
  Icon: ComponentType;
}[] = [
  { to: "/dashboard", label: "工作台", end: true, Icon: IcDashboard },
  { to: "/api-keys", label: "API 密钥", Icon: IcKey },
  { to: "/usage", label: "用量", Icon: IcChart },
  { to: "/optimization", label: "成本优化", Icon: IcBolt },
  { to: "/routing", label: "路由调度", Icon: IcRoute },
  { to: "/ops", label: "运营与审计", Icon: IcOps },
  { to: "/billing", label: "计费中心", Icon: IcReceipt },
  { to: "/recharge", label: "在线充值", Icon: IcWallet },
  { to: "/invoices", label: "自动化开票", Icon: IcInvoiceDoc },
];

const adminLinks: {
  to: string;
  label: string;
  end?: boolean;
  Icon: ComponentType;
}[] = [
  { to: "/dashboard", label: "平台概览", end: true, Icon: IcDashboard },
  { to: "/admin/usage", label: "调用与充值", Icon: IcChart },
  { to: "/admin/providers", label: "供应商与模型", Icon: IcRoute },
  { to: "/admin/users", label: "用户管理", Icon: IcPeople },
  { to: "/ops", label: "运营与审计", Icon: IcOps },
];

export function Layout() {
  const { user, logout } = useAuth();
  const initial = user?.name?.charAt(0) ?? "?";
  const tenantLabel = user?.tenant?.name ?? "—";
  const tenantStatus = user?.tenant?.status ?? "";
  const platformRole = user?.platformRole ?? "user";
  const links = platformRole === "platform_admin" ? adminLinks : tenantLinks;
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [navCollapsed]);

  const [wideLayout, setWideLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 769px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 769px)");
    const onChange = () => setWideLayout(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const sidebarCollapsed = navCollapsed && wideLayout;

  return (
    <div className="desk-root">
      <header className="desk-header">
        <div className="desk-header-left">
          <BrandLogo variant="header" />
        </div>
        <div className="desk-header-right">
          <span className="muted saas-tenant-pill">
            {tenantLabel}
            {tenantStatus ? ` · ${tenantStatus}` : ""}
          </span>
          <div className="desk-user">
            <span className="desk-user-avatar">{initial}</span>
            <span>
              {user?.name}
              {platformRole === "platform_admin" ? " · 平台管理员" : ""}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-header-ghost"
            onClick={logout}
          >
            退出
          </button>
        </div>
      </header>
      <div className="desk-body">
        <aside
          className={`app-sidebar${sidebarCollapsed ? " app-sidebar--collapsed" : ""}`}
        >
          <div
            className={`app-sidebar-head${sidebarCollapsed ? " app-sidebar-head--collapsed" : ""}`}
          >
            {!sidebarCollapsed ? <div className="app-brand">导航</div> : null}
            <button
              type="button"
              className="app-sidebar-toggle"
              onClick={() => setNavCollapsed((v) => !v)}
              aria-expanded={!sidebarCollapsed}
              aria-label={navCollapsed ? "展开导航" : "收起导航"}
            >
              {sidebarCollapsed ? (
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"
                  />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"
                  />
                </svg>
              )}
            </button>
          </div>
          <nav className="nav-links">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                title={l.label}
                className={({ isActive }) =>
                  `nav-link${isActive ? " active" : ""}`
                }
              >
                <l.Icon />
                <span className="nav-link-label">{l.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="app-main saas-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
