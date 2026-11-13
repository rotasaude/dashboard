// src/modules/WhoToVisit.tsx
// Casca da tela "Quem visitar" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function WhoToVisit() {
  return (
    <HomeVisitGate title="Quem visitar" sub="visita domiciliar · quem precisa de visita" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
