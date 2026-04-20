import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BillingRechargeSection } from "../components/BillingRechargeSection";
import { api, type BillingOverview, type BillingPlanDto } from "../api";
import { formatCurrencyAmount, formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";

function PlanCard({
  plan,
  current,
  language,
}: {
  plan: BillingPlanDto;
  current: boolean;
  language: string | undefined;
}) {
  const text = (zhCN: string, enUS: string) => pickText(language, zhCN, enUS);
  return (
    <div
      className={`bill-plan-card${current ? " bill-plan-card--current" : ""}`}
    >
      {current ? (
        <span className="bill-plan-ribbon">{text("当前套餐", "Current Plan")}</span>
      ) : null}
      <div className="bill-plan-name">{plan.name}</div>
      <div className="bill-plan-code muted">{plan.code}</div>
      <div className="bill-plan-price">
        <span className="bill-plan-price-val">
          ${formatCurrencyAmount(plan.pricePerMillionTokens, language, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}
        </span>
        <span className="bill-plan-price-unit muted">{text("/ 百万 tokens", "/ million tokens")}</span>
      </div>
      <div className="bill-plan-quota muted">
        {text("月配额 ", "Monthly quota ")}
        <strong>{formatNumber(plan.monthlyTokenQuota, language)}</strong>{" "}
        tokens
      </div>
      {plan.description ? (
        <p className="bill-plan-desc muted">{plan.description}</p>
      ) : null}
    </div>
  );
}

export function Billing() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const { data, isLoading, error } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => api<BillingOverview>("/billing/overview"),
  });

  if (isLoading) return <p className="muted bill-page-pad">{text("加载中…", "Loading…")}</p>;
  if (error) return <p className="error bill-page-pad">{(error as Error).message}</p>;

  const d = data!;
  const { summary } = d;

  return (
    <div className="bill-page">
      <header className="bill-hero">
        <div className="bill-hero-text">
          <h1 className="bill-title">{text("计费中心", "Billing")}</h1>
          <p className="bill-subtitle">
            {text("用量结算 · 套餐与余额 · 缓存带来的可核算节省", "Usage settlement · Plans and balance · Auditable savings from cache")}
          </p>
        </div>
      </header>

      <section className="bill-summary" aria-label={text("费用概览", "Billing Overview")}>
        <article className="bill-kpi bill-kpi--spend">
          <div className="bill-kpi-label">{text("累计实付（USD）", "Total Paid (USD)")}</div>
          <div className="bill-kpi-value">
            ${formatCurrencyAmount(summary.totalSpendUsd, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
          </div>
          <div className="bill-kpi-hint muted">{text("用量类型账单合计", "Sum of usage billing records")}</div>
        </article>
        <article className="bill-kpi bill-kpi--bal">
          <div className="bill-kpi-label">{text("账户余额（tokens）", "Account Balance (tokens)")}</div>
          <div className="bill-kpi-value bill-kpi-value--bal">
            {formatNumber(Number(summary.remainingBalanceTokens), i18n.resolvedLanguage)}
          </div>
          <div className="bill-kpi-hint muted">{text("可用于抵扣用量", "Available to offset usage")}</div>
        </article>
        <article className="bill-kpi bill-kpi--usage">
          <div className="bill-kpi-label">{text("本月用量（tokens）", "This Month's Usage (tokens)")}</div>
          <div className="bill-kpi-value">
            {formatNumber(summary.currentMonthUsageTokens, i18n.resolvedLanguage)}
          </div>
          <div className="bill-kpi-hint muted">{text("自然月内请求汇总", "Requests aggregated over the calendar month")}</div>
        </article>
        <article className="bill-kpi bill-kpi--save">
          <div className="bill-kpi-label">{text("本月估算节省（USD）", "Estimated Savings This Month (USD)")}</div>
          <div className="bill-kpi-value bill-kpi-value--save">
            ${formatCurrencyAmount(summary.estimatedSavingUsd, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })}
          </div>
          <div className="bill-kpi-hint muted">{text("缓存命中按单价折算", "Calculated from cache hits and unit pricing")}</div>
        </article>
      </section>

      <section className="bill-section">
        <h2 className="bill-section-title">{text("商业账户", "Commercial Account")}</h2>
        <p className="bill-section-desc muted">
          {text("状态：", "Status: ")}{summary.tenantStatus ?? "unknown"}
          {summary.trialDaysRemaining != null ? text(` · 试用剩余 ${summary.trialDaysRemaining} 天`, ` · ${summary.trialDaysRemaining} trial days left`) : ""}
          {summary.contractCode ? text(` · 合同 ${summary.contractCode}`, ` · Contract ${summary.contractCode}`) : ""}
        </p>
        <p className="bill-section-desc muted">
          {text("账单邮箱：", "Billing email: ")}{summary.billingEmail ?? text("未设置", "Not set")}
          {summary.monthlyBudgetUsd
            ? text(
                ` · 月预算 $${formatCurrencyAmount(summary.monthlyBudgetUsd, i18n.resolvedLanguage, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
                ` · Monthly budget $${formatCurrencyAmount(summary.monthlyBudgetUsd, i18n.resolvedLanguage, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
              )
            : ""}
        </p>
      </section>

      <BillingRechargeSection variant="billing" />

      <section className="bill-section">
        <h2 className="bill-section-title">{text("当前套餐", "Current Plan")}</h2>
        {d.currentPlan ? (
          <div className="bill-current-wrap">
            <PlanCard plan={d.currentPlan} current language={i18n.resolvedLanguage} />
          </div>
        ) : (
          <p className="muted bill-empty-hint">{text("未关联套餐，请联系商务配置。", "No plan is assigned yet. Please contact sales.")}</p>
        )}
      </section>

      <section className="bill-section">
        <h2 className="bill-section-title">{text("可选套餐", "Available Plans")}</h2>
        <p className="bill-section-desc muted">
          {text("以下为平台标准报价。升级可联系销售或在控制台提交工单。", "The options below are the platform's standard pricing. Contact sales or open a ticket in the console to upgrade.")}
        </p>
        <div className="bill-plans-grid">
          {d.plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              current={d.currentPlan?.id === p.id}
              language={i18n.resolvedLanguage}
            />
          ))}
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">{text("账单明细", "Billing Records")}</h2>
        <p className="bill-section-desc muted">
          {text(`共 ${d.records.length} 条记录（最多展示最近 100 条）`, `${d.records.length} records (showing the latest 100 at most)`)}
        </p>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>{text("日期", "Date")}</th>
                <th>{text("类型", "Type")}</th>
                <th>{text(`金额（${summary.currency}）`, `Amount (${summary.currency})`)}</th>
                <th>{text("状态", "Status")}</th>
                <th>{text("说明", "Description")}</th>
              </tr>
            </thead>
            <tbody>
              {d.records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="bill-table-empty muted">
                    {text("暂无账单记录", "No billing records")}
                  </td>
                </tr>
              ) : (
                d.records.map((r) => (
                  <tr key={r.id}>
                    <td className="bill-td-date">
                      {formatDateTime(r.createdAt, i18n.resolvedLanguage)}
                    </td>
                    <td>
                      <span
                        className={`bill-type-pill bill-type-pill--${r.type === "cache_hit" ? "cache" : "usage"}`}
                      >
                        {r.typeLabel}
                      </span>
                    </td>
                    <td className="tabular-nums bill-td-amt">
                      {formatCurrencyAmount(r.amountUsd, i18n.resolvedLanguage, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}
                    </td>
                    <td>
                      <span
                        className={`bill-status bill-status--${r.status === "已减免" ? "waived" : "settled"}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="bill-td-desc">{r.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {d.records.length > 0 ? (
          <p className="bill-section-desc muted">
            {text(
              `首条记录快照：输入单价 $${formatCurrencyAmount(d.records[0].inputUnitPriceUsd, i18n.resolvedLanguage)} / 百万，输出单价 $${formatCurrencyAmount(d.records[0].outputUnitPriceUsd, i18n.resolvedLanguage)} / 百万，对账 ${d.records[0].reconciliationStatus}，开票 ${d.records[0].invoiceStatus}`,
              `Snapshot of the first record: input price $${formatCurrencyAmount(d.records[0].inputUnitPriceUsd, i18n.resolvedLanguage)} / million, output price $${formatCurrencyAmount(d.records[0].outputUnitPriceUsd, i18n.resolvedLanguage)} / million, reconciliation ${d.records[0].reconciliationStatus}, invoicing ${d.records[0].invoiceStatus}`,
            )}
          </p>
        ) : null}
      </section>
    </div>
  );
}
