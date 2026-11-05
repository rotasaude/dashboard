// Módulo 31 — F-31.2: fila de encaminhamentos, demanda espontânea e acolhimento com ou sem matrícula (Task 5).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsReceptionProps = { today?: string; now?: Date; onGoToSecurity?: () => void };

export function CapsReception(_props: CapsReceptionProps) {
  return (
    <PsychosocialGate title="Acolhimento" sub="Encaminhamentos da UBS e demanda espontânea" allow={(r) => r.staff}>
      {() => null}
    </PsychosocialGate>
  );
}
