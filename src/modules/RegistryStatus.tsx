// src/modules/RegistryStatus.tsx
// Validade dos cadastros (módulo 24a): por enquanto só o portão; o corpo entra na task própria.
import { EmptyState } from "../components/EmptyState";
import { TerritoryGate } from "./territory/TerritoryGate";

export function RegistryStatus(_props: { today?: string; onRegister?: () => void } = {}) {
  return (
    <TerritoryGate title="Validade dos cadastros" sub="cadastro territorial · vencidos, a vencer e quem falta cadastrar" allow={(r) => r.professional}>
      {() => <EmptyState title="em construção" />}
    </TerritoryGate>
  );
}
