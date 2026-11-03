// Cadeia de frio — tela-portão do módulo 29 (só o portão; a tela real vem nas próximas tasks).
import { EmptyState } from "../components/EmptyState";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export function VaccinationColdChain(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Cadeia de frio" sub="equipamentos, temperatura duas vezes ao dia e conduta" allow={(r) => r.professional || r.keeper}>
      {() => <EmptyState title="em construção" />}
    </VaccinationGate>
  );
}
