import { BillingRechargeSection } from "../components/BillingRechargeSection";

export function Recharge() {
  return (
    <div className="fin-page">
      <header className="fin-hero">
        <div>
          <h1 className="fin-title">在线充值</h1>
          <p className="fin-subtitle muted">
            与「计费中心」同一套余额与订单；以下为完整充值与演示流程。
          </p>
        </div>
      </header>
      <BillingRechargeSection variant="page" />
    </div>
  );
}
