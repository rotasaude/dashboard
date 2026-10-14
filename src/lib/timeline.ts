// src/lib/timeline.ts
// Linha do tempo do paciente no painel da cidade (módulo 20, F-20.3; ADR 0035;
// contrato §2–§3). Quem lê, o que entra na pessoa, a ordem e o que é parcial
// são do api: aqui só se monta o pedido, se juntam as páginas e se escolhe a
// tela existente que mostra cada entrada.
import {
  ApiError, errorCode, type TimelineEntry, type TimelineFilters, type TimelineKind, type TimelinePage, type TimelineSubject
} from "./api";
import { OPENING_ENDED } from "./clinicalRecord";
import { featureDisabledKey } from "./features";
import { fmtDateTime } from "./format";

export const TIMELINE_KEY = "patientTimeline";

export const TIMELINE_KINDS: { key: TimelineKind; label: string }[] = [
  { key: "triage", label: "Triagem" },
  { key: "attendance", label: "Atendimento" },
  { key: "screening", label: "Escuta" },
  { key: "appointment", label: "Agendamento" },
  { key: "consultation", label: "Consulta" },
  { key: "clinical_document", label: "Documento" },
  { key: "controlled_notification", label: "Notificação de receita" },
  { key: "campaign", label: "Campanha" },
  { key: "exam", label: "Exame" }
];

// O tipo Exame só existe com o rastreamento de exames ligado (módulo 21a).
export function timelineKinds(examTracking: boolean): typeof TIMELINE_KINDS {
  return examTracking ? TIMELINE_KINDS : TIMELINE_KINDS.filter((k) => k.key !== "exam");
}

export const ALL_FILTERS: TimelineFilters = { kinds: [], from: "", to: "" };
export const PARTIAL_NOTICE =
  "Histórico parcial: aqui está só o que passou pelo Rota Saúde. As consultas desta cidade são registradas no PEC.";
export const TIMELINE_EMPTY = "nenhum registro neste período";
export const TIMELINE_DISABLED = "a linha do tempo está desligada nesta cidade";

