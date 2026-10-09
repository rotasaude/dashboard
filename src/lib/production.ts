// src/lib/production.ts
// Produção e-SUS da cidade (módulo 16; ADR 0028; spec §6.5; contratos §5.3).
// Prazo e dias úteis vêm calculados da API a partir da tabela oficial de
// prazos do SIAPS do ano (dias úteis com feriados nacionais só como fallback
// para ano sem tabela); aqui só se diz em português. `deadline_on` é data sem
// hora: formata por texto (fmtDay), nunca por new Date.
// Desde o módulo 18 (ADR 0030; api#43) a recusa chega só como códigos
// (`{ field, code }`), nunca o texto do PEC: a tela mostra os códigos como vêm.
import { ApiError, FICHAS_PER_PAGE, type LediErrorCode, type LediFicha } from "./api";
import { describeActionError } from "./actionErrors";
import { FEATURE_DISABLED_MESSAGE, featureDisabledKey } from "./features";
import { fmtDay } from "./audiencePhrase";

export const PRODUCTION_KEY = "production";

export const RESEND_STALE = "esta ficha não está mais recusada — a lista foi atualizada";
export const INVALID_COMPETENCE = "competência inválida — escolha outra da lista";

export const FICHA_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "down" }> = {
  pending: { label: "pendente", tone: "neutral" },
  sending: { label: "enviando", tone: "info" },
  accepted: { label: "aceita", tone: "ok" },
  rejected: { label: "recusada", tone: "down" },
  failed: { label: "falhou — sem novas tentativas", tone: "down" },
  correction_pending: { label: "correção pendente — não enviada", tone: "info" }
};

// Módulo 19 (spec §6): adendo depois do aceite gera a correção, que fica parada.
export const CORRECTION_PENDING_NOTE =
  "Correções de fichas já aceitas ficam guardadas e não são enviadas enquanto o reenvio depois do aceite não for confirmado com o PEC. Não contam como pendentes.";

export const ALREADY_RESOLVED = "esta ficha já foi gerada — a lista foi atualizada";
export const RESEND_GENERATION_FAILED =
  "não foi possível gerar a ficha de novo — veja \"Fichas que não puderam ser geradas\"";
export const EXPORT_UNUSABLE = "o envio da produção ao e-SUS não está utilizável agora nesta cidade";

export function errorCodeLabel(c: LediErrorCode): string {
  return c.field === "other" && c.code === "unknown" ? "erro não classificado" : `${c.field} · ${c.code}`;
}

export function errorCodesLabel(codes: LediErrorCode[] | undefined): string {
  return codes && codes.length > 0 ? codes.map(errorCodeLabel).join("; ") : "—";
}

// Fichas que não puderam ser geradas (módulo 18; spec §5): o que falta na origem.
export const GENERATION_REASON: Record<string, string> = {
  unit_without_cnes: "unidade sem CNES",
  professional_without_team: "profissional sem equipe (INE)",
  professional_without_cns: "profissional sem CNS",
  citizen_without_birth_date: "cidadão sem data de nascimento",
  citizen_without_sex: "cidadão sem sexo no cadastro",
  unknown_ciap2: "CIAP-2 fora da terminologia ativa"
};
export const SOURCE_LABEL: Record<string, string> = { Screening: "escuta inicial", Consultation: "consulta" };

export function reasonsLabel(codes: string[]): string {
  return codes.map((c) => GENERATION_REASON[c] ?? c).join(", ");
}

// Gerar de novo: resolvida = ficha nasceu; senão, diz o que ainda falta.
export function retryOutcome(f: { resolved_at: string | null; reason_codes: string[] }): string {
  return f.resolved_at
    ? "Ficha gerada: ela entra na fila de envio."
    : `Ainda não foi possível gerar: ${reasonsLabel(f.reason_codes)}. Corrija na origem e tente de novo.`;
}

export function canRetryGeneration(roles: string[]): boolean {
  return roles.includes("municipal_admin");
}

// Ficha recusada que já foi regenerada: outra linha da página aponta para ela.
export function replacedIds(fichas: LediFicha[]): Set<string> {
  return new Set(fichas.map((f) => f.replaces_outbox_id).filter((id): id is string => !!id));
}

export function canReadProduction(roles: string[]): boolean {
  return roles.includes("municipal_admin") || roles.includes("analyst");
}

// Só ficha recusada (400 do PEC) se reenvia; `failed` já esgotou as
// tentativas automáticas e não é recusa de validação.
export function canResend(roles: string[], ficha: LediFicha): boolean {
  return roles.includes("municipal_admin") && ficha.status === "rejected";
}

export function deadlinePhrase(deadlineOn: string, businessDaysLeft: number): string {
  const day = fmtDay(deadlineOn);
  if (businessDaysLeft < 0) return `prazo vencido em ${day}`;
  if (businessDaysLeft === 0) return `o prazo vence hoje (${day})`;
  const left = businessDaysLeft === 1 ? "falta 1 dia útil" : `faltam ${businessDaysLeft} dias úteis`;
  return `prazo em ${day} · ${left}`;
}

export function alertBanner(alert: string): { tone: "warn" | "down"; text: string } | null {
  if (alert === "critical") {
    return { tone: "down",
      text: "Nenhuma ficha aceita nesta competência, e o prazo está perto. Sem envio, o repasse da cidade fica em risco." };
  }
  if (alert === "attention") {
    return { tone: "warn", text: "Há fichas pendentes, recusadas ou com falha, e o prazo está perto. Confira a situação abaixo." };
  }
  return null;
}

// Pelo total da API (contratos §5.3): total múltiplo de 50 não abre página vazia.
export function hasNextPage(page: number, total: number): boolean {
  return page * FICHAS_PER_PAGE < total;
}

export function productionErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = (err.body as { error?: unknown } | null)?.error;
  return typeof code === "string" ? code : null;
}

export function productionError(err: unknown): string {
  const code = productionErrorCode(err);
  if (code === "not_rejected") return RESEND_STALE;
  if (code === "already_resolved") return ALREADY_RESOLVED;
  if (code === "generation_failed") return RESEND_GENERATION_FAILED;
  if (code === "export_unusable") return EXPORT_UNUSABLE;
  if (code === "invalid_competence") return INVALID_COMPETENCE;
  if (featureDisabledKey(err) !== null) return FEATURE_DISABLED_MESSAGE;
  const d = describeActionError(err);
  return "message" in d ? d.message : "não foi possível concluir a ação";
}
