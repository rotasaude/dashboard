// Bloco `offer` e lista `suggestions` do protocolo (módulo 15; schema
// protocols-v1.4.0; contratos §1). O JSON do editor é a fonte: estas funções
// leem a definição e devolvem uma definição nova, sem tocar no resto. A
// definição é `unknown` no dashboard (src/lib/editor.ts) e o contracts não
// publica tipos TS, então os tipos daqui são locais.
import type { ConditionTree } from "./api";

export interface OfferDraft {
  title: string;
  summary: string;
  eligibility: ConditionTree | null;
  retakeAfterDays: number | null;
}
export interface SuggestionDraft { protocol: string; when: ConditionTree | null }
export type OfferRead =
  | { ok: true; offer: OfferDraft; suggestions: SuggestionDraft[] }
  | { ok: false; reason: string };

export const TITLE_MAX = 60;
export const SUMMARY_MAX = 200;
export const RETAKE_MAX = 3650;
export const SUGGESTIONS_MAX = 10;
// O mesmo padrão do `name` do protocolo (contratos §1).
export const PROTOCOL_NAME_PATTERN = /^[a-z][a-z0-9-]+$/;
export const RETAKE_PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "sem intervalo", days: null },
  { label: "6 meses", days: 180 },
  { label: "1 ano", days: 365 }
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (reason: string): OfferRead => ({ ok: false, reason });

export function readOffer(definition: unknown): OfferRead {
  if (!isObj(definition)) return fail("a definição precisa ser um objeto JSON");
  const raw = definition.offer;
  if (raw !== undefined && !isObj(raw)) return fail(`“offer” não é um objeto: corrija no JSON`);
  const o: Obj = isObj(raw) ? raw : {};
  if (o.title !== undefined && typeof o.title !== "string") return fail(`“offer.title” precisa ser texto: corrija no JSON`);
  if (o.summary !== undefined && typeof o.summary !== "string") return fail(`“offer.summary” precisa ser texto: corrija no JSON`);
  if (o.eligibility !== undefined && !isObj(o.eligibility)) {
    return fail(`“offer.eligibility” precisa ser uma condição: corrija no JSON`);
  }
  if (o.retake_after_days !== undefined && !Number.isInteger(o.retake_after_days)) {
    return fail(`“offer.retake_after_days” precisa ser um número inteiro de dias: corrija no JSON`);
  }
  const list = definition.suggestions;
  if (list !== undefined && !Array.isArray(list)) return fail(`“suggestions” não é uma lista: corrija no JSON`);
  const items: unknown[] = Array.isArray(list) ? list : [];
  const malformed = items.some((s) => !isObj(s) ||
    (s.protocol !== undefined && typeof s.protocol !== "string") || (s.when !== undefined && !isObj(s.when)));
  if (malformed) return fail("uma sugestão está fora do formato { protocol, when }: corrija no JSON");

  return {
    ok: true,
    offer: {
      title: (o.title as string | undefined) ?? "",
      summary: (o.summary as string | undefined) ?? "",
      eligibility: (o.eligibility as ConditionTree | undefined) ?? null,
      retakeAfterDays: (o.retake_after_days as number | undefined) ?? null
    },
    suggestions: (items as Obj[]).map((s) => ({
      protocol: (s.protocol as string | undefined) ?? "",
      when: (s.when as ConditionTree | undefined) ?? null
    }))
  };
}

// Campo vazio sai ausente (o schema recusa "" e null); offer vazio sai inteiro.
export function writeOffer(definition: unknown, offer: OfferDraft): unknown {
  const next: Obj = { ...(definition as Obj) };
  const block: Obj = {};
  if (offer.title !== "") block.title = offer.title;
  if (offer.summary !== "") block.summary = offer.summary;
  if (offer.eligibility !== null) block.eligibility = offer.eligibility;
  if (offer.retakeAfterDays !== null) block.retake_after_days = offer.retakeAfterDays;
  if (Object.keys(block).length === 0) delete next.offer;
  else next.offer = block;
  return next;
}

// Sugestão sem condição vai sem `when`: o gate do api aponta o erro, e o
// painel mostra "defina quando sugerir" ao lado.
export function writeSuggestions(definition: unknown, list: SuggestionDraft[]): unknown {
  const next: Obj = { ...(definition as Obj) };
  if (list.length === 0) delete next.suggestions;
  else next.suggestions = list.map((s) => (s.when === null ? { protocol: s.protocol } : { protocol: s.protocol, when: s.when }));
  return next;
}

export function protocolNameOf(definition: unknown): string | null {
  return isObj(definition) && typeof definition.name === "string" ? definition.name : null;
}

export function parseRetake(text: string): { days: number | null; problem: string | null } {
  const t = text.trim();
  if (t === "") return { days: null, problem: null };
  if (!/^\d+$/.test(t)) return { days: null, problem: "use um número inteiro de dias" };
  const n = Number(t);
  if (n < 1 || n > RETAKE_MAX) return { days: null, problem: `use de 1 a ${RETAKE_MAX} dias` };
  return { days: n, problem: null };
}

export function retakeLabel(days: number | null): string {
  if (days === null) return "sem intervalo: pode refazer quando quiser";
  const preset = RETAKE_PRESETS.find((p) => p.days === days);
  if (preset) return `${preset.label} (${days} dias)`;
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

export function suggestionProblem(s: SuggestionDraft, ownName: string | null): string | null {
  if (s.protocol === "") return "escolha o protocolo sugerido";
  if (!PROTOCOL_NAME_PATTERN.test(s.protocol)) return "nome de protocolo inválido (minúsculas, números e hífen)";
  if (s.protocol === ownName) return "um protocolo não pode sugerir a si mesmo";
  if (s.when === null) return "defina quando sugerir";
  return null;
}
