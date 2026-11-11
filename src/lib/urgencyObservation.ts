// Regras de tela da observação, da prescrição interna e da checagem da medicação na UPA (módulo 32b; ADR 0050; contrato
// 2026-11-10; formas e limites do api em api-shapes.md §3–§5, que vale sobre o plano) sem React. Quem decide é o api: a tela só
// não envia o que já sabe que será recusado, com os mesmos limites e os mesmos `path` (`items.<n>.<campo>`). Nenhuma frase
// interpola nome, medicamento, dose, motivo ou dado do paciente.
import {
  URGENCY_DOSE_UNITS, type AdministrationStatus, type FrequencyKind, type ObservationAlert, type ScheduleSlot,
  type UrgencyAdministrationInput, type UrgencyDoseUnit, type UrgencyFrequency, type UrgencyPrescriptionItem,
  type UrgencyPrescriptionItemInput
} from "./api";
import { ROUTES } from "./clinicalDocuments";
import type { Problem } from "./pharmacy";
import { chars } from "./urgency";
import type { Tone } from "../theme/tokens";

// ─── Chaves de consulta, intervalos e limites ───────────────────────────────
export const URGENCY_OBSERVATION_POLL_MS = 30_000;
export const URGENCY_BEDS_KEY = "urgencyBeds";
export const MEDICATION_SCHEDULE_KEY = "urgencyMedicationSchedule";
export const URGENCY_SHORTFALLS_KEY = "urgencyShortfalls";
// Q5: um horário pode ser checado até 60 minutos antes de vencer.
export const CHECK_AHEAD_MINUTES = 60;
export const MAX_ITEMS = 20;
// A15: a administração pode ser datada até 5 minutos à frente.
const ADMINISTERED_AHEAD_MS = 5 * 60_000;
// Q4: a primeira dose vai de agora − 1 h até agora + 24 h.
const FIRST_DOSE_BEHIND_MS = 60 * 60_000;
const FIRST_DOSE_AHEAD_MS = 24 * 60 * 60_000;
// O api confere contra o próprio "agora", que é posterior ao da tela: a tela recusa (e o keptFirstDoseAt evita) o que estiver a
// menos de 1 min do piso, para que nenhum horário cruze o piso durante o envio. Quem chama passa o `now` do momento do envio.
export const FIRST_DOSE_FLOOR_MARGIN_MS = 60_000;
const firstDoseFloor = (now: Date): number => now.getTime() - FIRST_DOSE_BEHIND_MS + FIRST_DOSE_FLOOR_MARGIN_MS;

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const BED_FREE = "leito livre";
export const NO_UPA_BEDS = "esta UPA ainda não tem leitos de observação — a administração cadastra em Leitos";
export const OBSERVATION_STARTED = "paciente em observação";
export const BED_CHANGED = "leito trocado";
export const OBSERVATION_ENDED = "observação encerrada";
export const NO_CLINICAL_IN_MAP = "O mapa não mostra queixa, CID, medicamento nem a classificação.";
export const CHECK_IMMUTABLE = "A checagem não se altera depois de registrada; erro de registro se corrige com nova prescrição e o motivo no prontuário.";
export const STOCK_PENDING = "a baixa de estoque ficou pendente — a farmácia concilia a falta";
export const SHORTFALL_NO_PATIENT = "A lista de faltas não mostra o paciente, só a senha e o medicamento.";

// ─── Rótulos ────────────────────────────────────────────────────────────────
const raw = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);

export function alertText(a: ObservationAlert | null | undefined): string | null {
  if (a === null || a === undefined) return null;
  if (a === "near_limit") return "perto de 24 h em observação";
  if (a === "over_limit") return "mais de 24 h em observação";
  return String(a);
}
export const alertTone = (a: ObservationAlert | null | undefined): Tone => (a === "over_limit" ? "down" : a === "near_limit" ? "warn" : "neutral");
export const hoursText = (h: number): string => `${h} h em observação`;

export const FREQUENCY_KINDS: { value: FrequencyKind; label: string }[] = [
  { value: "once", label: "dose única" }, { value: "interval", label: "de X em X horas" }, { value: "if_needed", label: "se necessário" }
];
export function frequencyText(f: { kind: FrequencyKind } & Partial<Pick<UrgencyFrequency, "interval_hours" | "max_per_day">>): string {
  if (f.kind === "once") return "dose única";
  if (f.kind === "interval") return f.interval_hours ? `de ${f.interval_hours} em ${f.interval_hours} h` : "de X em X horas";
  if (f.kind === "if_needed") return f.max_per_day ? `se necessário, até ${f.max_per_day} por dia` : "se necessário";
  return String(f.kind);
}

