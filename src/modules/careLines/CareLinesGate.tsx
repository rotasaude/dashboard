// src/modules/careLines/CareLinesGate.tsx
// Portão das telas das linhas de cuidado: interruptor e papel antes de
// qualquer leitura (o api recusaria de novo; aqui só não se oferece a porta).
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { CARE_DISABLED, CARE_NO_ROLE, canUseCareLines, careLineRoles, type CareRoles } from "../../lib/careLines";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function CareLinesGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: CareRoles): boolean; children(roles: CareRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = careLineRoles(user);
  let body: ReactNode;
  if (!canUseCareLines(user)) body = <EmptyState title={CARE_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={CARE_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
