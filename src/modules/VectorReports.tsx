// src/modules/VectorReports.tsx
// Casca da tela "Relatórios de endemias" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: quem lê algum relatório (ReportsController#readable?: coordenação e admin os sete; laboratório ovitrampas e LIRAa).
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";
import { canReadAnyVectorReport } from "../lib/vectorControl";

export function VectorReports() {
  return (
    <VectorGate title="Relatórios de endemias" sub="endemias · relatórios em CSV e PDF" allow={canReadAnyVectorReport}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
