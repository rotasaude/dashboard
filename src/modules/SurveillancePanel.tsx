// SurveillancePanel — nasce como portão; a tela de verdade chega na task que a implementa.
import { EmptyState } from "../components/EmptyState";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

export function SurveillancePanel(_props: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Painel por bairro e semana epidemiológica" sub="casos por bairro e semana epidemiológica" allow={(r) => r.surveillance || r.analyst}>
      {() => <EmptyState title="em construção" />}
    </SurveillanceGate>
  );
}
