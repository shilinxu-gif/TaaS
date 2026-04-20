import { useQuery } from "@tanstack/react-query";
import { BillingRechargeSection } from "../components/BillingRechargeSection";
import { api, type BillingOverview, type BillingPlanDto } from "../api";

function formatUsd(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function PlanCard({
  plan,
  current,
}: {
  plan: BillingPlanDto;
  current: boolean;
}) {
  return (
    <div
      className={`bill-plan-card${current ? " bill-plan-card--current" : ""}`}
    >
      {current ? (
        <span className="bill-plan-ribbon">当前套餐</span>
      ) : null}
      <div className="bill-plan-name">{plan.name}</div>
      <div className="bill-plan-code muted">{plan.code}</div>
      <div className="bill-plan-price">
        <span className="bill-plan-price-val">
          ${formatUsd(plan.pricePerMillionTokens)}
        </span>
        <span className="bill-plan-price-unit muted">/ 百万 tokens</span>
      </div>
      <div className="bill-plan-quota muted">
        月配额{" "}
        <strong>{plan.monthlyTokenQuota.toLocaleString("zh-CN")}</strong>{" "}
        tokens
      </div>
      {plan.description ? (
        <p className="bill-plan-desc muted">{plan.description}</p>
      ) : null}
    </div>
  );
}

export function Billing() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => api<BillingOverview>("/billing/overview"),
  });

  if (isLoading) return <p className="muted bill-page-pad">加载中…</p>;
  if (error) return <p className="error bill-page-pad">{(error as Error).message}</p>;

  const d = data!;
  const { summary } = d;

  return (
    <div className="bill-page">
      <header className="bill-hero">
        <div className="bill-hero-text">
          <h1 className="bill-title">计费中心</h1>
          <p className="bill-subtitle">
            用量结算 · 套餐与余额 · 缓存带来的可核算节省
          </p>
        </div>
      </header>

      <section className="bill-summary" aria-label="费用概览">
        <article className="bill-kpi bill-kpi--spend">
          <div className="bill-kpi-label">累计实付（USD）</div>
          <div className="bill-kpi-value">
            ${formatUsd(summary.totalSpendUsd)}
          </div>
          <div className="bill-kpi-hint muted">用量类型账单合计</div>
        </article>
        <article className="bill-kpi bill-kpi--bal">
          <div className="bill-kpi-label">账户余额（tokens）</div>
          <div className="bill-kpi-value bill-kpi-value--bal">
            {Number(summary.remainingBalanceTokens).toLocaleString("zh-CN")}
          </div>
          <div className="bill-kpi-hint muted">可用于抵扣用量</div>
        </article>
        <article className="bill-kpi bill-kpi--usage">
          <div className="bill-kpi-label">本月用量（tokens）</div>
          <div className="bill-kpi-value">
            {summary.currentMonthUsageTokens.toLocaleString("zh-CN")}
          </div>
          <div className="bill-kpi-hint muted">自然月内请求汇总</div>
        </article>
        <article className="bill-kpi bill-kpi--save">
          <div className="bill-kpi-label">本月估算节省（USD）</div>
          <div className="bill-kpi-value bill-kpi-value--save">
            ${formatUsd(summary.estimatedSavingUsd)}
          </div>
          <div className="bill-kpi-hint muted">缓存命中按单价折算</div>
        </article>
      </section>

      <section className="bill-section">
        <h2 className="bill-section-title">商业账户</h2>
        <p className="bill-section-desc muted">
          状态：{summary.tenantStatus ?? "unknown"}
          {summary.trialDaysRemaining != null ? ` · 试用剩余 ${summary.trialDaysRemaining} 天` : ""}
          {summary.contractCode ? ` · 合同 ${summary.contractCode}` : ""}
        </p>
        <p className="bill-section-desc muted">
          账单邮箱：{summary.billingEmail ?? "未设置"}
          {summary.monthlyBudgetUsd ? ` · 月预算 $${formatUsd(summary.monthlyBudgetUsd)}` : ""}
        </p>
      </section>

      <BillingRechargeSection variant="billing" />

      <section className="bill-section">
        <h2 className="bill-section-title">当前套餐</h2>
        {d.currentPlan ? (
          <div className="bill-current-wrap">
            <PlanCard plan={d.currentPlan} current />
          </div>
        ) : (
          <p className="muted bill-empty-hint">未关联套餐，请联系商务配置。</p>
        )}
      </section>

      <section className="bill-section">
        <h2 className="bill-section-title">可选套餐</h2>
        <p className="bill-section-desc muted">
          以下为平台标准报价。升级可联系销售或在控制台提交工单。
        </p>
        <div className="bill-plans-grid">
          {d.plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              current={d.currentPlan?.id === p.id}
            />
          ))}
        </div>
      </section>

      <section className="bill-section bill-section--table">
        <h2 className="bill-section-title">账单明细</h2>
        <p className="bill-section-desc muted">
          共 {d.records.length} 条记录（最多展示最近 100 条）
        </p>
        <div className="bill-table-wrap">
          <table className="bill-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>金额（{summary.currency}）</th>
                <th>状态</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {d.records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="bill-table-empty muted">
                    暂无账单记录
                  </td>
                </tr>
              ) : (
                d.records.map((r) => (
                  <tr key={r.id}>
                    <td className="bill-td-date">
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td>
                      <span
                        className={`bill-type-pill bill-type-pill--${r.type === "cache_hit" ? "cache" : "usage"}`}
                      >
                        {r.typeLabel}
                      </span>
                    </td>
                    <td className="tabular-nums bill-td-amt">
                      {formatUsd(r.amountUsd)}
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
            首条记录快照：输入单价 ${formatUsd(d.records[0].inputUnitPriceUsd)} / 百万，
            输出单价 ${formatUsd(d.records[0].outputUnitPriceUsd)} / 百万，
            对账 {d.records[0].reconciliationStatus}，
            开票 {d.records[0].invoiceStatus}
          </p>
        ) : null}
      </section>
    </div>
  );
}
