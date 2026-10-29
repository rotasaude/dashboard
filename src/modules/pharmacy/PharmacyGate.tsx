// src/modules/pharmacy/PharmacyGate.tsx
// Portão das telas da farmácia (módulo 27a): interruptor e papel antes de qualquer
// leitura (o api recusaria de novo; aqui só não se oferece a porta). O interruptor
// `pharmacy` vale para TODO /pharmacy/*, inclusive "Locais e configurações".
// Cópia do molde do RegulationGate: o portão nasce próprio em vez de generalizar
// componente compartilhado. O papel POR LOCAL é do LocationPick.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { PHARMACY_DISABLED, PHARMACY_NO_ROLE, canUsePharmacy, pharmacyRoles } from "../../lib/pharmacy";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type PharmacyRoles = ReturnType<typeof pharmacyRoles>;

export function PharmacyGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: PharmacyRoles): boolean; children(roles: PharmacyRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = pharmacyRoles(user);
  let body: ReactNode;
  if (!canUsePharmacy(user)) body = <EmptyState title={PHARMACY_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={PHARMACY_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
