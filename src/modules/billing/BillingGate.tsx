// src/modules/billing/BillingGate.tsx
// Portão das telas do faturamento: interruptor e papel antes de qualquer
// leitura (o api recusaria de novo; aqui só não se oferece a porta).
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { BILLING_DISABLED, BILLING_NO_ROLE, billingRoles, canUseBilling, type BillingRoles } from "../../lib/billing";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function BillingGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: BillingRoles): boolean; children(roles: BillingRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = billingRoles(user);
  let body: ReactNode;
  if (!canUseBilling(user)) body = <EmptyState title={BILLING_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={BILLING_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
