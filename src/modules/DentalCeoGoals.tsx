// Metas do CEO (módulo 28). Tela-portão: o corpo vem nas Tasks 10–12.
import { EmptyState } from "../components/EmptyState";
import { DentalGate } from "./dental/DentalGate";

export function DentalCeoGoals() {
  return (
    <DentalGate title="Metas do CEO" sub="meta mensal por especialidade e risco de suspensão" allow={(r) => r.admin || r.analyst}>
      {() => <EmptyState title="Em construção nesta branch." />}
    </DentalGate>
  );
}
