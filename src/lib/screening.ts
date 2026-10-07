// src/lib/screening.ts
// Acolhimento (módulo 18; ADR 0030; spec §3–§4; contratos §2–§4). Regras puras
// da tela: rótulos, sinais vitais (plausibilidade espelhando o 422
// `implausible_vital`, que continua sendo a garantia), IMC, alertas, cor e
// destino. Nenhuma função aqui decide a cor: quem sugere é o protocolo
// assinado, no api.
import { ApiError, type GlucoseMoment, type ScreeningColor, type ScreeningCompleteInput, type ScreeningDestination,
  type ScreeningScope, type SchedulingPriority, type VitalSigns } from "./api";
import { attendanceError } from "./attendance";
import type { Tone } from "../theme/tokens";

export const COLORS: ScreeningColor[] = [ "red", "yellow", "green", "blue" ];
export const COLOR_LABEL: Record<ScreeningColor, string> = { red: "vermelho", yellow: "amarelo", green: "verde", blue: "azul" };
// Caderno de Atenção Básica nº 28.
export const COLOR_HINT: Record<ScreeningColor, string> = {
  red: "atendimento imediato", yellow: "atendimento prioritário", green: "atendimento no dia", blue: "consulta agendada"
};
export const COLOR_TONE: Record<ScreeningColor, Tone> = { red: "down", yellow: "warn", green: "ok", blue: "info" };
export const DESTINATIONS: ScreeningDestination[] = [ "same_day", "schedule", "oriented", "referred" ];
export const DESTINATION_LABEL: Record<ScreeningDestination, string> = {
  same_day: "consulta no dia", schedule: "agendar", oriented: "orientação", referred: "encaminhar"
};
export const SCOPE_LABEL: Record<ScreeningScope, string> = {
  walk_in: "só quem chega sem horário (padrão)", all: "todos os atendimentos"
};
export const GLUCOSE_MOMENTS: GlucoseMoment[] = [ "fasting", "postprandial", "random" ];
export const GLUCOSE_MOMENT_LABEL: Record<GlucoseMoment, string> = { fasting: "em jejum", postprandial: "pós-prandial", random: "casual" };

export const REASON_MIN = 10;
export const NOTE_MAX = 500;
export const DUE_MIN = 1;
export const DUE_MAX = 365;

export type VitalKey =
  | "systolic" | "diastolic" | "heart_rate" | "respiratory_rate" | "temperature_c" | "spo2" | "capillary_glucose"
  | "weight_kg" | "height_cm" | "pain_score";
export interface VitalSpec { key: VitalKey; label: string; unit: string; min: number; max: number; decimals: number }

// Limites de plausibilidade da spec §3.1, com a glicemia até 800 (o LEDI recusa
// acima; Desvio 3 do plano do api). O api é a fonte; aqui só se avisa antes.
export const VITALS: VitalSpec[] = [
  { key: "systolic", label: "Pressão sistólica", unit: "mmHg", min: 50, max: 300, decimals: 0 },
  { key: "diastolic", label: "Pressão diastólica", unit: "mmHg", min: 20, max: 200, decimals: 0 },
  { key: "heart_rate", label: "Frequência cardíaca", unit: "bpm", min: 20, max: 250, decimals: 0 },
  { key: "respiratory_rate", label: "Frequência respiratória", unit: "irpm", min: 4, max: 80, decimals: 0 },
  { key: "temperature_c", label: "Temperatura", unit: "°C", min: 30, max: 45, decimals: 1 },
  { key: "spo2", label: "Saturação (SpO2)", unit: "%", min: 50, max: 100, decimals: 0 },
  { key: "capillary_glucose", label: "Glicemia capilar", unit: "mg/dL", min: 10, max: 800, decimals: 0 },
  { key: "weight_kg", label: "Peso", unit: "kg", min: 0.5, max: 400, decimals: 2 },
  { key: "height_cm", label: "Altura", unit: "cm", min: 30, max: 250, decimals: 0 },
  { key: "pain_score", label: "Dor (0 a 10)", unit: "", min: 0, max: 10, decimals: 0 }
];
const SPEC = new Map(VITALS.map((v) => [ v.key, v ]));

