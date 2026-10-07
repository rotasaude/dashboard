// src/lib/riskRules.test.ts
import { describe, expect, it } from "vitest";
import { SCREENING_TEMPLATE, isScreeningDefinition, readRiskRules, riskRuleProblem, writeRiskRules } from "./riskRules";

const DEF = { name: "acolhimento", version: 1, kind: "screening", risk_rules: [ { when: { gte: [ "vitals.systolic", 180 ] }, color: "red" } ] };

describe("regras de cor do acolhimento", () => {
  it("reconhece a variante só por kind: screening", () => {
    expect(isScreeningDefinition(DEF)).toBe(true);
    expect(isScreeningDefinition({ name: "x", steps: [] })).toBe(false);
    expect(isScreeningDefinition({ kind: "triage" })).toBe(false);
    expect(isScreeningDefinition(null)).toBe(false);
  });

  it("lê as regras; ausente é lista vazia; formato errado diz o motivo", () => {
    expect(readRiskRules(DEF)).toEqual({ ok: true, rules: [ { when: { gte: [ "vitals.systolic", 180 ] }, color: "red" } ] });
    expect(readRiskRules({ kind: "screening" })).toEqual({ ok: true, rules: [] });
    expect(readRiskRules({ kind: "screening", risk_rules: {} })).toEqual({ ok: false, reason: "“risk_rules” não é uma lista: corrija no JSON" });
    expect(readRiskRules({ kind: "screening", risk_rules: [ { when: {}, color: "orange" } ] }).ok).toBe(false);
  });

  it("escreve sem tocar no resto; lista vazia continua no JSON; condição incompleta sai ausente", () => {
    const next = writeRiskRules(DEF, [ { when: null, color: "yellow" } ]) as Record<string, unknown>;
    expect(next.name).toBe("acolhimento");
    expect(next.risk_rules).toEqual([ { color: "yellow" } ]);
    expect((writeRiskRules(DEF, []) as Record<string, unknown>).risk_rules).toEqual([]);
    expect(riskRuleProblem({ when: null, color: "red" })).toBe("defina quando sugerir esta cor");
  });

  it("o modelo é uma definição de acolhimento com as regras iniciais", () => {
    const t = JSON.parse(SCREENING_TEMPLATE);
    expect(isScreeningDefinition(t)).toBe(true);
    expect(t.name).toBe("acolhimento");
    expect(t.risk_rules.map((r: { color: string }) => r.color)).toEqual([ "red", "red", "yellow", "yellow" ]);
    expect("steps" in t).toBe(false);
  });
});
