// Regras da aba "Catálogo de triagens" (módulo 15; ADR 0027; contratos §4.1 e
// §4.2). A situação repete a regra de oferta só para mostrar; quem decide o
// catálogo de cada cidadão é o Triages::Offer no api.
import { ApiError, type ConditionTree, type TriageOffer, type TriageOfferFields } from "./api";
import { fmtDay } from "./audiencePhrase";
import { fmtNumber } from "./format";
import { SUPPRESSED_LABEL } from "./smallCount";

export const TRIAGE_CATALOG_KEY = [ "triageCatalog" ] as const;
export const CATALOG_READER_ROLES = [ "protocol_author", "protocol_reviewer", "municipal_admin" ];
export const COUNTER_HINT = "Últimos 30 dias. Contagens de 1 a 4 aparecem como “< 5”, para não identificar ninguém.";

export function canReadCatalog(roles: string[]): boolean {
  return roles.some((r) => CATALOG_READER_ROLES.includes(r));
}

export function canEditCatalog(roles: string[]): boolean {
  return roles.includes("municipal_admin");
}

export type OfferTone = "ok" | "neutral" | "warn" | "info";

export function offerState(o: TriageOffer, today: string): { label: string; tone: OfferTone } {
  if (!o.configured) {
    return o.eligibility === null
      ? { label: "oferecida (sem configuração)", tone: "ok" }
      : { label: "fora de oferta: configure", tone: "warn" };
  }
  if (!o.enabled) return { label: "pausada", tone: "neutral" };
  if (o.available_from && today < o.available_from) return { label: "agendada", tone: "info" };
  if (o.available_until && today > o.available_until) return { label: "período encerrado", tone: "warn" };
  return { label: "oferecida", tone: "ok" };
}

export function periodPhrase(from: string | null, until: string | null): string {
  if (from && until) return `de ${fmtDay(from)} a ${fmtDay(until)}`;
  if (from) return `a partir de ${fmtDay(from)}`;
  if (until) return `até ${fmtDay(until)}`;
  return "sem período";
}

// null = entre 1 e 4 (ADR 0025). Nunca 0, nunca "—".
export function fmtCounter(v: number | null): string {
  return v === null ? SUPPRESSED_LABEL : fmtNumber(v);
}

export interface OfferFormState {
  enabled: boolean;
  position: string;
  restriction: ConditionTree | null;
  from: string;
  until: string;
}

export function formFrom(o: TriageOffer, all: TriageOffer[]): OfferFormState {
  if (o.configured) {
    return {
      enabled: o.enabled ?? true, position: String(o.position ?? 1), restriction: o.restriction,
      from: o.available_from ?? "", until: o.available_until ?? ""
    };
  }
  const last = Math.max(0, ...all.map((x) => x.position ?? 0));
  return { enabled: true, position: String(last + 1), restriction: null, from: "", until: "" };
}

export function offerFormProblem(f: OfferFormState): string | null {
  if (!/^\d+$/.test(f.position.trim()) || Number(f.position) < 1) return "a ordem precisa ser um número inteiro a partir de 1";
  if (f.from && f.until && f.until < f.from) return "o fim do período não pode ser antes do início";
  return null;
}

export function offerPayload(f: OfferFormState): TriageOfferFields {
  return {
    enabled: f.enabled, position: Number(f.position.trim()), restriction: f.restriction,
    available_from: f.from || null, available_until: f.until || null
  };
}

const MESSAGES: Record<string, string> = {
  invalid_restriction: "a restrição usa um campo que o catálogo não aceita ou está malformada",
  invalid_period: "o fim do período não pode ser antes do início",
  invalid_position: "a ordem precisa ser um número inteiro a partir de 1",
  invalid_enabled: "o campo “oferecer no catálogo” precisa ser sim ou não",
  unknown_protocol: "este protocolo não existe mais nesta cidade — recarregue a lista"
};

// Para o translateError do SensitiveAction: as recusas do PUT não trazem
// `message`, e sem isto a tela diria só "a API recusou a ação".
export function triageCatalogError(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const code = (err.body as { error?: unknown }).error;
  return typeof code === "string" ? MESSAGES[code] ?? null : null;
}
