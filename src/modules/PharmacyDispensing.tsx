// PharmacyDispensing — portão e estado provisório (módulo 27a, Task 3); a Task 9 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyDispensing() {
  return (
    <PharmacyGate title="Dispensação" sub="receita pelo código ou pelo paciente, lote e retirada" allow={(r) => r.pharmacist || r.assistant}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
