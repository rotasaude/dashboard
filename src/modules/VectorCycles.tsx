// src/modules/VectorCycles.tsx
// Casca da tela "Ciclos e cadência" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: só a coordenação (CyclesController e CadencesController: coordinator!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorCycles() {
  return (
    <VectorGate title="Ciclos e cadência" sub="endemias · ciclos de trabalho e cadência" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
