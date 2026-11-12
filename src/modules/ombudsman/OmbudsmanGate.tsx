// Portão das telas da ouvidoria (módulo 33, ADR 0051): interruptor e papel antes de qualquer leitura (o api recusaria de novo;
// aqui só não se oferece a porta). Sem escolha de unidade. Nada em storage.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { OMBUDSMAN_DISABLED, OMBUDSMAN_NO_ROLE, canUseOmbudsman, ombudsmanRoles, type OmbudsmanRoles } from "../../lib/ombudsman";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function OmbudsmanGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: OmbudsmanRoles): boolean; children(roles: OmbudsmanRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = ombudsmanRoles(user);
  let body: ReactNode;
  if (!canUseOmbudsman(user)) body = <EmptyState title={OMBUDSMAN_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={OMBUDSMAN_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
