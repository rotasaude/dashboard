// Indicadores B1 e B2 (módulo 28). Tela-portão: o corpo vem nas Tasks 10–12.
import { EmptyState } from "../components/EmptyState";
import { DentalGate } from "./dental/DentalGate";

export function DentalIndicators() {
  return (
    <DentalGate title="Indicadores B1 e B2" sub="primeira consulta e tratamento concluído por equipe" allow={(r) => r.admin || r.analyst}>
      {() => <EmptyState title="Em construção nesta branch." />}
    </DentalGate>
  );
}
