// Módulo 31 — F-31.4: grade semanal e presença a 375 px (Task 9).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsGroupsProps = { today?: string; now?: Date };

export function CapsGroups(_props: CapsGroupsProps) {
  return (
    <PsychosocialGate title="Grupos e oficinas" sub="Grade semanal e lista de presença" allow={(r) => r.staff}>
      {() => null}
    </PsychosocialGate>
  );
}