export type VitalsForm = Record<VitalKey, string> & { glucose_moment: GlucoseMoment | "" };
export type VitalsProblems = Partial<Record<VitalKey | "glucose_moment" | "bp", string>>;

export const EMPTY_VITALS_FORM: VitalsForm = {
  systolic: "", diastolic: "", heart_rate: "", respiratory_rate: "", temperature_c: "", spo2: "", capillary_glucose: "",
  weight_kg: "", height_cm: "", pain_score: "", glucose_moment: ""
};

// Para a reavaliação: a revisão corrente preenche o formulário (vírgula decimal).
export function vitalsFormFrom(v: VitalSigns): VitalsForm {
  const form: VitalsForm = { ...EMPTY_VITALS_FORM, glucose_moment: v.glucose_moment ?? "" };
  for (const spec of VITALS) {
    const n = v[spec.key];
    if (typeof n === "number") form[spec.key] = String(n).replace(".", ",");
  }
  return form;
}

function decimalsOf(text: string): number {
  const dot = text.indexOf(".");
  if (dot < 0) return 0;
  return text.slice(dot + 1).replace(/0+$/, "").length;
}

// Valor válido entra em `vitals`; campo com problema fica de fora e ganha a frase.
export function parseVitals(form: VitalsForm): { vitals: VitalSigns; problems: VitalsProblems } {
  const vitals: VitalSigns = {};
  const problems: VitalsProblems = {};
  for (const spec of VITALS) {
    const text = form[spec.key].trim().replace(",", ".");
    if (text === "") continue;
    if (!/^\d+(\.\d+)?$/.test(text)) { problems[spec.key] = "use só números"; continue; }
    if (decimalsOf(text) > spec.decimals) {
      problems[spec.key] = spec.decimals === 0 ? "use um número inteiro"
        : spec.decimals === 1 ? "use até 1 casa decimal" : `use até ${spec.decimals} casas decimais`;
      continue;
    }
    const n = Number(text);
    if (n < spec.min || n > spec.max) {
      problems[spec.key] = `use de ${String(spec.min).replace(".", ",")} a ${spec.max}${spec.unit ? ` ${spec.unit}` : ""}`;
      continue;
    }
    vitals[spec.key] = n;
  }
  const hasSys = form.systolic.trim() !== "";
  const hasDia = form.diastolic.trim() !== "";
  if (hasSys !== hasDia) problems.bp = "informe a sistólica e a diastólica juntas";
  if (vitals.systolic !== undefined && vitals.diastolic !== undefined && vitals.diastolic >= vitals.systolic) {
    problems.diastolic = "a diastólica precisa ser menor que a sistólica";
    delete vitals.diastolic;
  }
  if (problems.bp) { delete vitals.systolic; delete vitals.diastolic; }
  if (vitals.capillary_glucose !== undefined) {
    if (form.glucose_moment === "") problems.glucose_moment = "informe o momento da glicemia";
    else vitals.glucose_moment = form.glucose_moment;
  }
  return { vitals, problems };
}

// IMC = peso / altura², uma casa decimal. Sem peso ou altura, nada.
export function bmiOf(weightKg: number | undefined, heightCm: number | undefined): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

// Código de alerta do api (contratos §3; `Screenings::VitalSigns` do plano do
// api): campo + `_high`/`_low`/`_severe`, com `temperature`, `glucose` e `pain`
// abreviados. Código que não casa aparece como veio.
const ALERT_ALIAS: Record<string, VitalKey> = { temperature: "temperature_c", glucose: "capillary_glucose", pain: "pain_score" };
const ALERT_CODE = /^(.+)_(high|low|severe)$/;

export function alertField(code: string): VitalKey | null {
  const m = ALERT_CODE.exec(code);
  if (!m) return null;
  const key = ALERT_ALIAS[m[1]] ?? m[1];
  return SPEC.has(key as VitalKey) ? (key as VitalKey) : null;
}

export function alertLabel(code: string): string {
  const field = alertField(code);
  if (!field) return code;
  return `${SPEC.get(field)!.label}: ${code.endsWith("_low") ? "abaixo" : "acima"} da faixa de alerta`;
}