export const ADMIN_STATUSES: { value: AdministrationStatus; label: string }[] = [
  { value: "administered", label: "administrado" }, { value: "not_administered", label: "não administrado" },
  { value: "refused", label: "recusado pelo paciente" }
];
export const adminStatusLabel = raw(Object.fromEntries(ADMIN_STATUSES.map((s) => [ s.value, s.label ])));
export const shortfallCauseLabel = raw({
  no_location: "a UPA não tem local de estoque", insufficient_balance: "saldo insuficiente", lot_unavailable: "lote indisponível"
});
export const endKindLabel = raw({ bed_change: "troca de leito", observation_ended: "observação encerrada", outcome: "desfecho" });

// ─── Janela da checagem ─────────────────────────────────────────────────────
export type SlotState = "done" | "late" | "due" | "future";
// done: já checado; late: o horário passou sem checagem; due: já pode checar (agora ou até 60 min à frente); future: ainda não.
export function slotState(slot: Pick<ScheduleSlot, "scheduled_at" | "administration">, now: Date): SlotState {
  if (slot.administration) return "done";
  const t = Date.parse(slot.scheduled_at);
  if (t < now.getTime()) return "late";
  return t <= now.getTime() + CHECK_AHEAD_MINUTES * 60_000 ? "due" : "future";
}
export const canCheck = (slot: Pick<ScheduleSlot, "scheduled_at" | "administration">, now: Date): boolean => {
  const s = slotState(slot, now);
  return s === "late" || s === "due";
};

// ─── Números ────────────────────────────────────────────────────────────────
// "12,5" → "12.5" (formato do api) quando é decimal positivo com até `frac` casas e `int` inteiros; senão null.
function decimalText(value: string, int: number, frac: number): string | null {
  const t = value.trim().replace(",", ".");
  if (!new RegExp(`^\\d{1,${int}}(\\.\\d{1,${frac}})?$`).test(t)) return null;
  return Number(t) > 0 ? t : null;
}
export function parseDecimal(value: string): number | null {
  const t = value.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}
const wholeIn = (value: string, min: number, max: number): number | null => {
  const t = value.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};
const within = (v: string, min: number, max: number): boolean => { const n = chars(v); return n >= min && n <= max; };

export const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
export const BED_LABEL_TEXT = "o rótulo tem de 1 a 20 caracteres";
export const reasonProblem = (text: string): string | null => (within(text, 10, 500) ? null : REASON_TEXT);
export const bedLabelProblem = (label: string): string | null => (within(label, 1, 20) ? null : BED_LABEL_TEXT);

// ─── Data e hora ────────────────────────────────────────────────────────────
// O api aceita `YYYY-MM-DDTHH:MM` (sem fuso = hora da cidade) ou ISO completo. Sem fuso, lê-se como hora local do navegador.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const instant = (value: string): number | null => {
  const t = value.trim();
  if (!INSTANT.test(t)) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
};

