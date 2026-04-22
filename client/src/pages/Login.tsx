import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { IconLock, IconUser } from "../icons";
import { BrandLogo } from "../BrandLogo";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

type LoginRes = {
  token: string;
  user: User;
};

function homePathForRole(platformRole?: string) {
  return platformRole === "platform_admin" ? "/admin/usage" : "/dashboard";
}

export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, refreshMe } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);

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
      navigate(homePathForRole(res.user.platformRole), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.loginFailed"));
    }
  }

  return (
    <div className="login-screen login-screen--split">
      <div className="login-split">
        <div className="login-col login-col--left">
          <div className="login-intro">
            <div className="auth-language-row">
              <LanguageSwitcher compact />
            </div>
            <div className="login-logo-row">
              <BrandLogo variant="auth" />
            </div>
            <div
              className="login-after-logo-placeholder"
              aria-hidden="true"
            />
            <p className="login-tagline-en">
              {t("auth.login.heroLead")}
            </p>
            <p className="login-title-sub">{t("auth.login.heroSub")}</p>
          </div>
        </div>
        <div className="login-col login-col--right">
          <div className="auth-card-white login-auth-card">
            <h2 className="auth-card-heading">{t("auth.login.title")}</h2>
            <form onSubmit={onSubmit}>
              <div className="input-row">
                <span className="input-icon">
                  <IconUser />
                </span>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder={t("auth.login.loginPlaceholder")}
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
                  placeholder={t("auth.login.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <p className="muted">{t("auth.login.trialHint")}</p>
              {error ? <p className="error">{error}</p> : null}
              <button type="submit" className="btn-login-main">
                {t("auth.login.title")}
              </button>
            </form>
            <div className="auth-footer login-auth-footer">
              <Link to="/register">{t("auth.login.createAccount")}</Link>
              <button
                type="button"
                className="link-button muted-link"
                onClick={() => setForgotOpen(true)}
              >
                {t("auth.login.forgotPassword")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {forgotOpen ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-password-title"
        >
          <div className="keys-modal keys-modal--narrow">
            <div className="keys-modal-hd">
              <h2 id="forgot-password-title">{t("auth.login.forgotTitle")}</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setForgotOpen(false)}
              >
                {t("common.close")}
              </button>
            </div>
            <div className="keys-form">
              <p className="muted">
                {t("auth.login.forgotBody1")}
              </p>
              <p className="muted">
                {t("auth.login.forgotBody2")}
              </p>
              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setForgotOpen(false)}
                >
                  {t("auth.login.forgotAcknowledge")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
