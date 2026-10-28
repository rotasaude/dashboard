// Corpo provisório (módulo 26a, Task 3): portão e "em construção". A tela de
// verdade chega numa task seguinte.
import { RegulationGate } from "./regulation/RegulationGate";
import { EmptyState } from "../components/EmptyState";

export function RegulationReturned() {
  return (
    <RegulationGate title="Encaminhamentos devolvidos" sub="pedidos da unidade devolvidos para complementar" allow={(r) => r.professional}>
      {() => <EmptyState title="em construção" />}
    </RegulationGate>
  );
}
