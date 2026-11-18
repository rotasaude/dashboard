// src/modules/vectorControl/VectorGate.tsx
// Portão das telas do módulo 35a (vigilância ambiental de endemias; ADR 0054): o operador nunca, interruptor (com a visita
// domiciliar utilizável, Q1) e papel antes de qualquer leitura. O api confere de novo (403 feature_disabled / missing_role).
// O operador vem antes do interruptor: canUseVectorControl já o exclui, e a frase certa para ele é a do papel, não a de
// "desligada nesta cidade".
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { VC_NO_ROLE, canUseVectorControl, vectorRoles, type VectorRoles } from "../../lib/vectorControl";
import { VECTOR_CONTROL_DISABLED } from "../../lib/vectorErrors";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function VectorGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: VectorRoles): boolean; children(roles: VectorRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = vectorRoles(user);
  let body: ReactNode;
  if (user.operator) body = <EmptyState title={VC_NO_ROLE} />;
  else if (!canUseVectorControl(user)) body = <EmptyState title={VECTOR_CONTROL_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={VC_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
