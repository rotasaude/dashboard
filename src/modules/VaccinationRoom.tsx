// Sala de vacina — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationRoom(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Sala de vacina" sub="caderneta, dose com lote e frasco, transcrição" allow={(r) => r.professional}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
