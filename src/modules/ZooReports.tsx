// src/modules/ZooReports.tsx
// Casca da tela "Relatórios de zoonoses" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooReports() {
  return (
    <ZoonosesGate title="Relatórios de zoonoses" sub="zoonoses · relatórios" allow={(r) => r.reader}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
