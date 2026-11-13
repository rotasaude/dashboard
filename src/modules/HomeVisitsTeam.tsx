// src/modules/HomeVisitsTeam.tsx
// Casca da tela "Visitas da equipe" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function HomeVisitsTeam() {
  return (
    <HomeVisitGate title="Visitas da equipe" sub="visita domiciliar · folhas e visitas da equipe" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
