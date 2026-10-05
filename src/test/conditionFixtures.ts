// src/test/conditionFixtures.ts
// Dados comuns aos testes do construtor de condições (módulo 15).
import type { PanelNeighborhood } from "../lib/api";

export const SUGGESTION_DEF = {
  name: "saude-mental", version: 1, start_step_id: "humor",
  steps: [
    { id: "humor", prompt: "Sentiu-se triste?", answer_type: "boolean", branches: { true: "freq", false: null } },
    { id: "freq", prompt: "Com que frequência?", answer_type: "enum", options: [ "nunca", "às vezes", "sempre" ] },
    { id: "dias", prompt: "Há quantos dias?", answer_type: "integer" },
    { id: "obs", prompt: "Observações", answer_type: "text" }
  ],
  scoring: { type: "weighted", thresholds: { baixa: 0, media: 8, alta: 15 } }
};

export const NEIGHBORHOODS: PanelNeighborhood[] = [
  { id: "n1", name: "Xaxim", active: true },
  { id: "n2", name: "Boqueirão", active: true },
  { id: "n3", name: "Centro", active: false }
];
