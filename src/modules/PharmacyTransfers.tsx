// PharmacyTransfers — portão e estado provisório (módulo 27a, Task 3); a Task 7 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyTransfers() {
  return (
    <PharmacyGate title="Transferências" sub="envio do almoxarifado e recebimento conferido na unidade" allow={(r) => r.pharmacist || r.assistant || r.keeper}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
