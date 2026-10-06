// src/lib/schedulingRules.ts
// Bloco `scheduling` do protocolo (módulo 17; schema protocols-v1.5.0,
// contratos §1). Mesmo padrão de offer.ts: o JSON do editor é a fonte; estas
// funções leem a definição e devolvem uma definição nova sem tocar no resto.
import type { AppointmentType, ConditionTree, SchedulingPriority } from "./api";
import { TYPE_KEY_PATTERN } from "./scheduling";

export interface SchedulingRuleDraft {
  when: ConditionTree | null; appointmentType: string; priority: SchedulingPriority; dueInDays: number | null;
}
export type SchedulingRead = { ok: true; rules: SchedulingRuleDraft[] } | { ok: false; reason: string };

export const SCHEDULING_MAX = 10;
export const DUE_MIN = 1;
export const DUE_MAX = 365;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (reason: string): SchedulingRead => ({ ok: false, reason });

export function readScheduling(definition: unknown): SchedulingRead {
  if (!isObj(definition)) return fail("a definição precisa ser um objeto JSON");
  const list = definition.scheduling;
  if (list === undefined) return { ok: true, rules: [] };
  if (!Array.isArray(list)) return fail("“scheduling” não é uma lista: corrija no JSON");
  const malformed = list.some((r) => !isObj(r) ||
    (r.when !== undefined && !isObj(r.when)) ||
    (r.appointment_type !== undefined && typeof r.appointment_type !== "string") ||
    (r.priority !== undefined && r.priority !== "routine" && r.priority !== "priority") ||
    (r.due_in_days !== undefined && !Number.isInteger(r.due_in_days)));
  if (malformed) {
    return fail("uma regra de agendamento está fora do formato { when, appointment_type, priority, due_in_days }: corrija no JSON");
  }
  return {
    ok: true,
    rules: (list as Obj[]).map((r) => ({
      when: (r.when as ConditionTree | undefined) ?? null,
      appointmentType: (r.appointment_type as string | undefined) ?? "",
      priority: (r.priority as SchedulingPriority | undefined) ?? "routine",
      dueInDays: (r.due_in_days as number | undefined) ?? null
    }))
  };
}

// Campo incompleto sai ausente: o gate do api aponta o erro, e o painel
// mostra o motivo ao lado (como as sugestões do módulo 15).
export function writeScheduling(definition: unknown, rules: SchedulingRuleDraft[]): unknown {
  const next: Obj = { ...(definition as Obj) };
  if (rules.length === 0) { delete next.scheduling; return next; }
  next.scheduling = rules.map((r) => {
    const out: Obj = {};
    if (r.when !== null) out.when = r.when;
    if (r.appointmentType !== "") out.appointment_type = r.appointmentType;
    out.priority = r.priority;
    if (r.dueInDays !== null) out.due_in_days = r.dueInDays;
    return out;
  });
  return next;
}

export function parseDueDays(text: string): { days: number | null; problem: string | null } {
  const t = text.trim();
  if (t === "") return { days: null, problem: null };
  if (!/^\d+$/.test(t)) return { days: null, problem: "use um número inteiro de dias" };
  const n = Number(t);
  if (n < DUE_MIN || n > DUE_MAX) return { days: null, problem: `use de ${DUE_MIN} a ${DUE_MAX} dias` };
  return { days: n, problem: null };
}

export function schedulingRuleProblem(rule: SchedulingRuleDraft, types: AppointmentType[] | null): string | null {
  if (rule.appointmentType === "") return "escolha o tipo de atendimento";
  if (!TYPE_KEY_PATTERN.test(rule.appointmentType)) return "tipo inválido: minúsculas, números e _";
  if (rule.when === null) return "defina quando gerar o pedido";
  if (rule.dueInDays === null) return `informe o prazo (${DUE_MIN} a ${DUE_MAX} dias)`;
  if (types) {
    const t = types.find((x) => x.key === rule.appointmentType);
    if (!t) return "tipo não existe nesta cidade: o gate avisa, sem bloquear";
    if (!t.active) return "tipo inativo nesta cidade";
  }
  return null;
}

export function moveRule(list: SchedulingRuleDraft[], i: number, delta: -1 | 1): SchedulingRuleDraft[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const next = [ ...list ];
  [ next[i], next[j] ] = [ next[j], next[i] ];
  return next;
}
