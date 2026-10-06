// Regras do módulo 17 sem React (spec 2026-10-05 §3–§5; contratos §2–§4).
// A validação daqui espelha os 422 do api para a tela avisar antes de enviar;
// quem garante continua sendo o api.
import type {
  AppointmentType, AppointmentView, AvailabilitySlot, BlockKind, BookingKind, PreferredPeriod, RescheduleReasonCode,
  ScheduleBlock, ScheduleTemplate, SchedulingPriority
} from "./api";
import { cityDateFormat, cityIsoDate, fmtHourMinute } from "./format";
import { addDays } from "./campaigns";
import { mondayOf } from "./analytics";

// Aritmética de dia já existente (UTC ao meio-dia): reaproveitada, não copiada.
export { addDays as addDaysIso, mondayOf as weekStart };

export const TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;
export const DURATION_MIN = 5;
export const DURATION_MAX = 240;
export const FIT_IN_LIMIT_MAX = 20;
export const CBO_PREFIXES_MAX = 20;
export const FIT_IN_REASON_MIN = 10;
export const AVAILABILITY_DAYS = 14;
export const MY_AGENDA_DAYS = 7;
// Nome do tipo e do modelo: 1 a 60 depois do squish (save_template.rb, save_appointment_type.rb).
export const NAME_MAX = 60;
// Teto de faixas por modelo (template_blocks.rb MAX_BLOCKS); acima disso o api devolve bad_block.
export const MAX_BLOCKS = 24;

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  walk_in: "demanda do dia", bookable: "agendável", blocked: "bloqueada"
};
export const PRIORITY_LABEL: Record<SchedulingPriority, string> = { routine: "rotina", priority: "prioritária" };
export const PERIOD_LABEL: Record<PreferredPeriod, string> = { morning: "manhã", afternoon: "tarde", any: "qualquer período" };
export const REASON_CODE_LABEL: Record<RescheduleReasonCode, string> = {
  work: "trabalho", health: "saúde", transport: "transporte", other: "outro motivo"
};
export const BOOKING_KIND_LABEL: Record<BookingKind, string> = { slot: "vaga", fit_in: "encaixe", legacy: "marcação livre" };

// Todos são `detail` do 422 invalid_blocks (contratos §3 e §9; template_blocks.rb).
export type BlockProblem =
  | "overlap" | "missing_type" | "unknown_type" | "inactive_type" | "bad_time" | "crosses_midnight" | "bad_slot_minutes"
  | "empty" | "bad_block";
