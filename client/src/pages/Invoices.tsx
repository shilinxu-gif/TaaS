import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type InvoiceRequestDetail,
  type InvoiceRequestRow,
  type InvoiceSummary,
} from "../api";
import { formatCurrencyAmount, formatDateTime } from "../i18n/format";
import { pickText } from "../i18n/inline";

function invoiceStatusBadgeClass(status: string): string {
  if (status === "issued") return "fin-badge fin-badge--ok";
  if (status === "submitted") return "fin-badge fin-badge--warn";
  if (status === "processing") return "fin-badge fin-badge--info";
  if (status === "rejected") return "fin-badge fin-badge--err";
  if (status === "void") return "fin-badge fin-badge--muted";
  return "fin-badge fin-badge--muted";
}

export function Invoices() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) => pickText(i18n.resolvedLanguage, zhCN, enUS);
  const invoiceStatusLabel = (status: string, fallback: string) =>
    status === "issued"
      ? text("已开票", "Issued")
      : status === "submitted"
        ? text("已提交", "Submitted")
        : status === "processing"
          ? text("开票中", "Processing")
          : status === "rejected"
            ? text("已驳回", "Rejected")
            : status === "void"
              ? text("已作废", "Voided")
              : fallback;
  const invoiceTypeLabel = (type: string, fallback: string) =>
    type === "vat_special"
      ? text("增值税专用发票", "Special VAT invoice")
      : type === "vat_normal"
        ? text("增值税普通发票", "Standard VAT invoice")
        : type === "e_normal"
          ? text("增值税电子普通发票", "Electronic standard VAT invoice")
          : fallback;
  const titleTypeLabel = (type: string, fallback: string) =>
    type === "enterprise"
      ? text("企业", "Enterprise")
      : type === "personal"
        ? text("个人", "Personal")
        : fallback;
  const qc = useQueryClient();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    titleType: "enterprise" as "enterprise" | "personal",
    invoiceType: "vat_special" as "vat_special" | "vat_normal" | "e_normal",
    buyerName: "",
    buyerTaxNo: "",
    buyerAddressPhone: "",
    buyerBankAccount: "",
    amountCny: "8000",
    email: "",
  });

  const summaryQ = useQuery({
    queryKey: ["finance", "invoices", "summary"],
    queryFn: () => api<InvoiceSummary>("/finance/invoices/summary"),
  });

  const listQ = useQuery({
    queryKey: ["finance", "invoices"],
    queryFn: () => api<InvoiceRequestRow[]>("/finance/invoices"),
  });

  const detailQ = useQuery({
    queryKey: ["finance", "invoices", drawerId],
    queryFn: () => api<InvoiceRequestDetail>(`/finance/invoices/${drawerId}`),
    enabled: Boolean(drawerId),
  });

  const createM = useMutation({
    mutationFn: () =>
      api<InvoiceRequestRow>("/finance/invoices", {
        method: "POST",
        body: JSON.stringify({
          titleType: form.titleType,
          invoiceType: form.invoiceType,
          buyerName: form.buyerName.trim(),
          buyerTaxNo: form.buyerTaxNo.trim(),
          buyerAddressPhone: form.buyerAddressPhone.trim() || undefined,
          buyerBankAccount: form.buyerBankAccount.trim() || undefined,
          amountCny: Number(form.amountCny),
          email: form.email.trim(),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "invoices"] });
      qc.invalidateQueries({ queryKey: ["finance", "invoices", "summary"] });
      setModalOpen(false);
    },
  });

  if (summaryQ.isLoading || listQ.isLoading) {
    return <p className="muted fin-page-pad">{text("加载中…", "Loading…")}</p>;
  }
  if (summaryQ.error) {
    return (
      <p className="error fin-page-pad">{(summaryQ.error as Error).message}</p>
    );
  }
  if (listQ.error) {
    return <p className="error fin-page-pad">{(listQ.error as Error).message}</p>;
  }

  const s = summaryQ.data!;
  const rows = listQ.data!;
  const detail = detailQ.data;

  return (
    <div className="fin-page">
      <header className="fin-hero">
        <div>
          <h1 className="fin-title">{text("自动化开票", "Invoicing")}</h1>
          <p className="fin-subtitle muted">
            {text(
              "开票申请、税号与抬头管理、状态跟踪；当前按生产占位流程保留申请与回填能力",
              "Invoice requests, tax ID and title management, and status tracking. The current production-placeholder flow keeps request and backfill capabilities.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          {text("新建开票申请", "New invoice request")}
        </button>
      </header>

      <p className="fin-note muted">{s.note}</p>

      <section className="fin-kpi-row" aria-label={text("开票概览", "Invoice Overview")}>
        <article className="fin-kpi">
          <div className="fin-kpi-label">{text("待办结申请", "Pending Requests")}</div>
          <div className="fin-kpi-value tabular-nums">{s.pendingCount}</div>
          <div className="fin-kpi-hint muted">{text("已提交 + 开票中", "Submitted + processing")}</div>
        </article>
        <article className="fin-kpi">
          <div className="fin-kpi-label">{text("本月已开票（张）", "Issued This Month")}</div>
          <div className="fin-kpi-value tabular-nums">{s.issuedThisMonth}</div>
          <div className="fin-kpi-hint muted">
            {text("状态为「已开票」且开票日期在本月", "Status is issued and the invoice date is in this month")}
          </div>
        </article>
        <article className="fin-kpi">
          <div className="fin-kpi-label">{text("本月开票金额（CNY）", "Issued Amount This Month (CNY)")}</div>
          <div className="fin-kpi-value tabular-nums">
            ¥{formatCurrencyAmount(s.issuedAmountMonthCny, i18n.resolvedLanguage, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="fin-kpi-hint muted">{text("已开票蓝字金额合计", "Total issued positive invoice amount")}</div>
        </article>
      </section>

      <section className="fin-section">
        <h2 className="fin-section-title">{text("开票申请列表", "Invoice Request List")}</h2>
        <p className="fin-section-desc muted">
          {text(
            `共 ${rows.length} 条点击行查看详情；状态将由真实开票系统或后台流程推进`,
            `${rows.length} records. Click a row to view details. Status will be advanced by the real invoicing system or back-office workflow.`,
          )}
        </p>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>{text("申请单号", "Request No.")}</th>
                <th>{text("申请时间", "Requested At")}</th>
                <th>{text("发票类型", "Invoice Type")}</th>
                <th>{text("购方名称", "Buyer Name")}</th>
                <th>{text("金额（CNY）", "Amount (CNY)")}</th>
                <th className="fin-col-status">{text("状态", "Status")}</th>
                <th>{text("发票号码", "Invoice No.")}</th>
                <th className="fin-col-actions">{text("说明", "Notes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="fin-table-empty muted">
                    {text("暂无开票申请", "No invoice requests")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="fin-row-click"
                    onClick={() => setDrawerId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDrawerId(r.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="fin-mono">{r.requestNo}</td>
                    <td className="fin-td-time">
                      {formatDateTime(r.createdAt, i18n.resolvedLanguage)}
                    </td>
                    <td>{invoiceTypeLabel(r.invoiceType, r.invoiceTypeLabel)}</td>
                    <td className="fin-td-ellip">{r.buyerName}</td>
                    <td className="tabular-nums">¥{formatCurrencyAmount(r.amountCny, i18n.resolvedLanguage, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}</td>
                    <td className="fin-col-status">
                      <span className={invoiceStatusBadgeClass(r.status)}>
                        {invoiceStatusLabel(r.status, r.statusLabel)}
                      </span>
                    </td>
                    <td className="fin-mono fin-td-sub">
                      {r.invoiceNo ?? "—"}
                    </td>
                    <td className="fin-col-actions" onClick={(e) => e.stopPropagation()}>
                      {r.status === "submitted" || r.status === "processing" ? (
                        <span className="muted">{text("等待开票系统处理", "Waiting for the invoicing system")}</span>
                      ) : (
                        <span className="muted fin-dash">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {drawerId ? (
        <>
          <button
            type="button"
            className="usage-drawer-backdrop"
            aria-label={text("关闭详情", "Close details")}
            onClick={() => setDrawerId(null)}
          />
          <aside className="usage-drawer fin-drawer">
            <div className="usage-drawer-hd">
              <h2>{text("开票申请详情", "Invoice Request Details")}</h2>
              <button
                type="button"
                className="btn btn-ghost usage-drawer-close"
                onClick={() => setDrawerId(null)}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="usage-drawer-body">
              {detailQ.isLoading ? (
                <p className="muted">{text("加载详情…", "Loading details…")}</p>
              ) : detailQ.error ? (
                <p className="error">{(detailQ.error as Error).message}</p>
              ) : detail ? (
                <>
                  <dl className="usage-dl fin-dl">
                    <dt>{text("申请单号", "Request No.")}</dt>
                    <dd className="fin-mono">{detail.requestNo}</dd>
                    <dt>{text("状态", "Status")}</dt>
                    <dd>
                      <span className={invoiceStatusBadgeClass(detail.status)}>
                        {invoiceStatusLabel(detail.status, detail.statusLabel)}
                      </span>
                    </dd>
                    <dt>{text("抬头类型", "Title Type")}</dt>
                    <dd>{titleTypeLabel(detail.titleType, detail.titleTypeLabel)}</dd>
                    <dt>{text("发票类型", "Invoice Type")}</dt>
                    <dd>{invoiceTypeLabel(detail.invoiceType, detail.invoiceTypeLabel)}</dd>
                    <dt>{text("购方名称", "Buyer Name")}</dt>
                    <dd>{detail.buyerName}</dd>
                    <dt>{text("纳税人识别号", "Tax ID")}</dt>
                    <dd className="fin-mono">{detail.buyerTaxNo}</dd>
                    <dt>{text("地址、电话", "Address / Phone")}</dt>
                    <dd>{detail.buyerAddressPhone ?? "—"}</dd>
                    <dt>{text("开户行及账号", "Bank and Account")}</dt>
                    <dd>{detail.buyerBankAccount ?? "—"}</dd>
                    <dt>{text("价税合计（CNY）", "Tax-Included Amount (CNY)")}</dt>
                    <dd className="tabular-nums">
                      ¥{formatCurrencyAmount(detail.amountCny, i18n.resolvedLanguage, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </dd>
                    <dt>{text("电子票接收邮箱", "E-invoice Email")}</dt>
                    <dd>{detail.email}</dd>
                    <dt>{text("发票代码", "Invoice Code")}</dt>
                    <dd className="fin-mono">{detail.invoiceCode ?? "—"}</dd>
                    <dt>{text("发票号码", "Invoice No.")}</dt>
                    <dd className="fin-mono">{detail.invoiceNo ?? "—"}</dd>
                    <dt>{text("开票时间", "Issued At")}</dt>
                    <dd>
                      {detail.issuedAt
                        ? formatDateTime(detail.issuedAt, i18n.resolvedLanguage)
                        : "—"}
                    </dd>
                    <dt>{text("驳回/作废原因", "Reject / Void Reason")}</dt>
                    <dd>{detail.rejectReason ?? "—"}</dd>
                    <dt>PDF</dt>
                    <dd>
                      {detail.pdfUrl ? (
                        <a href={detail.pdfUrl}>{text("下载", "Download")}</a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </dl>
                </>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}

      {modalOpen ? (
        <div
          className="keys-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inv-modal-title"
        >
          <div className="keys-modal keys-modal--wide">
            <div className="keys-modal-hd">
              <h2 id="inv-modal-title">{text("新建开票申请", "New Invoice Request")}</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setModalOpen(false)}
              >
                {text("关闭", "Close")}
              </button>
            </div>
            <div className="keys-form">
              <div className="keys-field-row">
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="inv-tt">
                    {text("抬头类型", "Title Type")}
                  </label>
                  <select
                    id="inv-tt"
                    className="input-plain"
                    value={form.titleType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        titleType: e.target.value as "enterprise" | "personal",
                      }))
                    }
                  >
                    <option value="enterprise">{text("企业", "Enterprise")}</option>
                    <option value="personal">{text("个人", "Personal")}</option>
                  </select>
                </div>
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="inv-it">
                    {text("发票类型", "Invoice Type")}
                  </label>
                  <select
                    id="inv-it"
                    className="input-plain"
                    value={form.invoiceType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        invoiceType: e.target.value as
                          | "vat_special"
                          | "vat_normal"
                          | "e_normal",
                      }))
                    }
                  >
                    <option value="vat_special">{text("增值税专用发票", "Special VAT invoice")}</option>
                    <option value="vat_normal">{text("增值税普通发票", "Standard VAT invoice")}</option>
                    <option value="e_normal">{text("增值税电子普通发票", "Electronic standard VAT invoice")}</option>
                  </select>
                </div>
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-bn">
                  {text("购方名称（发票抬头）", "Buyer Name (Invoice Title)")}
                </label>
                <input
                  id="inv-bn"
                  className="input-plain"
                  value={form.buyerName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerName: e.target.value }))
                  }
                  placeholder={text("与营业执照或身份证一致", "Match the business license or ID card")}
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-tax">
                  {text("纳税人识别号 / 证件号", "Tax ID / ID Number")}
                </label>
                <input
                  id="inv-tax"
                  className="input-plain"
                  value={form.buyerTaxNo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerTaxNo: e.target.value }))
                  }
                  placeholder={text("统一社会信用代码或身份证号", "Unified social credit code or ID number")}
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-addr">
                  {text("注册地址、电话（专票建议填写）", "Registered Address / Phone (recommended for special VAT invoices)")}
                </label>
                <input
                  id="inv-addr"
                  className="input-plain"
                  value={form.buyerAddressPhone}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      buyerAddressPhone: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-bank">
                  {text("开户行及账号（专票建议填写）", "Bank and Account (recommended for special VAT invoices)")}
                </label>
                <input
                  id="inv-bank"
                  className="input-plain"
                  value={form.buyerBankAccount}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      buyerBankAccount: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="keys-field-row">
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="inv-amt">
                    {text("开票金额（CNY）", "Invoice Amount (CNY)")}
                  </label>
                  <input
                    id="inv-amt"
                    className="input-plain"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={form.amountCny}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amountCny: e.target.value }))
                    }
                  />
                </div>
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="inv-mail">
                    {text("电子票邮箱", "E-invoice Email")}
                  </label>
                  <input
                    id="inv-mail"
                    className="input-plain"
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                    placeholder={text("用于接收电子版发票", "Used to receive the electronic invoice")}
                  />
                </div>
              </div>
              {createM.error ? (
                <p className="error keys-form-error">
                  {(createM.error as Error).message}
                </p>
              ) : null}
              <div className="keys-modal-actions">
                <button
                  type="button"
                  className="btn btn-header-ghost"
                  onClick={() => setModalOpen(false)}
                >
                  {text("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createM.isPending}
                  onClick={() => createM.mutate()}
                >
                  {text("提交申请", "Submit request")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
