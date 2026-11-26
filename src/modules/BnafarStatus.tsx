// Casca do módulo 27b: portão e título; o corpo vem nas Tasks 8–11.
import { BnafarGate } from "./bnafar/BnafarGate";

export function BnafarStatus(_props: { onGoToSecurity?: () => void; onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void }) {
  return (
    <BnafarGate title="Envio à BNAFAR" sub="Situação de cada dia, recusas e prazo de correção" needs="bnafar" allow={() => true} /* room_lead (Q32) não vem na sessão: o 403 missing_role vira BNAFAR_NO_ROLE na tela */>
      {() => null}
    </BnafarGate>
  );
}
