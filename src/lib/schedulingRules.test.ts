// src/lib/schedulingRules.test.ts
import { describe, expect, it } from "vitest";
import { moveRule, parseDueDays, readScheduling, schedulingRuleProblem, writeScheduling, type SchedulingRuleDraft } from "./schedulingRules";
import { TYPES } from "../test/schedulingFixtures";

const WHEN = { gte: [ "profile.age", 60 ] };
const RULE: SchedulingRuleDraft = { when: WHEN, appointmentType: "consulta_medica", priority: "routine", dueInDays: 30 };

describe("bloco scheduling na definição", () => {
  it("sem scheduling: lista vazia; com regras: rascunho", () => {
    expect(readScheduling({ name: "x" })).toEqual({ ok: true, rules: [] });
    expect(readScheduling({ scheduling: [ { when: WHEN, appointment_type: "consulta_medica", priority: "routine", due_in_days: 30 } ] }))
      .toEqual({ ok: true, rules: [ RULE ] });
  });

  it("campo ausente vira vazio no rascunho; prioridade ausente vira rotina", () => {
    expect(readScheduling({ scheduling: [ {} ] })).toEqual({ ok: true,
      rules: [ { when: null, appointmentType: "", priority: "routine", dueInDays: null } ] });
  });

  it("formato errado: motivo, sem tocar no JSON", () => {
    expect(readScheduling({ scheduling: {} })).toEqual({ ok: false, reason: "“scheduling” não é uma lista: corrija no JSON" });
    expect(readScheduling({ scheduling: [ { due_in_days: "30" } ] }).ok).toBe(false);
    expect(readScheduling({ scheduling: [ { priority: "urgent" } ] }).ok).toBe(false);
  });

  it("escrita: ordem das chaves do contrato, vazio sai ausente, sem when e sem prazo saem ausentes", () => {
    const def = { name: "x", scheduling: [] as unknown[] };
    expect(writeScheduling(def, [ RULE ])).toEqual({ name: "x",
      scheduling: [ { when: WHEN, appointment_type: "consulta_medica", priority: "routine", due_in_days: 30 } ] });
    expect("scheduling" in (writeScheduling(def, []) as object)).toBe(false);
    expect(writeScheduling({}, [ { ...RULE, when: null, dueInDays: null, appointmentType: "" } ]))
      .toEqual({ scheduling: [ { priority: "routine" } ] });
  });

  it("prazo: inteiro de 1 a 365", () => {
    expect(parseDueDays("30")).toEqual({ days: 30, problem: null });
    expect(parseDueDays("")).toEqual({ days: null, problem: null });
    expect(parseDueDays("0").problem).toBe("use de 1 a 365 dias");
    expect(parseDueDays("366").problem).toBe("use de 1 a 365 dias");
    expect(parseDueDays("1,5").problem).toBe("use um número inteiro de dias");
  });

  it("problema da regra, na ordem: tipo, padrão, condição, prazo; tipo inexistente e inativo avisam", () => {
    expect(schedulingRuleProblem(RULE, TYPES)).toBeNull();
    expect(schedulingRuleProblem({ ...RULE, appointmentType: "" }, TYPES)).toBe("escolha o tipo de atendimento");
    expect(schedulingRuleProblem({ ...RULE, appointmentType: "Consulta" }, null)).toBe("tipo inválido: minúsculas, números e _");
    expect(schedulingRuleProblem({ ...RULE, when: null }, TYPES)).toBe("defina quando gerar o pedido");
    expect(schedulingRuleProblem({ ...RULE, dueInDays: null }, TYPES)).toBe("informe o prazo (1 a 365 dias)");
    expect(schedulingRuleProblem({ ...RULE, appointmentType: "sumiu" }, TYPES))
      .toBe("tipo não existe nesta cidade: o gate avisa, sem bloquear");
    expect(schedulingRuleProblem({ ...RULE, appointmentType: "puericultura" }, TYPES)).toBe("tipo inativo nesta cidade");
    expect(schedulingRuleProblem({ ...RULE, appointmentType: "sumiu" }, null)).toBeNull();
  });

  it("mover regra: a ordem decide (vale a primeira que casar)", () => {
    const b = { ...RULE, appointmentType: "retorno" };
    expect(moveRule([ RULE, b ], 1, -1)).toEqual([ b, RULE ]);
    expect(moveRule([ RULE, b ], 0, -1)).toEqual([ RULE, b ]);
  });
});
