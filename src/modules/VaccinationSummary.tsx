// Resumo mensal — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationSummary() {
  return (
    <VaccinationGate title="Resumo mensal" sub="movimentação do mês para lançar no SIES/SIPNI" allow={(r) => r.professional || r.keeper}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
