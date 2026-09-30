// Regras puras do Analytics (módulo 14; ADR 0025; contratos mod14 §0–§1).
// Sem React: texto de célula e taxa, carimbo "dados até", intervalos, opções
// dos recortes e tradução das recusas. A supressão é da API; aqui nada é
// somado nem derivado — oculto e sem dado nunca viram zero.
import {
  ApiError, type AnalyticsFront, type AnalyticsQuery, type AuthorProtocolRow, type CalibrationOutcome, type Cell,
  type Granularity, type Rate
} from "./api";
import { HIDDEN_LABEL, isSuppressed } from "./smallCount";
import { fmtNumber } from "./format";
import { addDays, todayInCity } from "./campaigns";

// ─── Textos (spec §8, literais) ─────────────────────────────────────────────
export { HIDDEN_LABEL };
export const NO_DATA_LABEL = "sem dado";
export const HIDDEN_HINT =
  `Contagens de 1 a 4, e taxas calculadas sobre elas, aparecem como "oculto" para não identificar ninguém.`;
export const NO_DATA_HINT = "Nada no denominador neste período: não há taxa a mostrar.";
export const STALE_LABEL = "dados desatualizados";
export const EMPTY_TITLE = "ainda sem dados consolidados";
export const EMPTY_SUB = "a consolidação roda toda madrugada e cobre até o dia anterior";
export const EPI_EMPTY_TITLE = "nenhuma pergunta marcada para Analytics";
export const EPI_HOWTO =
  `Para uma pergunta aparecer aqui, abra o protocolo no Editor de protocolo, marque "Usar em Analytics" ` +
  "numa pergunta de sim/não ou de lista, salve o rascunho e leve a nova versão pelo ciclo de assinaturas " +
  "até a ativação. Só entram as triagens concluídas com essa versão.";
export const FORBIDDEN_TEXT =
  "O Analytics é do papel Análise e do administrador municipal. Peça o acesso a quem administra a equipe.";

// ─── Cache ──────────────────────────────────────────────────────────────────
export const ANALYTICS_PROTOCOLS_KEY = [ "analyticsProtocols" ] as const;

// Recorte nulo e ausente são o mesmo pedido: a chave os iguala, e trocar de
// "Todas" para uma unidade e de volta reaproveita o cache.
export function analyticsKey(front: AnalyticsFront, query: AnalyticsQuery) {
  const compact: Record<string, unknown> = Object.fromEntries(
    Object.entries(query).filter(([ , v ]) => v !== null && v !== undefined && v !== ""));
  return [ "analytics", front, compact ] as const;
}

// ─── Célula e taxa ──────────────────────────────────────────────────────────
const rateFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function fmtCell(value: Cell | undefined): string {
  if (isSuppressed(value)) return HIDDEN_LABEL;
  return typeof value === "number" ? fmtNumber(value) : "—";
}

export function fmtRate(value: Rate | undefined): string {
  if (value === null) return NO_DATA_LABEL;
  if (isSuppressed(value)) return HIDDEN_LABEL;
  return typeof value === "number" ? `${rateFmt.format(value)}%` : "—";
}

// Ponto oculto ou sem dado vira lacuna: desenhar 0 seria afirmar um número.
export function plotValue(value: Cell | Rate | undefined): number | null {
  return typeof value === "number" ? value : null;
}

// ─── Carimbo e períodos ─────────────────────────────────────────────────────
// A consolidação que termina no dia D (fuso da cidade) cobre até D-1 (spec §4.1).
export function dataUntil(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return null;
  const day = addDays(todayInCity(at), -1);
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

// Início de período ISO → rótulo. Lido como texto: `new Date("2026-09-28")`
// seria meia-noite UTC e voltaria um dia em São Paulo.
export function fmtPeriod(start: string, granularity: Granularity): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return start;
  return granularity === "month" ? `${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`;
}

export interface AnalyticsRange { granularity: Granularity; count: number }

