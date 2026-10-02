import { afterEach, describe, it, expect } from "vitest";
import {
  cityIsoDate, cityLocalIso, cityOffsetLabel, cityTimeZone, fmtDateTime, fmtNumber, fmtDuration, fmtHourMinute,
  parseCityLocal, setCityTimeZone
} from "./format";

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

describe("fuso da cidade (api#27)", () => {
  afterEach(() => setCityTimeZone(null));

  // 03h30 UTC: 00h30 em São Paulo e 23h30 do dia anterior em Manaus.
  const AT = "2026-10-03T03:30:00Z";

  it("sem sessão, horário de Brasília", () => {
    expect(cityTimeZone()).toBe("America/Sao_Paulo");
    expect(fmtHourMinute(AT)).toBe("00:30");
    expect(cityOffsetLabel(new Date(AT))).toBe("GMT-3");
  });

  it("em Manaus, formata, data e rotula no fuso dela", () => {
    setCityTimeZone("America/Manaus");
    expect(fmtHourMinute(AT)).toBe("23:30");
    expect(fmtDateTime(AT)).toBe("02/10/2026, 23:30");
    expect(cityIsoDate(new Date(AT))).toBe("2026-10-02");
    expect(cityOffsetLabel(new Date(AT))).toBe("GMT-4");
  });

  it("em Rio Branco, a hora digitada vira o instante certo", () => {
    setCityTimeZone("America/Rio_Branco");
    expect(parseCityLocal("2026-10-02T22:30")?.toISOString()).toBe("2026-10-03T03:30:00.000Z");
    expect(cityLocalIso("2026-10-02T22:30")).toBe("2026-10-02T22:30:00-05:00");
  });

  it("fuso vazio volta ao de Brasília", () => {
    setCityTimeZone("America/Manaus");
    setCityTimeZone(undefined);
    expect(cityTimeZone()).toBe("America/Sao_Paulo");
  });
});
