// PharmacyAdmin — portão e estado provisório (módulo 27a, Task 3); a Task 4 troca o corpo.
import { EmptyState } from "../components/EmptyState";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyAdmin(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <PharmacyGate title="Locais e configurações" sub="locais de estoque, equipe por local e prazos" allow={(r) => r.admin}>
      {() => <EmptyState title="Em construção" />}
    </PharmacyGate>
  );
}
