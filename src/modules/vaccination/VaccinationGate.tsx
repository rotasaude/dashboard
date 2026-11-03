// Portão das telas da vacinação (módulo 29): interruptor e papel antes de qualquer leitura (o api recusaria de novo; aqui só não
// se oferece a porta). Molde do PharmacyGate. O papel POR LOCAL é do VaccineLocationPick.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { VACCINATION_DISABLED, VACCINATION_NO_ROLE, canUseVaccination, vaccinationRoles } from "../../lib/vaccination";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type VaccinationRoles = ReturnType<typeof vaccinationRoles>;

export function VaccinationGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: VaccinationRoles): boolean; children(roles: VaccinationRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = vaccinationRoles(user);
  let body: ReactNode;
  if (!canUseVaccination(user)) body = <EmptyState title={VACCINATION_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={VACCINATION_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
