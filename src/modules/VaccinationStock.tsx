// Imunobiológicos e frascos — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationStock(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Imunobiológicos e frascos" sub="entrada, transferência, frascos abertos, posição e perdas" allow={(r) => r.professional || r.keeper}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
