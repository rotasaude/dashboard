// src/lib/condition.test.ts
import { describe, expect, it } from "vitest";
import {
  appendTo, emptyRoot, fieldsFor, fromTree, newGroup, newRow, removeNode, rowProblem, tiersOf, toTree, updateNode, withOp,
  type ConditionContext, type ConditionField, type ConditionGroup, type ConditionRow
} from "./condition";
import { NEIGHBORHOODS, SUGGESTION_DEF } from "../test/conditionFixtures";

const FIELDS: Record<ConditionContext, ConditionField[]> = {
  eligibility: fieldsFor("eligibility"),
  suggestion: fieldsFor("suggestion", { definition: SUGGESTION_DEF }),
  restriction: fieldsFor("restriction", { neighborhoods: NEIGHBORHOODS })
};
const field = (context: ConditionContext, id: string) => FIELDS[context].find((f) => f.id === id)!;
const AGE = "profile.age";
const range = (f: string, a: number, b: number) => ({ all: [ { gte: [ f, a ] }, { lte: [ f, b ] } ] });
const OLD_OR_BABY = { any: [ { lte: [ AGE, 2 ] }, { gte: [ AGE, 60 ] } ] };

describe("campos por contexto", () => {
  it("elegibilidade só tem idade e sexo", () => {
    expect(FIELDS.eligibility.map((f) => f.id)).toEqual([ "profile.age", "profile.sex" ]);
    expect(field("eligibility", "profile.sex").options).toEqual([
      { value: "female", label: "feminino" }, { value: "male", label: "masculino" }
    ]);
  });

  it("sugestão ganha as respostas (sem texto livre) e o resultado com as classificações do protocolo", () => {
    expect(FIELDS.suggestion.map((f) => f.id)).toEqual([
      "profile.age", "profile.sex", "humor", "freq", "dias", "outcome.tier", "outcome.score", "outcome.priority"
    ]);
    expect(field("suggestion", "humor")).toMatchObject({ kind: "boolean", label: "“Sentiu-se triste?”", verb: " é " });
    expect(field("suggestion", "freq").options?.map((o) => o.value)).toEqual([ "nunca", "às vezes", "sempre" ]);
    expect(field("suggestion", "dias").kind).toBe("number");
    expect(field("suggestion", "outcome.tier").options?.map((o) => o.value)).toEqual([ "baixa", "media", "alta" ]);
    expect(field("suggestion", "outcome.priority")).toMatchObject({ min: 1, max: 9 });
  });

  it("passo com prefixo reservado não vira campo", () => {
    const def = { steps: [ { id: "profile.idade", prompt: "x", answer_type: "integer" } ] };
    expect(fieldsFor("suggestion", { definition: def }).map((f) => f.id)).not.toContain("profile.idade");
  });

  it("classificações de tabela de decisão vêm das regras e do fallback, sem repetir", () => {
    const def = { scoring: { type: "decision_table", rules: [ { tier: "vermelha" }, { tier: "amarela" }, { tier: "vermelha" } ], fallback: { tier: "verde" } } };
    expect(tiersOf(def)).toEqual([ "vermelha", "amarela", "verde" ]);
    expect(tiersOf({})).toEqual([]);
  });

  it("restrição ganha o bairro, em ordem de nome, com o inativo marcado", () => {
    expect(field("restriction", "citizen.neighborhood_id").options).toEqual([
      { value: "n2", label: "Boqueirão" },
      { value: "n3", label: "Centro (bairro inativo)", inactive: true },
      { value: "n1", label: "Xaxim" }
    ]);
  });
});

