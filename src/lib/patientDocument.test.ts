// src/lib/patientDocument.test.ts
import { describe, expect, it } from "vitest";
import { documentText, patientDocument } from "./patientDocument";

const CNS = "*** **** **** 1234";

describe("documento do paciente (contrato L8 do 24a)", () => {
  it("com CPF: a máscara de hoje", () => {
    expect(patientDocument({ has_cpf: true, cpf_masked: "***.982.247-**", cns_masked: CNS })).toEqual({ k: "CPF", v: "***.982.247-**" });
    expect(documentText({ has_cpf: true, cpf_masked: "***.982.247-**" })).toBe("CPF ***.982.247-**");
  });

  it("sem has_cpf (forma antiga): a máscara decide", () => {
    expect(patientDocument({ cpf_masked: "***.982.247-**" })).toEqual({ k: "CPF", v: "***.982.247-**" });
    expect(patientDocument({ cpf_masked: null })).toEqual({ k: "CPF", v: "sem CPF" });
  });

  it("has_cpf manda: com CPF e sem máscara é \"com CPF\", nunca \"sem CPF\"", () => {
    expect(patientDocument({ has_cpf: true, cns_masked: null })).toEqual({ k: "CPF", v: "com CPF" });
    expect(documentText({ has_cpf: true, cpf_masked: null })).toBe("com CPF");
  });

  it("sem CPF com CNS: \"sem CPF\" e o CNS mascarado", () => {
    expect(patientDocument({ has_cpf: false, cpf_masked: null, cns_masked: CNS })).toEqual({ k: "CNS", v: `sem CPF · CNS ${CNS}` });
    expect(documentText({ has_cpf: false, cpf_masked: null, cns_masked: CNS })).toBe(`sem CPF · CNS ${CNS}`);
  });

  it("sem os dois: \"sem CPF\" — nunca undefined/null", () => {
    expect(patientDocument({ has_cpf: false, cpf_masked: null, cns_masked: null })).toEqual({ k: "CPF", v: "sem CPF" });
    expect(documentText({ has_cpf: false })).toBe("sem CPF");
    expect(documentText({})).toBe("sem CPF");
  });
});
