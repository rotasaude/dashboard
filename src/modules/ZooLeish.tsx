// src/modules/ZooLeish.tsx
// Casca da tela "Leishmaniose" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooLeish() {
  return (
    <ZoonosesGate title="Leishmaniose" sub="zoonoses · leishmaniose" allow={(r) => r.team}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
