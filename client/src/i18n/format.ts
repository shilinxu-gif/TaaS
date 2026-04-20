import { i18n } from "../i18n";
import { defaultLanguage, normalizeLanguage, type SupportedLanguage } from "./locale";

function pickLanguage(language?: string | null): SupportedLanguage {
  return normalizeLanguage(language ?? i18n.resolvedLanguage ?? defaultLanguage);
}

export function formatNumber(
  value: number,
  language?: string | null,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(pickLanguage(language), options);
}

export function formatDateTime(
  value: string | Date | null | undefined,
  language?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) {
    return "—";
  }
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(pickLanguage(language), options);
}

export function formatCurrencyAmount(
  value: string | number,
  language?: string | null,
  options?: Intl.NumberFormatOptions,
): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }
  return formatNumber(numeric, language, options);
}
