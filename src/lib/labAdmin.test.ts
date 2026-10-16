import { describe, expect, it } from "vitest";
import { ageToDays, daysToAge, formulaKeys, labProviders, versionBody, versionDraft, versionProblem } from "./labAdmin";
import { labTemplate, labVersion } from "../test/labFixtures";
import { examProvider } from "../test/examFixtures";

describe("idade das faixas", () => {
  it("anos, meses e dias viram dias; e voltam na unidade mais redonda", () => {
    expect(ageToDays("18", "years")).toBe(6570);
    expect(ageToDays("6", "months")).toBe(180);
    expect(ageToDays("", "years")).toBeNull();
    expect(ageToDays("-1", "days")).toBeNull();
    expect(daysToAge(6570)).toEqual({ value: "18", unit: "years" });
    expect(daysToAge(180)).toEqual({ value: "6", unit: "months" });
    expect(daysToAge(10)).toEqual({ value: "10", unit: "days" });
    expect(daysToAge(null)).toEqual({ value: "", unit: "years" });
  });

  it("B3: 43800 dias é 'sem limite' (campo em branco) e o branco volta como 0 e 43800", () => {
    expect(daysToAge(43800)).toEqual({ value: "", unit: "years" });
    const draft = versionDraft(labVersion());
    expect(draft.analytes[0].ranges[0].ageMax).toBe("");
    const body = versionBody({ ...draft, analytes: [ { ...draft.analytes[0], ranges: [ { ...draft.analytes[0].ranges[0], ageMin: "", ageMax: "" } ] } ] });
    expect(body.analytes[0].reference_ranges[0]).toMatchObject({ age_min_days: 0, age_max_days: 43800 });
  });
});

describe("versão", () => {
  it("parte da versão atual e devolve o mesmo corpo", () => {
    const v = labVersion();
    const body = versionBody(versionDraft(v));
    expect(body).toEqual({
      method: v.method, material: v.material, container: v.container, instrument_test_code: "GLU",
      analytes: [ { key: "glicose", name: "Glicose", loinc: "2345-7", unit: "mg/dL", value_type: "numeric", choices: [], decimals: 0,
        reference_ranges: [ { sex: "any", age_min_days: 6570, age_max_days: 43800, low: 70, high: 99, text: null } ],
        entry_min: 10, entry_max: 1500, critical_low: 40, critical_high: 400, formula: null } ]
    });
  });

  it("parte do modelo do catálogo-base quando não há versão", () => {
    const d = versionDraft(null, labTemplate());
    expect(d.method).toBe("enzimático (GOD-PAP)");
    expect(d.analytes[0].key).toBe("glicose");
  });

  it("recusas: chave, faixa sem limite nem texto, idade invertida, crítico, fórmula com chave desconhecida", () => {
    const base = versionDraft(labVersion());
    const a = base.analytes[0];
    const with1 = (patch: object) => ({ ...base, analytes: [ { ...a, ...patch } ] });
    const range = a.ranges[0];
    expect(versionProblem(with1({ key: "Glicose!" }))).toBe("componente 1: a chave usa letras minúsculas, números e _");
    expect(versionProblem(with1({ ranges: [ { ...range, low: "", high: "", text: "" } ] })))
      .toBe("componente 1, faixa 1: informe mínimo, máximo ou um texto");
    expect(versionProblem(with1({ ranges: [ { ...range, ageMin: "60", ageMinUnit: "years", ageMax: "18", ageMaxUnit: "years" } ] })))
      .toBe("componente 1, faixa 1: a idade mínima passa da máxima");
    expect(versionProblem(with1({ ranges: [ { ...range, ageMax: "200", ageMaxUnit: "years" } ] })))
      .toBe("componente 1, faixa 1: a idade passa de 43800 dias (120 anos)");
    expect(versionProblem(with1({ entryMin: "200", entryMax: "100" }))).toBe("componente 1: o limite de digitação mínimo passa do máximo");
    expect(versionProblem(with1({ criticalLow: "500", criticalHigh: "400" }))).toBe("componente 1: o crítico baixo passa do crítico alto");
    expect(versionProblem({ ...base, analytes: [ a, { ...a, key: "calc", name: "Calculado", formula: "glicose * k" } ] }))
      .toBe("componente 2: a fórmula usa k, que não é componente deste exame");
    expect(versionProblem({ ...base, method: " " })).toBe("informe o método");
    expect(versionProblem(base)).toBeNull();
  });

  it("D4: casas decimais 0 a 4", () => {
    const base = versionDraft(labVersion());
    expect(versionProblem({ ...base, analytes: [ { ...base.analytes[0], decimals: "5" } ] })).toBe("componente 1: casas decimais de 0 a 4");
    expect(versionProblem({ ...base, analytes: [ { ...base.analytes[0], decimals: "4" } ] })).toBeNull();
  });

  it("D4: fórmula não usa componente calculado nem a si mesma", () => {
    const base = versionDraft(labVersion());
    const a = base.analytes[0];
    const calc = { ...a, key: "c1", name: "C1", formula: "glicose * 2" };
    expect(versionProblem({ ...base, analytes: [ a, calc, { ...a, key: "c2", name: "C2", formula: "c1 + 1" } ] }))
      .toBe("componente 3: a fórmula usa c1, que é calculado — use só componentes digitados");
    expect(versionProblem({ ...base, analytes: [ { ...a, formula: "glicose + 1" } ] }))
      .toBe("componente 1: a fórmula usa glicose, que não é componente deste exame");
  });

  it("B29: opções de escolha — de 1 a 20, até 60 caracteres, sem repetir", () => {
    const base = versionDraft(labVersion());
    const choice = (choices: string) => ({ ...base, analytes: [ { ...base.analytes[0], valueType: "choice" as const, choices } ] });
    const msg = "componente 1: informe de 1 a 20 opções distintas, separadas por ;, com até 60 caracteres";
    expect(versionProblem(choice("positivo; negativo"))).toBeNull();
    expect(versionProblem(choice("positivo; Positivo"))).toBe(msg);
    expect(versionProblem(choice("positivo;; negativo"))).toBe(msg);
    expect(versionProblem(choice(""))).toBe(msg);
    expect(versionProblem(choice("x".repeat(61)))).toBe(msg);
    expect(versionProblem(choice(Array.from({ length: 21 }, (_, i) => `o${i}`).join(";")))).toBe(msg);
    expect(versionProblem(choice(Array.from({ length: 20 }, (_, i) => `o${i}`).join(";")))).toBeNull();
  });

  it("chaves da fórmula", () => {
    expect(formulaKeys("ct - hdl - tg / 5")).toEqual([ "ct", "hdl", "tg" ]);
    expect(formulaKeys("(a+b)*2.5")).toEqual([ "a", "b" ]);
  });

  it("só prestadores com o laboratório municipal", () => {
    expect(labProviders([ examProvider(), examProvider({ id: "pv9", uses_municipal_lab: true }) ]).map((p) => p.id)).toEqual([ "pv9" ]);
  });
});
