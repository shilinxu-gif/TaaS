import { BillingRechargeSection } from "../components/BillingRechargeSection";
import { useTranslation } from "react-i18next";
import { pickText } from "../i18n/inline";

export function Recharge() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) =>
    pickText(i18n.resolvedLanguage, zhCN, enUS);
  return (
    <div className="fin-page">
      <header className="fin-hero">
        <div>
          <h1 className="fin-title">{text("在线充值", "Recharge")}</h1>
          <p className="fin-subtitle muted">
            {text("与「计费中心」共用同一套余额与订单；当前展示生产占位版充值流程。", "Shares the same balance and orders with Billing; currently shows the production-placeholder recharge flow.")}
          </p>
        </div>
      </header>
      <BillingRechargeSection variant="page" />
    </div>
  );
}
