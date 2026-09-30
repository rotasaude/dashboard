// A equipe da cidade, vista por PESSOA (spec do dashboard §5.2). A API
// devolve uma linha por membership ativa; aqui elas viram uma linha por
// usuário, com os papéis juntos.
//
// Limite conhecido: quem não tem nenhum papel ativo não aparece — a API não
// lista usuários, lista memberships. Na prática todo usuário da cidade nasce
// de um convite com papel.
import { ApiError, type MembershipRow } from "./api";
import { CAMPAIGN_MANAGER_ROLE } from "./campaigns";

export const REVIEWER_ROLE = "protocol_reviewer";
export const VERIFIER_ROLE = "citizen_verifier";
export const PROFESSIONAL_ROLE = "health_professional";
// Módulo 14 (ADR 0025): só leitura do Analytics, fora de PRIVILEGED_ROLES.
export const ANALYST_ROLE = "analyst";
export const REQUIRED_REVIEWERS = 2;

export interface TeamMember {
  userId: string;
  email: string;
  roles: string[];
  isReviewer: boolean;
  reviewerMembershipId: string | null;
  isVerifier: boolean;
  verifierMembershipId: string | null;
  isProfessional: boolean;
  professionalMembershipId: string | null;
  professionalStatus: "missing_profile" | "missing_link" | "ok" | null;
  isCampaignManager: boolean;
  campaignManagerMembershipId: string | null;
  isAnalyst: boolean;
  analystMembershipId: string | null;
}

export function teamMembers(rows: MembershipRow[]): TeamMember[] {
  const byUser = new Map<string, TeamMember>();

  for (const row of rows) {
    const current = byUser.get(row.user.id) ?? {
      userId: row.user.id, email: row.user.email_address, roles: [],
      isReviewer: false, reviewerMembershipId: null,
      isVerifier: false, verifierMembershipId: null,
      isProfessional: false, professionalMembershipId: null, professionalStatus: null, isCampaignManager: false, campaignManagerMembershipId: null, isAnalyst: false, analystMembershipId: null
    };
    current.roles = [ ...current.roles, row.role ].sort();
    if (row.role === REVIEWER_ROLE) {
      current.isReviewer = true;
      current.reviewerMembershipId = row.id;
    }
    if (row.role === VERIFIER_ROLE) {
      current.isVerifier = true;
      current.verifierMembershipId = row.id;
    }
    if (row.role === PROFESSIONAL_ROLE) {
      current.isProfessional = true;
      current.professionalMembershipId = row.id;
      current.professionalStatus = row.professional_status ?? null;
    }
    if (row.role === CAMPAIGN_MANAGER_ROLE) {
      current.isCampaignManager = true;
      current.campaignManagerMembershipId = row.id;
    }
    if (row.role === ANALYST_ROLE) {
      current.isAnalyst = true;
      current.analystMembershipId = row.id;
    }
    byUser.set(row.user.id, current);
  }

  return [ ...byUser.values() ].sort((a, b) => a.email.localeCompare(b.email));
}

export function reviewerCount(members: TeamMember[]): number {
  return members.filter((m) => m.isReviewer).length;
}

// Os 9 papéis da cidade (Membership::ROLES na API), na ordem do seletor do
// convite.
export const INVITE_ROLES: { role: string; label: string }[] = [
  { role: "viewer", label: "Leitura (viewer)" },
  { role: ANALYST_ROLE, label: "Análise" },
  { role: "protocol_author", label: "Autor de protocolo" },
  { role: "protocol_publisher", label: "Publicador de protocolo" },
  { role: "protocol_reviewer", label: "Revisor de protocolo" },
  { role: "citizen_verifier", label: "Atendente" },
  { role: "health_professional", label: "Profissional de saúde" },
  { role: CAMPAIGN_MANAGER_ROLE, label: "Gestor de campanhas" },
  { role: "municipal_admin", label: "Administrador municipal" }
];

// Membership::PRIVILEGED_ROLES: conceder OU convidar exige step-up.
const PRIVILEGED_ROLES = new Set([ "municipal_admin", REVIEWER_ROLE, VERIFIER_ROLE, PROFESSIONAL_ROLE, CAMPAIGN_MANAGER_ROLE ]);

export function isPrivilegedRole(role: string): boolean {
  return PRIVILEGED_ROLES.has(role);
}

// Só o formato grosso — quem decide se o e-mail existe é a entrega do convite.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function errorCode(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const code = (err.body as Record<string, unknown>).error;
  return typeof code === "string" ? code : null;
}

function errorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const message = (err.body as Record<string, unknown>).message;
  return typeof message === "string" && message ? message : null;
}

// Frases das recusas do convite; `null` deixa o SensitiveAction usar a padrão.
export function inviteErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  switch (errorCode(err)) {
    case "already_member": return "Essa pessoa já faz parte da equipe";
    case "already_invited": return "Já existe um convite pendente para esse e-mail";
    case "invalid": return errorMessage(err) ?? "Convite inválido — confira o e-mail e o papel";
    default: return null;
  }
}

export function deactivateErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 404) return "Usuário não encontrado";
  if (err.status !== 422) return null;
  switch (errorCode(err)) {
    case "cannot_deactivate_self": return "Você não pode desativar o próprio acesso";
    case "already_deactivated": return "Essa pessoa já estava desativada";
    default: return null;
  }
}
