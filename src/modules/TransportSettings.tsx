// Módulo 30: portão da tela "Regras do TFD e do acompanhante" (mesmo filtro do menu); o corpo vem numa task seguinte do plano.
import { TransportGate } from "./transport/TransportGate";

export function TransportSettings(_props: { onGoToSecurity?: () => void }) {
  return <TransportGate title="Regras do TFD e do acompanhante" sub="Distância mínima, acompanhante, CNES e complemento" area="transport" allow={(r) => r.admin}>{() => null}</TransportGate>;
}
