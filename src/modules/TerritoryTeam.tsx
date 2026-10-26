// src/modules/TerritoryTeam.tsx
// Território da equipe (módulo 24a): por enquanto só o portão; o corpo entra na task própria.
import { EmptyState } from "../components/EmptyState";
import { TerritoryGate } from "./territory/TerritoryGate";

export function TerritoryTeam(_props: { today?: string } = {}) {
  return (
    <TerritoryGate title="Território da equipe" sub="cadastro territorial · domicílios, famílias e moradores" allow={(r) => r.professional}>
      {() => <EmptyState title="em construção" />}
    </TerritoryGate>
  );
}
