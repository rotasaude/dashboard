// Salas e rede de frio — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationAdmin(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Salas e rede de frio" sub="salas, vacinadores, rede de frio e início na cidade" allow={(r) => r.admin}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
