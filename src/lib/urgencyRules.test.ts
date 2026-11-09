// src/lib/urgencyRules.test.ts
import { describe, expect, it } from "vitest";
import {
  URGENCY_PROTOCOL_NAME, URGENCY_RULES_MAX, URGENCY_TEMPLATE, isUrgencyDefinition, levelProblem, nextRuleId, readLevels,
  readUrgencyRules, urgencyRuleProblems, writeLevels, writeUrgencyRules, type UrgencyRuleDraft
} from "./urgencyRules";
import { DEFAULT_LEVELS } from "./urgency";

const ORDER_REASON = "“levels” precisa das 5 cores, na ordem vermelho, laranja, amarelo, verde, azul: corrija no JSON";

describe("protocolo de classificação de risco (módulo 32a)", () => {
  it("modelo: kind, as 5 cores na ordem com os tempos padrão, regras com id, condição, cor e critério", () => {
    const def = JSON.parse(URGENCY_TEMPLATE);
    expect(def.kind).toBe("urgency_classification");
    // E2 do preflight: o nome da semente, para o editor gerar a próxima versão dela.
    expect(def.name).toBe("classificacao-urgencia");
    expect(URGENCY_PROTOCOL_NAME).toBe("classificacao-urgencia");
    expect(def.levels).toEqual([ { color: "red", max_wait_minutes: 0 }, { color: "orange", max_wait_minutes: 10 },
      { color: "yellow", max_wait_minutes: 60 }, { color: "green", max_wait_minutes: 120 }, { color: "blue", max_wait_minutes: 240 } ]);
    expect(def.classification_rules[0]).toEqual({ id: "r1", when: { lte: [ "vitals.spo2", 89 ] }, color: "red", criterion: "saturação de oxigênio até 89%" });
    expect(def.classification_rules.map((r: UrgencyRuleDraft) => r.id)).toEqual([ "r1", "r2", "r3", "r4", "r5" ]);
    expect(def.classification_rules[3]).toEqual({ id: "r4", when: { gte: [ "pain_scale", 8 ] }, color: "orange", criterion: "dor intensa (8 a 10)" });
    expect(def.rules).toBeUndefined();
    expect(isUrgencyDefinition(def)).toBe(true);
    expect(isUrgencyDefinition({ kind: "screening" })).toBe(false);
    expect(isUrgencyDefinition(null)).toBe(false);
  });

  it("níveis: lê e escreve sem tocar no resto; tempo inteiro de 0 a 1440 e não decrescente", () => {
    const def = { kind: "urgency_classification", name: "x", levels: DEFAULT_LEVELS, classification_rules: [] };
    const next = writeLevels(def, DEFAULT_LEVELS.map((l) => (l.color === "yellow" ? { ...l, max_wait_minutes: 45 } : l))) as typeof def;
    expect(next.name).toBe("x");
    expect(next.classification_rules).toEqual([]);
    expect(readLevels(next)).toEqual({ ok: true, levels: expect.arrayContaining([ { color: "yellow", max_wait_minutes: 45 } ]) });
    expect(levelProblem({ color: "green", max_wait_minutes: 1.5 })).toBe("o tempo é um número inteiro de minutos, de 0 a 1440");
    expect(levelProblem({ color: "green", max_wait_minutes: 1441 })).toBe("o tempo é um número inteiro de minutos, de 0 a 1440");
    expect(levelProblem({ color: "green", max_wait_minutes: -1 })).toBe("o tempo é um número inteiro de minutos, de 0 a 1440");
    expect(levelProblem({ color: "green", max_wait_minutes: 120 }, { color: "yellow", max_wait_minutes: 60 })).toBeNull();
    expect(levelProblem({ color: "yellow", max_wait_minutes: 5 }, { color: "orange", max_wait_minutes: 10 }))
      .toBe("o amarelo não pode esperar menos que o laranja (10 min)");
    expect(readLevels({ kind: "urgency_classification", levels: [ { color: "red", max_wait_minutes: 0 } ] }))
      .toEqual({ ok: false, reason: ORDER_REASON });
    expect(readLevels({ kind: "urgency_classification", levels: [ ...DEFAULT_LEVELS ].reverse() })).toEqual({ ok: false, reason: ORDER_REASON });
    expect(readLevels({ kind: "urgency_classification" })).toEqual({ ok: false, reason: ORDER_REASON });
  });

  it("regras: lê classification_rules, ausente é lista vazia, formato errado diz o motivo; escreve sem tocar no resto", () => {
    const rule = { id: "spo2-baixa", when: { lt: [ "vitals.spo2", 90 ] }, color: "red", criterion: "SpO2 abaixo de 90%" };
    const def = { kind: "urgency_classification", name: "x", levels: DEFAULT_LEVELS, classification_rules: [ rule ] };
    expect(readUrgencyRules(def)).toEqual({ ok: true, rules: [ rule ] });
    expect(readUrgencyRules({ kind: "urgency_classification" })).toEqual({ ok: true, rules: [] });
    expect(readUrgencyRules({ kind: "urgency_classification", classification_rules: {} }))
      .toEqual({ ok: false, reason: "“classification_rules” não é uma lista: corrija no JSON" });
    expect(readUrgencyRules({ classification_rules: [ { id: "r1", color: "purple", criterion: "x" } ] }).ok).toBe(false);
    const next = writeUrgencyRules(def, [ { id: "r2", when: null, color: "orange", criterion: "" } ]) as Record<string, unknown>;
    expect(next.name).toBe("x");
    expect(next.levels).toEqual(DEFAULT_LEVELS);
    expect(next.classification_rules).toEqual([ { id: "r2", color: "orange", criterion: "" } ]);
    expect(URGENCY_RULES_MAX).toBe(100);
  });

  it("regra: critério de 1 a 120 caracteres, condição definida, id no padrão do schema e único; próximo id", () => {
    expect(urgencyRuleProblems({ id: "r1", when: null, color: "red", criterion: "" }))
      .toEqual([ "defina quando sugerir esta cor", "o critério tem de 1 a 120 caracteres" ]);
    expect(urgencyRuleProblems({ id: "r1", when: { gte: [ "pain_scale", 8 ] }, color: "red", criterion: "x" })).toEqual([]);
    expect(urgencyRuleProblems({ id: "r1", when: { gte: [ "pain_scale", 8 ] }, color: "red", criterion: "x".repeat(121) }))
      .toEqual([ "o critério tem de 1 a 120 caracteres" ]);
    expect(urgencyRuleProblems({ id: "1abc", when: { gte: [ "pain_scale", 8 ] }, color: "red", criterion: "x" }))
      .toEqual([ "o identificador começa por letra minúscula e usa só minúsculas, números, - e _ (até 40)" ]);
    const a: UrgencyRuleDraft = { id: "r1", when: { gte: [ "pain_scale", 8 ] }, color: "red", criterion: "x" };
    expect(urgencyRuleProblems(a, [ a, { ...a } ])).toEqual([ "outra regra já usa o identificador “r1”" ]);
    expect(nextRuleId([ { id: "r1" }, { id: "r7" } ] as UrgencyRuleDraft[])).toBe("r8");
    expect(nextRuleId([ { id: "spo2-baixa" } ] as UrgencyRuleDraft[])).toBe("r1");
    expect(nextRuleId([])).toBe("r1");
  });
});
