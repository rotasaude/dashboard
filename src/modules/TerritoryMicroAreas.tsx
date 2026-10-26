// src/modules/TerritoryMicroAreas.tsx
// Microáreas (módulo 24a): por enquanto só o portão; o corpo entra na task própria.
import { EmptyState } from "../components/EmptyState";
import { TerritoryGate } from "./territory/TerritoryGate";

export function TerritoryMicroAreas(_props: { onGoToSecurity?: () => void } = {}) {
  return (
    <TerritoryGate title="Microáreas" sub="cadastro territorial · microáreas das equipes e o ACS responsável" allow={(r) => r.admin}>
      {() => <EmptyState title="em construção" />}
    </TerritoryGate>
  );
}