export const BLOCK_DETAIL_MESSAGE: Record<BlockProblem, string> = {
  overlap: "faixas sobrepostas — ajuste os horários",
  missing_type: "faixa agendável precisa de um tipo de atendimento",
  unknown_type: "faixa com tipo de atendimento que não existe na cidade",
  inactive_type: "faixa com tipo de atendimento desativado — escolha um tipo ativo",
  bad_time: "horário inválido — use HH:MM",
  crosses_midnight: "a faixa não cruza a meia-noite — use fim depois do início (sem 24:00)",
  bad_slot_minutes: `duração da vaga entre ${DURATION_MIN} e ${DURATION_MAX} minutos`,
  empty: "inclua pelo menos uma faixa",
  // O api usa bad_block para faixa malformada (tipo ou vaga em faixa não
  // agendável, campo desconhecido) e para mais de 24 faixas.
  bad_block: `faixa inválida ou mais de ${MAX_BLOCKS} faixas — confira o modelo`
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const validSpan = (b: ScheduleBlock) => HHMM.test(b.starts) && HHMM.test(b.ends) && toMinutes(b.ends) > toMinutes(b.starts);
const squish = (s: string) => s.trim().replace(/\s+/g, " ");

// Mesma ordem de checagem do api (TemplateBlocks.block_detail).
// Desativar um tipo nunca quebra o que já existe (ADR 0029): o modelo salvo
// continua valendo. Mas salvar de novo um modelo com tipo inativo é recusado
// (inactive_type, §9); a tela avisa antes e mostra o tipo marcado "(inativo)".
export function blockProblem(block: ScheduleBlock, types: AppointmentType[]): BlockProblem | null {
  if (block.ends === "24:00") return "crosses_midnight";
  if (!HHMM.test(block.starts) || !HHMM.test(block.ends)) return "bad_time";
  if (!validSpan(block)) return "crosses_midnight";
  if (block.kind !== "bookable") {
    return block.appointment_type_key !== undefined || block.slot_minutes !== undefined ? "bad_block" : null;
  }
  if (!block.appointment_type_key) return "missing_type";
  const type = types.find((t) => t.key === block.appointment_type_key);
  if (!type) return "unknown_type";
  if (!type.active) return "inactive_type";
  if (block.slot_minutes !== undefined &&
      (!Number.isInteger(block.slot_minutes) || block.slot_minutes < DURATION_MIN || block.slot_minutes > DURATION_MAX)) {
    return "bad_slot_minutes";
  }
  return null;
}

export function overlappingBlocks(blocks: ScheduleBlock[]): Set<number> {
  const out = new Set<number>();
  blocks.forEach((a, i) => {
    blocks.forEach((b, j) => {
      if (j <= i || !validSpan(a) || !validSpan(b)) return;
      if (toMinutes(a.starts) < toMinutes(b.ends) && toMinutes(b.starts) < toMinutes(a.ends)) { out.add(i); out.add(j); }
    });
  });
  return out;
}

export function parseFitInLimit(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= FIT_IN_LIMIT_MAX ? n : null;
}

export interface TemplateDraft { name: string; fitInLimit: string; blocks: ScheduleBlock[] }

export function templateDraftFrom(t: ScheduleTemplate | null): TemplateDraft {
  if (!t) return { name: "", fitInLimit: "2", blocks: [ { starts: "08:00", ends: "12:00", kind: "bookable" } ] };
  return { name: t.name, fitInLimit: String(t.fit_in_limit), blocks: t.blocks.map((b) => ({ ...b })) };
}

export function templateProblem(draft: TemplateDraft, types: AppointmentType[]): string | null {
  const name = squish(draft.name);
  if (name === "") return "dê um nome ao modelo";
  if (name.length > NAME_MAX) return `nome do modelo com até ${NAME_MAX} caracteres`;
  if (parseFitInLimit(draft.fitInLimit) === null) return `limite de encaixes entre 0 e ${FIT_IN_LIMIT_MAX}`;
  if (draft.blocks.length === 0) return BLOCK_DETAIL_MESSAGE.empty;
  if (draft.blocks.length > MAX_BLOCKS) return `no máximo ${MAX_BLOCKS} faixas por modelo`;
  for (const b of draft.blocks) {
    const p = blockProblem(b, types);
    if (p) return BLOCK_DETAIL_MESSAGE[p];
  }
  if (overlappingBlocks(draft.blocks).size > 0) return BLOCK_DETAIL_MESSAGE.overlap;
  return null;
}

export interface TypeDraft { key: string; name: string; duration: string; cbo: string }

export function typeDraftFrom(t: AppointmentType | null): TypeDraft {
  if (!t) return { key: "", name: "", duration: "", cbo: "" };
  return { key: t.key, name: t.name, duration: String(t.duration_minutes), cbo: t.cbo_prefixes.join(", ") };
}

export function parseCboPrefixes(text: string): string[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > CBO_PREFIXES_MAX || parts.some((p) => !/^\d{1,6}$/.test(p))) return null;
  return parts;
}

export function typeDraftProblem(draft: TypeDraft, mode: "create" | "edit"): string | null {
  if (mode === "create" && !TYPE_KEY_PATTERN.test(draft.key)) return "chave: minúsculas, números e _, começando por letra (2 a 41)";
  const name = squish(draft.name);
  if (name === "") return "dê um nome ao tipo";
  if (name.length > NAME_MAX) return `nome do tipo com até ${NAME_MAX} caracteres`;
  const d = Number(draft.duration);
  if (!/^\d+$/.test(draft.duration.trim()) || d < DURATION_MIN || d > DURATION_MAX) {
    return `duração entre ${DURATION_MIN} e ${DURATION_MAX} minutos`;
  }
  if (parseCboPrefixes(draft.cbo) === null) return `informe de 1 a ${CBO_PREFIXES_MAX} grupos de CBO (só números, separados por vírgula)`;
  return null;
}

