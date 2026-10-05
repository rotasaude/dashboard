// src/lib/conditionPhrase.test.ts
import { describe, expect, it } from "vitest";
import { fieldsFor } from "./condition";
import { UNKNOWN_RULE, describeCondition } from "./conditionPhrase";
import { NEIGHBORHOODS, SUGGESTION_DEF } from "../test/conditionFixtures";

const ELIG = fieldsFor("eligibility");
const SUGG = fieldsFor("suggestion", { definition: SUGGESTION_DEF });
const REST = fieldsFor("restriction", { neighborhoods: NEIGHBORHOODS });
const AGE = "profile.age";
const say = (tree: unknown, fields = ELIG) => describeCondition(tree, fields, "para todos");

describe("frase da condição", () => {
  it("sem condição usa o texto do lugar", () => {
    expect(say(null)).toBe("para todos");
    expect(describeCondition(undefined, REST, "nenhuma")).toBe("nenhuma");
  });

  it("idade com unidade, inclusive no singular", () => {
    expect(say({ gte: [ AGE, 60 ] })).toBe("idade a partir de 60 anos");
    expect(say({ lte: [ AGE, 1 ] })).toBe("idade até 1 ano");
    expect(say({ all: [ { gte: [ AGE, 18 ] }, { lte: [ AGE, 59 ] } ] })).toBe("idade entre 18 e 59 anos");
    expect(say({ all: [ { gte: [ AGE, 40 ] }, { lte: [ AGE, 40 ] } ] })).toBe("idade igual a 40 anos");
    expect(say({ eq: [ AGE, 60 ] })).toBe("idade igual a 60 anos");
  });

  it("sexo é um de, em português", () => {
    expect(say({ in: [ "profile.sex", [ "female" ] ] })).toBe("sexo feminino");
    expect(say({ in: [ "profile.sex", [ "female", "male" ] ] })).toBe("sexo feminino ou masculino");
    expect(say({ eq: [ "profile.sex", "male" ] })).toBe("sexo masculino");
  });

  it("NÃO, E, OU e subgrupo entre parênteses", () => {
    expect(say({ not: { gte: [ AGE, 60 ] } })).toBe("não (idade a partir de 60 anos)");
    expect(say({ all: [ { gte: [ AGE, 40 ] }, { in: [ "profile.sex", [ "female" ] ] } ] }))
      .toBe("idade a partir de 40 anos e sexo feminino");
    expect(say({ all: [ { in: [ "profile.sex", [ "female" ] ] }, { any: [ { lte: [ AGE, 2 ] }, { gte: [ AGE, 60 ] } ] } ] }))
      .toBe("sexo feminino e (idade até 2 anos ou idade a partir de 60 anos)");
    expect(say({ all: [ { in: [ "profile.sex", [ "female" ] ] }, { all: [ { gte: [ AGE, 18 ] }, { lte: [ AGE, 59 ] } ] } ] }))
      .toBe("sexo feminino e idade entre 18 e 59 anos");
  });

  it("respostas e resultado na sugestão", () => {
    expect(say({ eq: [ "humor", "true" ] }, SUGG)).toBe('“Sentiu-se triste?” é sim');
    expect(say({ in: [ "freq", [ "às vezes", "sempre" ] ] }, SUGG)).toBe('“Com que frequência?” é às vezes ou sempre');
    expect(say({ gte: [ "dias", 14 ] }, SUGG)).toBe('“Há quantos dias?” a partir de 14');
    expect(say({ gte: [ "outcome.score", 15 ] }, SUGG)).toBe("pontuação a partir de 15");
    expect(say({ in: [ "outcome.tier", [ "alta" ] ] }, SUGG)).toBe("classificação alta");
  });

  it("bairro inativo e bairro desconhecido", () => {
    expect(say({ in: [ "citizen.neighborhood_id", [ "n1", "n3" ] ] }, REST)).toBe("bairro Xaxim ou Centro (bairro inativo)");
    expect(say({ in: [ "citizen.neighborhood_id", [ "zz" ] ] }, REST)).toBe("bairro zz (fora da lista)");
  });

  it("regra avançada também vira frase", () => {
    expect(say({ gt: [ AGE, 59 ] })).toBe("idade acima de 59 anos");
    expect(say({ lt: [ AGE, 12 ] })).toBe("idade abaixo de 12 anos");
    expect(say({ humor: "true", freq: "sempre" }, SUGG)).toBe('“Sentiu-se triste?” é sim e “Com que frequência?” é sempre');
    expect(say({ not: { not: { gte: [ AGE, 60 ] } } })).toBe("não (não (idade a partir de 60 anos))");
    expect(say({ gte: [ "profile.peso", 80 ] })).toBe("profile.peso a partir de 80");
  });

  it("o que não é condição diz que não reconhece", () => {
    expect(say("idade > 60")).toBe(UNKNOWN_RULE);
    expect(say({})).toBe(UNKNOWN_RULE);
    expect(say({ all: [] })).toBe(UNKNOWN_RULE);
    expect(say({ gte: [ AGE ] })).toBe(UNKNOWN_RULE);
  });
});
