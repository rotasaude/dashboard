// src/modules/VectorSamples.tsx
// Casca da tela "Amostras de larvas" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: coordenação e laboratório (SamplesController#reader!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorSamples() {
  return (
    <VectorGate title="Amostras de larvas" sub="endemias · amostras do boletim e resultado" allow={(r) => r.coordinator || r.lab}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