// Árvores canônicas: as que o próprio construtor produz. Ida e volta tem de
// devolver exatamente a mesma árvore.
const CANONICAL: Array<[ ConditionContext, string, unknown ]> = [
  [ "eligibility", "idade a partir de", { gte: [ AGE, 60 ] } ],
  [ "eligibility", "idade até", { lte: [ AGE, 12 ] } ],
  [ "eligibility", "idade entre", range(AGE, 18, 59) ],
  [ "eligibility", "idade igual", range(AGE, 40, 40) ],
  [ "eligibility", "sexo, um valor", { in: [ "profile.sex", [ "female" ] ] } ],
  [ "eligibility", "sexo, dois valores", { in: [ "profile.sex", [ "female", "male" ] ] } ],
  [ "eligibility", "NÃO na linha", { not: { gte: [ AGE, 60 ] } } ],
  [ "eligibility", "NÃO no entre", { not: range(AGE, 18, 59) } ],
  [ "eligibility", "E", { all: [ { gte: [ AGE, 40 ] }, { in: [ "profile.sex", [ "female" ] ] } ] } ],
  [ "eligibility", "OU", OLD_OR_BABY ],
  [ "eligibility", "OU com uma linha", { any: [ { gte: [ AGE, 60 ] } ] } ],
  [ "eligibility", "NÃO no grupo", { not: OLD_OR_BABY } ],
  [ "eligibility", "NÃO na raiz com uma linha", { not: { all: [ { gte: [ AGE, 60 ] } ] } } ],
  [ "eligibility", "subgrupo", { all: [ { in: [ "profile.sex", [ "female" ] ] }, OLD_OR_BABY ] } ],
  [ "eligibility", "subgrupo negado", { all: [ { in: [ "profile.sex", [ "male" ] ] }, { not: OLD_OR_BABY } ] } ],
  [ "suggestion", "sim/não", { eq: [ "humor", "true" ] } ],
  [ "suggestion", "lista", { in: [ "freq", [ "às vezes", "sempre" ] ] } ],
  [ "suggestion", "número de resposta", { gte: [ "dias", 14 ] } ],
  [ "suggestion", "pontuação", { gte: [ "outcome.score", 15 ] } ],
  [ "suggestion", "classificação", { in: [ "outcome.tier", [ "alta" ] ] } ],
  [ "suggestion", "prioridade", { lte: [ "outcome.priority", 3 ] } ],
  [ "suggestion", "misto", { all: [ { eq: [ "humor", "true" ] }, { any: [ { gte: [ "outcome.score", 15 ] }, { in: [ "freq", [ "sempre" ] ] } ] } ] } ],
  [ "restriction", "bairro", { in: [ "citizen.neighborhood_id", [ "n1", "n2" ] ] } ],
  [ "restriction", "bairro inativo", { in: [ "citizen.neighborhood_id", [ "n3" ] ] } ],
  [ "restriction", "idade e bairro", { all: [ { gte: [ AGE, 60 ] }, { in: [ "citizen.neighborhood_id", [ "n2" ] ] } ] } ]
];

