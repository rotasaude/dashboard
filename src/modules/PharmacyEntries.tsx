// PharmacyEntries — portão e estado provisório (módulo 27a, Task 3); a Task 5 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyEntries() {
  return (
    <PharmacyGate title="Entradas e abertura" sub="nota fiscal, doação e inventário de abertura, com lote" allow={(r) => r.keeper || r.pharmacist}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
