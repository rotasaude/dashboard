// src/modules/HomeVisitDay.tsx
// Casca da tela "Folha do dia" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function HomeVisitDay() {
  return (
    <HomeVisitGate title="Folha do dia" sub="visita domiciliar · visitas de hoje" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
