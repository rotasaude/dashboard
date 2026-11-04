// Módulo 30: portão da tela "Comissão de TFD" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TfdQueue(_props: { today?: string; now?: Date; onGoToSecurity?: () => void }) {
  return <TransportGate title="Comissão de TFD" sub="Laudos aguardando, decisão, trechos e pagamento" area="tfd" allow={(r) => r.committee}>{() => null}</TransportGate>;
}
