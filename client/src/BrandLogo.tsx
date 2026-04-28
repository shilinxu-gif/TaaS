import { useTranslation } from "react-i18next";
import { pickText } from "./i18n/inline";

export function BrandLogo({
  variant = "header",
}: {
  variant?: "header" | "auth";
}) {
  const { i18n } = useTranslation();
  return (
    <img
      src="/brand-logo.png"
      alt={pickText(i18n.resolvedLanguage, "算力无限", "TaaS")}
      className={`brand-logo-img brand-logo-img--${variant}`}
      decoding="async"
    />
  );
}
