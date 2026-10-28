// src/modules/surveillance/SurveillanceGate.tsx
// Portão das telas da vigilância: interruptor e papel antes de qualquer
// leitura (o api recusaria de novo; aqui só não se oferece a porta).
// Cópia do molde do CareLinesGate: o plano do módulo 25 não mexe em componente
// compartilhado, então o portão nasce próprio em vez de ser generalizado.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { SURVEILLANCE_DISABLED, SURVEILLANCE_NO_ROLE, canUseSurveillance, surveillanceRoles, type SurveillanceRoles } from "../../lib/surveillance";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function SurveillanceGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: SurveillanceRoles): boolean; children(roles: SurveillanceRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = surveillanceRoles(user);
  let body: ReactNode;
  if (!canUseSurveillance(user)) body = <EmptyState title={SURVEILLANCE_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={SURVEILLANCE_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
