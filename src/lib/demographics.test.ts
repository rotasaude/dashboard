// src/lib/demographics.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  EMPTY_DEMOGRAPHICS, RACE_COLORS, demographicsBody, demographicsError, demographicsFilled, demographicsProblem, missingText
} from "./demographics";

const ADDRESS = { ...EMPTY_DEMOGRAPHICS, zip: "80010-000", street: "RUA XV DE NOVEMBRO", number: "100", district: "CENTRO" };

describe("dados do paciente para o BPA-I (contrato §12, D-U1)", () => {
  it("lista de raça/cor do layout, sem 'sem informação' (99)", () => {
    expect(RACE_COLORS.map((r) => r.code)).toEqual([ "01", "02", "03", "04", "05" ]);
    expect(RACE_COLORS.some((r) => (r.code as string) === "99")).toBe(false);
  });

  it("tudo opcional: vazio não é problema, mas também não é 'preenchido'", () => {
    expect(demographicsFilled(EMPTY_DEMOGRAPHICS)).toBe(false);
    expect(demographicsProblem(EMPTY_DEMOGRAPHICS)).toBeNull();
    expect(demographicsFilled({ ...EMPTY_DEMOGRAPHICS, raceColor: "03" })).toBe(true);
  });

  it("indígena exige a etnia (4 dígitos); os outros não mandam etnia", () => {
    expect(demographicsProblem({ ...EMPTY_DEMOGRAPHICS, raceColor: "05" })).toBe("para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS");
    expect(demographicsProblem({ ...EMPTY_DEMOGRAPHICS, raceColor: "05", ethnicity: "12" })).toBe("para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS");
    expect(demographicsBody({ ...EMPTY_DEMOGRAPHICS, raceColor: "05", ethnicity: " 0001 " })).toEqual({ race_color: "05", ethnicity: "0001" });
    // A etnia é recusada pelo api fora de 05: nem vai no corpo.
    expect(demographicsBody({ ...EMPTY_DEMOGRAPHICS, raceColor: "03", ethnicity: "0001" })).toEqual({ race_color: "03" });
  });

  it("endereço: começou, precisa de CEP com 8 dígitos, logradouro e bairro; larguras recusadas, nunca cortadas", () => {
    expect(demographicsProblem({ ...EMPTY_DEMOGRAPHICS, street: "RUA XV" })).toBe("CEP com 8 dígitos");
    expect(demographicsProblem({ ...ADDRESS, street: "" })).toBe("informe o logradouro");
    expect(demographicsProblem({ ...ADDRESS, district: "" })).toBe("informe o bairro");
    expect(demographicsProblem({ ...ADDRESS, street: "x".repeat(31) })).toBe("logradouro com até 30 caracteres (largura do arquivo BPA) — abrevie");
    expect(demographicsProblem({ ...ADDRESS, number: "123456" })).toBe("número com até 5 caracteres");
    expect(demographicsProblem({ ...ADDRESS, complement: "x".repeat(11) })).toBe("complemento com até 10 caracteres — abrevie");
    expect(demographicsProblem({ ...ADDRESS, district: "x".repeat(31) })).toBe("bairro com até 30 caracteres (largura do arquivo BPA) — abrevie");
    expect(demographicsProblem(ADDRESS)).toBeNull();
    expect(demographicsBody(ADDRESS)).toEqual({
      address_zip: "80010000", address_street: "RUA XV DE NOVEMBRO", address_number: "100", address_district: "CENTRO"
    });
    // Sem número, "SN" (padrão do layout); complemento só se houver.
    expect(demographicsBody({ ...ADDRESS, number: " ", complement: "APTO 12" })).toEqual({
      address_zip: "80010000", address_street: "RUA XV DE NOVEMBRO", address_number: "SN", address_complement: "APTO 12", address_district: "CENTRO"
    });
  });

  it("o que falta em frase; recusas do api", () => {
    expect(missingText([ "race_color", "address" ])).toBe("raça/cor; CEP e endereço");
    expect(missingText([ "phone" ])).toBe("phone");
    expect(demographicsError(new ApiError(422, { error: "invalid_zip" }, "x"))).toBe("CEP inválido — confira os 8 dígitos");
    expect(demographicsError(new ApiError(422, { error: "ethnicity_required" }, "x"))).toBe("para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS");
    expect(demographicsError(new ApiError(403, { error: "missing_role" }, "x"))).toBe("seu papel não permite alterar os dados do paciente");
    expect(demographicsError(new ApiError(422, { error: "too_long", field: "address_street" }, "x"))).toBe("logradouro maior que a largura do arquivo BPA — abrevie");
    expect(demographicsError(new ApiError(422, { error: "too_long", field: "outro" }, "x"))).toBe("texto maior que a largura do arquivo BPA — abrevie");
    expect(demographicsError(new ApiError(500, "", "x"))).toBe("não foi possível salvar (500) — tente de novo");
  });
});
