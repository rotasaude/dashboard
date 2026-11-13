// src/modules/FieldDevicesAdmin.tsx
// Casca da tela "Aparelhos de campo da cidade" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function FieldDevicesAdmin() {
  return (
    <HomeVisitGate title="Aparelhos de campo da cidade" sub="app de campo · aparelhos da cidade e revogação" feature={null} allow={(r) => r.admin}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