// Prazo padrão do pedido pela cor (spec §4); vermelho não tem padrão.
export function defaultDueDays(color: ScreeningColor | null): number | null {
  if (color === "yellow") return 7;
  if (color === "green") return 15;
  if (color === "blue") return 30;
  return null;
}

// Sem sugestão (nenhum protocolo ativo ou nenhuma regra casou) não há o que mudar.
export function needsColorReason(suggested: ScreeningColor | null, final: ScreeningColor | null): boolean {
  return suggested !== null && final !== null && final !== suggested;
}

export function colorProblem(suggested: ScreeningColor | null, final: ScreeningColor | null, reason: string): string | null {
  if (final === null) return "escolha a cor final";
  if (needsColorReason(suggested, final) && reason.trim().length < REASON_MIN) {
    return `explique por que a cor final é diferente da sugerida (pelo menos ${REASON_MIN} caracteres)`;
  }
  return null;
}

export interface DestinationDraft {
  destination: ScreeningDestination | "";
  orientationNote: string;
  typeKey: string;
  priority: SchedulingPriority;
  dueDays: string;
  referralUnitId: string;
  referralNote: string;
}

export function emptyDestination(color: ScreeningColor | null): DestinationDraft {
  const due = defaultDueDays(color);
  return { destination: "", orientationNote: "", typeKey: "", priority: "routine", dueDays: due === null ? "" : String(due),
    referralUnitId: "", referralNote: "" };
}

function dueOf(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= DUE_MIN && n <= DUE_MAX ? n : null;
}

export function destinationProblem(d: DestinationDraft): string | null {
  if (d.destination === "") return "escolha o destino";
  if (d.destination === "oriented") {
    if (d.orientationNote.trim() === "") return "escreva a orientação dada";
    if (d.orientationNote.length > NOTE_MAX) return `a orientação passa de ${NOTE_MAX} caracteres`;
  }
  if (d.destination === "schedule") {
    if (d.typeKey === "") return "escolha o tipo de atendimento";
    if (dueOf(d.dueDays) === null) return `informe o prazo (${DUE_MIN} a ${DUE_MAX} dias)`;
  }
  if (d.destination === "referred" && d.referralUnitId === "" && d.referralNote.trim() === "") {
    return "informe a unidade de destino ou a descrição do encaminhamento";
  }
  return null;
}

// Só os campos do destino escolhido vão no corpo.
export function destinationPayload(d: DestinationDraft): Pick<ScreeningCompleteInput, "destination" | "orientation_note" | "schedule" | "referral"> {
  const destination = d.destination as ScreeningDestination;
  if (destination === "oriented") return { destination, orientation_note: d.orientationNote.trim() };
  if (destination === "schedule") {
    return { destination, schedule: { appointment_type_key: d.typeKey, priority: d.priority, due_in_days: dueOf(d.dueDays) as number } };
  }
  if (destination === "referred") {
    return { destination, referral: {
      ...(d.referralUnitId ? { referral_unit_id: d.referralUnitId } : {}),
      ...(d.referralNote.trim() ? { referral_note: d.referralNote.trim() } : {})
    } };
  }
  return { destination };
}

export function waitedMinutes(sinceIso: string, now: Date = new Date()): number {
  const t = new Date(sinceIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 60_000));
}

export function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

const NOTE_FIELD_LABEL: Record<string, string> = {
  complaint_note: "A queixa", orientation_note: "A orientação", color_change_reason: "A justificativa"
};

// `implausible_vital` e `note_too_long` vêm com `field` (contratos §3, §9): a frase diz qual.
export function screeningError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as { error?: string; field?: string };
    if (body.error === "implausible_vital") {
      if (body.field === "glucose_moment") return "Informe o momento da glicemia.";
      if (body.field === "vitals") return "Confira os sinais vitais.";
      const spec = body.field ? SPEC.get(body.field as VitalKey) : undefined;
      if (spec) return `${spec.label}: valor fora do plausível — confira`;
    }
    if (body.error === "note_too_long") {
      const who = body.field ? NOTE_FIELD_LABEL[body.field] : undefined;
      if (who) return `${who} passa de ${NOTE_MAX} caracteres.`;
    }
  }
  return attendanceError(err);
}
