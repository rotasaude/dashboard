// Módulo 30: portão da tela "Painel de transporte e TFD" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportPanel(_props: { today?: string }) {
  return <TransportGate title="Painel de transporte e TFD" sub="Viagens, ocupação, faltas, km e TFD do mês" area="transport" allow={(r) => r.admin || r.dispatcher || r.committee}>{() => null}</TransportGate>;
}
