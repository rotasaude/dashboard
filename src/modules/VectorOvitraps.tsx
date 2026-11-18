// src/modules/VectorOvitraps.tsx
// Casca da tela "Ovitrampas" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: coordenação e laboratório (OvitrapsController#neighborhood_scope, OvitrapReadingsController#reader!).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorOvitraps() {
  return (
    <VectorGate title="Ovitrampas" sub="endemias · ovitrampas do bairro e contagem de ovos" allow={(r) => r.coordinator || r.lab}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
