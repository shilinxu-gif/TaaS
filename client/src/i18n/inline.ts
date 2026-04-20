import { normalizeLanguage } from "./locale";

export function pickText(
  language: string | undefined,
  zhCN: string,
  enUS: string,
): string {
  return normalizeLanguage(language) === "en-US" ? enUS : zhCN;
}
