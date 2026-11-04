// Módulo 30: portão da tela "Pendências e faltas" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportPending(_props: { today?: string }) {
  return <TransportGate title="Pendências e faltas" sub="Séries sem vaga e faltas por paciente" area="transport" allow={(r) => r.dispatcher}>{() => null}</TransportGate>;
}
