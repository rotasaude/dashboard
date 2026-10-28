// SurveillanceQueue — nasce como portão; a tela de verdade chega na task que a implementa.
import { EmptyState } from "../components/EmptyState";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

export function SurveillanceQueue(_props: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Fila da vigilância" sub="notificações com prazo · vigilância epidemiológica" allow={(r) => r.surveillance}>
      {() => <EmptyState title="em construção" />}
    </SurveillanceGate>
  );
}
