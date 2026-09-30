import { describe, it, expect } from "vitest";
import { analyticSteps, parseDefinition, setAnalytic, stripIneligibleAnalytic, TEMPLATE } from "./editor";

describe("parseDefinition", () => {
  it("ok for valid JSON", () => {
    const r = parseDefinition('{"a":1}');
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });
  it("error for invalid JSON", () => {
    const r = parseDefinition("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });
});

describe("TEMPLATE", () => {
  it("parses to a definition with name/version/steps", () => {
    const r = parseDefinition(TEMPLATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as Record<string, unknown>;
      expect(v.name).toBeTruthy();
      expect(v.version).toBe(1);
      expect(Array.isArray(v.steps)).toBe(true);
    }
  });
});

describe("perguntas analíticas (módulo 14)", () => {
  const def = {
    name: "arbovirose", version: 3, start_step_id: "febre",
    steps: [
      { id: "febre", prompt: "Teve febre?", answer_type: "boolean" },
      { id: "sintoma", prompt: "Qual o sintoma?", answer_type: "enum", options: [ "dor", "tosse" ], analytic: true },
      { id: "dias", prompt: "Há quantos dias?", answer_type: "integer", analytic: true },
      { id: "obs", prompt: "Observações", answer_type: "text" }
    ]
  };

  it("analyticSteps diz quem está marcado e quem pode ser", () => {
    expect(analyticSteps(def).map((s) => [ s.id, s.analytic, s.eligible ])).toEqual([
      [ "febre", false, true ], [ "sintoma", true, true ], [ "dias", true, false ], [ "obs", false, false ]
    ]);
    expect(analyticSteps(null)).toEqual([]);
    expect(analyticSteps({ steps: "x" })).toEqual([]);
  });

  // As perguntas de `def` têm formatos diferentes; lidas como registro soltas.
  const stepsOf = (d: unknown) => (d as { steps: Array<Record<string, unknown>> }).steps;

  it("setAnalytic marca boolean/enum, desmarca apagando a chave, e ignora integer/text", () => {
    expect(stepsOf(setAnalytic(def, "febre", true))[0])
      .toEqual({ id: "febre", prompt: "Teve febre?", answer_type: "boolean", analytic: true });
    expect("analytic" in stepsOf(setAnalytic(def, "sintoma", false))[1]).toBe(false);
    expect("analytic" in stepsOf(setAnalytic(def, "obs", true))[3]).toBe(false);
    expect(def.steps[0]).toEqual({ id: "febre", prompt: "Teve febre?", answer_type: "boolean" }); // não muta
  });

  it("stripIneligibleAnalytic tira a marca de integer/text e diz de quais", () => {
    const { definition, removed } = stripIneligibleAnalytic(def);
    expect(removed).toEqual([ "dias" ]);
    expect("analytic" in stepsOf(definition)[2]).toBe(false);
    expect(stepsOf(definition)[1].analytic).toBe(true);
  });

  it.each([ [ "integer", false ], [ "integer", "true" ], [ "text", false ], [ "text", "true" ] ])(
    "stripIneligibleAnalytic tira qualquer chave analytic (%s, %j) de integer/text",
    (answerType, value) => {
      const d = { steps: [ { id: "q", prompt: "Q", answer_type: answerType, analytic: value } ] };
      expect(analyticSteps(d)[0]).toMatchObject({ analytic: false, eligible: false, stranded: true });
      const { definition, removed } = stripIneligibleAnalytic(d);
      expect(removed).toEqual([ "q" ]);
      expect("analytic" in stepsOf(definition)[0]).toBe(false);
      expect("analytic" in d.steps[0]).toBe(true); // não muta
    }
  );

  it("sem nada a tirar, devolve a mesma definição", () => {
    const clean = { steps: [ { id: "febre", prompt: "Teve febre?", answer_type: "boolean", analytic: true } ] };
    expect(stripIneligibleAnalytic(clean)).toEqual({ definition: clean, removed: [] });
  });
});
