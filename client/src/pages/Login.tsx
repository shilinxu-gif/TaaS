import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { IconLock, IconUser } from "../icons";
import { BrandLogo } from "../BrandLogo";

type LoginRes = {
  token: string;
  user: User;
};

export function Login() {
  const navigate = useNavigate();
  const { login, refreshMe } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api<LoginRes>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login: loginName.trim(), password }),
      });
      login(res.token, res.user);
      await refreshMe();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  }

  return (
    <div className="login-screen login-screen--split">
      <div className="login-split">
        <div className="login-col login-col--left">
          <div className="login-intro">
            <div className="login-logo-row">
              <BrandLogo variant="auth" />
            </div>
            <div
              className="login-after-logo-placeholder"
              aria-hidden="true"
            />
            <p className="login-tagline-en">
              AI is changing the world…
            </p>
            <p className="login-title-sub">多模型路由 · 企业计费 · 可审计 AI 网关</p>
          </div>
        </div>
        <div className="login-col login-col--right">
          <div className="auth-card-white login-auth-card">
            <h2 className="auth-card-heading">登录</h2>
            <form onSubmit={onSubmit}>
              <div className="input-row">
                <span className="input-icon">
                  <IconUser />
                </span>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Username or email"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  required
                />
              </div>
              <div className="input-row">
                <span className="input-icon">
                  <IconLock />
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <p className="muted">企业试用默认 14 天，注册后自动创建租户、预算与路由策略。</p>
              {error ? <p className="error">{error}</p> : null}
              <button type="submit" className="btn-login-main">
                登录
              </button>
            </form>
            <div className="auth-footer login-auth-footer">
              <Link to="/register">Create account</Link>
              <span className="muted-link">Forgot password?</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
