import { describe, expect, it } from "vitest";
import { EMPTY_NAMES, namesBody, namesProblem } from "./citizenNames";

describe("nomes do documento", () => {
  it("nome completo obrigatório (3 a 200); social e mãe até 200", () => {
    expect(namesProblem(EMPTY_NAMES)).toBe("informe o nome completo como no documento");
    expect(namesProblem({ ...EMPTY_NAMES, fullName: " Jo " })).toBe("informe o nome completo como no documento");
    expect(namesProblem({ ...EMPTY_NAMES, fullName: "a".repeat(201) })).toBe("o nome completo pode ter até 200 caracteres");
    expect(namesProblem({ ...EMPTY_NAMES, fullName: "João Carlos Lima", socialName: "a".repeat(201) }))
      .toBe("o nome social pode ter até 200 caracteres");
    expect(namesProblem({ ...EMPTY_NAMES, fullName: "João Carlos Lima", motherName: "a".repeat(201) }))
      .toBe("o nome da mãe pode ter até 200 caracteres");
    expect(namesProblem({ fullName: "João Carlos Lima", socialName: "Joana Lima", motherName: "" })).toBeNull();
  });

  it("corpo: espaços normalizados e opcionais só quando preenchidos", () => {
    expect(namesBody({ fullName: "  João   Carlos Lima ", socialName: " ", motherName: "Maria  Lima" }))
      .toEqual({ full_name: "João Carlos Lima", mother_name: "Maria Lima" });
    expect(namesBody({ fullName: "João Carlos Lima", socialName: "Joana Lima", motherName: "" }))
      .toEqual({ full_name: "João Carlos Lima", social_name: "Joana Lima" });
  });
});
