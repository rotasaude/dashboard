// src/lib/production.ts
// Produção e-SUS da cidade (módulo 16; ADR 0028; spec §6.5; contratos §5.3).
// Prazo e dias úteis vêm calculados da API a partir da tabela oficial de
// prazos do SIAPS do ano (dias úteis com feriados nacionais só como fallback
// para ano sem tabela); aqui só se diz em português. `deadline_on` é data sem
// hora: formata por texto (fmtDay), nunca por new Date.
// Mensagens de recusa (`rejections[].message`, `last_error`) já chegam
// mascaradas da API e são mostradas como vieram.
import { ApiError, FICHAS_PER_PAGE, type LediFicha } from "./api";
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
  failed: { label: "falhou — sem novas tentativas", tone: "down" }
};

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
    return { tone: "warn", text: "Há fichas pendentes ou recusadas, e o prazo está perto. Confira as recusas abaixo." };
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
  if (code === "invalid_competence") return INVALID_COMPETENCE;
  if (featureDisabledKey(err) !== null) return FEATURE_DISABLED_MESSAGE;
  const d = describeActionError(err);
  return "message" in d ? d.message : "não foi possível concluir a ação";
}
