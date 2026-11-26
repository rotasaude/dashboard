// Casca do módulo 27b: portão e título; o corpo vem nas Tasks 8–11.
import { BnafarGate } from "./bnafar/BnafarGate";

export function ExternalExits(_props: { onGoToSecurity?: () => void; onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void }) {
  return (
    <BnafarGate title="Saída externa" sub="Devolução, remanejamento, doação e empréstimo para fora da rede" needs="stock" allow={(r) => r.admin || r.keeper}>
      {() => null}
    </BnafarGate>
  );
}
