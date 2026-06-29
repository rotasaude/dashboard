// Helpers puros do editor de protocolo (F-03.12). Sem dependência de React,
// para serem testáveis isoladamente.
export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function parseDefinition(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON inválido" };
  }
}

export const TEMPLATE = JSON.stringify(
  {
    name: "novo-protocolo",
    version: 1,
    start_step_id: "s1",
    steps: [
      {
        id: "s1",
        prompt: "Pergunta inicial?",
        answer_type: "boolean",
        branches: { true: null, false: null },
        weights: { true: 0, false: 0 }
      }
    ],
    scoring: { type: "weighted", thresholds: { baixa: 0 }, priority_map: { baixa: 9 } }
  },
  null,
  2
);
