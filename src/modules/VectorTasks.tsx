// src/modules/VectorTasks.tsx
// Casca da tela "Tarefas de endemias" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: só a coordenação (TasksController: coordinator!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorTasks() {
  return (
    <VectorGate title="Tarefas de endemias" sub="endemias · tarefas da coordenação" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
