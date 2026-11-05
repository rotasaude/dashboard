// Módulo 31 — F-31.1: leitos, limite de noites e prazo do PTS, só do municipal_admin, com step-up (Task 4).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsSettingsProps = { onGoToSecurity?: () => void };

export function CapsSettings(_props: CapsSettingsProps) {
  return (
    <PsychosocialGate title="CAPS: leitos e regras" sub="Leitos, limite de noites e prazo do PTS" unit="none" allow={(r) => r.admin}>
      {() => null}
    </PsychosocialGate>
  );
}
