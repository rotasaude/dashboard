// src/modules/territory/TerritoryGate.tsx
// Portão das telas do cadastro territorial: interruptor e papel antes de
// qualquer leitura (o api recusaria de novo; aqui só não se oferece a porta).
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { TERRITORY_DISABLED, TERRITORY_NO_ROLE, canUseTerritory, territoryRoles } from "../../lib/territoryRegistry";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type TerritoryRoles = ReturnType<typeof territoryRoles>;

export function TerritoryGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: TerritoryRoles): boolean; children(roles: TerritoryRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = territoryRoles(user);
  let body: ReactNode;
  if (!canUseTerritory(user)) body = <EmptyState title={TERRITORY_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={TERRITORY_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
