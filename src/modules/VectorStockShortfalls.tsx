// src/modules/VectorStockShortfalls.tsx
// Casca da tela "Faltas de insumo de campo" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: coordenação e almoxarife, sem exigir pharmacy (Q21; StockShortfallsController#readable_scope confere o local).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function VectorStockShortfalls() {
  return (
    <VectorGate title="Faltas de insumo de campo" sub="endemias · insumo aplicado sem saldo no local" allow={(r) => r.coordinator || r.stockKeeper}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
