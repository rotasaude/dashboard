// Módulo 30: portão da tela "Meus pedidos de TFD" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TfdMyCases(_props: { today?: string }) {
  return <TransportGate title="Meus pedidos de TFD" sub="Pedidos de TFD que você fez e os devolvidos" area="tfd" allow={(r) => r.professional}>{() => null}</TransportGate>;
}
