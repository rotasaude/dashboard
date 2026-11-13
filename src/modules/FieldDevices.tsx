// src/modules/FieldDevices.tsx
// Casca da tela "Aparelhos de campo" (módulo 24b): portão e papel; o corpo vem nas tarefas seguintes.
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { EmptyState } from "../components/EmptyState";

export function FieldDevices() {
  return (
    <HomeVisitGate title="Aparelhos de campo" sub="app de campo · cadastrar e revogar o aparelho" feature={null} allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </HomeVisitGate>
  );
}
