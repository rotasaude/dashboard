// Módulo 32b (D1): leitos da observação da UPA, só do municipal_admin com `urgency_care` (+ `clinical_record`). Portão por ora;
// o cadastro (lista, criar, renomear, ativar/desativar com step-up) vem na Task 4.
import { useAuth } from "../lib/auth";
import { canUseUrgency, URGENCY_DISABLED } from "../lib/urgency";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { stack } from "./exams/styles";

export const URGENCY_BEDS_NO_ROLE = "você não tem acesso aos leitos de observação";

export function UrgencyBedsSettings(_props: { onGoToSecurity: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  const isAdmin = user.memberships.some((m) => m.role === "municipal_admin");
  let body;
  if (!canUseUrgency(user)) body = <EmptyState title={URGENCY_DISABLED} />;
  else if (!isAdmin) body = <EmptyState title={URGENCY_BEDS_NO_ROLE} />;
  else body = <EmptyState title="Leitos de observação" />;
  return (
    <div style={stack}>
      <PageHeader title="Leitos de observação" sub="UPA" />
      {body}
    </div>
  );
}
