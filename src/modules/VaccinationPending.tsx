// Pendências do envio — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationPending() {
  return (
    <VaccinationGate title="Pendências do envio" sub="doses paradas, recusadas ou perto do prazo de 24 h" allow={(r) => r.professional}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
