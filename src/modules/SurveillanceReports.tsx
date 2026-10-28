// SurveillanceReports — nasce como portão; a tela de verdade chega na task que a implementa.
import { EmptyState } from "../components/EmptyState";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

export function SurveillanceReports(_props: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Relatórios da vigilância" sub="CSV por semana e encerradas sem número oficial" allow={(r) => r.surveillance}>
      {() => <EmptyState title="em construção" />}
    </SurveillanceGate>
  );
}
