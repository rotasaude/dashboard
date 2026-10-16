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
    expect(versionProblem(with1({ entryMin: "200", entryMax: "100" }))).toBe("componente 1: o limite de digitação mínimo deve ser menor que o máximo");
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
      .toBe("componente 3: a fórmula usa c1, que é calculado ou não é numérico — use só componentes numéricos digitados");
    expect(versionProblem({ ...base, analytes: [ { ...a, formula: "glicose + 1" } ] }))
      .toBe("componente 1: a fórmula usa glicose, que não é componente deste exame");
  });

  it("B29: opções de escolha — de 1 a 20, até 60 caracteres, sem repetir", () => {
    const base = versionDraft(labVersion());
    const choice = (choices: string) => ({ ...base, analytes: [ { ...base.analytes[0], valueType: "choice" as const, choices, entryMin: "", entryMax: "", criticalLow: "", criticalHigh: "" } ] });
    const msg = "componente 1: informe de 1 a 20 opções distintas, separadas por ;, com até 60 caracteres";
    expect(versionProblem(choice("positivo; negativo"))).toBeNull();
    expect(versionProblem(choice("positivo; Positivo"))).toBeNull(); // o api compara com caixa
    expect(versionProblem(choice("positivo; positivo"))).toBe(msg);
    expect(versionProblem(choice("positivo;; negativo"))).toBe(msg);
    expect(versionProblem(choice(""))).toBe(msg);
    expect(versionProblem(choice("x".repeat(61)))).toBe(msg);
    expect(versionProblem(choice(Array.from({ length: 21 }, (_, i) => `o${i}`).join(";")))).toBe(msg);
    expect(versionProblem(choice(Array.from({ length: 20 }, (_, i) => `o${i}`).join(";")))).toBeNull();
  });

  it("api: limite de digitação mínimo estritamente menor que o máximo", () => {
    const base = versionDraft(labVersion());
    const lim = (entryMin: string, entryMax: string) => ({ ...base, analytes: [ { ...base.analytes[0], entryMin, entryMax } ] });
    expect(versionProblem(lim("10", "10"))).toBe("componente 1: o limite de digitação mínimo deve ser menor que o máximo");
    expect(versionProblem(lim("10", "11"))).toBeNull();
    expect(versionProblem(lim("", "10"))).toBeNull();
  });

  it("api: limites e fórmula só em numérico; fórmula só sobre numéricos digitados", () => {
    const base = versionDraft(labVersion());
    const a = base.analytes[0];
    const text = { ...a, key: "obs", name: "Obs", valueType: "text" as const, entryMin: "", entryMax: "", criticalLow: "", criticalHigh: "", ranges: [] };
    expect(versionProblem({ ...base, analytes: [ text ] })).toBeNull();
    expect(versionProblem({ ...base, analytes: [ { ...text, entryMin: "1" } ] })).toBe("componente 1: limites de digitação e críticos valem só para componente numérico");
    expect(versionProblem({ ...base, analytes: [ { ...text, criticalHigh: "1" } ] })).toBe("componente 1: limites de digitação e críticos valem só para componente numérico");
    expect(versionProblem({ ...base, analytes: [ { ...text, formula: "1+1" } ] })).toBe("componente 1: fórmula só em componente numérico");
    expect(versionProblem({ ...base, analytes: [ a, { ...a, key: "c", name: "C", formula: "obs + 1" }, text ] }))
      .toBe("componente 2: a fórmula usa obs, que é calculado ou não é numérico — use só componentes numéricos digitados");
    expect(versionProblem({ ...base, analytes: [ a, { ...a, key: "c", name: "C", formula: "glicose + 1" } ] })).toBeNull();
  });

  it("api: sintaxe da fórmula (sem unário, operador pendente, parênteses, operandos juntos)", () => {
    const base = versionDraft(labVersion());
    const a = base.analytes[0];
    const f = (formula: string) => versionProblem({ ...base, analytes: [ a, { ...a, key: "c", name: "C", formula } ] });
    const bad = "componente 2: fórmula mal formada — alterne valores e operadores, feche os parênteses e não use sinal no início";
    for (const ok of [ "glicose", "glicose + 1", "(glicose + 1) * 2.5", "((glicose))", "glicose/2-1" ]) expect(f(ok), ok).toBeNull();
    for (const no of [ "-glicose", "glicose +", "+ glicose", "(glicose", "glicose)", "glicose glicose", "2glicose", "()", "glicose (1)", "(glicose)(1)", "1 + * 2", "2.", ".5" ]) {
      expect(f(no), no).not.toBeNull();
    }
    expect(f("glicose +")).toBe(bad);
    expect(f("Glicose")).toBe("componente 2: a fórmula usa só chaves, números e + - * / ( )");
    expect(f(`glicose${" +glicose".repeat(30)}`)).toBe(bad); // 200 é o teto: 7 + 30*9 > 200
  });

  it("api: limites de tamanho nos dois lados", () => {
    const base = versionDraft(labVersion());
    const a = base.analytes[0];
    const top = (p: object) => versionProblem({ ...base, ...p });
    const inA = (p: object) => versionProblem({ ...base, analytes: [ { ...a, ...p } ] });
    expect(top({ method: "m".repeat(160) })).toBeNull();
    expect(top({ method: "m".repeat(161) })).toBe("o método tem no máximo 160 caracteres");
    expect(top({ material: "m".repeat(60) })).toBeNull();
    expect(top({ material: "m".repeat(61) })).toBe("o material tem no máximo 60 caracteres");
    expect(top({ container: "m".repeat(60) })).toBeNull();
    expect(top({ container: "m".repeat(61) })).toBe("o recipiente tem no máximo 60 caracteres");
    expect(inA({ name: "n".repeat(120) })).toBeNull();
    expect(inA({ name: "n".repeat(121) })).toBe("componente 1: o nome tem no máximo 120 caracteres");
    expect(inA({ unit: "u".repeat(30) })).toBeNull();
    expect(inA({ unit: "u".repeat(31) })).toBe("componente 1: a unidade tem no máximo 30 caracteres");
    const range = a.ranges[0];
    expect(inA({ ranges: [ { ...range, text: "t".repeat(120) } ] })).toBeNull();
    expect(inA({ ranges: [ { ...range, text: "t".repeat(121) } ] })).toBe("componente 1, faixa 1: o texto tem no máximo 120 caracteres");
    expect(inA({ ranges: Array.from({ length: 20 }, () => range) })).toBeNull();
    expect(inA({ ranges: Array.from({ length: 21 }, () => range) })).toBe("componente 1: no máximo 20 faixas");
    const many = (n: number) => ({ ...base, analytes: Array.from({ length: n }, (_, i) => ({ ...a, key: `k${i}`, name: `K${i}` })) });
    expect(versionProblem(many(60))).toBeNull();
    expect(versionProblem(many(61))).toBe("no máximo 60 componentes por exame");
  });

  it("api: código do aparelho", () => {
    const base = versionDraft(labVersion());
    const code = (instrumentTestCode: string) => versionProblem({ ...base, instrumentTestCode });
    for (const ok of [ "", "GLU", "gli.1-a_2", "A".repeat(30) ]) expect(code(ok), ok).toBeNull();
    for (const no of [ "A".repeat(31), "GL U", "GLÚ", "GLU/1" ]) {
      expect(code(no), no).toBe("o código do aparelho usa letras, números, ponto, hífen e _, até 30 caracteres");
    }
  });

  it("idade mínima 43800 reabre como 120 anos (só a máxima vira 'sem limite')", () => {
    expect(daysToAge(43800, "min")).toEqual({ value: "120", unit: "years" });
    expect(daysToAge(43800)).toEqual({ value: "", unit: "years" });
  });

  it("chaves da fórmula", () => {
    expect(formulaKeys("ct - hdl - tg / 5")).toEqual([ "ct", "hdl", "tg" ]);
    expect(formulaKeys("(a+b)*2.5")).toEqual([ "a", "b" ]);
  });

  it("só prestadores com o laboratório municipal", () => {
    expect(labProviders([ examProvider(), examProvider({ id: "pv9", uses_municipal_lab: true }) ]).map((p) => p.id)).toEqual([ "pv9" ]);
  });
});
