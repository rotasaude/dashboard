// Corpo provisório (módulo 26a, Task 3): portão e "em construção". A tela de
// verdade chega numa task seguinte.
import { RegulationGate } from "./regulation/RegulationGate";
import { EmptyState } from "../components/EmptyState";

export function RegulationSettings(_props: { onGoToSecurity?: () => void } = {}) {
  return (
    <RegulationGate title="Prazos e lista do enfermeiro" sub="prazos por cor e o que o enfermeiro pode pedir" allow={(r) => r.admin}>
      {() => <EmptyState title="em construção" />}
    </RegulationGate>
  );
}
