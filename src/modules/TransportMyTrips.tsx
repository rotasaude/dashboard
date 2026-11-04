// Módulo 30: portão da tela "Minhas viagens" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportMyTrips(_props: { today?: string; now?: Date }) {
  return <TransportGate title="Minhas viagens" sub="Viagens do dia, embarque e fechamento" area="transport" allow={(r) => r.driver}>{() => null}</TransportGate>;
}
