const rawJwtSecret = process.env.JWT_SECRET?.trim() ?? "";
const defaultDevSecret = "dev-only-change-me";

export const authConfig = {
  jwtSecret: rawJwtSecret || defaultDevSecret,
  hasExplicitJwtSecret: rawJwtSecret.length > 0,
  isWeakJwtSecret: !rawJwtSecret || rawJwtSecret === defaultDevSecret,
};

const providerSecret =
  process.env.PROVIDER_CONFIG_SECRET?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  "dev-provider-config-secret";

const appKeyPepper =
  process.env.APP_KEY_PEPPER?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  "dev-app-key-pepper";

export const commercialConfig = {
  providerSecret,
  appKeyPepper,
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || "support@taas.example",
  salesEmail: process.env.SALES_EMAIL?.trim() || "sales@taas.example",
  trialDays: Number(process.env.TRIAL_DAYS ?? 14),
  allowMockProvider:
    process.env.ALLOW_MOCK_PROVIDER === "1" ||
    process.env.NODE_ENV !== "production",
};

export function isProductionLike(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "staging"
  );
}
