// PharmacyExternal — portão e estado provisório (módulo 27a, Task 3); a Task 11 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyExternal() {
  return (
    <PharmacyGate title="Receita externa" sub="receita de fora da rede, com profissional e conselho" allow={(r) => r.pharmacist || r.assistant}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
