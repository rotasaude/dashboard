import { describe, it, expect } from "vitest";
import { fmtNumber, fmtDuration, fmtHourMinute } from "./format";

describe("fmtNumber", () => {
  it("formata inteiro com separador de milhar pt-BR", () => {
    expect(fmtNumber(1234)).toBe("1.234");
  });
  it("travessão para null e NaN", () => {
    expect(fmtNumber(null)).toBe("—");
    expect(fmtNumber(NaN)).toBe("—");
  });
});

describe("fmtDuration", () => {
  it("segundos", () => { expect(fmtDuration(45)).toBe("45s"); });
  it("minutos arredondados", () => { expect(fmtDuration(90)).toBe("2 min"); });
  it("travessão para null", () => { expect(fmtDuration(null)).toBe("—"); });
});

describe("fmtHourMinute", () => {
  it("hh:mm no fuso America/Sao_Paulo, sem segundos", () => {
    expect(fmtHourMinute("2026-09-25T23:43:24Z")).toBe("20:43");
  });
  it("travessão para null e data inválida", () => {
    expect(fmtHourMinute(null)).toBe("—");
    expect(fmtHourMinute("x")).toBe("—");
  });
});