// `types` nulo: a lista de tipos não está disponível nesta tela (não carregou,
// ou o papel não lê GET /professionals/appointment_types — leem municipal_admin,
// citizen_verifier, health_professional, protocol_author e protocol_reviewer).
// Sem a lista, mostra a chave.
export function typeLabel(key: string | null | undefined, types: AppointmentType[] | null): string {
  if (!key) return "—";
  if (!types) return key;
  const t = types.find((x) => x.key === key);
  if (!t) return `${key} (não existe na cidade)`;
  return t.active ? t.name : `${t.name} (inativo)`;
}

// Grupos de CBO são prefixos (spec §3.1; Scheduling::AppointmentTypes.serves?).
export function typeServes(type: AppointmentType, cboCode: string): boolean {
  return type.cbo_prefixes.some((p) => cboCode.startsWith(p));
}

export function blockLine(block: ScheduleBlock, types: AppointmentType[] | null): string {
  const parts = [ `${block.starts}–${block.ends}`, BLOCK_KIND_LABEL[block.kind] ];
  if (block.kind === "bookable") {
    parts.push(!types && block.appointment_type_name ? block.appointment_type_name : typeLabel(block.appointment_type_key, types));
  }
  if (block.slot_minutes !== undefined) parts.push(`vagas de ${block.slot_minutes} min`);
  return parts.join(" · ");
}

// O mesmo aviso que a marcação de hoje mostra (spec 2026-09-25 §6).
export function confirmationWarning(start: Date, now: Date): string {
  const hoursUntil = (start.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntil < 48) return "O horário nasce confirmado";
  const deadline = new Date(start.getTime() - 24 * 3_600_000);
  const day = cityDateFormat({ day: "2-digit", month: "2-digit" }).format(deadline);
  return `O cidadão precisa confirmar até ${day} ${fmtHourMinute(deadline.toISOString())}`;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// "2026-10-06" → "06/10", sem passar por Date (a data já é da cidade).
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const WEEKDAYS = [ "dom", "seg", "ter", "qua", "qui", "sex", "sáb" ];
export function dayLabel(iso: string): string {
  return `${WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${ddmm(iso)}`;
}

export function fmtDueOn(iso: string): string {
  return `até ${ddmm(iso)}`;
}

export function slotsByDay(slots: AvailabilitySlot[]): Map<string, AvailabilitySlot[]> {
  const map = new Map<string, AvailabilitySlot[]>();
  for (const s of slots) {
    const day = cityIsoDate(new Date(s.starts_at));
    map.set(day, [ ...(map.get(day) ?? []), s ]);
  }
  return map;
}

export function requestKindLabel(row: { kind: "return" | "referral" | "triage"; origin_unit_name: string | null }): string {
  if (row.kind === "return") return "Retorno";
  if (row.kind === "triage") return "Triagem";
  return row.origin_unit_name ? `Encaminhado de ${row.origin_unit_name}` : "Encaminhamento";
}

export interface QueueMarksInput {
  overdue: boolean; reschedule_requested: boolean; needs_reschedule: boolean; reopened_reason: "expired" | "no_show" | null;
}
type Mark = { label: string; tone: "down" | "warn" | "info" | "neutral" };

export function requestMarks(row: QueueMarksInput): Mark[] {
  const out: Mark[] = [];
  if (row.overdue) out.push({ label: "atrasado", tone: "down" });
  if (row.reschedule_requested) out.push({ label: "pediu outro horário", tone: "warn" });
  if (row.needs_reschedule) out.push({ label: "precisa remarcar", tone: "warn" });
  if (row.reopened_reason === "expired") out.push({ label: "sem confirmação", tone: "neutral" });
  if (row.reopened_reason === "no_show") out.push({ label: "faltou", tone: "neutral" });
  return out;
}

export function appointmentFlags(a: AppointmentView): string[] {
  const out: string[] = [];
  if (a.fit_in) out.push("encaixe");
  if (a.outside_template) out.push("fora do modelo");
  if (a.shift_cancelled) out.push("turno cancelado");
  return out;
}
