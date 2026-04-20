import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, type User } from "../api";
import { useAuth } from "../auth";
import { IconLock, IconUser } from "../icons";
import { BrandLogo } from "../BrandLogo";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

type RegisterRes = {
  token: string;
  user: User;
};

export function Register() {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t("auth.registerFailed"));
    }
  }

  return (
    <div className="login-screen">
      <div className="login-center">
        <div className="auth-language-row auth-language-row--center">
          <LanguageSwitcher compact />
        </div>
        <div className="login-logo-row">
          <BrandLogo variant="auth" />
        </div>
        <h1 className="login-title-main">{t("auth.register.title")}</h1>
        <p className="login-title-sub">
          {t("auth.register.subtitle")}
        </p>

        <div className="auth-card-white">
          <h2 className="auth-card-heading">{t("auth.register.cardTitle")}</h2>
          <form onSubmit={onSubmit}>
            <div className="input-row">
              <span className="input-icon">
                <IconUser />
              </span>
              <input
                placeholder={t("auth.register.namePlaceholder")}
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
                placeholder={t("auth.register.emailPlaceholder")}
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
                placeholder={t("auth.register.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" className="btn-login-main">
              {t("auth.register.submit")}
            </button>
          </form>
          <div className="auth-footer" style={{ justifyContent: "center" }}>
            <Link to="/login">{t("auth.register.signInLink")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
