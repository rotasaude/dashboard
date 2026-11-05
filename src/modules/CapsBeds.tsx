// Módulo 31 — F-31.5: mapa dos leitos, entrada, saída, limite e reavaliação (Task 10). Só CAPS III, AD III e AD IV.
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsBedsProps = { today?: string; now?: Date };

export function CapsBeds(_props: CapsBedsProps) {
  return (
    <PsychosocialGate title="Leitos" sub="Acolhimento noturno: leitos, entrada e saída" unit="beds" allow={(r) => r.staff}>
      {() => null}
    </PsychosocialGate>
  );
}
