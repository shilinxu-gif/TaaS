import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { IconLock, IconShield, IconUser } from "../icons";
import { BrandLogo } from "../BrandLogo";

type LoginRes = {
  token: string;
  user: User;
};

function randomCaptcha(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function Login() {
  const navigate = useNavigate();
  const { login, refreshMe } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [captchaCode, setCaptchaCode] = useState(randomCaptcha);
  const [captchaInput, setCaptchaInput] = useState("");
  const [error, setError] = useState("");

  const refreshCaptcha = useCallback(() => {
    setCaptchaCode(randomCaptcha());
    setCaptchaInput("");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (captchaInput.trim() !== captchaCode) {
      setError("Captcha does not match");
      refreshCaptcha();
      return;
    }
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
      refreshCaptcha();
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
            <p className="login-title-sub">多模型路由 · 计量与计费演示</p>
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
              <div className="captcha-row">
                <div className="input-row login-captcha-input-wrap">
                  <span className="input-icon">
                    <IconShield />
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Captcha"
                    value={captchaInput}
                    onChange={(e) => setCaptchaInput(e.target.value)}
                    required
                  />
                </div>
                <div className="captcha-box" title="Captcha">
                  {captchaCode}
                </div>
                <button
                  type="button"
                  className="captcha-refresh"
                  onClick={refreshCaptcha}
                  aria-label="Refresh captcha"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                    />
                  </svg>
                </button>
              </div>
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
