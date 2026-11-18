// src/modules/VectorLiraa.tsx
// Casca da tela "LIRAa" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: só a coordenação (LiraaSurveysController: coordinator!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorLiraa() {
  return (
    <VectorGate title="LIRAa" sub="endemias · levantamento rápido de índices" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
