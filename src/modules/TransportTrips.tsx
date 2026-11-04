// Módulo 30: portão da tela "Viagens do dia" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportTrips(_props: { today?: string; onGoToSecurity?: () => void }) {
  return <TransportGate title="Viagens do dia" sub="Agenda por dia e veículo, passageiros e lista impressa" area="transport" allow={(r) => r.dispatcher}>{() => null}</TransportGate>;
}
