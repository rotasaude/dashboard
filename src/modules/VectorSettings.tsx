// src/modules/VectorSettings.tsx
// Casca da tela "Produtos e parâmetros" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: só a coordenação (ProductsController e SettingsController: coordinator!; PUT /parameters também).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorSettings() {
  return (
    <VectorGate title="Produtos e parâmetros" sub="endemias · produtos, parâmetros e ajustes" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
