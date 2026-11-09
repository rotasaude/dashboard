// Módulo 32a: painel da urgência (casca; o conteúdo vem na Task 11/12). Portão: interruptor e papel.
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { useAuth } from "../lib/auth";
import { canUseUrgency, URGENCY_DISABLED } from "../lib/urgency";
import { stack } from "./exams/styles";

export const URGENCY_NO_ROLE = "você não tem acesso ao painel da urgência";

export function UrgencyPanel() {
  const { user } = useAuth();
  if (!user) return null;
  const roles = user.memberships.map((m) => m.role);
  let body;
  if (!canUseUrgency(user)) body = <EmptyState title={URGENCY_DISABLED} />;
  else if (!roles.includes("municipal_admin") && !roles.includes("analyst")) body = <EmptyState title={URGENCY_NO_ROLE} />;
  else body = <EmptyState title="Painel da urgência em construção" />;
  return (
    <div style={stack}>
      <PageHeader title="Painel da urgência" sub="UPA · tempos e desfechos" />
      {body}
    </div>
  );
}
