// src/lib/consultationDrafts.ts
// Rascunhos de consulta abertos (fix51, rotasaude/api#51; módulo 19a, ADR 0031):
// o municipal_admin descarta o rascunho ou designa outro profissional da
// unidade. A tela nunca mostra texto clínico, nome ou CPF — só iniciais.
import { ApiError } from "./api";
import { cancelReasonProblem } from "./clinicalDocuments";

export interface OpenDraft {
  consultation_id: string;
  attendance_id: string;
  health_unit: { id: string; name: string };
  author: { user_id: string; name: string };
  author_linked: boolean;
  patient_initials: string;
  // Documentos clínicos emitidos (não cancelados) ligados ao rascunho: só o número.
  issued_documents: number;
  started_at: string;
  last_saved_at: string;
}

export interface DraftCandidate {
  user_id: string;
  name: string;
  cbo_code: string | null;
  cbo_title: string | null;
  council: string | null;
  council_state: string | null;
  registration_number: string | null;
}

// Mesma faixa do api (10 a 500 após colapsar espaços; a do cancelamento de documento).
export const draftReasonProblem = cancelReasonProblem;

export const DRAFT_GENERIC_ERROR = "não foi possível concluir — tente de novo";

const MESSAGES: Record<string, string> = {
  not_found: "rascunho não encontrado — atualize a lista",
  not_draft: "este rascunho já foi finalizado ou descartado — atualize a lista",
  invalid_reason: "o motivo precisa ter de 10 a 500 caracteres",
  invalid_professional: "este profissional não é elegível nesta unidade — atualize os candidatos",
  same_author: "este profissional já é o autor do rascunho — escolha outro",
  missing_role: "seu papel não permite esta ação",
  feature_disabled: "o prontuário está desligado nesta cidade",
  mfa_required: "a verificação em duas etapas expirou — informe um novo código"
};

export function draftAdminError(err: unknown): string {
  const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
  return (code && MESSAGES[code]) || DRAFT_GENERIC_ERROR;
}
