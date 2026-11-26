// Casca do módulo 27b: portão e título; o corpo vem nas Tasks 8–11.
import { BnafarGate } from "./bnafar/BnafarGate";

export function OpeningImport(_props: { onGoToSecurity?: () => void; onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void }) {
  return (
    <BnafarGate title="Saldo inicial" sub="Planilha do saldo inicial, conferência e aplicação" needs="stock" allow={(r) => r.admin || r.keeper}>
      {() => null}
    </BnafarGate>
  );
}