// Limites da API: 104 semanas, 60 meses (contratos §1).
export const RANGE_OPTIONS: Record<Granularity, number[]> = { week: [ 12, 26, 52, 104 ], month: [ 6, 12, 24, 60 ] };
export const DEFAULT_RANGE: AnalyticsRange = { granularity: "week", count: 12 };
export const GRANULARITY_LABEL: Record<Granularity, string> = { week: "Semana", month: "Mês" };

export function rangeLabel(granularity: Granularity, count: number): string {
  return granularity === "week" ? `últimas ${count} semanas` : `últimos ${count} meses`;
}

export function withGranularity(range: AnalyticsRange, granularity: Granularity): AnalyticsRange {
  const options = RANGE_OPTIONS[granularity];
  return { granularity, count: options.includes(range.count) ? range.count : options[0] };
}

export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(date, -((weekday + 6) % 7));
}

// Termina ontem (o dia corrente nunca é consolidado) e começa no início do
// primeiro período, para a API contar exatamente `count` períodos.
export function rangeDates(range: AnalyticsRange, today: string = todayInCity()): { from: string; to: string } {
  const to = addDays(today, -1);
  if (range.granularity === "week") {
    return { from: addDays(mondayOf(to), -7 * (range.count - 1)), to };
  }
  const [ year, month ] = to.split("-").map(Number);
  const index = year * 12 + (month - 1) - (range.count - 1);
  const from = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
  return { from, to };
}

// ─── Opções dos recortes ────────────────────────────────────────────────────
export interface ProtocolOption { name: string; versions: number[] }

// GET /admin/api/protocols manda `version` como string; rascunho nunca teve triagem.
export function protocolOptions(rows: AuthorProtocolRow[]): ProtocolOption[] {
  const byName = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.status === "draft") continue;
    const version = Number(row.version);
    if (!Number.isInteger(version)) continue;
    byName.set(row.name, (byName.get(row.name) ?? new Set<number>()).add(version));
  }
  return [ ...byName.entries() ]
    .map(([ name, versions ]) => ({ name, versions: [ ...versions ].sort((a, b) => b - a) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ─── Rótulos ────────────────────────────────────────────────────────────────
export const KIND_LABEL: Record<string, string> = { return: "Retorno", referral: "Encaminhamento" };
export const CLOSED_REASON_LABEL: Record<string, string> = {
  fulfilled: "Atendido", citizen_cancelled: "Cancelado pelo cidadão", dismissed: "Dispensado"
};
export const WAIT_BUCKET_LABEL: Record<string, string> = {
  "0-15": "até 15 min", "15-30": "15 a 30 min", "30-60": "30 a 60 min", "60-120": "1 a 2 h", "120+": "mais de 2 h"
};
export const APPOINTMENT_LABEL: Record<string, string> = {
  checked_in: "Compareceu", no_show: "Faltou", expired: "Expirou", cancelled_by_citizen: "Cancelado pelo cidadão"
};
export const OUTCOME_LABEL: Record<CalibrationOutcome, string> = {
  discharged: "Atendido e liberado", referred: "Encaminhado", return: "Retorno", left: "Saiu sem atendimento",
  none: "Sem atendimento encerrado"
};
export const CALIBRATION_OUTCOMES: CalibrationOutcome[] = [ "discharged", "referred", "return", "left", "none" ];

// Valor novo da API sem rótulo ainda aparece cru, em vez de sumir.
export function labelOr(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

// ─── Recusas ────────────────────────────────────────────────────────────────
const GENERIC = "não foi possível carregar — tente de novo";
const REFUSAL_TEXT: Record<string, string> = {
  invalid_range: "Período inválido — escolha outro intervalo.",
  invalid_neighborhood: "Esse bairro não existe nesta cidade — escolha outro.",
  invalid_unit: "Essa unidade não existe nesta cidade — escolha outra.",
  invalid_protocol: "Protocolo ou versão não encontrado — escolha outro."
};

export function analyticsError(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  if (err.status === 403) return FORBIDDEN_TEXT;
  if (err.status === 401) return "sessão expirada — entre de novo";
  const code = err.body && typeof err.body === "object" ? (err.body as { error?: unknown }).error : undefined;
  if (err.status === 422 && typeof code === "string" && REFUSAL_TEXT[code]) return REFUSAL_TEXT[code];
  return GENERIC;
}
