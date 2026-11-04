// Portão das telas do transporte sanitário e do TFD (módulo 30): interruptor e papel antes de qualquer leitura (o api recusaria
// de novo; aqui só não se oferece a porta). Molde do VaccinationGate. O TFD exige `tfd`, `sanitary_transport` e
// `clinical_record` (a sessão traz as chaves ligadas, não as usáveis). O cadastro do motorista na frota e o CBO 225 do médico
// só o api sabe: a recusa (403 missing_role / cbo_not_allowed) é traduzida pela tela que lê.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { TRANSPORT_DISABLED, TRANSPORT_NO_ROLE, canUseTransport, transportRoles } from "../../lib/transport";
import { TFD_DISABLED, TFD_NO_ROLE, canUseTfd } from "../../lib/tfd";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type TransportRoles = ReturnType<typeof transportRoles>;

export function TransportGate({ title, sub, area, allow, children }: {
  title: string; sub: string; area: "transport" | "tfd"; allow(roles: TransportRoles): boolean; children(roles: TransportRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = transportRoles(user);
  const tfd = area === "tfd";
  let body: ReactNode;
  if (!(tfd ? canUseTfd(user) : canUseTransport(user))) body = <EmptyState title={tfd ? TFD_DISABLED : TRANSPORT_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={tfd ? TFD_NO_ROLE : TRANSPORT_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
