// src/lib/clinicalRecord.ts
// Abertura justificada do prontuário (módulo 19; spec §5; ADR 0031): fora do
// atendimento, a leitura pede CPF, motivo de lista (nota ≥ 10 em "Outro
// motivo") e step-up, vale 30 minutos para aquele paciente e usuário e fica no
// relatório. O CPF e a nota vão no corpo do POST.
import { ApiError, type OpeningInput, type OpeningReason } from "./api";
import { isValidCpf } from "./attendance";
import { consultationError } from "./consultation";

export const OPENING_REASONS: { value: OpeningReason; label: string }[] = [
  { value: "case_review", label: "Revisão de caso" },
  { value: "active_search", label: "Busca ativa" },
  { value: "continuity_of_care", label: "Continuidade do cuidado" },
  { value: "other", label: "Outro motivo" }
];
export const OPENING_NOTE_MIN = 10;
export const OPENING_ENDED = "A abertura de 30 minutos terminou. Para continuar, abra de novo com o motivo.";

export function reasonLabel(code: string | null): string {
  if (!code) return "—";
  return OPENING_REASONS.find((r) => r.value === code)?.label ?? code;
}

export interface OpeningDraft { cpf: string; reason: OpeningReason | ""; note: string }
export const EMPTY_OPENING: OpeningDraft = { cpf: "", reason: "", note: "" };

export function openingProblem(d: OpeningDraft): string | null {
  if (!isValidCpf(d.cpf)) return "CPF inválido";
  if (d.reason === "") return "escolha o motivo";
  if (d.reason === "other" && d.note.trim().length < OPENING_NOTE_MIN) {
    return `em 'Outro motivo', descreva com pelo menos ${OPENING_NOTE_MIN} caracteres`;
  }
  return null;
}

// Só chamado depois de openingProblem === null (o motivo já foi escolhido).
export function openingBody(d: OpeningDraft): OpeningInput {
  const note = d.note.trim();
  return { cpf: d.cpf, reason_code: d.reason as OpeningReason, ...(note ? { reason_note: note } : {}) };
}

export const OPENING_VALID_MS = 30 * 60_000;

// Prazo local da abertura: o relógio do servidor pode diferir do daqui, então
// vale o menor entre `expires_at` e (recebida + 30 min no relógio local).
export function deadlineMs(expiresAt: string, receivedAtMs: number): number {
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? 0 : Math.min(t, receivedAtMs + OPENING_VALID_MS);
}

export function remainingMs(expiresAt: string, nowMs: number): number {
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? 0 : Math.max(0, t - nowMs);
}

export function countdownLabel(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function clinicalRecordError(err: unknown): string {
  const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
  if (code === "patient_not_found") return "nenhum prontuário para este CPF — o prontuário nasce na primeira consulta de um cadastro validado";
  if (code === "invalid_reason") return `escolha o motivo; em 'Outro motivo', descreva com pelo menos ${OPENING_NOTE_MIN} caracteres`;
  return consultationError(err);
}
