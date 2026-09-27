import { afterEach, describe, it, expect } from "vitest";
import { fmtNumber, fmtDuration, fmtHourMinute, parseCityLocal } from "./format";

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

describe("parseCityLocal", () => {
  const original = process.env.TZ;
  afterEach(() => { process.env.TZ = original; });

  it("lê o valor do datetime-local no fuso da cidade, não no da máquina", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(new Date("2026-09-26T09:00").toISOString()).toBe("2026-09-26T00:00:00.000Z"); // o bug
    expect(parseCityLocal("2026-09-26T09:00")?.toISOString()).toBe("2026-09-26T12:00:00.000Z");
    process.env.TZ = "America/Manaus";
    expect(parseCityLocal("2026-09-26T23:30")?.toISOString()).toBe("2026-09-27T02:30:00.000Z");
  });

  it("valor vazio ou inválido: null", () => {
    expect(parseCityLocal("")).toBeNull();
    expect(parseCityLocal("amanhã")).toBeNull();
  });
});
