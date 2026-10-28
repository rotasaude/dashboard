import { describe, expect, it } from "vitest";
import {
  INVITE_ROLES, REQUIRED_REVIEWERS, deactivateErrorMessage, inviteErrorMessage, isPrivilegedRole, isValidEmail,
  reviewerCount, teamMembers
} from "./team";
import { ApiError } from "./api";
import type { MembershipRow } from "./api";

function row(email: string, role: string, id = `${email}-${role}`): MembershipRow {
  return { id, user: { id: `u-${email}`, email_address: email }, role, granted_at: "2026-09-01T00:00:00Z" };
}

describe("teamMembers", () => {
  it("agrupa as memberships por usuário, com os papéis em ordem", () => {
    const members = teamMembers([
      row("bia@cidade.gov.br", "protocol_reviewer"),
      row("ana@cidade.gov.br", "protocol_publisher"),
      row("ana@cidade.gov.br", "municipal_admin")
    ]);

    expect(members.map((m) => m.email)).toEqual([ "ana@cidade.gov.br", "bia@cidade.gov.br" ]);
    expect(members[0].roles).toEqual([ "municipal_admin", "protocol_publisher" ]);
    expect(members[0].isReviewer).toBe(false);
    expect(members[0].reviewerMembershipId).toBeNull();
  });

  it("marca quem é revisor e guarda o id da membership de revisor (para revogar)", () => {
    const members = teamMembers([ row("bia@cidade.gov.br", "protocol_reviewer", "m-9") ]);

    expect(members[0].isReviewer).toBe(true);
    expect(members[0].reviewerMembershipId).toBe("m-9");
  });

  it("lista vazia vira equipe vazia", () => {
    expect(teamMembers([])).toEqual([]);
  });
});

describe("reviewerCount", () => {
  it("conta pessoas, não memberships", () => {
    const members = teamMembers([
      row("ana@cidade.gov.br", "protocol_reviewer"),
      row("ana@cidade.gov.br", "protocol_publisher"),
      row("bia@cidade.gov.br", "protocol_reviewer")
    ]);

    expect(reviewerCount(members)).toBe(2);
    expect(REQUIRED_REVIEWERS).toBe(2);
  });

  it("zero quando ninguém é revisor", () => {
    expect(reviewerCount(teamMembers([ row("ana@cidade.gov.br", "viewer") ]))).toBe(0);
  });
});

const apiError = (status: number, body: unknown) => new ApiError(status, body, String(status));

