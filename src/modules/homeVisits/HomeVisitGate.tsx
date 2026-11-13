// src/modules/homeVisits/HomeVisitGate.tsx
// Portão das telas da visita domiciliar e da atividade coletiva (módulo 24b): interruptor e papel antes de qualquer leitura.
// `feature: null` (aparelhos de campo, Q75): só a sessão e o papel — listar e revogar nunca dependem do interruptor, para
// que um aparelho perdido sempre possa ser revogado; só o cadastro de aparelho novo exige `home_visits` (o api recusa).
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { COLLECTIVE_DISABLED, HOME_VISITS_DISABLED, HV_NO_ROLE, canUseCollectiveActivities, canUseHomeVisits, hvRoles } from "../../lib/homeVisits";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type HvRoles = ReturnType<typeof hvRoles>;
export type HomeVisitFeature = "home_visits" | "collective_activities" | null;

export function HomeVisitGate({ title, sub, feature, allow, children }: {
  title: string; sub: string; feature: HomeVisitFeature; allow(roles: HvRoles): boolean; children(roles: HvRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = hvRoles(user);
  let body: ReactNode;
  if (feature === "home_visits" && !canUseHomeVisits(user)) body = <EmptyState title={HOME_VISITS_DISABLED} />;
  else if (feature === "collective_activities" && !canUseCollectiveActivities(user)) body = <EmptyState title={COLLECTIVE_DISABLED} />;
  else if (user.operator || !allow(roles)) body = <EmptyState title={HV_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
