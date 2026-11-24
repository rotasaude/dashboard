// src/modules/ZooShelter.tsx
// Casca da tela "Canil e gatil" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooShelter(_props: { onGoToSecurity(): void }) {
  return (
    <ZoonosesGate title="Canil e gatil" sub="zoonoses · canil e gatil" allow={(r) => r.team}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
