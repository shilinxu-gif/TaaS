/** 品牌图形标识（public/brand-logo.png） */
export function BrandLogo({
  variant = "header",
}: {
  variant?: "header" | "auth";
}) {
  return (
    <img
      src="/brand-logo.png"
      alt="算力无限"
      className={`brand-logo-img brand-logo-img--${variant}`}
      decoding="async"
    />
  );
}
