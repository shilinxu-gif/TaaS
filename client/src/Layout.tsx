import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
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
  labelKey: string;
  end?: boolean;
  Icon: ComponentType;
}[] = [
  { to: "/dashboard", labelKey: "layout.tenantLinks.dashboard", end: true, Icon: IcDashboard },
  { to: "/api-keys", labelKey: "layout.tenantLinks.apiKeys", Icon: IcKey },
  { to: "/usage", labelKey: "layout.tenantLinks.usage", Icon: IcChart },
  { to: "/optimization", labelKey: "layout.tenantLinks.optimization", Icon: IcBolt },
  { to: "/routing", labelKey: "layout.tenantLinks.routing", Icon: IcRoute },
  { to: "/ops", labelKey: "layout.tenantLinks.ops", Icon: IcOps },
  { to: "/billing", labelKey: "layout.tenantLinks.billing", Icon: IcReceipt },
  { to: "/recharge", labelKey: "layout.tenantLinks.recharge", Icon: IcWallet },
  { to: "/invoices", labelKey: "layout.tenantLinks.invoices", Icon: IcInvoiceDoc },
];

const adminLinks: {
  to: string;
  labelKey: string;
  end?: boolean;
  Icon: ComponentType;
}[] = [
  { to: "/admin/usage", labelKey: "layout.adminLinks.dashboard", end: true, Icon: IcDashboard },
  { to: "/admin/providers", labelKey: "layout.adminLinks.providers", Icon: IcRoute },
  { to: "/admin/users", labelKey: "layout.adminLinks.users", Icon: IcPeople },
  { to: "/ops", labelKey: "layout.adminLinks.ops", Icon: IcOps },
];

export function Layout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const initial = user?.name?.charAt(0) ?? "?";
  const tenantLabel = user?.tenant?.name ?? t("layout.tenantFallback");
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
          {platformRole !== "platform_admin" ? (
            <>
              <NavLink
                to="/model-hub"
                className={({ isActive }) =>
                  `desk-header-link${isActive ? " desk-header-link--active" : ""}`
                }
              >
                {t("layout.tenantLinks.modelHub")}
              </NavLink>
              <NavLink
                to="/integration-docs"
                className={({ isActive }) =>
                  `desk-header-link${isActive ? " desk-header-link--active" : ""}`
                }
              >
                {t("layout.tenantLinks.integrationDocs")}
              </NavLink>
            </>
          ) : null}
          <LanguageSwitcher compact />
          <span className="muted saas-tenant-pill">
            {tenantLabel}
            {tenantStatus ? ` · ${tenantStatus}` : ""}
          </span>
          <div className="desk-user">
            <span className="desk-user-avatar">{initial}</span>
            <span>
              {user?.name}
              {platformRole === "platform_admin" ? ` · ${t("layout.platformAdmin")}` : ""}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-header-ghost"
            onClick={logout}
          >
            {t("layout.logout")}
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
            {!sidebarCollapsed ? <div className="app-brand">{t("layout.nav")}</div> : null}
            <button
              type="button"
              className="app-sidebar-toggle"
              onClick={() => setNavCollapsed((v) => !v)}
              aria-expanded={!sidebarCollapsed}
              aria-label={navCollapsed ? t("layout.expandNav") : t("layout.collapseNav")}
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
            {links.map((l) => {
              const label = t(l.labelKey);
              return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                title={label}
                className={({ isActive }) =>
                  `nav-link${isActive ? " active" : ""}`
                }
              >
                <l.Icon />
                <span className="nav-link-label">{label}</span>
              </NavLink>
              );
            })}
          </nav>
        </aside>
        <main className="app-main saas-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
