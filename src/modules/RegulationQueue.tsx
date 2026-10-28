// Corpo provisório (módulo 26a, Task 3): portão e "em construção". A tela de
// verdade chega numa task seguinte.
import { RegulationGate } from "./regulation/RegulationGate";
import { EmptyState } from "../components/EmptyState";

export function RegulationQueue() {
  return (
    <RegulationGate title="Fila regulada" sub="pedidos por cor e espera, vencidos primeiro" allow={(r) => r.regulator}>
      {() => <EmptyState title="em construção" />}
    </RegulationGate>
  );
}
