import { describe, expect, it } from "vitest";
import { navGroupsFor, withExamPendingCount, NAV_GROUPS } from "./modules";

const ON = { features: [ "exam_tracking" ] };
const userWith = (roles: string[], extra: object = ON) => ({ operator: false, memberships: roles.map((role) => ({ role })), ...extra });
const ids = (user: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(user).flatMap((g) => g.items.map((i) => i.id));
const EXAM_IDS = [ "exam-acknowledgements", "exams-unit", "exams-overdue", "exam-regulation", "exam-report", "exams-admin", "exam-provider" ];
const examIds = (user: Parameters<typeof navGroupsFor>[0]) => ids(user).filter((id) => EXAM_IDS.includes(id));

describe("grupo Exames (módulo 21a)", () => {
  it("sem exam_tracking, nenhum item de Exames para ninguém", () => {
    for (const role of [ "municipal_admin", "health_professional", "citizen_verifier", "exam_regulator" ]) {
      expect(examIds(userWith([ role ], {}))).toEqual([]);
    }
    expect(navGroupsFor(userWith([ "municipal_admin" ], {})).some((g) => g.label === "Exames")).toBe(false);
  });

  it("cada papel vê o seu", () => {
    expect(examIds(userWith([ "health_professional" ]))).toEqual([ "exam-acknowledgements", "exams-unit" ]);
    expect(examIds(userWith([ "citizen_verifier" ]))).toEqual([ "exams-unit" ]);
    expect(examIds(userWith([ "exam_regulator" ]))).toEqual([ "exams-overdue", "exam-regulation", "exam-report" ]);
    // C4: o administrador não é equipe de unidade — sem "Exames da unidade".
    expect(examIds(userWith([ "municipal_admin" ]))).toEqual([ "exams-overdue", "exam-regulation", "exam-report", "exams-admin" ]);
    expect(examIds({ operator: true, memberships: [], ...ON })).toEqual([]);
  });

  it("o prestador vê só o portal e a Segurança", () => {
    const provider = userWith([ "exam_provider" ]);
    expect(navGroupsFor(provider).map((g) => g.label)).toEqual([ "Exames", "Conta" ]);
    expect(ids(provider)).toEqual([ "exam-provider", "security" ]);
  });

  it("prestador com o rastreamento desligado vê só a Segurança", () => {
    expect(ids(userWith([ "exam_provider" ], {}))).toEqual([ "security" ]);
  });

  it("contador de ciência no rótulo; mais páginas vira N+", () => {
    const item = (n: number, more = false) => withExamPendingCount(NAV_GROUPS, n, more).flatMap((g) => g.items).find((i) => i.id === "exam-acknowledgements");
    expect(item(0)?.label).toBe("Resultados aguardando ciência");
    expect(item(4)?.label).toBe("Resultados aguardando ciência (4)");
    expect(item(50, true)?.label).toBe("Resultados aguardando ciência (50+)");
  });
});