describe("convite", () => {
  it("oferece os 15 papéis da cidade que se convidam pela Equipe", () => {
    expect(INVITE_ROLES.map((r) => r.role).sort()).toEqual([
      "analyst", "billing_clerk", "campaign_manager", "care_regulator", "citizen_verifier", "exam_regulator", "health_professional", "lab_releaser", "lab_staff",
      "municipal_admin", "protocol_author", "protocol_publisher", "protocol_reviewer", "surveillance", "viewer"
    ]);
    expect(INVITE_ROLES.find((r) => r.role === "exam_regulator")?.label).toBe("Regulador de exames");
    expect(isPrivilegedRole("exam_regulator")).toBe(true);
    expect(INVITE_ROLES.find((r) => r.role === "lab_staff")?.label).toBe("Equipe do laboratório");
    expect(INVITE_ROLES.find((r) => r.role === "lab_releaser")?.label).toBe("Liberador de laudos");
    expect(isPrivilegedRole("lab_staff")).toBe(true);
    expect(isPrivilegedRole("lab_releaser")).toBe(true);
    // Módulo 22: o faturista baixa arquivo com dado de paciente — privilegiado (step-up no convite).
    expect(INVITE_ROLES.find((r) => r.role === "billing_clerk")?.label).toBe("Faturista");
    expect(isPrivilegedRole("billing_clerk")).toBe(true);
    // Módulo 25 (ADR 0043): a fila nominal da vigilância — privilegiado (step-up no convite).
    expect(INVITE_ROLES.find((r) => r.role === "surveillance")?.label).toBe("Vigilância epidemiológica");
    expect(isPrivilegedRole("surveillance")).toBe(true);
    // Módulo 26a: o regulador decide sobre pedido nominal — privilegiado (step-up no convite).
    expect(INVITE_ROLES.find((r) => r.role === "care_regulator")?.label).toBe("Regulador de encaminhamentos");
    expect(isPrivilegedRole("care_regulator")).toBe(true);
    // O exam_provider só entra pelo cadastro do prestador.
    expect(INVITE_ROLES.some((r) => r.role === "exam_provider")).toBe(false);
    expect(INVITE_ROLES.find((r) => r.role === "campaign_manager")?.label).toBe("Gestor de campanhas");
    expect(INVITE_ROLES.find((r) => r.role === "analyst")?.label).toBe("Análise");
  });

  it("papéis privilegiados são os mesmos que a API protege com step-up", () => {
    for (const role of [ "municipal_admin", "protocol_reviewer", "citizen_verifier", "health_professional", "campaign_manager" ]) {
      expect(isPrivilegedRole(role)).toBe(true);
    }
    for (const role of [ "viewer", "protocol_author", "protocol_publisher", "analyst" ]) {
      expect(isPrivilegedRole(role)).toBe(false);
    }
  });

  it("valida o formato do e-mail", () => {
    expect(isValidEmail("ana@cidade.gov.br")).toBe(true);
    expect(isValidEmail("  ana@cidade.gov.br ")).toBe(true);
    expect(isValidEmail("ana")).toBe(false);
    expect(isValidEmail("ana@cidade")).toBe(false);
    expect(isValidEmail("a na@cidade.gov.br")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("traduz as recusas do convite", () => {
    expect(inviteErrorMessage(apiError(422, { error: "already_member" }))).toBe("Essa pessoa já faz parte da equipe");
    expect(inviteErrorMessage(apiError(422, { error: "already_invited" }))).toBe("Já existe um convite pendente para esse e-mail");
    expect(inviteErrorMessage(apiError(422, { error: "invalid", message: "papel desconhecido" }))).toBe("papel desconhecido");
    expect(inviteErrorMessage(apiError(422, { error: "invalid" }))).toBe("Convite inválido — confira o e-mail e o papel");
    expect(inviteErrorMessage(apiError(500, ""))).toBeNull();
  });
});

describe("professionalStatus", () => {
  it("professionalStatus vem da linha de health_professional", () => {
    const rows = [
      { id: "1", user: { id: "u1", email_address: "a@c" }, role: "health_professional", granted_at: "x", professional_status: "missing_link" as const },
      { id: "2", user: { id: "u2", email_address: "b@c" }, role: "viewer", granted_at: "x" }
    ];
    const [ a, b ] = teamMembers(rows);
    expect(a.professionalStatus).toBe("missing_link");
    expect(b.professionalStatus).toBeNull();
  });
});

describe("desativação", () => {
  it("traduz as recusas da desativação", () => {
    expect(deactivateErrorMessage(apiError(422, { error: "cannot_deactivate_self" }))).toBe("Você não pode desativar o próprio acesso");
    expect(deactivateErrorMessage(apiError(422, { error: "already_deactivated" }))).toBe("Essa pessoa já estava desativada");
    expect(deactivateErrorMessage(apiError(404, ""))).toBe("Usuário não encontrado");
    expect(deactivateErrorMessage(apiError(500, ""))).toBeNull();
    expect(deactivateErrorMessage(new Error("rede"))).toBeNull();
  });
});

describe("gestor de campanhas", () => {
  it("teamMembers marca o papel e guarda o id da membership", () => {
    const [ ana ] = teamMembers([
      { id: "m-1", user: { id: "u1", email_address: "ana@cidade.gov.br" }, role: "viewer", granted_at: "x" },
      { id: "m-2", user: { id: "u1", email_address: "ana@cidade.gov.br" }, role: "campaign_manager", granted_at: "x" }
    ]);
    expect(ana.isCampaignManager).toBe(true);
    expect(ana.campaignManagerMembershipId).toBe("m-2");
  });
});

describe("analista", () => {
  it("teamMembers marca o papel e guarda o id da membership", () => {
    const [ ana ] = teamMembers([ row("ana@cidade.gov.br", "viewer"), row("ana@cidade.gov.br", "analyst", "m-an") ]);
    expect(ana.isAnalyst).toBe(true);
    expect(ana.analystMembershipId).toBe("m-an");
  });
});
