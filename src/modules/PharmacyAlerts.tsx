// PharmacyAlerts — portão e estado provisório (módulo 27a, Task 3); a Task 13 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyAlerts() {
  return (
    <PharmacyGate title="Alertas da farmácia" sub="vencendo, abaixo do mínimo, em trânsito e pendências" allow={(r) => r.pharmacist || r.assistant || r.keeper}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
