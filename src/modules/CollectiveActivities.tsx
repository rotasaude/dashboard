// src/modules/CollectiveActivities.tsx
// Casca da tela "Atividade coletiva" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function CollectiveActivities() {
  return (
    <HomeVisitGate title="Atividade coletiva" sub="atividade coletiva · registrar e consultar" feature={"collective_activities"} allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
