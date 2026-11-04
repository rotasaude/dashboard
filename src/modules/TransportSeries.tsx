// Módulo 30: portão da tela "Séries recorrentes" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportSeries(_props: { today?: string; onGoToSecurity?: () => void }) {
  return <TransportGate title="Séries recorrentes" sub="Hemodiálise, radioterapia e outros tratamentos contínuos" area="transport" allow={(r) => r.dispatcher}>{() => null}</TransportGate>;
}
