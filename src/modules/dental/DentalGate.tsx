// Portão das telas da saúde bucal (módulo 28): interruptor e papel antes de qualquer leitura (o api recusaria de novo;
// aqui só não se oferece a porta). Cópia do molde do PharmacyGate.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { DENTAL_DISABLED, DENTAL_NO_ROLE, canUseDental, dentalRoles } from "../../lib/dental";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type DentalGateRoles = ReturnType<typeof dentalRoles>;

export function DentalGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: DentalGateRoles): boolean; children(roles: DentalGateRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = dentalRoles(user);
  let body: ReactNode;
  if (!canUseDental(user)) body = <EmptyState title={DENTAL_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={DENTAL_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