const pad = (n: number) => String(n).padStart(2, "0");
// ms → ISO no mesmo fuso do texto de referência (offset ou Z), sem frações.
function formatLike(ms: number, reference: string): string {
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(reference);
  const zone = m ? m[1] : "Z";
  const offsetMin = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const d = new Date(ms + offsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${zone}`;
}

// `now` = o instante do envio (não o da abertura da tela).
// D18a: o api recusa `first_dose_at` < agora − 1 h. Ao alterar a prescrição, o item mantido volta com a primeira dose da PRÓPRIA
// grade (original + k·intervalo) que cai na janela. Retorna null quando o campo deve ser omitido (o api usa "agora"):
//  - interval: o menor horário original + k·intervalo ≥ agora − 1 h (mantém o original se ele ainda cabe);
//  - once / if_needed: mantém o original só se ainda cabe na janela; senão omite (once já dado nunca é reagendado: `given`).
export function keptFirstDoseAt(item: Pick<UrgencyPrescriptionItem, "first_dose_at" | "frequency">, now: Date, opts: { given?: boolean } = {}): string | null {
  const first = Date.parse(item.first_dose_at);
  if (Number.isNaN(first)) return null;
  const floor = firstDoseFloor(now);
  const { kind, interval_hours } = item.frequency;
  if (kind === "interval" && interval_hours && interval_hours > 0) {
    const step = interval_hours * 3_600_000;
    const k = first >= floor ? 0 : Math.ceil((floor - first) / step);
    return formatLike(first + k * step, item.first_dose_at);
  }
  if (kind === "once" && opts.given) return null;
  return first >= floor ? item.first_dose_at : null;
}

// ─── Prescrição ─────────────────────────────────────────────────────────────
export type ItemDraft = {
  // `controlled_list` e `stock_unit` só servem à tela (marca do controlado; unidade da baixa); nunca vão ao api.
  item: { catalog_item_id: string; name: string; controlled_list?: string; stock_unit?: string } | null;
  dose: string; doseUnit: UrgencyDoseUnit | ""; route: UrgencyPrescriptionItemInput["route"];
  kind: FrequencyKind; intervalHours: string; maxPerDay: string;
  // Vazia = "agora" (o api assume). Ao alterar, carrega a primeira dose do item original (D18).
  firstDoseAt: string; instructions: string; quantityPerDose: string;
};
export const emptyItemDraft = (): ItemDraft => ({
  item: null, dose: "", doseUnit: "", route: "oral", kind: "once", intervalHours: "", maxPerDay: "", firstDoseAt: "",
  instructions: "", quantityPerDose: "1"
});
export function itemDraftFrom(item: UrgencyPrescriptionItem): ItemDraft {
  const q = parseDecimal(item.stock_quantity_per_dose);
  return {
    item: item.catalog_item ? {
      catalog_item_id: item.catalog_item.catalog_item_id, name: item.catalog_item.name,
      ...(item.controlled_list ? { controlled_list: item.controlled_list } : {}), ...(item.stock_unit ? { stock_unit: item.stock_unit } : {})
    } : null,
    dose: item.dose, doseUnit: item.dose_unit, route: item.route, kind: item.frequency.kind,
    intervalHours: item.frequency.interval_hours === null ? "" : String(item.frequency.interval_hours),
    maxPerDay: item.frequency.max_per_day === null ? "" : String(item.frequency.max_per_day),
    firstDoseAt: item.first_dose_at, instructions: item.instructions ?? "", quantityPerDose: q === null ? "1" : String(q)
  };
}

const DOSE_UNIT_SET: ReadonlySet<string> = new Set(URGENCY_DOSE_UNITS);
const ROUTE_SET: ReadonlySet<string> = new Set(ROUTES);

// Na ordem do formulário, item a item; todos os problemas de uma vez. `now` ativa a janela da primeira dose.
export function prescriptionProblems(drafts: ItemDraft[], now?: Date): Problem[] {
  if (drafts.length < 1 || drafts.length > MAX_ITEMS) return [ { path: "items", text: "a prescrição tem de 1 a 20 itens" } ];
  const out: Problem[] = [];
  drafts.forEach((d, i) => {
    const at = (field: string, text: string) => out.push({ path: `items.${i}.${field}`, text });
    if (!d.item) at("catalog_item_id", "escolha o medicamento");
    if (decimalText(d.dose, 5, 3) === null) at("dose", "informe a dose (até 5 dígitos e 3 casas, maior que zero)");
    if (!DOSE_UNIT_SET.has(d.doseUnit)) at("dose_unit", "escolha a unidade da dose");
    if (!ROUTE_SET.has(d.route)) at("route", "escolha a via");
    if (d.kind === "interval" && wholeIn(d.intervalHours, 1, 24) === null) at("frequency.interval_hours", "o intervalo vai de 1 a 24 horas");
    if (d.kind === "if_needed" && wholeIn(d.maxPerDay, 1, 24) === null) at("frequency.max_per_day", "o máximo por dia vai de 1 a 24");
    if (d.firstDoseAt.trim() !== "") {
      const t = instant(d.firstDoseAt);
      const bad = t === null || (now !== undefined && (t < firstDoseFloor(now) || t > now.getTime() + FIRST_DOSE_AHEAD_MS));
      if (bad) at("first_dose_at", "a primeira dose vai de 1 hora atrás até 24 horas à frente");
    }
    if (chars(d.instructions) > 500) at("instructions", "a orientação tem até 500 caracteres");
    if (decimalText(d.quantityPerDose, 5, 2) === null) at("stock_quantity_per_dose", "a quantidade por dose é maior que zero, com até 2 casas");
  });
  return out;
}

// Só chaves que o api aceita: `interval_hours`/`max_per_day` só no seu tipo, nunca null; `dose` e quantidade como texto com ponto;
// `instructions` só se não vazia; `first_dose_at` só preenchida; `stock_quantity_per_dose` só diferente de 1. Chame após prescriptionProblems.
export function prescriptionBody(drafts: ItemDraft[]): UrgencyPrescriptionItemInput[] {
  return drafts.map((d): UrgencyPrescriptionItemInput => {
    if (!d.item || d.doseUnit === "") throw new Error("prescriptionBody: item incompleto");
    const frequency: UrgencyPrescriptionItemInput["frequency"] = { kind: d.kind };
    if (d.kind === "interval") frequency.interval_hours = Number(d.intervalHours.trim());
    if (d.kind === "if_needed") frequency.max_per_day = Number(d.maxPerDay.trim());
    const out: UrgencyPrescriptionItemInput = {
      catalog_item_id: d.item.catalog_item_id, dose: decimalText(d.dose, 5, 3) ?? d.dose.trim(), dose_unit: d.doseUnit, route: d.route, frequency
    };
    const instructions = d.instructions.trim();
    if (instructions) out.instructions = instructions;
    if (d.firstDoseAt.trim()) out.first_dose_at = d.firstDoseAt.trim();
    const q = decimalText(d.quantityPerDose, 5, 2);
    if (q !== null && Number(q) !== 1) out.stock_quantity_per_dose = q;
    return out;
  });
}

// ─── Checagem ───────────────────────────────────────────────────────────────
export type AdministrationDraft = { status: AdministrationStatus; reason: string; lotId: string; quantity: string; administeredAt: string };
export type AdministrationContext = {
  // O interruptor UTILIZÁVEL agora (`schedule.stock_deduction`).
  stockDeduction: boolean;
  // Padrão do aprazamento: o primeiro lote FEFO e a quantidade por dose do item; só o que mudar vai ao api.
  defaultLotId: string; defaultQuantity: string; now: Date;
  // `prescribed_at` da versão: dose dada antes de a versão nascer não entra nela.
  prescribedAt: string;
};

const stockChanged = (d: AdministrationDraft, ctx: AdministrationContext) =>
  ctx.stockDeduction && d.status === "administered"
  && { lot: d.lotId !== "" && d.lotId !== ctx.defaultLotId, quantity: parseDecimal(d.quantity) !== parseDecimal(ctx.defaultQuantity) || decimalText(d.quantity, 5, 2) === null };

export type AdministrationTarget = { itemId: string; kind: FrequencyKind; slot: string | null };

// `target` (opcional) confere o horário: once/interval exigem `scheduled_at`; if_needed não o aceita.
export function administrationProblems(d: AdministrationDraft, ctx: AdministrationContext, target?: AdministrationTarget): Problem[] {
  const out: Problem[] = [];
  if (target && target.kind !== "if_needed" && !target.slot) out.push({ path: "scheduled_at", text: "escolha o horário a checar" });
  if (d.status !== "administered") {
    const p = reasonProblem(d.reason);
    if (p) out.push({ path: "reason", text: p });
    return out;
  }
  if (d.administeredAt.trim() !== "") {
    const t = instant(d.administeredAt);
    const from = Date.parse(ctx.prescribedAt);
    if (t === null || t > ctx.now.getTime() + ADMINISTERED_AHEAD_MS || (!Number.isNaN(from) && t < from)) {
      out.push({ path: "administered_at", text: "o horário da administração não pode passar de 5 minutos à frente nem ser anterior a esta prescrição" });
    }
  }
  const changed = stockChanged(d, ctx);
  if (changed && changed.quantity && decimalText(d.quantity, 5, 2) === null) {
    out.push({ path: "stock_quantity", text: "a quantidade é maior que zero, com até 2 casas" });
  }
  return out;
}

// `scheduled_at` só com horário (if_needed não aceita); `reason` só fora de administrado; `administered_at` só se informado;
// estoque só com o interruptor, administrado e valor diferente do padrão.
export function administrationBody(
  d: AdministrationDraft, ctx: AdministrationContext, target: AdministrationTarget
): UrgencyAdministrationInput {
  if (target.kind !== "if_needed" && !target.slot) throw new Error("administrationBody: horário não escolhido");
  const out: UrgencyAdministrationInput = { prescription_item_id: target.itemId, status: d.status };
  if (target.kind !== "if_needed" && target.slot) out.scheduled_at = target.slot;
  if (d.status !== "administered") {
    out.reason = d.reason.trim();
    return out;
  }
  if (d.administeredAt.trim()) out.administered_at = d.administeredAt.trim();
  const changed = stockChanged(d, ctx);
  if (changed) {
    if (changed.lot) out.stock_lot_id = d.lotId;
    const q = decimalText(d.quantity, 5, 2);
    if (changed.quantity && q !== null) out.stock_quantity = q;
  }
  return out;
}

// ─── Cadastro de leitos (F-32.7) ────────────────────────────────────────────
export const BED_ADDED = "Leito adicionado ao mapa da observação.";
export const BED_DEACTIVATED = "Leito desativado.";
export const BED_REACTIVATED = "Leito reativado.";
