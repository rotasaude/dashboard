// Casca da tela "Setores da secretaria" (módulo 33): do municipal_admin, sem o portão do interruptor (Q12); conteúdo na Task 11.
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { stack } from "./exams/styles";

export function Departments() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div style={stack}>
      <PageHeader title="Setores da secretaria" sub="setores que recebem encaminhamentos" />
      <EmptyState title="em construção" />
    </div>
  );
}
