// src/modules/regulation/RegulationGate.tsx
// Portão das telas da regulação (módulo 26a): interruptor e papel antes de
// qualquer leitura (o api recusaria de novo; aqui só não se oferece a porta).
// Cópia do molde do SurveillanceGate: o portão nasce próprio em vez de
// generalizar componente compartilhado.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { REGULATION_DISABLED, REGULATION_NO_ROLE, canUseRegulation, regulationRoles, type RegulationRoles } from "../../lib/regulation";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function RegulationGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: RegulationRoles): boolean; children(roles: RegulationRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = regulationRoles(user);
  let body: ReactNode;
  if (!canUseRegulation(user)) body = <EmptyState title={REGULATION_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={REGULATION_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
