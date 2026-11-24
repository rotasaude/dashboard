// src/modules/ZooObservations.tsx
// Casca da tela "Observação do agressor" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooObservations() {
  return (
    <ZoonosesGate title="Observação do agressor" sub="zoonoses · observação" allow={(r) => r.team}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
