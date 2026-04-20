import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  api,
  type RechargeBankAccount,
  type RechargeCreateResponse,
  type RechargeOrderRow,
  type RechargePayChannel,
  type RechargeSummary,
} from "../api";

const PAY_CHANNELS: {
  id: RechargePayChannel;
  label: string;
  recommended?: boolean;
  intl?: boolean;
}[] = [
  { id: "bank_transfer", label: "对公打款", recommended: true },
  { id: "alipay", label: "支付宝", recommended: true },
  { id: "wechat", label: "微信支付" },
  { id: "apple_pay", label: "Apple Pay", intl: true },
  { id: "google_pay", label: "Google Pay", intl: true },
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
        showToast(res.hint ?? "对公充值申请已创建，请按指引打款。");
      } else {
        setFollowUp(null);
        showToast(res.hint ?? "充值申请已提交。");
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
        <p className="muted">在线充值加载中…</p>
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
      aria-label={variant === "page" ? "在线充值与记录" : undefined}
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
                在线充值
              </h2>
              <p className="rc-sub muted">
                购买余额与套餐的入口；当前页面按生产占位流程记录申请与到账状态。
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
          <div className="rc-card-label">当前余额（tokens）</div>
          <div className="rc-card-value tabular-nums">
            {Number(s.balanceTokens).toLocaleString("zh-CN")}
          </div>
          <div className="rc-card-meta muted">
            与计费中心同一口径 · 待处理订单 {s.pendingCount} 笔
          </div>
          <div className="rc-card-meta muted">
            本月成功充值（折合 CNY）¥
            {Number(s.monthRechargeCny).toLocaleString("zh-CN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <p className="rc-card-hint muted">{s.monthRechargeNote}</p>
        </article>

        <article className="rc-card rc-card--entry">
          <div className="rc-card-label">充值入口</div>
          <p className="rc-entry-desc muted">
            推荐优先使用对公打款；其他支付方式保留为接入占位，提交后生成待处理申请。
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
                  <span className="rc-pay-tile-label">{ch.label}</span>
                  {ch.intl ? (
                    <span className="rc-intl-pill">国际支付</span>
                  ) : null}
                  {rec ? <span className="rc-rec-pill">推荐</span> : null}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn btn-primary rc-cta" onClick={openDrawer}>
            发起充值
          </button>
        </article>
      </div>

      {followUp?.kind === "bank" ? (
        <div className="rc-follow rc-follow--bank">
          <div className="rc-follow-hd">
            <strong>对公打款</strong>
            <span className="muted">单号 {followUp.row.orderNo}</span>
          </div>
          <p className="muted rc-follow-tip">
            请向以下账户转账 <strong>{formatMoneyRow(followUp.row)}</strong>，附言请填写订单号；
            打款后预计 <strong>1 个工作日内</strong>到账，当前为「待审核」状态。
          </p>
          <dl className="rc-bank-dl">
            <div>
              <dt>公司名称</dt>
              <dd>{followUp.bank.companyName}</dd>
            </div>
            <div>
              <dt>开户行</dt>
              <dd>{followUp.bank.bankName}</dd>
            </div>
            <div>
              <dt>银行账号</dt>
              <dd className="rc-mono">{followUp.bank.accountNo}</dd>
            </div>
            <div>
              <dt>户名</dt>
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
                  `户名：${b.accountName}`,
                  `开户行：${b.bankName}`,
                  `账号：${b.accountNo}`,
                  `公司：${b.companyName}`,
                ].join("\n");
                copyText(txt, () => {
                  setCopied(true);
                  showToast("账户信息已复制");
                });
              }}
            >
              {copied ? "已复制" : "复制账户信息"}
            </button>
            <button
              type="button"
              className="btn btn-header-ghost"
              onClick={() => setFollowUp(null)}
            >
              收起
            </button>
          </div>
        </div>
      ) : null}

      <div className="rc-table-block">
        <h3 className="rc-table-title">充值记录</h3>
        <p className="muted rc-table-desc">共 {rows.length} 条（最近 100 条）</p>
        <div className="rc-table-wrap">
          <table className="rc-table">
            <thead>
              <tr>
                <th>充值单号</th>
                <th>租户名称</th>
                <th>充值金额</th>
                <th>币种</th>
                <th>支付方式</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>到账时间</th>
                <th className="rc-col-actions">说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="rc-table-empty muted">
                    暂无充值记录
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="rc-mono">{r.orderNo}</td>
                    <td>{r.tenantName}</td>
                    <td className="tabular-nums">{r.amountDisplay}</td>
                    <td>{r.currency}</td>
                    <td>{r.payChannelLabel}</td>
                    <td>
                      <span className={rechargeStatusBadgeClass(r.status)}>
                        {r.statusLabel}
                      </span>
                    </td>
                    <td className="rc-td-time">
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="rc-td-time">
                      {r.paidAt
                        ? new Date(r.paidAt).toLocaleString("zh-CN")
                        : "—"}
                    </td>
                    <td className="rc-col-actions">
                      {r.status === "pending_review" ? (
                        <span className="muted">等待财务确认到账</span>
                      ) : r.status === "pending_payment" ||
                        r.status === "pending" ||
                        r.status === "processing" ? (
                        <span className="muted">等待真实支付通道回调或人工处理</span>
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
        <h3 className="rc-instructions-title">支付方式说明</h3>
        <ul className="rc-instructions-list muted">
          <li>
            <strong className="rc-instructions-strong">对公打款</strong>
            ：适合合同框架内付款；请按页面户名、开户行、账号打款，并备注订单号或合同编号。
          </li>
          <li>
            <strong className="rc-instructions-strong">微信支付 / 支付宝</strong>
            ：支付通道保留接入位，当前提交后会生成待支付申请，由后续真实支付回调或人工复核完成到账。
          </li>
          <li>
            <strong className="rc-instructions-strong">Apple Pay / Google Pay</strong>
            ：适用于国际卡与海外主体；当前仅保留订单受理能力，待后续接入真实支付通道。
          </li>
          <li>发票：勾选「需要发票」后，可在「自动化开票」模块补充抬头与邮寄信息。</li>
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
              <h2 id="rc-drawer-title">发起充值</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setDrawerOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="keys-form">
              <div className="keys-field">
                <span className="keys-label">支付方式</span>
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
                      {ch.label}
                      {ch.intl ? " · 国际" : ""}
                    </button>
                  ))}
                </div>
              </div>
              <div className="keys-field-row">
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="rc-amt">
                    充值金额
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
                    币种
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
                  付款主体名称
                </label>
                <input
                  id="rc-payer"
                  className="input-plain"
                  placeholder="与付款账户一致的企业或个人名称"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="rc-rmk">
                  备注
                </label>
                <textarea
                  id="rc-rmk"
                  className="input-plain keys-textarea"
                  rows={2}
                  maxLength={500}
                  placeholder="选填：合同号、成本中心等"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                />
              </div>
              <div className="keys-field rc-switch-field">
                <label className="keys-label" htmlFor="rc-inv">
                  是否需要发票
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
                  当前渠道仍在接入中。提交后会先登记充值申请，不会自动加款。
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
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createM.isPending}
                  onClick={() => createM.mutate()}
                >
                  提交
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function copyText(text: string, onDone: () => void): void {
  void navigator.clipboard.writeText(text).then(onDone);
}
