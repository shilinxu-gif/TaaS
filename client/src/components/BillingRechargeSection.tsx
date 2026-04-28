import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type RechargeBankAccount,
  type RechargeCreateResponse,
  type RechargeOrderRow,
  type RechargePayChannel,
  type RechargeSummary,
} from "../api";
import { formatCurrencyAmount, formatDateTime, formatNumber } from "../i18n/format";
import { pickText } from "../i18n/inline";
import { copyText } from "../utils/clipboard";

const PAY_CHANNELS: {
  id: RechargePayChannel;
  recommended?: boolean;
  intl?: boolean;
}[] = [
  { id: "bank_transfer", recommended: true },
  { id: "alipay", recommended: true },
  { id: "wechat" },
  { id: "apple_pay", intl: true },
  { id: "google_pay", intl: true },
];

function IconBank() {
  return (
    <svg className="rc-pay-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 10h16v2H4v-2zm2-6h12v2H6V4zm12 14H6v-2h12v2zM2 18h20v2H2v-2z"
      />
    </svg>
  );
}

function IconWeChat() {
  return (
    <svg className="rc-pay-ico rc-pay-ico--wechat" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M8.5 10a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4zm7 0a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4zM12 4C7 4 2.8 7 2.8 10.8c0 2 1.2 3.8 3 5.1L5 20l4.2-1.2c.9.2 1.8.4 2.8.4 5 0 9.2-3 9.2-6.8C21.2 7 17 4 12 4z"
      />
    </svg>
  );
}

function IconAlipay() {
  return (
    <svg className="rc-pay-ico rc-pay-ico--alipay" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 3L4 7v10l8 4 8-4V7l-8-4zm0 2.2l5.7 2.9L12 11 6.3 8.1 12 5.2zM6 9.4l5 2.5v5.1L6 14.5V9.4zm12 5.1l-5 2.7v-5.1l5-2.5v5z"
      />
    </svg>
  );
}

function IconApple() {
  return (
    <svg className="rc-pay-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M16.1 12.7c0-2.5 2.1-3.7 2.2-3.8-.6-.9-1.5-1.4-2.4-1.4-1 0-1.8.6-2.3.6-.5 0-1.4-.6-2.3-.6-1.2 0-2.3.7-2.9 1.8-1.2 2.1-.3 5.3.9 7 .6 1 1.3 2.1 2.2 2.1.9 0 1.2-.6 2.2-.6 1.1 0 1.4.6 2.2.6.9 0 1.5-.8 2.1-1.7.7-.9 1-1.9 1-1.9-.1 0-2-.8-2-3zm-1.9-6.2c.5-.6.9-1.6.8-2.5-.8 0-1.7.5-2.2 1.1-.5.5-.9 1.5-.8 2.4.9.1 1.8-.5 2.2-1z"
      />
    </svg>
  );
}

