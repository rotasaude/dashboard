// src/modules/MicroAreaAssignments.tsx
// Casca da tela "Atribuição de microáreas" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function MicroAreaAssignments() {
  return (
    <HomeVisitGate title="Atribuição de microáreas" sub="visita domiciliar · microáreas dos agentes de campo" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
