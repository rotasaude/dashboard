// src/modules/ZooDemands.tsx
// Casca da tela "Demandas" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooDemands() {
  return (
    <ZoonosesGate title="Demandas" sub="zoonoses · demandas" allow={(r) => r.team}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
