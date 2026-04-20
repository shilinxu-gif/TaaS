export const LANGUAGE_STORAGE_KEY = "taas-language";

export const supportedLanguages = ["zh-CN", "en-US"] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

export const defaultLanguage: SupportedLanguage = "zh-CN";

export function normalizeLanguage(value?: string | null): SupportedLanguage {
  const lower = value?.toLowerCase() ?? "";
  if (lower.startsWith("en")) {
    return "en-US";
  }
  return "zh-CN";
}

export function detectInitialLanguage(): SupportedLanguage {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved) {
      return normalizeLanguage(saved);
    }
    return normalizeLanguage(window.navigator.language);
  }
  return defaultLanguage;
}
