// Módulo 31 — F-31.8: painel (Task 14). Portão sem CAPS: o painel lê os CAPS e oferece "Todos os CAPS" (P52; preflight R7).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsPanelProps = { today?: string };

export function CapsPanel(_props: CapsPanelProps) {
  return (
    <PsychosocialGate title="Painel do CAPS" sub="Matrículas, PTS, ações, leitos e RAAS do mês" unit="none" allow={(r) => r.lead || r.admin || r.analyst}>
      {() => null}
    </PsychosocialGate>
  );
}
