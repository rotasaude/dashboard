// Tela "Configuração da ouvidoria" (módulo 33; F-33.1): do ouvidor (`lead`). Respondentes, assuntos e prazos, cada um num painel
// que lê só depois do portão (interruptor e papel). Nada em storage.
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";
import { RespondersPanel } from "./ombudsman/RespondersPanel";
import { SubjectsPanel } from "./ombudsman/SubjectsPanel";
import { DeadlinesPanel } from "./ombudsman/DeadlinesPanel";

export function OmbudsmanSettings() {
  return (
    <OmbudsmanGate title="Configuração da ouvidoria" sub="respondentes, assuntos e prazos" allow={(r) => r.lead}>
      {() => (
        <>
          <RespondersPanel />
          <SubjectsPanel />
          <DeadlinesPanel />
        </>
      )}
    </OmbudsmanGate>
  );
}
