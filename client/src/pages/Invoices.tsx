import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  api,
  type InvoiceRequestDetail,
  type InvoiceRequestRow,
  type InvoiceSummary,
} from "../api";

function formatCny(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function invoiceStatusBadgeClass(status: string): string {
  if (status === "issued") return "fin-badge fin-badge--ok";
  if (status === "submitted") return "fin-badge fin-badge--warn";
  if (status === "processing") return "fin-badge fin-badge--info";
  if (status === "rejected") return "fin-badge fin-badge--err";
  if (status === "void") return "fin-badge fin-badge--muted";
  return "fin-badge fin-badge--muted";
}

export function Invoices() {
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
    return <p className="muted fin-page-pad">加载中…</p>;
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
          <h1 className="fin-title">自动化开票</h1>
          <p className="fin-subtitle muted">
            开票申请、税号与抬头管理、状态跟踪；当前按生产占位流程保留申请与回填能力
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          新建开票申请
        </button>
      </header>

      <p className="fin-note muted">{s.note}</p>

      <section className="fin-kpi-row" aria-label="开票概览">
        <article className="fin-kpi">
          <div className="fin-kpi-label">待办结申请</div>
          <div className="fin-kpi-value tabular-nums">{s.pendingCount}</div>
          <div className="fin-kpi-hint muted">已提交 + 开票中</div>
        </article>
        <article className="fin-kpi">
          <div className="fin-kpi-label">本月已开票（张）</div>
          <div className="fin-kpi-value tabular-nums">{s.issuedThisMonth}</div>
          <div className="fin-kpi-hint muted">状态为「已开票」且开票日期在本月</div>
        </article>
        <article className="fin-kpi">
          <div className="fin-kpi-label">本月开票金额（CNY）</div>
          <div className="fin-kpi-value tabular-nums">
            ¥{formatCny(s.issuedAmountMonthCny)}
          </div>
          <div className="fin-kpi-hint muted">已开票蓝字金额合计</div>
        </article>
      </section>

      <section className="fin-section">
        <h2 className="fin-section-title">开票申请列表</h2>
        <p className="fin-section-desc muted">
          共 {rows.length} 条。点击行查看详情；状态将由真实开票系统或后台流程推进。
        </p>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>申请单号</th>
                <th>申请时间</th>
                <th>发票类型</th>
                <th>购方名称</th>
                <th>金额（CNY）</th>
                <th className="fin-col-status">状态</th>
                <th>发票号码</th>
                <th className="fin-col-actions">说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="fin-table-empty muted">
                    暂无开票申请
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
                      {new Date(r.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td>{r.invoiceTypeLabel}</td>
                    <td className="fin-td-ellip">{r.buyerName}</td>
                    <td className="tabular-nums">¥{formatCny(r.amountCny)}</td>
                    <td className="fin-col-status">
                      <span className={invoiceStatusBadgeClass(r.status)}>
                        {r.statusLabel}
                      </span>
                    </td>
                    <td className="fin-mono fin-td-sub">
                      {r.invoiceNo ?? "—"}
                    </td>
                    <td className="fin-col-actions" onClick={(e) => e.stopPropagation()}>
                      {r.status === "submitted" || r.status === "processing" ? (
                        <span className="muted">等待开票系统处理</span>
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
            aria-label="关闭详情"
            onClick={() => setDrawerId(null)}
          />
          <aside className="usage-drawer fin-drawer">
            <div className="usage-drawer-hd">
              <h2>开票申请详情</h2>
              <button
                type="button"
                className="btn btn-ghost usage-drawer-close"
                onClick={() => setDrawerId(null)}
              >
                关闭
              </button>
            </div>
            <div className="usage-drawer-body">
              {detailQ.isLoading ? (
                <p className="muted">加载详情…</p>
              ) : detailQ.error ? (
                <p className="error">{(detailQ.error as Error).message}</p>
              ) : detail ? (
                <>
                  <dl className="usage-dl fin-dl">
                    <dt>申请单号</dt>
                    <dd className="fin-mono">{detail.requestNo}</dd>
                    <dt>状态</dt>
                    <dd>
                      <span className={invoiceStatusBadgeClass(detail.status)}>
                        {detail.statusLabel}
                      </span>
                    </dd>
                    <dt>抬头类型</dt>
                    <dd>{detail.titleTypeLabel}</dd>
                    <dt>发票类型</dt>
                    <dd>{detail.invoiceTypeLabel}</dd>
                    <dt>购方名称</dt>
                    <dd>{detail.buyerName}</dd>
                    <dt>纳税人识别号</dt>
                    <dd className="fin-mono">{detail.buyerTaxNo}</dd>
                    <dt>地址、电话</dt>
                    <dd>{detail.buyerAddressPhone ?? "—"}</dd>
                    <dt>开户行及账号</dt>
                    <dd>{detail.buyerBankAccount ?? "—"}</dd>
                    <dt>价税合计（CNY）</dt>
                    <dd className="tabular-nums">
                      ¥{formatCny(detail.amountCny)}
                    </dd>
                    <dt>电子票接收邮箱</dt>
                    <dd>{detail.email}</dd>
                    <dt>发票代码</dt>
                    <dd className="fin-mono">{detail.invoiceCode ?? "—"}</dd>
                    <dt>发票号码</dt>
                    <dd className="fin-mono">{detail.invoiceNo ?? "—"}</dd>
                    <dt>开票时间</dt>
                    <dd>
                      {detail.issuedAt
                        ? new Date(detail.issuedAt).toLocaleString("zh-CN")
                        : "—"}
                    </dd>
                    <dt>驳回/作废原因</dt>
                    <dd>{detail.rejectReason ?? "—"}</dd>
                    <dt>PDF</dt>
                    <dd>
                      {detail.pdfUrl ? (
                        <a href={detail.pdfUrl}>下载</a>
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
              <h2 id="inv-modal-title">新建开票申请</h2>
              <button
                type="button"
                className="btn btn-header-ghost"
                onClick={() => setModalOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="keys-form">
              <div className="keys-field-row">
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="inv-tt">
                   抬头类型
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
                    <option value="enterprise">企业</option>
                    <option value="personal">个人</option>
                  </select>
                </div>
                <div className="keys-field keys-field--half">
                  <label className="keys-label" htmlFor="inv-it">
                    发票类型
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
                    <option value="vat_special">增值税专用发票</option>
                    <option value="vat_normal">增值税普通发票</option>
                    <option value="e_normal">增值税电子普通发票</option>
                  </select>
                </div>
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-bn">
                  购方名称（发票抬头）
                </label>
                <input
                  id="inv-bn"
                  className="input-plain"
                  value={form.buyerName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerName: e.target.value }))
                  }
                  placeholder="与营业执照或身份证一致"
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-tax">
                  纳税人识别号 / 证件号
                </label>
                <input
                  id="inv-tax"
                  className="input-plain"
                  value={form.buyerTaxNo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, buyerTaxNo: e.target.value }))
                  }
                  placeholder="统一社会信用代码或身份证号"
                />
              </div>
              <div className="keys-field">
                <label className="keys-label" htmlFor="inv-addr">
                  注册地址、电话（专票建议填写）
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
                  开户行及账号（专票建议填写）
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
                    开票金额（CNY）
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
                    电子票邮箱
                  </label>
                  <input
                    id="inv-mail"
                    className="input-plain"
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                    placeholder="用于接收电子版发票"
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
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={createM.isPending}
                  onClick={() => createM.mutate()}
                >
                  提交申请
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
