// SurveillanceDiseases — nasce como portão; a tela de verdade chega na task que a implementa.
import { EmptyState } from "../components/EmptyState";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

export function SurveillanceDiseases(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <SurveillanceGate title="Doenças notificáveis" sub="lista nacional e doenças da cidade" allow={(r) => r.surveillance}>
      {() => <EmptyState title="em construção" />}
    </SurveillanceGate>
  );
}
