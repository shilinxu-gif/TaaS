import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  api,
  type AdminAppKeyUsageRow,
  type AdminModelUsageRow,
  type AdminRechargeOrderRow,
  type AdminRechargeOverviewRow,
  type AdminTrendSeries,
  type AdminUsageDimension,
  type AdminUsageOverview,
  type AdminUsageSummaryRow,
  type AdminUserModelUsageRow,
} from "../api";
import {
  formatCurrencyAmount,
  formatDateTime as formatDateTimeValue,
  formatNumber,
} from "../i18n/format";
import { pickText } from "../i18n/inline";
import { UsageSortTh, type UsageSortDir } from "../components/UsageSortTh";

const DEFAULT_TO = new Date().toISOString().slice(0, 10);
const DEFAULT_FROM = shiftDate(DEFAULT_TO, -13);

const emptyOverview: AdminUsageOverview = {
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  dimension: "tenant",
  summaries: [],
  appKeys: [],
  models: [],
  userModels: [],
  appKeyTrends: [],
  modelTrends: [],
  recharges: [],
  rechargeOrders: [],
};

type UserModelSortField = "lastCalledAt" | "requestCount" | "totalTokens" | "spendUsd";

type SummarySortField =
  | "name"
  | "facetCount"
  | "requestCount"
  | "totalTokens"
  | "rechargeCount"
  | "rechargeSuccessCny"
  | "rechargeTokens"
  | "lastRequestAt"
  | "lastRechargeAt";

type AppKeySortField =
  | "name"
  | "tenantName"
  | "environment"
  | "requestCount"
  | "successCount"
  | "totalTokens"
  | "spendUsd"
  | "lastCalledAt";

type ModelSortField =
  | "model"
  | "providerSlug"
  | "requestCount"
  | "totalTokens"
  | "spendUsd"
  | "avgLatencyMs"
  | "successRate";

type RechargeSortField =
  | "tenantName"
  | "rechargeCount"
  | "successAmountCny"
  | "successTokens"
  | "lastRechargeAt";

type RechargeOrderSortField = "orderNo" | "amount" | "creditedTokens" | "createdAt";

