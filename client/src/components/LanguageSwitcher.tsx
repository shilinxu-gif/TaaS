import { useTranslation } from "react-i18next";
import { supportedLanguages, type SupportedLanguage } from "../i18n/locale";

type LanguageSwitcherProps = {
  className?: string;
  compact?: boolean;
};

export function LanguageSwitcher({
  className = "",
  compact = false,
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "zh-CN") as SupportedLanguage;

  return (
    <div
      className={`language-switcher${compact ? " language-switcher--compact" : ""}${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={t("common.language")}
    >
      {supportedLanguages.map((language) => {
        const active = current === language;
        return (
          <button
            key={language}
            type="button"
            className={`language-switcher__button${active ? " language-switcher__button--active" : ""}`}
            onClick={() => void i18n.changeLanguage(language)}
          >
            {language === "zh-CN" ? t("common.chinese") : t("common.english")}
          </button>
        );
      })}
    </div>
  );
}
