import { describe, expect, it } from "vitest";
import { REQUIRED_REVIEWERS, reviewerCount, teamMembers } from "./team";
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
