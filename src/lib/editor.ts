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

// ─── Perguntas analíticas (módulo 14; ADR 0025; spec §7) ────────────────────
// `analytic: true` só vale em pergunta boolean/enum; a API recusa em
// integer/text. A marca é parte da versão e passa pelo ciclo assinado.
export const ANALYTIC_HINT = "respostas desta pergunta aparecerão agregadas por bairro, nunca por pessoa";
const ANALYTIC_TYPES = new Set([ "boolean", "enum" ]);

type Step = Record<string, unknown>;

export interface AnalyticStep { id: string; prompt: string; answerType: string; analytic: boolean; eligible: boolean; stranded: boolean }

function stepsOf(definition: unknown): Step[] | null {
  if (!definition || typeof definition !== "object") return null;
  const steps = (definition as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return null;
  return steps.filter((s): s is Step => !!s && typeof s === "object");
}

export function analyticSteps(definition: unknown): AnalyticStep[] {
  return (stepsOf(definition) ?? []).map((s) => {
    const answerType = typeof s.answer_type === "string" ? s.answer_type : "";
    const id = String(s.id ?? "");
    return {
      id, prompt: typeof s.prompt === "string" && s.prompt ? s.prompt : id, answerType,
      analytic: s.analytic === true, eligible: ANALYTIC_TYPES.has(answerType),
      // Qualquer chave `analytic` (true, false, "true"...) em integer/text é resíduo: sai ao salvar.
      stranded: !ANALYTIC_TYPES.has(answerType) && "analytic" in s
    };
  });
}

// Cópia rasa com a pergunta trocada; o resto da definição fica como está.
function mapSteps(definition: unknown, fn: (step: Step) => Step): unknown {
  const d = definition as Record<string, unknown>;
  return { ...d, steps: (d.steps as unknown[]).map((s) => (s && typeof s === "object" ? fn(s as Step) : s)) };
}

function withoutAnalytic(step: Step): Step {
  const next = { ...step };
  delete next.analytic;
  return next;
}

export function setAnalytic(definition: unknown, stepId: string, on: boolean): unknown {
  if (!stepsOf(definition)) return definition;
  return mapSteps(definition, (s) => {
    if (s.id !== stepId) return s;
    const next = withoutAnalytic(s);
    if (on && ANALYTIC_TYPES.has(String(s.answer_type))) next.analytic = true;
    return next;
  });
}

export function stripIneligibleAnalytic(definition: unknown): { definition: unknown; removed: string[] } {
  const removed = analyticSteps(definition).filter((s) => s.stranded).map((s) => s.id);
  if (removed.length === 0) return { definition, removed };
  return {
    definition: mapSteps(definition, (s) => (removed.includes(String(s.id ?? "")) ? withoutAnalytic(s) : s)),
    removed
  };
}