export function timelineKindLabel(kind: string): string {
  return TIMELINE_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export function subjectKey(subject: TimelineSubject): string {
  if ("attendanceId" in subject) return `attendance:${subject.attendanceId}`;
  if ("patientId" in subject) return `patient:${subject.patientId}`;
  return `opening:${subject.openingId}`;
}

export interface FilterDraft { kinds: TimelineKind[]; from: string; to: string }
export const EMPTY_DRAFT: FilterDraft = { kinds: TIMELINE_KINDS.map((k) => k.key), from: "", to: "" };

export function toggleKind(d: FilterDraft, kind: TimelineKind): FilterDraft {
  return { ...d, kinds: d.kinds.includes(kind) ? d.kinds.filter((k) => k !== kind) : [ ...d.kinds, kind ] };
}

export function filterProblem(d: FilterDraft, kinds = TIMELINE_KINDS): string | null {
  if (!kinds.some((k) => d.kinds.includes(k.key))) return "marque ao menos um tipo de registro";
  if (d.from && d.to && d.from > d.to) return "o início do período é depois do fim";
  return null;
}

// Todos marcados = sem kinds[] (o api devolve tudo, inclusive tipo novo).
// `kinds` são os tipos que a tela mostra: sem o rastreamento de exames, o
// Exame não aparece nem vai no pedido.
export function filtersFrom(d: FilterDraft, kinds = TIMELINE_KINDS): TimelineFilters {
  const all = kinds.every((k) => d.kinds.includes(k.key));
  return {
    kinds: all ? [] : kinds.map((k) => k.key).filter((k) => d.kinds.includes(k)),
    from: d.from, to: d.to
  };
}

// O cursor composto não repete, mas uma entrada que muda entre duas leituras
// (ex.: documento cancelado) não pode aparecer duas vezes: vale a primeira.
export function mergePages(pages: TimelinePage[]): TimelineEntry[] {
  const seen = new Set<string>();
  const out: TimelineEntry[] = [];
  for (const p of pages) {
    for (const e of p.entries) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

export type DetailType = "consultation" | "clinical_document" | "screening" | "appointment_request" | "exam_order";
export interface DetailTarget { type: DetailType; id: string }
const OPENABLE: ReadonlySet<string> = new Set<DetailType>([ "consultation", "clinical_document", "screening", "appointment_request", "exam_order" ]);

// Pela abertura justificada (fora de contexto) só a consulta abre: as rotas de
// documento, escuta e pedido não aceitam a abertura (contrato §9). O pedido de
// agendamento (GET /attendance/requests/:id) exige citizen_verifier: sem o
// papel, a entrada fica só com o resumo.
export function detailTarget(entry: TimelineEntry, inContext: boolean, canOpenRequests = false): DetailTarget | null {
  const ref = entry.detail_ref;
  if (!ref || !OPENABLE.has(ref.type) || !ref.id) return null;
  if (!inContext && ref.type !== "consultation") return null;
  if (ref.type === "appointment_request" && !canOpenRequests) return null;
  return { type: ref.type as DetailType, id: ref.id };
}

export function entryWhen(entry: TimelineEntry): string {
  return fmtDateTime(entry.occurred_at);
}

// Unidade e pessoa separadas, para a tela pôr em duas linhas sem cortar
// (AT-15). Conta sem nome cadastrado chega com o e-mail: não se mostra.
export function entryWhere(entry: TimelineEntry): { unit: string | null; person: string | null } {
  const name = entry.professional?.name ?? null;
  return { unit: entry.unit?.name ?? null, person: name && name.includes("@") ? "pessoa sem nome cadastrado" : name };
}

export function openLabel(entry: TimelineEntry): string {
  return `Abrir ${timelineKindLabel(entry.kind).toLowerCase()} de ${entryWhen(entry)}`;
}

// Códigos de situação das origens (triagem, atendimento, escuta, agendamento,
// consulta, documento, campanha). Código novo do api aparece cru.
const STATUS_LABEL: Record<string, string> = {
  in_progress: "em andamento",
  completed: "concluído",
  abandoned: "abandonado",
  aborted_by_revocation: "consentimento revogado",
  aborted_by_timeout: "interrompido por tempo",
  aborted_by_cancellation: "cancelado",
  waiting: "aguardando",
  in_care: "em atendimento",
  closed: "encerrado",
  scheduled: "marcado",
  confirmed: "confirmado",
  checked_in: "compareceu",
  cancelled_by_citizen: "cancelado pelo cidadão",
  expired: "não confirmado no prazo",
  no_show: "faltou",
  draft: "rascunho",
  finalized: "finalizada",
  issued: "emitido",
  cancelled: "cancelado",
  read: "aviso lido",
  unread: "aviso não lido",
  // Módulo 21a (contrato §1): situação do exame (scheduled e cancelled já estão acima);
  // external = resultado externo registrado por qualquer unidade (A38).
  awaiting_authorization: "aguardando autorização",
  denied: "negado",
  awaiting_schedule: "a agendar",
  collected: "coletado",
  resulted: "resultado registrado",
  acknowledged: "ciência dada",
  external: "resultado externo"
};

export function statusLabel(status: string | null, apiLabel?: string | null): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? apiLabel ?? status;
}

export function endsOpening(err: unknown, endOnOutOfContext: boolean): boolean {
  const code = errorCode(err);
  return code === "opening_required" || (endOnOutOfContext && code === "out_of_context");
}

const ERRORS: Record<string, string> = {
  out_of_context: "esta pessoa não está em atendimento com você — para ler, use a abertura justificada em Prontuário",
  opening_required: OPENING_ENDED,
  missing_role: "seu papel não permite ler a linha do tempo",
  invalid_cursor: "a lista mudou desde a última página — use Atualizar",
  invalid_period: "período inválido — confira as datas",
  not_found: "pessoa não encontrada — atualize a fila",
  invalid_kinds: "tipo de registro inválido — use Limpar filtros",
  citizen_not_verified: "esta pessoa ainda não validou o cadastro na unidade — a linha do tempo só existe para cadastro validado"
};

// Pela abertura justificada não há fila: not_found ganha uma frase neutra.
const NOT_FOUND_BY_OPENING = "não há dados desta pessoa para mostrar";

export function timelineError(err: unknown, opts: { opening?: boolean } = {}): string {
  if (featureDisabledKey(err) !== null) return TIMELINE_DISABLED;
  const code = errorCode(err);
  if (code === "not_found" && opts.opening) return NOT_FOUND_BY_OPENING;
  if (code && ERRORS[code]) return ERRORS[code];
  if (err instanceof ApiError) return `não foi possível ler a linha do tempo (${err.status}) — tente de novo`;
  return "sem conexão com o servidor — tente de novo";
}
