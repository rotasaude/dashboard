// Módulo 32b (D17): faltas da UPA (medicação dada sem saldo), do farmacêutico e do almoxarife; só o interruptor `pharmacy`,
// sem exigir `urgency_care` nem `urgency_stock_deduction`. Portão por ora; a lista e a conciliação vêm na Task 9.
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { EmptyState } from "../components/EmptyState";

export function PharmacyUrgencyShortfalls() {
  return (
    <PharmacyGate title="Faltas da UPA" sub="medicação dada na UPA sem saldo no estoque" allow={(r) => r.pharmacist || r.keeper}>
      {() => <EmptyState title="Faltas da UPA" />}
    </PharmacyGate>
  );
}
