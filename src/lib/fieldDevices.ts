// Aparelhos de campo (módulo 24c, contrato §3.6; Q16, Q17): situação,
// substituição e o aviso do que se perde ao revogar. Regras puras; quem
// decide o estado é o api.
import type { FieldDevice } from "./api";
import { fmtDateTime } from "./format";
import { revokedReasonLabel } from "./homeVisits";

// Revogação automática (o vínculo acabou ou o usuário foi desativado): o
// tablet guarda a fila, e um aparelho novo lido no MESMO tablet a envia.
export const AUTO_REVOKED_REASONS = [ "membership_ended", "user_disabled" ] as const;

export function isAutoRevoked(d: FieldDevice): boolean {
  return d.status === "revoked" && (AUTO_REVOKED_REASONS as readonly string[]).includes(d.revoked_reason ?? "");
}

// O api só substitui aparelho ativo (Q16): suspenso e revogado, não.
export function canReplace(d: FieldDevice): boolean {
  return d.status === "active";
}

// `perspective`: "owner" é a tela de quem tem o aparelho ("por você",
// "cadastre de novo"); "admin" é a lista da cidade, onde quem olha não é o
// dono nem pode cadastrar por ele — vê o motivo.
const ADMIN_REVOKED: Record<string, string> = { user: "pela pessoa", admin: "pela administração" };
export function deviceStatusLabel(d: FieldDevice, perspective: "owner" | "admin" = "owner"): string {
  if (d.status === "active") return "ativo";
  if (d.status === "inactive") return "suspenso enquanto sem vínculo";
  if (d.status !== "revoked") return d.status;
  if (!d.revoked_reason) return "revogado";
  if (perspective === "owner" && isAutoRevoked(d)) return "revogado automaticamente: cadastre de novo";
  const admin = perspective === "admin" && Object.prototype.hasOwnProperty.call(ADMIN_REVOKED, d.revoked_reason) ? ADMIN_REVOKED[d.revoked_reason] : null;
  return `revogado: ${admin ?? revokedReasonLabel(d.revoked_reason)}`;
}

// Revogação manual apaga o que o tablet ainda não enviou (decisão 6A do módulo).
export function revokeLossWarning(lastUsedAt: string | null): string {
  return `O que não foi sincronizado neste aparelho será perdido. Último uso: ${lastUsedAt ? fmtDateTime(lastUsedAt) : "nunca usado"}.`;
}

export const REPLACE_NOTICE =
  "O aparelho antigo para de sincronizar agora e guarda o que não foi enviado. Leia o QR novo no tablet: no mesmo tablet, o app envia o que ficou guardado.";
export const REREGISTER_NOTICE =
  "Este aparelho foi revogado automaticamente. Cadastre um aparelho novo e leia o QR no mesmo tablet: o app envia o que não foi enviado.";
