// src/modules/ZooAnimals.tsx
// Casca da tela "Animais" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooAnimals() {
  return (
    <ZoonosesGate title="Animais" sub="zoonoses · animais" allow={(r) => r.team}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
