// PharmacyStock — portão e estado provisório (módulo 27a, Task 3); a Task 6 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyStock() {
  return (
    <PharmacyGate title="Posição e extrato" sub="saldo por local e lote, extrato e estoque mínimo" allow={(r) => r.pharmacist || r.assistant || r.keeper}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
