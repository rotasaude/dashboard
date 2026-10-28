// SurveillanceNegatives — nasce como portão; a tela de verdade chega na task que a implementa.
import { EmptyState } from "../components/EmptyState";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

export function SurveillanceNegatives(_props: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Notificação negativa" sub="unidades sem casos na semana epidemiológica" allow={(r) => r.surveillance}>
      {() => <EmptyState title="em construção" />}
    </SurveillanceGate>
  );
}