describe("ida e volta", () => {
  it.each(CANONICAL)("%s / %s: árvore → modelo → árvore é a mesma", (context, _name, tree) => {
    const parsed = fromTree(tree, FIELDS[context]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(toTree(parsed.root)).toEqual(tree);
  });

  it("entre vira uma linha só, e igual vira a linha 'igual a'", () => {
    const between = fromTree(range(AGE, 18, 59), FIELDS.eligibility);
    const equal = fromTree(range(AGE, 40, 40), FIELDS.eligibility);
    expect(between.ok && between.root.children[0]).toMatchObject({ kind: "row", op: "between", value: [ 18, 59 ] });
    expect(equal.ok && equal.root.children[0]).toMatchObject({ kind: "row", op: "eq", value: 40 });
  });

  it("árvore ausente é a raiz vazia, e a raiz vazia volta como null", () => {
    const parsed = fromTree(undefined, FIELDS.eligibility);
    expect(parsed.ok && parsed.root.children).toEqual([]);
    expect(toTree(emptyRoot())).toBeNull();
  });
});

describe("formas aceitas que o construtor reescreve no formato dele", () => {
  it.each([
    [ "eq em campo de escolha vira in", { eq: [ "profile.sex", "female" ] }, { in: [ "profile.sex", [ "female" ] ] } ],
    [ "eq numérico vira o par gte/lte", { eq: [ AGE, 60 ] }, range(AGE, 60, 60) ],
    [ "all com uma linha na raiz vira a linha", { all: [ { gte: [ AGE, 18 ] } ] }, { gte: [ AGE, 18 ] } ]
  ])("%s", (_name, tree, canonical) => {
    const parsed = fromTree(tree, FIELDS.eligibility);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(toTree(parsed.root)).toEqual(canonical);
  });
});

describe("regra avançada (fora do subconjunto)", () => {
  it.each([
    [ "eligibility", "gt", { gt: [ AGE, 59 ] } ],
    [ "eligibility", "lt", { lt: [ AGE, 12 ] } ],
    [ "suggestion", "mapa legado", { humor: "true" } ],
    [ "eligibility", "NÃO duplo", { not: { not: { gte: [ AGE, 60 ] } } } ],
    [ "eligibility", "grupo dentro de subgrupo", { all: [ { any: [ { all: [ { gte: [ AGE, 1 ] }, { in: [ "profile.sex", [ "male" ] ] } ] } ] } ] } ],
    [ "eligibility", "campo de outro lugar", { gte: [ "outcome.score", 15 ] } ],
    [ "restriction", "resposta na restrição", { eq: [ "humor", "true" ] } ],
    [ "suggestion", "passo de texto livre", { eq: [ "obs", "dor" ] } ],
    [ "eligibility", "número como texto", { gte: [ AGE, "60" ] } ],
    [ "eligibility", "in vazio", { in: [ "profile.sex", [] ] } ],
    [ "eligibility", "grupo vazio", { all: [] } ],
    [ "eligibility", "operando curto", { gte: [ AGE ] } ],
    [ "eligibility", "não é objeto", "idade > 60" ]
  ] as Array<[ ConditionContext, string, unknown ]>)("%s / %s", (context, _name, tree) => {
    expect(fromTree(tree, FIELDS[context])).toEqual({ ok: false });
  });
});

describe("linhas incompletas não entram na árvore", () => {
  const age = field("eligibility", AGE);
  const sex = field("eligibility", "profile.sex");

  it("valor vazio, entre pela metade, entre invertido e nenhuma opção somem da árvore", () => {
    const root: ConditionGroup = { ...emptyRoot(), children: [
      newRow(age),
      { ...newRow(age, "between"), value: [ 60, null ] } as ConditionRow,
      { ...newRow(age, "between"), value: [ 60, 18 ] } as ConditionRow,
      newRow(sex)
    ] };
    expect(toTree(root)).toBeNull();
  });

  it("com uma linha completa e outra incompleta, a árvore é só a completa", () => {
    const root: ConditionGroup = { ...emptyRoot(), children: [ { ...newRow(age), value: 60 } as ConditionRow, newRow(sex) ] };
    expect(toTree(root)).toEqual({ gte: [ AGE, 60 ] });
  });

  it("subgrupo vazio some", () => {
    const root: ConditionGroup = { ...emptyRoot(), children: [ { ...newRow(age), value: 60 } as ConditionRow, newGroup("any") ] };
    expect(toTree(root)).toEqual({ gte: [ AGE, 60 ] });
  });

  it("o motivo de cada linha incompleta é dito", () => {
    expect(rowProblem(newRow(age), age)).toBe("informe o valor");
    expect(rowProblem({ ...newRow(age), value: 200 } as ConditionRow, age)).toBe("use um valor entre 0 e 130");
    expect(rowProblem({ ...newRow(age, "between"), value: [ 60, 18 ] } as ConditionRow, age)).toBe("o início precisa ser menor que o fim");
    expect(rowProblem(newRow(sex), sex)).toBe("marque ao menos uma opção");
    expect(rowProblem({ ...newRow(age), value: 60 } as ConditionRow, age)).toBeNull();
    expect(rowProblem(newRow(age), undefined)).toBe("campo indisponível neste lugar");
  });
});

describe("edição do modelo", () => {
  const age = field("eligibility", AGE);

  it("trocar de operador numérico guarda o número digitado", () => {
    const row = { ...newRow(age), value: 60 } as ConditionRow;
    expect(withOp(row, "between", age)).toMatchObject({ key: row.key, op: "between", value: [ 60, null ] });
    expect(withOp(row, "lte", age)).toMatchObject({ key: row.key, op: "lte", value: 60 });
  });

  it("acrescenta, altera e remove por chave, inclusive dentro de subgrupo", () => {
    const group = newGroup("any");
    let root = appendTo(emptyRoot(), "nada", newRow(age));
    expect(root.children).toHaveLength(0);
    root = appendTo({ ...emptyRoot(), children: [ group ] }, group.key, newRow(age));
    const inner = (root.children[0] as ConditionGroup).children[0];
    root = updateNode(root, inner.key, (n) => ({ ...(n as ConditionRow), value: 60 }) as ConditionRow);
    expect(toTree(root)).toEqual({ any: [ { gte: [ AGE, 60 ] } ] });
    root = removeNode(root, inner.key);
    expect(toTree(root)).toBeNull();
  });
});
