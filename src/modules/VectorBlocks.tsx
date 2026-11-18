// src/modules/VectorBlocks.tsx
// Casca da tela "Quarteirões e imóveis" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: só a coordenação (BlocksController escreve e HouseholdsController lista e atribui só com coordinator!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorBlocks() {
  return (
    <VectorGate title="Quarteirões e imóveis" sub="endemias · quarteirões e perfil vetorial" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
