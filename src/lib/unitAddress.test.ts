import { describe, expect, it } from "vitest";
import { EMPTY_ADDRESS, addressFieldsFrom, addressPayload, formatAddress, maskCep, zipError } from "./unitAddress";

describe("maskCep", () => {
  it("põe o hífen e corta em 8 dígitos", () => {
    expect(maskCep("80010000")).toBe("80010-000");
    expect(maskCep("80.010-0009")).toBe("80010-000");
    expect(maskCep("8001")).toBe("8001");
  });
});

describe("zipError", () => {
  it("vazio ou 8 dígitos passam; o resto não", () => {
    expect(zipError("")).toBeNull();
    expect(zipError("80010-000")).toBeNull();
    expect(zipError("8001")).toBe("CEP precisa ter 8 dígitos");
  });
});

describe("addressPayload", () => {
  it("apara, troca vazio por null e manda o CEP só com dígitos", () => {
    expect(addressPayload({ street: " Rua A ", number: "10", complement: "  ", zip: "80010-000", neighborhoodId: "n1" }))
      .toEqual({ address_street: "Rua A", address_number: "10", address_complement: null, address_zip: "80010000", neighborhood_id: "n1" });
  });
  it("formulário vazio vira EMPTY_ADDRESS", () => {
    expect(addressPayload({ street: "", number: "", complement: "", zip: "", neighborhoodId: "" })).toEqual(EMPTY_ADDRESS);
  });
});

describe("addressFieldsFrom", () => {
  it("unidade sem endereço (API antiga) vira campos vazios", () => {
    expect(addressFieldsFrom({})).toEqual({ street: "", number: "", complement: "", zip: "", neighborhoodId: "" });
  });
  it("CEP volta mascarado", () => {
    expect(addressFieldsFrom({ address_zip: "80010000" }).zip).toBe("80010-000");
  });
});

describe("formatAddress", () => {
  it("junta logradouro, número, complemento, bairro e CEP", () => {
    expect(formatAddress({ address_street: "Rua A", address_number: "1", address_complement: "sala 2", address_zip: "80010000" }, "Centro"))
      .toBe("Rua A, 1 — sala 2 · Centro · 80010-000");
    expect(formatAddress({ address_street: "Rua A", address_number: "1" }, "Centro")).toBe("Rua A, 1 · Centro");
  });
  it("sem nada: travessão", () => {
    expect(formatAddress({}, null)).toBe("—");
  });
});
