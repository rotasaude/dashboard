// src/modules/ZooCampaigns.tsx
// Casca da tela "Campanhas e vacinação" (módulo 35b, Task 3): portão e cabeçalho; o conteúdo vem nas tasks seguintes.
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { EmptyState } from "../components/EmptyState";

export function ZooCampaigns() {
  return (
    <ZoonosesGate title="Campanhas e vacinação" sub="zoonoses · campanhas" allow={(r) => r.reader}>
      {() => <EmptyState title="Em construção" />}
    </ZoonosesGate>
  );
}
