// Casca do módulo 27b: portão e título; o corpo vem nas Tasks 8–11.
import { BnafarGate } from "./bnafar/BnafarGate";

export function BnafarPending(_props: { onGoToSecurity?: () => void; onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void }) {
  return (
    <BnafarGate title="Pendências do envio à BNAFAR" sub="Lotes incompletos, locais sem CNES, produtos sem código e saldos com fração" needs="stock" allow={() => true} /* room_lead (Q32) não vem na sessão: o 403 missing_role vira BNAFAR_NO_ROLE na tela */>
      {() => null}
    </BnafarGate>
  );
}
