// Módulo 31 — F-31.7: matriciamento e casos compartilhados (Task 12).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsMatrixProps = { today?: string };

export function CapsMatrix(_props: CapsMatrixProps) {
  return (
    <PsychosocialGate title="Matriciamento" sub="Apoio às equipes da UBS e casos compartilhados" allow={(r) => r.staff}>
      {() => null}
    </PsychosocialGate>
  );
}