function parseLastCalledAtMs(value: string | null): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function compareNullableNumberDesc(
  left: number | null,
  right: number | null,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function compareNullableNumberAsc(
  left: number | null,
  right: number | null,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function parseTokenMoneyString(value: string | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function compareSummaryRows(
  left: AdminUsageSummaryRow,
  right: AdminUsageSummaryRow,
  field: SummarySortField,
  dir: UsageSortDir,
  dimension: AdminUsageDimension,
): number {
  const sign = dir === "desc" ? -1 : 1;
  let primary = 0;
  switch (field) {
    case "name":
      primary = sign * left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      break;
    case "facetCount": {
      const lv = dimension === "tenant" ? left.memberCount ?? 0 : left.tenantCount ?? 0;
      const rv = dimension === "tenant" ? right.memberCount ?? 0 : right.tenantCount ?? 0;
      primary = sign * (lv - rv);
      break;
    }
    case "requestCount":
      primary = sign * (left.requestCount - right.requestCount);
      break;
    case "totalTokens":
      primary = sign * (left.totalTokens - right.totalTokens);
      break;
    case "rechargeCount":
      primary = sign * (left.rechargeCount - right.rechargeCount);
      break;
    case "rechargeSuccessCny":
      primary =
        sign *
        (parseTokenMoneyString(left.rechargeSuccessCny) -
          parseTokenMoneyString(right.rechargeSuccessCny));
      break;
    case "rechargeTokens":
      primary =
        sign *
        (parseTokenMoneyString(left.rechargeTokens) - parseTokenMoneyString(right.rechargeTokens));
      break;
    case "lastRequestAt": {
      const lm = parseLastCalledAtMs(left.lastRequestAt);
      const rm = parseLastCalledAtMs(right.lastRequestAt);
      primary =
        dir === "desc" ? compareNullableNumberDesc(lm, rm) : compareNullableNumberAsc(lm, rm);
      break;
    }
    case "lastRechargeAt": {
      const lm = parseLastCalledAtMs(left.lastRechargeAt);
      const rm = parseLastCalledAtMs(right.lastRechargeAt);
      primary =
        dir === "desc" ? compareNullableNumberDesc(lm, rm) : compareNullableNumberAsc(lm, rm);
      break;
    }
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return left.id.localeCompare(right.id);
}

function compareAppKeyRows(
  left: AdminAppKeyUsageRow,
  right: AdminAppKeyUsageRow,
  field: AppKeySortField,
  dir: UsageSortDir,
): number {
  const sign = dir === "desc" ? -1 : 1;
  let primary = 0;
  switch (field) {
    case "name":
      primary = sign * left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      break;
    case "tenantName":
      primary = sign * left.tenantName.localeCompare(right.tenantName, undefined, {
        sensitivity: "base",
      });
      break;
    case "environment":
      primary = sign * left.environment.localeCompare(right.environment, undefined, {
        sensitivity: "base",
      });
      break;
    case "requestCount":
      primary = sign * (left.requestCount - right.requestCount);
      break;
    case "successCount":
      primary = sign * (left.successCount - right.successCount);
      break;
    case "totalTokens":
      primary = sign * (left.totalTokens - right.totalTokens);
      break;
    case "spendUsd":
      primary =
        sign * (parseTokenMoneyString(left.spendUsd) - parseTokenMoneyString(right.spendUsd));
      break;
    case "lastCalledAt": {
      const lm = parseLastCalledAtMs(left.lastCalledAt);
      const rm = parseLastCalledAtMs(right.lastCalledAt);
      primary =
        dir === "desc" ? compareNullableNumberDesc(lm, rm) : compareNullableNumberAsc(lm, rm);
      break;
    }
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return left.id.localeCompare(right.id);
}

function compareModelRows(
  left: AdminModelUsageRow,
  right: AdminModelUsageRow,
  field: ModelSortField,
  dir: UsageSortDir,
): number {
  const sign = dir === "desc" ? -1 : 1;
  let primary = 0;
  switch (field) {
    case "model":
      primary = sign * left.model.localeCompare(right.model, undefined, { sensitivity: "base" });
      break;
    case "providerSlug":
      primary = sign * left.providerSlug.localeCompare(right.providerSlug, undefined, {
        sensitivity: "base",
      });
      break;
    case "requestCount":
      primary = sign * (left.requestCount - right.requestCount);
      break;
    case "totalTokens":
      primary = sign * (left.totalTokens - right.totalTokens);
      break;
    case "spendUsd":
      primary =
        sign * (parseTokenMoneyString(left.spendUsd) - parseTokenMoneyString(right.spendUsd));
      break;
    case "avgLatencyMs":
      primary = sign * (left.avgLatencyMs - right.avgLatencyMs);
      break;
    case "successRate":
      primary = sign * (left.successRate - right.successRate);
      break;
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return `${left.model}\0${left.providerSlug}`.localeCompare(
    `${right.model}\0${right.providerSlug}`,
    undefined,
    { sensitivity: "base" },
  );
}

function compareRechargeRows(
  left: AdminRechargeOverviewRow,
  right: AdminRechargeOverviewRow,
  field: RechargeSortField,
  dir: UsageSortDir,
): number {
  const sign = dir === "desc" ? -1 : 1;
  let primary = 0;
  switch (field) {
    case "tenantName":
      primary = sign * left.tenantName.localeCompare(right.tenantName, undefined, {
        sensitivity: "base",
      });
      break;
    case "rechargeCount":
      primary = sign * (left.rechargeCount - right.rechargeCount);
      break;
    case "successAmountCny":
      primary =
        sign *
        (parseTokenMoneyString(left.successAmountCny) -
          parseTokenMoneyString(right.successAmountCny));
      break;
    case "successTokens":
      primary =
        sign *
        (parseTokenMoneyString(left.successTokens) - parseTokenMoneyString(right.successTokens));
      break;
    case "lastRechargeAt": {
      const lm = parseLastCalledAtMs(left.lastRechargeAt);
      const rm = parseLastCalledAtMs(right.lastRechargeAt);
      primary =
        dir === "desc" ? compareNullableNumberDesc(lm, rm) : compareNullableNumberAsc(lm, rm);
      break;
    }
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return left.tenantId.localeCompare(right.tenantId);
}

function compareRechargeOrderRows(
  left: AdminRechargeOrderRow,
  right: AdminRechargeOrderRow,
  field: RechargeOrderSortField,
  dir: UsageSortDir,
): number {
  const sign = dir === "desc" ? -1 : 1;
  let primary = 0;
  switch (field) {
    case "orderNo":
      primary = sign * left.orderNo.localeCompare(right.orderNo, undefined, {
        sensitivity: "base",
      });
      break;
    case "amount":
      primary =
        sign * (parseTokenMoneyString(left.amount) - parseTokenMoneyString(right.amount));
      break;
    case "creditedTokens":
      primary =
        sign *
        (parseTokenMoneyString(left.creditedTokens) -
          parseTokenMoneyString(right.creditedTokens));
      break;
    case "createdAt": {
      const lm = parseLastCalledAtMs(left.createdAt);
      const rm = parseLastCalledAtMs(right.createdAt);
      primary =
        dir === "desc" ? compareNullableNumberDesc(lm, rm) : compareNullableNumberAsc(lm, rm);
      break;
    }
    default:
      primary = 0;
  }
  if (primary !== 0) return primary;
  return left.id.localeCompare(right.id);
}

function sortRechargeOrderRows(
  rows: AdminRechargeOrderRow[],
  sort: { field: RechargeOrderSortField; dir: UsageSortDir },
): AdminRechargeOrderRow[] {
  if (rows.length <= 1) {
    return rows;
  }
  return [...rows].sort((a, b) => compareRechargeOrderRows(a, b, sort.field, sort.dir));
}

function compareUserModelRows(
  left: AdminUserModelUsageRow,
  right: AdminUserModelUsageRow,
  field: UserModelSortField,
  dir: UsageSortDir,
): number {
  const sign = dir === "desc" ? -1 : 1;
  if (field === "requestCount") {
    const byCount = sign * (left.requestCount - right.requestCount);
    if (byCount !== 0) return byCount;
  } else if (field === "totalTokens") {
    const byTokens = sign * (left.totalTokens - right.totalTokens);
    if (byTokens !== 0) return byTokens;
  } else if (field === "spendUsd") {
    const bySpend =
      sign *
      (parseTokenMoneyString(left.spendUsd) - parseTokenMoneyString(right.spendUsd));
    if (bySpend !== 0) return bySpend;
  } else {
    const leftMs = parseLastCalledAtMs(left.lastCalledAt);
    const rightMs = parseLastCalledAtMs(right.lastCalledAt);
    const byTime =
      dir === "desc"
        ? compareNullableNumberDesc(leftMs, rightMs)
        : compareNullableNumberAsc(leftMs, rightMs);
    if (byTime !== 0) return byTime;
  }

  const byUser = left.userName.localeCompare(right.userName, undefined, { sensitivity: "base" });
  if (byUser !== 0) return byUser;

  return left.model.localeCompare(right.model, undefined, { sensitivity: "base" });
}

export function AdminUsage() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const channelLabel = (value: string) =>
    value === "alipay"
      ? text("支付宝", "Alipay")
      : value === "wechat"
        ? text("微信", "WeChat")
        : value === "bank_transfer"
          ? text("对公转账", "Bank transfer")
          : value === "stripe"
            ? text("国际支付", "International payment")
            : value;
  const statusLabel = (value: string) =>
    value === "success"
      ? text("已到账", "Credited")
      : value === "pending_review"
        ? text("待审核", "Pending review")
        : value === "pending_payment"
          ? text("待支付", "Pending payment")
          : value === "pending" || value === "processing"
            ? text("处理中", "Processing")
            : value === "cancelled"
              ? text("已取消", "Cancelled")
              : value === "failed"
                ? text("失败", "Failed")
                : value;
  const platformRoleLabel = (value?: string | null) =>
    value === "platform_admin"
      ? text("平台管理员", "Platform Admin")
      : value === "user"
        ? text("普通用户", "User")
        : value || "—";
  const tenantStatusLabel = (value?: string | null) =>
    !value
      ? "—"
      : value === "active"
        ? text("启用中", "Active")
        : value === "trial"
          ? text("试用中", "Trial")
          : value;
  const [search, setSearch] = useState("");
  const [dimension, setDimension] = useState<AdminUsageDimension>("tenant");
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
  const [summarySort, setSummarySort] = useState<{
    field: SummarySortField;
    dir: UsageSortDir;
  }>({ field: "requestCount", dir: "desc" });
  const [appKeySort, setAppKeySort] = useState<{
    field: AppKeySortField;
    dir: UsageSortDir;
  }>({ field: "requestCount", dir: "desc" });
  const [modelSort, setModelSort] = useState<{
    field: ModelSortField;
    dir: UsageSortDir;
  }>({ field: "requestCount", dir: "desc" });
  const [rechargeSort, setRechargeSort] = useState<{
    field: RechargeSortField;
    dir: UsageSortDir;
  }>({ field: "lastRechargeAt", dir: "desc" });
  const [rechargeOrderSort, setRechargeOrderSort] = useState<{
    field: RechargeOrderSortField;
    dir: UsageSortDir;
  }>({ field: "createdAt", dir: "desc" });
  const [userModelSort, setUserModelSort] = useState<{
    field: UserModelSortField;
    dir: UsageSortDir;
  }>({ field: "lastCalledAt", dir: "desc" });
  const overviewQuery = useQuery({
    queryKey: ["admin", "usage-overview", dimension, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ dimension, from, to });
      return api<AdminUsageOverview>(`/admin/usage-overview?${params.toString()}`);
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = overviewQuery.data;
    if (!data || !q) {
      return data ?? emptyOverview;
    }
    const matchesOrder = (row: AdminRechargeOrderRow) =>
      row.tenantName.toLowerCase().includes(q) ||
      row.orderNo.toLowerCase().includes(q) ||
      (row.payerName ?? "").toLowerCase().includes(q) ||
      (row.remark ?? "").toLowerCase().includes(q);
    const rechargeOrders = data.rechargeOrders.filter(matchesOrder);
    const orderTenantIds = new Set(rechargeOrders.map((row) => row.tenantId));
    return {
      ...data,
      summaries: data.summaries.filter(
        (row) =>
          row.name.toLowerCase().includes(q) ||
          (row.email ?? "").toLowerCase().includes(q) ||
          (row.platformRole ?? "").toLowerCase().includes(q) ||
          (row.tenantSlug ?? "").toLowerCase().includes(q) ||
          (row.tenantStatus ?? "").toLowerCase().includes(q),
      ),
      appKeys: data.appKeys.filter(
        (row) =>
          row.name.toLowerCase().includes(q) ||
          row.tenantName.toLowerCase().includes(q) ||
          row.environment.toLowerCase().includes(q),
      ),
      models: data.models.filter(
        (row) =>
          row.model.toLowerCase().includes(q) ||
          row.providerSlug.toLowerCase().includes(q),
      ),
      userModels: data.userModels.filter(
        (row) =>
          row.userName.toLowerCase().includes(q) ||
          (row.email ?? "").toLowerCase().includes(q) ||
          row.model.toLowerCase().includes(q),
      ),
      appKeyTrends: data.appKeyTrends.filter((row) =>
        row.label.toLowerCase().includes(q),
      ),
      modelTrends: data.modelTrends.filter((row) =>
        row.label.toLowerCase().includes(q),
      ),
      recharges: data.recharges.filter(
        (row) => row.tenantName.toLowerCase().includes(q) || orderTenantIds.has(row.tenantId),
      ),
      rechargeOrders,
    };
  }, [overviewQuery.data, search]);

  useEffect(() => {
    setUserModelSort({ field: "lastCalledAt", dir: "desc" });
    setSummarySort({ field: "requestCount", dir: "desc" });
    setAppKeySort({ field: "requestCount", dir: "desc" });
    setModelSort({ field: "requestCount", dir: "desc" });
    setRechargeSort({ field: "lastRechargeAt", dir: "desc" });
    setRechargeOrderSort({ field: "createdAt", dir: "desc" });
  }, [from, to, dimension, search]);

  useEffect(() => {
    setRechargeOrderSort({ field: "createdAt", dir: "desc" });
  }, [expandedTenantId]);

  const sortedSummaries = useMemo(() => {
    const rows = filtered.summaries;
    if (rows.length === 0) {
      return rows;
    }
    return [...rows].sort((left, right) =>
      compareSummaryRows(left, right, summarySort.field, summarySort.dir, dimension),
    );
  }, [dimension, filtered.summaries, summarySort.dir, summarySort.field]);

  const sortedAppKeys = useMemo(() => {
    const rows = filtered.appKeys;
    if (rows.length === 0) {
      return rows;
    }
    return [...rows].sort((left, right) =>
      compareAppKeyRows(left, right, appKeySort.field, appKeySort.dir),
    );
  }, [appKeySort.dir, appKeySort.field, filtered.appKeys]);

  const sortedModels = useMemo(() => {
    const rows = filtered.models;
    if (rows.length === 0) {
      return rows;
    }
    return [...rows].sort((left, right) =>
      compareModelRows(left, right, modelSort.field, modelSort.dir),
    );
  }, [filtered.models, modelSort.dir, modelSort.field]);

  const sortedRecharges = useMemo(() => {
    const rows = filtered.recharges;
    if (rows.length === 0) {
      return rows;
    }
    return [...rows].sort((left, right) =>
      compareRechargeRows(left, right, rechargeSort.field, rechargeSort.dir),
    );
  }, [filtered.recharges, rechargeSort.dir, rechargeSort.field]);

  const sortedUserModels = useMemo(() => {
    const rows = filtered.userModels;
    if (rows.length === 0) {
      return rows;
    }
    return [...rows].sort((left, right) =>
      compareUserModelRows(left, right, userModelSort.field, userModelSort.dir),
    );
  }, [filtered.userModels, userModelSort.dir, userModelSort.field]);

  const toggleSummarySort = (field: SummarySortField) => {
    setSummarySort((prev) => {
      if (prev.field !== field) {
        return { field, dir: "desc" };
      }
      return { field, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  const toggleAppKeySort = (field: AppKeySortField) => {
    setAppKeySort((prev) => {
      if (prev.field !== field) {
        return { field, dir: "desc" };
      }
      return { field, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  const toggleModelSort = (field: ModelSortField) => {
    setModelSort((prev) => {
      if (prev.field !== field) {
        return { field, dir: "desc" };
      }
      return { field, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  const toggleRechargeSort = (field: RechargeSortField) => {
    setRechargeSort((prev) => {
      if (prev.field !== field) {
        return { field, dir: "desc" };
      }
      return { field, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  const toggleRechargeOrderSort = (field: RechargeOrderSortField) => {
    setRechargeOrderSort((prev) => {
      if (prev.field !== field) {
        return { field, dir: "desc" };
      }
      return { field, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  const toggleUserModelSort = (field: UserModelSortField) => {
    setUserModelSort((prev) => {
      if (prev.field !== field) {
        return { field, dir: "desc" };
      }
      return { field, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  };

  const summaryStats = useMemo(() => {
    return {
      totalRequests: filtered.summaries.reduce((sum, row) => sum + row.requestCount, 0),
      totalTokens: filtered.summaries.reduce((sum, row) => sum + row.totalTokens, 0),
      rechargeCount: filtered.summaries.reduce((sum, row) => sum + row.rechargeCount, 0),
      rechargeAmount: filtered.summaries.reduce(
        (sum, row) => sum + Number.parseFloat(row.rechargeSuccessCny || "0"),
        0,
      ),
    };
  }, [filtered]);

  if (overviewQuery.isLoading) {
    return <p className="muted usage-page-pad">{text("加载中…", "Loading…")}</p>;
  }
  if (overviewQuery.error) {
    return (
      <p className="error usage-page-pad">
        {(overviewQuery.error as Error).message}
      </p>
    );
  }

  return (
    <div className="usage-page">
      <header className="usage-header">
        <div>
          <h1 className="usage-title">{text("调用与充值统计", "Usage & Recharge Analytics")}</h1>
          <p className="usage-subtitle muted">
            {text(
              "支持按时间筛选、用户/租户维度切换，并查看 AppKey / 模型趋势与充值单明细",
              "Filter by time, switch between user and tenant dimensions, and inspect AppKey/model trends plus recharge order details.",
            )}
          </p>
        </div>
      </header>

      <section className="usage-filters">
        <div className="usage-filter-grid admin-usage-filter-grid">
          <div className="usage-filter-block">
            <span className="usage-filter-label">{text("搜索", "Search")}</span>
            <div className="pane-search" style={{ maxWidth: "100%" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" style={{ opacity: 0.45 }}>
                <path
                  fill="currentColor"
                  d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                />
              </svg>
              <input
                placeholder={text("搜索用户 / 租户 / AppKey / 模型 / 订单号", "Search user / tenant / AppKey / model / order no.")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="usage-filter-field">
            <span className="usage-filter-label">{text("统计维度", "Dimension")}</span>
            <div className="admin-usage-toggle">
              <button
                className={`btn ${dimension === "tenant" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDimension("tenant")}
                type="button"
              >
                {text("租户", "Tenant")}
              </button>
              <button
                className={`btn ${dimension === "user" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setDimension("user")}
                type="button"
              >
                {text("用户", "User")}
              </button>
            </div>
          </div>

          <div className="usage-filter-field">
            <span className="usage-filter-label">{text("时间范围", "Date Range")}</span>
            <div className="usage-date-row">
              <input
                className="input-plain usage-input"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="usage-date-sep">{text("至", "to")}</span>
              <input
                className="input-plain usage-input"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="usage-filter-field">
            <span className="usage-filter-label">{text("快捷范围", "Quick Range")}</span>
            <div className="usage-preset-row">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  className="btn btn-ghost usage-chip"
                  onClick={() => {
                    setTo(DEFAULT_TO);
                    setFrom(shiftDate(DEFAULT_TO, -(days - 1)));
                  }}
                  type="button"
                >
                  {text(`最近 ${days} 天`, `Last ${days} days`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="usage-filter-meta muted">
          {text(
            `当前区间：${filtered.from} 至 ${filtered.to}，默认按 UTC 自然日统计`,
            `Current range: ${filtered.from} to ${filtered.to}. Statistics use UTC calendar days by default.`,
          )}
        </p>
      </section>

      <section className="bill-summary">
        <article className="bill-kpi bill-kpi--usage">
          <div className="bill-kpi-label">{text("维度实体数", "Dimension Entities")}</div>
          <div className="bill-kpi-value">{filtered.summaries.length}</div>
          <div className="bill-kpi-hint muted">
            {text(
              `当前按${dimension === "tenant" ? "租户" : "用户"}聚合`,
              `Aggregated by ${dimension === "tenant" ? "tenant" : "user"}`,
            )}
          </div>
        </article>
        <article className="bill-kpi bill-kpi--spend">
          <div className="bill-kpi-label">{text("请求总数", "Total Requests")}</div>
          <div className="bill-kpi-value">
            {formatNumber(summaryStats.totalRequests, i18n.resolvedLanguage)}
          </div>
          <div className="bill-kpi-hint muted">
            Token {text("总量", "total")} {formatNumber(summaryStats.totalTokens, i18n.resolvedLanguage)}
          </div>
        </article>
        <article className="bill-kpi bill-kpi--bal">
          <div className="bill-kpi-label">{text("充值订单数", "Recharge Orders")}</div>
          <div className="bill-kpi-value">{summaryStats.rechargeCount}</div>
          <div className="bill-kpi-hint muted">
            {text(`成功金额 ¥${formatMoney(summaryStats.rechargeAmount)}`, `Successful amount ¥${formatMoney(summaryStats.rechargeAmount)}`)}
          </div>
        </article>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">
          {dimension === "tenant" ? text("租户维度统计", "Tenant Dimension") : text("用户维度统计", "User Dimension")}
        </h2>
        <p className="bill-section-desc muted">
          {text(
            "可快速切换运营视角，观察请求量、Token 用量与充值结果",
            "Switch operational perspectives quickly to observe request volume, token usage, and recharge results.",
          )}
        </p>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th
                  {...(summarySort.field === "name"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="name"
                    label={dimension === "tenant" ? text("租户", "Tenant") : text("用户", "User")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th>{dimension === "tenant" ? text("Slug / 状态", "Slug / Status") : text("邮箱 / 平台角色", "Email / Platform Role")}</th>
                <th
                  {...(summarySort.field === "facetCount"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="facetCount"
                    label={dimension === "tenant" ? text("成员数", "Members") : text("关联租户", "Tenants")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "requestCount"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="requestCount"
                    label={text("请求数", "Requests")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "totalTokens"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="totalTokens"
                    label={text("总 Token", "Total Tokens")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "rechargeCount"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="rechargeCount"
                    label={text("充值次数", "Recharge Count")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "rechargeSuccessCny"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="rechargeSuccessCny"
                    label={text("成功金额(CNY)", "Successful Amount (CNY)")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "rechargeTokens"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="rechargeTokens"
                    label={text("到账 Tokens", "Credited Tokens")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "lastRequestAt"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="lastRequestAt"
                    label={text("最近调用", "Last Call")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
                <th
                  {...(summarySort.field === "lastRechargeAt"
                    ? {
                        "aria-sort":
                          summarySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="lastRechargeAt"
                    label={text("最近充值", "Last Recharge")}
                    sort={summarySort}
                    onToggle={toggleSummarySort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSummaries.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={10}>
                    {text("当前筛选条件下暂无数据", "No data for the current filters")}
                  </td>
                </tr>
              ) : (
                sortedSummaries.map((row) => (
                  <tr key={row.id}>
                    <td className="usage-td-strong">{row.name}</td>
                    <td>
                      {dimension === "tenant" ? (
                        <div>
                          <div className="usage-code-sm">{row.tenantSlug || "—"}</div>
                          <span className="admin-usage-subtle">
                            {tenantStatusLabel(row.tenantStatus)}
                          </span>
                        </div>
                      ) : (
                        <div>
                          <div className="usage-code-sm">{row.email || "—"}</div>
                          <span className="admin-usage-subtle">
                            {platformRoleLabel(row.platformRole)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>{dimension === "tenant" ? row.memberCount ?? 0 : row.tenantCount ?? 0}</td>
                    <td>{formatNumber(row.requestCount, i18n.resolvedLanguage)}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.rechargeCount}</td>
                    <td>{row.rechargeSuccessCny}</td>
                    <td>{formatIntegerString(row.rechargeTokens)}</td>
                    <td className="bill-td-date">{formatDateTime(row.lastRequestAt)}</td>
                    <td className="bill-td-date">{formatDateTime(row.lastRechargeAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <TrendChart
        title={text("AppKey 调用趋势", "AppKey Call Trend")}
        description={text(
          "展示当前筛选区间内请求量最高的 AppKey 日趋势",
          "Daily trend for the AppKeys with the highest request volume in the current filter range.",
        )}
        series={filtered.appKeyTrends}
      />

      <TrendChart
        title={text("模型调用趋势", "Model Call Trend")}
        description={text(
          "展示当前筛选区间内调用量最高的模型日趋势",
          "Daily trend for the models with the highest call volume in the current filter range.",
        )}
        series={filtered.modelTrends}
      />

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("AppKey 调用情况", "AppKey Usage")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th
                  {...(appKeySort.field === "name"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="name"
                    label="AppKey"
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "tenantName"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="tenantName"
                    label={text("租户", "Tenant")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "environment"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="environment"
                    label={text("环境", "Environment")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "requestCount"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="requestCount"
                    label={text("请求数", "Requests")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "successCount"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="successCount"
                    label={text("成功数", "Successes")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "totalTokens"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="totalTokens"
                    label={text("总 Token", "Total Tokens")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "spendUsd"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="spendUsd"
                    label={text("费用(USD)", "Spend (USD)")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
                <th
                  {...(appKeySort.field === "lastCalledAt"
                    ? {
                        "aria-sort":
                          appKeySort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="lastCalledAt"
                    label={text("最近调用", "Last Call")}
                    sort={appKeySort}
                    onToggle={toggleAppKeySort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAppKeys.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={8}>
                    {text("当前筛选条件下暂无数据", "No data for the current filters")}
                  </td>
                </tr>
              ) : (
                sortedAppKeys.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.tenantName}</td>
                    <td>{row.environment}</td>
                    <td>{row.requestCount}</td>
                    <td>{row.successCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.spendUsd}</td>
                    <td>{formatDateTime(row.lastCalledAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("模型调用情况", "Model Usage")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th
                  {...(modelSort.field === "model"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="model"
                    label={text("模型", "Model")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
                <th
                  {...(modelSort.field === "providerSlug"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="providerSlug"
                    label={text("供应商", "Provider")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
                <th
                  {...(modelSort.field === "requestCount"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="requestCount"
                    label={text("请求数", "Requests")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
                <th
                  {...(modelSort.field === "totalTokens"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="totalTokens"
                    label={text("总 Token", "Total Tokens")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
                <th
                  {...(modelSort.field === "spendUsd"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="spendUsd"
                    label={text("费用(USD)", "Spend (USD)")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
                <th
                  {...(modelSort.field === "avgLatencyMs"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="avgLatencyMs"
                    label={text("平均延迟", "Avg Latency")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
                <th
                  {...(modelSort.field === "successRate"
                    ? {
                        "aria-sort":
                          modelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="successRate"
                    label={text("成功率", "Success Rate")}
                    sort={modelSort}
                    onToggle={toggleModelSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={7}>
                    {text("当前筛选条件下暂无数据", "No data for the current filters")}
                  </td>
                </tr>
              ) : (
                sortedModels.map((row) => (
                  <tr key={`${row.model}-${row.providerSlug}`}>
                    <td>{row.model}</td>
                    <td>{row.providerSlug}</td>
                    <td>{row.requestCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.spendUsd}</td>
                    <td>{row.avgLatencyMs} ms</td>
                    <td>{row.successRate.toFixed(1)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("用户模型调用情况", "User Model Usage")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{text("用户", "User")}</th>
                <th>{text("邮箱", "Email")}</th>
                <th>{text("模型", "Model")}</th>
                <th
                  {...(userModelSort.field === "requestCount"
                    ? {
                        "aria-sort":
                          userModelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="requestCount"
                    label={text("请求数", "Requests")}
                    sort={userModelSort}
                    onToggle={toggleUserModelSort}
                  />
                </th>
                <th
                  {...(userModelSort.field === "totalTokens"
                    ? {
                        "aria-sort":
                          userModelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="totalTokens"
                    label={text("总 Token", "Total Tokens")}
                    sort={userModelSort}
                    onToggle={toggleUserModelSort}
                  />
                </th>
                <th
                  {...(userModelSort.field === "spendUsd"
                    ? {
                        "aria-sort":
                          userModelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="spendUsd"
                    label={text("费用(USD)", "Spend (USD)")}
                    sort={userModelSort}
                    onToggle={toggleUserModelSort}
                  />
                </th>
                <th
                  {...(userModelSort.field === "lastCalledAt"
                    ? {
                        "aria-sort":
                          userModelSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="lastCalledAt"
                    label={text("最近调用", "Last Call")}
                    sort={userModelSort}
                    onToggle={toggleUserModelSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedUserModels.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={7}>
                    {text("当前筛选条件下暂无用户模型调用数据", "No user model usage data for the current filters")}
                  </td>
                </tr>
              ) : (
                sortedUserModels.map((row) => (
                  <tr key={`${row.userId}-${row.model}`}>
                    <td>{row.userName}</td>
                    <td>{row.email ?? "—"}</td>
                    <td>{row.model}</td>
                    <td>{row.requestCount}</td>
                    <td>{formatNumber(row.totalTokens, i18n.resolvedLanguage)}</td>
                    <td>{row.spendUsd}</td>
                    <td>{formatDateTime(row.lastCalledAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("租户充值情况", "Tenant Recharge")}</h2>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th></th>
                <th
                  {...(rechargeSort.field === "tenantName"
                    ? {
                        "aria-sort":
                          rechargeSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="tenantName"
                    label={text("租户", "Tenant")}
                    sort={rechargeSort}
                    onToggle={toggleRechargeSort}
                  />
                </th>
                <th
                  {...(rechargeSort.field === "rechargeCount"
                    ? {
                        "aria-sort":
                          rechargeSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="rechargeCount"
                    label={text("充值次数", "Recharge Count")}
                    sort={rechargeSort}
                    onToggle={toggleRechargeSort}
                  />
                </th>
                <th
                  {...(rechargeSort.field === "successAmountCny"
                    ? {
                        "aria-sort":
                          rechargeSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="successAmountCny"
                    label={text("成功金额(CNY)", "Successful Amount (CNY)")}
                    sort={rechargeSort}
                    onToggle={toggleRechargeSort}
                  />
                </th>
                <th
                  {...(rechargeSort.field === "successTokens"
                    ? {
                        "aria-sort":
                          rechargeSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="successTokens"
                    label={text("到账 Tokens", "Credited Tokens")}
                    sort={rechargeSort}
                    onToggle={toggleRechargeSort}
                  />
                </th>
                <th
                  {...(rechargeSort.field === "lastRechargeAt"
                    ? {
                        "aria-sort":
                          rechargeSort.dir === "asc"
                            ? ("ascending" as const)
                            : ("descending" as const),
                      }
                    : {})}
                >
                  <UsageSortTh
                    field="lastRechargeAt"
                    label={text("最近充值", "Last Recharge")}
                    sort={rechargeSort}
                    onToggle={toggleRechargeSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRecharges.length === 0 ? (
                <tr>
                  <td className="bill-table-empty" colSpan={6}>
                    {text("当前筛选条件下暂无充值数据", "No recharge data for the current filters")}
                  </td>
                </tr>
              ) : (
                sortedRecharges.map((row) => {
                  const tenantOrders = filtered.rechargeOrders.filter(
                    (order) => order.tenantId === row.tenantId,
                  );
                  const expanded = expandedTenantId === row.tenantId;
                  return (
                    <Fragment key={row.tenantId}>
                      <tr>
                        <td>
                          <button
                            className="btn btn-ghost admin-usage-expand"
                            onClick={() =>
                              setExpandedTenantId(expanded ? null : row.tenantId)
                            }
                            type="button"
                          >
                            {expanded
                              ? text("收起", "Collapse")
                              : text(`展开 ${tenantOrders.length || ""}`.trim(), `Expand ${tenantOrders.length || ""}`.trim())}
                          </button>
                        </td>
                        <td>{row.tenantName}</td>
                        <td>{row.rechargeCount}</td>
                        <td>{row.successAmountCny}</td>
                        <td>{formatIntegerString(row.successTokens)}</td>
                        <td>{formatDateTime(row.lastRechargeAt)}</td>
                      </tr>
                      {expanded ? (
                        <tr className="admin-usage-detail-row">
                          <td colSpan={6}>
                            <div className="admin-usage-detail-wrap">
                              {tenantOrders.length === 0 ? (
                                <p className="muted admin-usage-detail-empty">
                                  {text(
                                    "当前租户在此筛选条件下没有充值单明细",
                                    "This tenant has no recharge order details for the current filters.",
                                  )}
                                </p>
                              ) : (
                                <table className="admin-usage-detail-table">
                                  <thead>
                                    <tr>
                                      <th
                                        {...(rechargeOrderSort.field === "orderNo"
                                          ? {
                                              "aria-sort":
                                                rechargeOrderSort.dir === "asc"
                                                  ? ("ascending" as const)
                                                  : ("descending" as const),
                                            }
                                          : {})}
                                      >
                                        <UsageSortTh
                                          field="orderNo"
                                          label={text("订单号", "Order No.")}
                                          sort={rechargeOrderSort}
                                          onToggle={toggleRechargeOrderSort}
                                        />
                                      </th>
                                      <th
                                        {...(rechargeOrderSort.field === "amount"
                                          ? {
                                              "aria-sort":
                                                rechargeOrderSort.dir === "asc"
                                                  ? ("ascending" as const)
                                                  : ("descending" as const),
                                            }
                                          : {})}
                                      >
                                        <UsageSortTh
                                          field="amount"
                                          label={text("金额", "Amount")}
                                          sort={rechargeOrderSort}
                                          onToggle={toggleRechargeOrderSort}
                                        />
                                      </th>
                                      <th>{text("渠道", "Channel")}</th>
                                      <th>{text("状态", "Status")}</th>
                                      <th
                                        {...(rechargeOrderSort.field === "creditedTokens"
                                          ? {
                                              "aria-sort":
                                                rechargeOrderSort.dir === "asc"
                                                  ? ("ascending" as const)
                                                  : ("descending" as const),
                                            }
                                          : {})}
                                      >
                                        <UsageSortTh
                                          field="creditedTokens"
                                          label={text("到账 Tokens", "Credited Tokens")}
                                          sort={rechargeOrderSort}
                                          onToggle={toggleRechargeOrderSort}
                                        />
                                      </th>
                                      <th>{text("付款人", "Payer")}</th>
                                      <th
                                        {...(rechargeOrderSort.field === "createdAt"
                                          ? {
                                              "aria-sort":
                                                rechargeOrderSort.dir === "asc"
                                                  ? ("ascending" as const)
                                                  : ("descending" as const),
                                            }
                                          : {})}
                                      >
                                        <UsageSortTh
                                          field="createdAt"
                                          label={text("创建时间", "Created At")}
                                          sort={rechargeOrderSort}
                                          onToggle={toggleRechargeOrderSort}
                                        />
                                      </th>
                                      <th>{text("备注", "Remark")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sortRechargeOrderRows(
                                      tenantOrders,
                                      rechargeOrderSort,
                                    ).map((order) => (
                                      <tr key={order.id}>
                                        <td className="usage-code-sm">{order.orderNo}</td>
                                        <td>
                                          {order.currency === "USD" ? "$" : "¥"}
                                          {order.amount}
                                        </td>
                                        <td>{channelLabel(order.payChannel)}</td>
                                        <td>{statusLabel(order.status)}</td>
                                        <td>{formatIntegerString(order.creditedTokens)}</td>
                                        <td>{order.payerName || "—"}</td>
                                        <td className="bill-td-date">
                                          {formatDateTime(order.createdAt)}
                                        </td>
                                        <td className="bill-td-desc">
                                          {[
                                            order.needInvoice ? text("需发票", "Invoice needed") : null,
                                            order.remark,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ") || "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TrendChart({
  title,
  description,
  series,
}: {
  title: string;
  description: string;
  series: AdminTrendSeries[];
}) {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const maxCount = Math.max(
    1,
    ...series.flatMap((item) => item.points.map((point) => point.requestCount)),
  );
  return (
    <section className="bill-section">
      <h2 className="bill-section-title">{title}</h2>
      <p className="bill-section-desc muted">{description}</p>
      <div className="admin-usage-trend-grid">
        {series.length === 0 ? (
          <div className="admin-usage-trend-empty muted">
            {text("当前筛选条件下暂无趋势数据", "No trend data for the current filters")}
          </div>
        ) : (
          series.map((item) => (
            <article className="admin-usage-trend-card" key={item.key}>
              <div className="admin-usage-trend-head">
                <div className="admin-usage-trend-name">{item.label}</div>
                <div className="admin-usage-trend-total">
                  {text(`${formatNumber(item.requestCount, i18n.resolvedLanguage)} 请求`, `${formatNumber(item.requestCount, i18n.resolvedLanguage)} requests`)}
                </div>
              </div>
              <div className="admin-usage-trend-bars">
                {item.points.map((point) => (
                  <div
                    className="admin-usage-trend-bar-col"
                    key={`${item.key}-${point.date}`}
                    title={text(`${point.date} · ${point.requestCount} 请求`, `${point.date} · ${point.requestCount} requests`)}
                  >
                    <span
                      style={{
                        height:
                          point.requestCount === 0
                            ? "0%"
                            : `${Math.max((point.requestCount / maxCount) * 100, 8)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="admin-usage-trend-axis">
                <span>{item.points[0]?.date || "—"}</span>
                <span>{item.points[item.points.length - 1]?.date || "—"}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  return value ? formatDateTimeValue(value) : "—";
}

function formatMoney(value: number) {
  return formatCurrencyAmount(value, undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatIntegerString(value: string) {
  const numeric = Number.parseFloat(value || "0");
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return formatNumber(numeric, undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

