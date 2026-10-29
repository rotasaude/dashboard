// PharmacyAdjustments — portão e estado provisório (módulo 27a, Task 3); a Task 8 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyAdjustments(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <PharmacyGate title="Inventário e ajustes" sub="ajustes, perdas e vencimentos, com aprovação" allow={(r) => r.pharmacist || r.keeper}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
