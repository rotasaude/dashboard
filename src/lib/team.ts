// A equipe da cidade, vista por PESSOA (spec do dashboard §5.2). A API
// devolve uma linha por membership ativa; aqui elas viram uma linha por
// usuário, com os papéis juntos.
//
// Limite conhecido: quem não tem nenhum papel ativo não aparece — a API não
// lista usuários, lista memberships. Na prática todo usuário da cidade nasce
// de um convite com papel.
import type { MembershipRow } from "./api";

export const REVIEWER_ROLE = "protocol_reviewer";
export const VERIFIER_ROLE = "citizen_verifier";
export const PROFESSIONAL_ROLE = "health_professional";
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
}

export function teamMembers(rows: MembershipRow[]): TeamMember[] {
  const byUser = new Map<string, TeamMember>();

  for (const row of rows) {
    const current = byUser.get(row.user.id) ?? {
      userId: row.user.id, email: row.user.email_address, roles: [],
      isReviewer: false, reviewerMembershipId: null,
      isVerifier: false, verifierMembershipId: null,
      isProfessional: false, professionalMembershipId: null
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
    }
    byUser.set(row.user.id, current);
  }

  return [ ...byUser.values() ].sort((a, b) => a.email.localeCompare(b.email));
}

export function reviewerCount(members: TeamMember[]): number {
  return members.filter((m) => m.isReviewer).length;
}