function IconGoogle() {
  return (
    <svg className="rc-pay-ico" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 11.2v2.7h4.6c-.2 1.2-1.4 3.4-4.6 3.4-2.8 0-5-2.3-5-5.1s2.2-5.1 5-5.1c1.6 0 2.7.7 3.3 1.3l2.3-2.2C16.4 4.6 14.4 3.5 12 3.5 6.9 3.5 3 7.4 3 12.2s3.9 8.7 9 8.7c5.2 0 8.6-3.6 8.6-8.8 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}

function PayIcon({ id }: { id: RechargePayChannel }) {
  switch (id) {
    case "bank_transfer":
      return <IconBank />;
    case "wechat":
      return <IconWeChat />;
    case "alipay":
      return <IconAlipay />;
    case "apple_pay":
      return <IconApple />;
    case "google_pay":
      return <IconGoogle />;
    default:
      return null;
  }
}

function rechargeStatusBadgeClass(status: string): string {
  if (status === "success") return "rc-badge rc-badge--ok";
  if (
    status === "pending_payment" ||
    status === "pending_review" ||
    status === "pending" ||
    status === "processing"
  ) {
    return "rc-badge rc-badge--warn";
  }
  if (status === "failed") return "rc-badge rc-badge--err";
  if (status === "cancelled") return "rc-badge rc-badge--muted";
  return "rc-badge rc-badge--muted";
}

function formatMoneyRow(row: RechargeOrderRow): string {
  if (row.amountDisplay?.trim()) {
    return row.amountDisplay;
  }
  return row.currency === "USD" ? `$${row.amount}` : `¥${row.amount}`;
}

type FollowUp =
  | {
      kind: "bank";
      row: RechargeOrderRow;
      bank: RechargeBankAccount;
    }
  | null;

export function BillingRechargeSection({
  variant = "billing",
}: {
  variant?: "billing" | "page";
}) {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const payChannelLabel = (channel: RechargePayChannel | string, fallback?: string) =>
    channel === "bank_transfer"
      ? text("对公打款", "Bank transfer")
      : channel === "alipay"
        ? text("支付宝", "Alipay")
        : channel === "wechat"
          ? text("微信支付", "WeChat Pay")
          : channel === "apple_pay"
            ? "Apple Pay"
            : channel === "google_pay"
              ? "Google Pay"
              : fallback ?? channel;
  const statusLabel = (status: string, fallback: string) =>
    status === "success"
      ? text("已到账", "Credited")
      : status === "pending_review"
        ? text("待审核", "Pending review")
        : status === "pending_payment"
          ? text("待支付", "Pending payment")
          : status === "pending" || status === "processing"
            ? text("处理中", "Processing")
            : status === "cancelled"
              ? text("已取消", "Cancelled")
              : status === "failed"
                ? text("失败", "Failed")
                : fallback;
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [amount, setAmount] = useState("5000");
  const [currency, setCurrency] = useState<"CNY" | "USD">("CNY");
  const [payChannel, setPayChannel] = useState<RechargePayChannel>("bank_transfer");
  const [payerName, setPayerName] = useState("");
  const [remark, setRemark] = useState("");
  const [needInvoice, setNeedInvoice] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const summaryQ = useQuery({
    queryKey: ["finance", "recharges", "summary"],
    queryFn: () => api<RechargeSummary>("/finance/recharges/summary"),
  });

  const listQ = useQuery({
    queryKey: ["finance", "recharges"],
    queryFn: () => api<RechargeOrderRow[]>("/finance/recharges"),
  });

  const invalidateAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["finance", "recharges"] });
    void qc.invalidateQueries({ queryKey: ["finance", "recharges", "summary"] });
    void qc.invalidateQueries({ queryKey: ["billing", "overview"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  const createM = useMutation({
    mutationFn: () =>
      api<RechargeCreateResponse>("/finance/recharges", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(amount),
          currency,
          payChannel,
          payerName: payerName.trim(),
          remark: remark.trim() || undefined,
          needInvoice,
        }),
      }),
    onSuccess: (res) => {
      invalidateAll();
      setDrawerOpen(false);
      if (res.flow === "bank" && res.bankAccount) {
        setFollowUp({ kind: "bank", row: res, bank: res.bankAccount });
        showToast(res.hint ?? text("对公充值申请已创建，请按指引打款", "The bank-transfer recharge request has been created. Please complete the transfer as instructed."));
      } else {
        setFollowUp(null);
        showToast(res.hint ?? text("充值申请已提交", "Recharge request submitted."));
      }
    },
  });

  const rows = listQ.data ?? [];
  const summary = summaryQ.data;

  const openDrawer = () => {
    setDrawerOpen(true);
    setCopied(false);
  };

  if (summaryQ.isLoading || listQ.isLoading) {
    return (
      <section className={variant === "page" ? "rc-wrap rc-wrap--page" : "rc-wrap"}>
        <p className="muted">{text("在线充值加载中…", "Loading recharge…")}</p>
      </section>
    );
  }
  if (summaryQ.error) {
    return (
      <section className={variant === "page" ? "rc-wrap rc-wrap--page" : "rc-wrap"}>
        <p className="error">{(summaryQ.error as Error).message}</p>
      </section>
    );
  }
  if (listQ.error) {
    return (
      <section className={variant === "page" ? "rc-wrap rc-wrap--page" : "rc-wrap"}>
        <p className="error">{(listQ.error as Error).message}</p>
      </section>
    );
  }

  const s = summary!;

  return (
    <section
      className={variant === "page" ? "rc-wrap rc-wrap--page" : "rc-wrap"}
      aria-label={variant === "page" ? text("在线充值与记录", "Recharge and Records") : undefined}
      aria-labelledby={variant === "billing" ? "rc-heading" : undefined}
    >
      {toast ? (
        <div className="rc-toast" role="status">
          {toast}
        </div>
      ) : null}

      {variant === "billing" ? (
        <>
          <div className="rc-head">
            <div>
              <h2 id="rc-heading" className="rc-title">
                {text("在线充值", "Online Recharge")}
              </h2>
              <p className="rc-sub muted">
                {text(
                  "购买余额与套餐的入口；当前页面按生产占位流程记录申请与到账状态",
                  "Entry point for purchasing balance and plans. The current production-placeholder flow records requests and crediting status.",
                )}
              </p>
            </div>
          </div>
          <p className="rc-note muted">{s.note}</p>
        </>
      ) : (
        <p className="rc-note muted">{s.note}</p>
      )}

      <div className="rc-cards-grid">
        <article className="rc-card rc-card--balance">
          <div className="rc-card-label">{text("当前余额（tokens）", "Current Balance (tokens)")}</div>
          <div className="rc-card-value tabular-nums">
            {formatNumber(Number(s.balanceTokens), i18n.resolvedLanguage)}
          </div>
          <div className="rc-card-meta muted">
            {text(`与计费中心同一口径 · 待处理订单 ${s.pendingCount} 笔`, `Same metric as billing · ${s.pendingCount} orders pending`)}
          </div>
          <div className="rc-card-meta muted">
            {text("本月成功充值（折合 CNY）¥", "Successful recharge this month (CNY equiv.) ¥")}
            {formatCurrencyAmount(s.monthRechargeCny, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <p className="rc-card-hint muted">{s.monthRechargeNote}</p>
        </article>

        <article className="rc-card rc-card--entry">
          <div className="rc-card-label">{text("充值入口", "Recharge Entry")}</div>
          <p className="rc-entry-desc muted">
            {text(
              "推荐优先使用对公打款；其他支付方式保留为接入占位，提交后生成待处理申请",
              "Bank transfer is recommended first. Other payment methods are reserved as integration placeholders and create pending requests after submission.",
            )}
          </p>
          <div className="rc-pay-grid" role="list">
            {PAY_CHANNELS.map((ch) => {
              const active = payChannel === ch.id;
              const rec = s.recommendedChannels.includes(ch.id) || ch.recommended;
              return (
                <button
                  key={ch.id}
                  type="button"
                  role="listitem"
                  className={
                    "rc-pay-tile" +
                    (active ? " rc-pay-tile--active" : "") +
                    (rec ? " rc-pay-tile--rec" : "")
                  }
                  onClick={() => setPayChannel(ch.id)}
                >
                  <PayIcon id={ch.id} />
                  <span className="rc-pay-tile-label">{payChannelLabel(ch.id)}</span>
                  {ch.intl ? (
                    <span className="rc-intl-pill">{text("国际支付", "International")}</span>
                  ) : null}
                  {rec ? <span className="rc-rec-pill">{text("推荐", "Recommended")}</span> : null}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn btn-primary rc-cta" onClick={openDrawer}>
            {text("发起充值", "Start recharge")}
          </button>
        </article>
      </div>

      {followUp?.kind === "bank" ? (
        <div className="rc-follow rc-follow--bank">
          <div className="rc-follow-hd">
            <strong>{text("对公打款", "Bank transfer")}</strong>
            <span className="muted">{text(`单号 ${followUp.row.orderNo}`, `Order ${followUp.row.orderNo}`)}</span>
          </div>
          <p className="muted rc-follow-tip">
            {text("请向以下账户转账 ", "Transfer ")}
            <strong>{formatMoneyRow(followUp.row)}</strong>
            {text("，附言请填写订单号；打款后预计 ", " to the following account and include the order number in the memo. Funds are expected to be credited within ")}
            <strong>{text("1 个工作日内", "1 business day")}</strong>
            {text("到账，当前为「待审核」状态", ". Current status: pending review.")}
          </p>
          <dl className="rc-bank-dl">
            <div>
              <dt>{text("公司名称", "Company Name")}</dt>
              <dd>{followUp.bank.companyName}</dd>
            </div>
            <div>
              <dt>{text("开户行", "Bank Name")}</dt>
              <dd>{followUp.bank.bankName}</dd>
            </div>
            <div>
              <dt>{text("银行账号", "Bank Account")}</dt>
              <dd className="rc-mono">{followUp.bank.accountNo}</dd>
            </div>
            <div>
              <dt>{text("户名", "Account Name")}</dt>
              <dd>{followUp.bank.accountName}</dd>
            </div>
          </dl>
          <div className="rc-follow-actions">
            <button
              type="button"
              className="btn fin-row-btn"
              onClick={() => {
                const b = followUp.bank;
                const txt = [
                  text(`户名：${b.accountName}`, `Account name: ${b.accountName}`),
                  text(`开户行：${b.bankName}`, `Bank: ${b.bankName}`),
                  text(`账号：${b.accountNo}`, `Account no.: ${b.accountNo}`),
                  text(`公司：${b.companyName}`, `Company: ${b.companyName}`),
                ].join("\n");
                void copyText(txt).then((ok) => {
                  if (ok) {
                    setCopied(true);
                    showToast(text("账户信息已复制", "Account information copied"));
                    return;
                  }
                  showToast(text("复制失败，请手动复制", "Copy failed. Please copy manually."));
                });
              }}
            >
              {copied ? text("已复制", "Copied") : text("复制账户信息", "Copy account information")}
            </button>
            <button
              type="button"
              className="btn btn-header-ghost"
              onClick={() => setFollowUp(null)}
            >
              {text("收起", "Collapse")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rc-table-block">
        <h3 className="rc-table-title">{text("充值记录", "Recharge Records")}</h3>
        <p className="muted rc-table-desc">
          {text(`共 ${rows.length} 条（最近 100 条）`, `${rows.length} records (latest 100)`)}
        </p>
        <div className="rc-table-wrap">
          <table className="rc-table">
            <thead>
              <tr>
                <th>{text("充值单号", "Order No.")}</th>
                <th>{text("租户名称", "Tenant Name")}</th>
                <th>{text("充值金额", "Amount")}</th>
                <th>{text("币种", "Currency")}</th>
                <th>{text("支付方式", "Payment Method")}</th>
                <th>{text("状态", "Status")}</th>
                <th>{text("创建时间", "Created At")}</th>
                <th>{text("到账时间", "Credited At")}</th>
                <th className="rc-col-actions">{text("说明", "Notes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="rc-table-empty muted">
                    {text("暂无充值记录", "No recharge records")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="rc-mono">{r.orderNo}</td>
                    <td>{r.tenantName}</td>
                    <td className="tabular-nums">{r.amountDisplay}</td>
                    <td>{r.currency}</td>
                    <td>{payChannelLabel(r.payChannel, r.payChannelLabel)}</td>
                    <td>
                      <span className={rechargeStatusBadgeClass(r.status)}>
                        {statusLabel(r.status, r.statusLabel)}
                      </span>
                    </td>
                    <td className="rc-td-time">
                      {formatDateTime(r.createdAt, i18n.resolvedLanguage)}
                    </td>
                    <td className="rc-td-time">
                      {r.paidAt
                        ? formatDateTime(r.paidAt, i18n.resolvedLanguage)
                        : "—"}
                    </td>
                    <td className="rc-col-actions">
                      {r.status === "pending_review" ? (
                        <span className="muted">{text("等待财务确认到账", "Waiting for finance to confirm crediting")}</span>
                      ) : r.status === "pending_payment" ||
                        r.status === "pending" ||
                        r.status === "processing" ? (
                        <span className="muted">{text("等待真实支付通道回调或人工处理", "Waiting for payment callback or manual processing")}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rc-instructions">
        <h3 className="rc-instructions-title">{text("支付方式说明", "Payment Method Notes")}</h3>
        <ul className="rc-instructions-list muted">
          <li>
            <strong className="rc-instructions-strong">{text("对公打款", "Bank transfer")}</strong>
            {text(
              "：适合合同框架内付款；请按页面户名、开户行、账号打款，并备注订单号或合同编号",
              ": Suitable for payments under a contract. Transfer to the displayed account name, bank, and account number, and include the order or contract number in the memo.",
            )}
          </li>
          <li>
            <strong className="rc-instructions-strong">{text("微信支付 / 支付宝", "WeChat Pay / Alipay")}</strong>
            {text(
              "：支付通道保留接入位，当前提交后会生成待支付申请，由后续真实支付回调或人工复核完成到账",
              ": Payment channels are reserved integration slots. Submitting now creates a pending payment request that will be credited after a real payment callback or manual review.",
            )}
          </li>
          <li>
            <strong className="rc-instructions-strong">Apple Pay / Google Pay</strong>
            {text(
              "：适用于国际卡与海外主体；当前仅保留订单受理能力，待后续接入真实支付通道",
              ": Suitable for international cards and overseas entities. Currently only order intake is kept until real payment channels are integrated.",
            )}
          </li>
          <li>
            {text(
              "发票：勾选「需要发票」后，可在「自动化开票」模块补充抬头与邮寄信息",
              "Invoice: after checking “Need invoice”, complete the title and delivery information in the invoicing module.",
            )}
          </li>
        </ul>
      </div>

      {drawerOpen ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rc-drawer-title"
        >
          <div className="keys-modal keys-modal--wide">
            <div className="keys-modal-hd">
              <h2 id="rc-drawer-title">{text("发起充值", "Start Recharge")}</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setDrawerOpen(false)}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <div className="keys-field">
                <span className="keys-label">{text("支付方式", "Payment Method")}</span>
                <div className="rc-drawer-chips">
                  {PAY_CHANNELS.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      className={
                        "rc-chip" + (payChannel === ch.id ? " rc-chip--on" : "")
                      }
                      onClick={() => setPayChannel(ch.id)}
                    >
                      {payChannelLabel(ch.id)}
                      {ch.intl ? text(" · 国际", " · International") : ""}
                    </button>
                  ))}
                </div>
              </div>
              <div className="keys-field-row">
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="rc-amt">
                    {text("充值金额", "Recharge Amount")}
                  </label>
                  <input
                    id="rc-amt"
                    className="input-plain"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="rc-cur">
                    {text("币种", "Currency")}
                  </label>
                  <select
                    id="rc-cur"
                    className="input-plain"
                    value={currency}
                    onChange={(e) =>
                      setCurrency(e.target.value as "CNY" | "USD")
                    }
                  >
                    <option value="CNY">CNY</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="rc-payer">
                  {text("付款主体名称", "Payer Name")}
                </label>
                <input
                  id="rc-payer"
                  className="input-plain"
                  placeholder={text("与付款账户一致的企业或个人名称", "Company or individual name matching the payer account")}
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="rc-rmk">
                  {text("备注", "Remark")}
                </label>
                <textarea
                  id="rc-rmk"
                  className="input-plain keys-textarea"
                  rows={2}
                  maxLength={500}
                  placeholder={text("选填：合同号、成本中心等", "Optional: contract number, cost center, etc.")}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                />
              </div>
              <div className="keys-field rc-switch-field">
                <label className="keys-label" htmlFor="rc-inv">
                  {text("是否需要发票", "Need Invoice")}
                </label>
                <button
                  id="rc-inv"
                  type="button"
                  role="switch"
                  aria-checked={needInvoice}
                  className={"rc-switch" + (needInvoice ? " rc-switch--on" : "")}
                  onClick={() => setNeedInvoice((v) => !v)}
                >
                  <span className="rc-switch-knob" />
                </button>
              </div>
              {(payChannel === "apple_pay" || payChannel === "google_pay") ? (
                <p className="muted-sm">
                  {text(
                    "当前渠道仍在接入中提交后会先登记充值申请，不会自动加款",
                    "This channel is still being integrated. Submission records a recharge request first and will not automatically add balance.",
                  )}
                </p>
              ) : null}
              {createM.error ? (
                <p className="error keys-form-error">
                  {(createM.error as Error).message}
                </p>
              ) : null}
              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-header-ghost"
                  onClick={() => setDrawerOpen(false)}
                >
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createM.isPending}
                  onClick={() => createM.mutate()}
                >
                  {text("提交", "Submit")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
