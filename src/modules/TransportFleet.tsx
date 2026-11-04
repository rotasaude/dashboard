// Módulo 30: portão da tela "Frota, motoristas e destinos" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportFleet(_props: { today?: string; onGoToSecurity?: () => void }) {
  return <TransportGate title="Frota, motoristas e destinos" sub="Veículos, motoristas com CNH e destinos com km" area="transport" allow={(r) => r.dispatcher}>{() => null}</TransportGate>;
}
