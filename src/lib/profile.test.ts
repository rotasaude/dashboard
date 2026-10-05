import { describe, expect, it } from "vitest";
import {
  GENDER_IDENTITY_OPTIONS, SEX_OPTIONS, ageOn, birthDateProblem, describeProfile, genderIdentityLabel, sexLabel
} from "./profile";

const TODAY = "2026-10-05";

describe("rótulos do perfil", () => {
  it("sexo tem só os dois valores do contrato", () => {
    expect(SEX_OPTIONS.map((o) => o.value)).toEqual([ "female", "male" ]);
    expect(sexLabel("female")).toBe("feminino");
    expect(sexLabel("male")).toBe("masculino");
  });

  it("identidade de gênero usa os rótulos do contrato, e null é 'não informada'", () => {
    expect(GENDER_IDENTITY_OPTIONS.map((o) => o.label)).toEqual([
      "Mulher cis", "Homem cis", "Mulher trans", "Homem trans", "Travesti", "Não binária", "Outra"
    ]);
    expect(genderIdentityLabel("non_binary")).toBe("Não binária");
    expect(genderIdentityLabel(null)).toBe("não informada");
  });
});

describe("idade na borda do aniversário", () => {
  it("aniversário hoje já conta o ano novo; amanhã ainda não", () => {
    expect(ageOn("1966-10-05", TODAY)).toBe(60);
    expect(ageOn("1966-10-06", TODAY)).toBe(59);
  });

  it("29 de fevereiro faz aniversário em 1º de março no ano comum", () => {
    expect(ageOn("2000-02-29", "2025-02-28")).toBe(24);
    expect(ageOn("2000-02-29", "2025-03-01")).toBe(25);
  });

  it("data que não existe não tem idade", () => {
    expect(ageOn("2026-02-30", TODAY)).toBeNull();
    expect(ageOn("02/04/1963", TODAY)).toBeNull();
  });
});

describe("data de nascimento inválida", () => {
  it("vazia, inexistente, futura e acima de 130 anos são recusadas", () => {
    expect(birthDateProblem("", TODAY)).toBe("informe a data de nascimento");
    expect(birthDateProblem("2026-13-01", TODAY)).toBe("data de nascimento inválida");
    expect(birthDateProblem("2026-10-06", TODAY)).toBe("a data de nascimento não pode ser no futuro");
    expect(birthDateProblem("1895-10-04", TODAY)).toBe("idade acima de 130 anos — confira a data");
  });

  it("hoje e exatamente 130 anos são aceitos", () => {
    expect(birthDateProblem(TODAY, TODAY)).toBeNull();
    expect(birthDateProblem("1896-10-05", TODAY)).toBeNull();
  });
});

describe("perfil em frase", () => {
  it("mostra data sem deslocar o dia, idade, sexo e identidade", () => {
    expect(describeProfile({ birth_date: "1963-04-02", sex: "female", gender_identity: "cis_woman", profile_source: "declared" }, TODAY))
      .toBe("nascimento 02/04/1963 (63 anos) · sexo feminino · identidade de gênero Mulher cis");
  });

  it("um ano no singular, e sem perfil diz isso", () => {
    expect(describeProfile({ birth_date: "2025-10-01", sex: "male", gender_identity: null, profile_source: "declared" }, TODAY))
      .toBe("nascimento 01/10/2025 (1 ano) · sexo masculino · identidade de gênero não informada");
    expect(describeProfile(null, TODAY)).toBe("sem perfil declarado");
  });
});
