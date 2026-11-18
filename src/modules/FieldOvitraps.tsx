// src/modules/FieldOvitraps.tsx
// Casca da tela "Ovitrampas de campo" (módulo 35a): portão e papel; o corpo vem nas tarefas seguintes. Papel: o profissional; o agente 515140 na microárea quem confere é o api (Access.agent_refusal) e, depois, a tela pela equipe.
import { VectorGate } from "./vectorControl/VectorGate";
import { EmptyState } from "../components/EmptyState";

export function FieldOvitraps() {
  return (
    <VectorGate title="Ovitrampas de campo" sub="endemias · ovitrampas da sua microárea" allow={(r) => r.professional}>
      {() => <EmptyState title="Em construção" />}
    </VectorGate>
  );
}
