// Painel de vacinação — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationPanel() {
  return (
    <VaccinationGate title="Painel de vacinação" sub="doses, cobertura do C2, envio à RNDS e perdas" allow={(r) => r.admin || r.analyst}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
