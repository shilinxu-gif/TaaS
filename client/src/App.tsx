import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./Layout";
import { ApiKeys } from "./pages/ApiKeys";
import { Billing } from "./pages/Billing";
import { Dashboard } from "./pages/Dashboard";
import { Invoices } from "./pages/Invoices";
import { Recharge } from "./pages/Recharge";
import { Login } from "./pages/Login";
import { Optimization } from "./pages/Optimization";
import { Register } from "./pages/Register";
import { Routing } from "./pages/Routing";
import { Usage } from "./pages/Usage";

function Protected({ children }: { children: ReactNode }) {
  const { token, user, loading } = useAuth();
  if (loading) {
    return (
      <div className="app-loading">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
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
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="usage" element={<Usage />} />
        <Route path="optimization" element={<Optimization />} />
        <Route path="routing" element={<Routing />} />
        <Route path="billing" element={<Billing />} />
        <Route path="recharge" element={<Recharge />} />
        <Route path="invoices" element={<Invoices />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
