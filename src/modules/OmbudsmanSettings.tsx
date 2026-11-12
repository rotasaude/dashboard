// Casca da tela "Configuração da ouvidoria" (módulo 33): portão pronto; o conteúdo vem nas próximas tasks.
import { EmptyState } from "../components/EmptyState";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export function OmbudsmanSettings() {
  return (
    <OmbudsmanGate title="Configuração da ouvidoria" sub="respondentes, assuntos e prazos" allow={(r) => r.lead}>
      {() => <EmptyState title="em construção" />}
    </OmbudsmanGate>
  );
}
