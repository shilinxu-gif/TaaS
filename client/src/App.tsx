import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./Layout";
import { AdminProviders } from "./pages/AdminProviders";
import { AdminUsage } from "./pages/AdminUsage";
import { AdminUsers } from "./pages/AdminUsers";
import { ApiKeys } from "./pages/ApiKeys";
import { Billing } from "./pages/Billing";
import { Dashboard } from "./pages/Dashboard";
import { IntegrationDocs } from "./pages/IntegrationDocs";
import { Invoices } from "./pages/Invoices";
import { Recharge } from "./pages/Recharge";
import { Login } from "./pages/Login";
import { ModelHub } from "./pages/ModelHub";
import { Optimization } from "./pages/Optimization";
import { Ops } from "./pages/Ops";
import { Register } from "./pages/Register";
import { Routing } from "./pages/Routing";
import { Usage } from "./pages/Usage";

function homePathForRole(platformRole?: string) {
  return platformRole === "platform_admin" ? "/admin/usage" : "/dashboard";
}

function Protected({ children }: { children: ReactNode }) {
  const { token, user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="app-loading">
        <p className="muted">{t("app.protectedLoading")}</p>
      </div>
    );
  }
  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.platformRole !== "platform_admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homePathForRole(user?.platformRole)} replace />;
}

function DashboardEntry() {
  const { user } = useAuth();
  if (user?.platformRole === "platform_admin") {
    return <Navigate to="/admin/usage" replace />;
  }
  return <Dashboard />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<DashboardEntry />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="model-hub" element={<ModelHub />} />
        <Route path="integration-docs" element={<IntegrationDocs />} />
        <Route path="usage" element={<Usage />} />
        <Route path="optimization" element={<Optimization />} />
        <Route path="routing" element={<Routing />} />
        <Route path="ops" element={<Ops />} />
        <Route path="billing" element={<Billing />} />
        <Route path="recharge" element={<Recharge />} />
        <Route path="invoices" element={<Invoices />} />
        <Route
          path="admin/usage"
          element={
            <AdminOnly>
              <AdminUsage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/providers"
          element={
            <AdminOnly>
              <AdminProviders />
            </AdminOnly>
          }
        />
        <Route
          path="admin/users"
          element={
            <AdminOnly>
              <AdminUsers />
            </AdminOnly>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
