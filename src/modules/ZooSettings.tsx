// src/modules/ZooSettings.tsx
// Casca da tela "Parâmetros de zoonoses" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooSettings(_props: { onGoToSecurity(): void }) {
  return (
    <ZoonosesGate title="Parâmetros de zoonoses" sub="zoonoses · parâmetros" allow={(r) => r.coordinator}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
