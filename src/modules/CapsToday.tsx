// Módulo 31 — F-31.4: grupos e atendimentos do dia (Task 9).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsTodayProps = { today?: string; now?: Date };

export function CapsToday(_props: CapsTodayProps) {
  return (
    <PsychosocialGate title="Hoje no CAPS" sub="Grupos e atendimentos do dia" allow={(r) => r.staff}>
      {() => null}
    </PsychosocialGate>
  );
}
