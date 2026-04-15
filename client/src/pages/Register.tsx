import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { IconLock, IconUser } from "../icons";
import { BrandLogo } from "../BrandLogo";

type RegisterRes = {
  token: string;
  user: User;
};

export function Register() {
  const navigate = useNavigate();
  const { login, refreshMe } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api<RegisterRes>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      login(res.token, res.user);
      await refreshMe();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    }
  }

  return (
    <div className="login-screen">
      <div className="login-center">
        <div className="login-logo-row">
          <BrandLogo variant="auth" />
        </div>
        <h1 className="login-title-main">创建组织与账户</h1>
        <p className="login-title-sub">
          注册后自动开通 14 天企业试用、默认预算与多供应商路由策略
        </p>

        <div className="auth-card-white">
          <h2 className="auth-card-heading">注册</h2>
          <form onSubmit={onSubmit}>
            <div className="input-row">
              <span className="input-icon">
                <IconUser />
              </span>
              <input
                placeholder="Display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="input-row">
              <span className="input-icon">
                <IconUser />
              </span>
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="input-row">
              <span className="input-icon">
                <IconLock />
              </span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" className="btn-login-main">
              创建账户
            </button>
          </form>
          <div className="auth-footer" style={{ justifyContent: "center" }}>
            <Link to="/login">Already have an account? Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
