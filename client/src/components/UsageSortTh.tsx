export type UsageSortDir = "asc" | "desc";

/** 用量/账单等表格表头：无边框 + 固定 ↑↓，与 `styles.css` 中 `.admin-usage-sort-*` 配套 */
export function UsageSortTh<F extends string>({
  field,
  label,
  sort,
  onToggle,
}: {
  field: F;
  label: string;
  sort: { field: F; dir: UsageSortDir };
  onToggle: (field: F) => void;
}) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      className="admin-usage-sort-control"
      onClick={() => onToggle(field)}
    >
      <span className="admin-usage-sort-label">{label}</span>
      <span className="admin-usage-sort-arrows" aria-hidden>
        <span
          className={
            active && sort.dir === "asc"
              ? "admin-usage-sort-arrow admin-usage-sort-arrow--active"
              : "admin-usage-sort-arrow"
          }
        >
          ↑
        </span>
        <span
          className={
            active && sort.dir === "desc"
              ? "admin-usage-sort-arrow admin-usage-sort-arrow--active"
              : "admin-usage-sort-arrow"
          }
        >
          ↓
        </span>
      </span>
    </button>
  );
}
