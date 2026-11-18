// src/modules/VectorTransmission.tsx
// Casca da tela "Bloqueio de transmissão" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: só a coordenação (TransmissionBlocksController: coordinator!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorTransmission() {
  return (
    <VectorGate title="Bloqueio de transmissão" sub="endemias · bloqueio pelos casos notificados" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
