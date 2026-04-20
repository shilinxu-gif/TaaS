import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./i18n/resources";
import {
  defaultLanguage,
  detectInitialLanguage,
  LANGUAGE_STORAGE_KEY,
  supportedLanguages,
} from "./i18n/locale";

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: defaultLanguage,
  supportedLngs: supportedLanguages,
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (language) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.title = i18n.t("meta.title");
  }
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.resolvedLanguage ?? defaultLanguage;
  document.title = i18n.t("meta.title");
}

export { i18n };
