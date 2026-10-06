import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { competenceLabel, competenceOf, competenceOptions, isCompetence, recentCompetences } from "./competence";
import { todayInCity } from "./campaigns";

describe("competência AAAAMM", () => {
  it("valida e rotula por texto", () => {
    expect(isCompetence("202610")).toBe(true);
    expect(isCompetence("202613")).toBe(false);
    expect(isCompetence("2026-10")).toBe(false);
    expect(competenceLabel("202610")).toBe("10/2026");
    expect(competenceLabel("lixo")).toBe("lixo");
  });

  it("recentes atravessam a virada do ano, corrente primeiro", () => {
    expect(recentCompetences("2026-02-10", 4)).toEqual([ "202602", "202601", "202512", "202511" ]);
    expect(recentCompetences("2026-10-05")).toHaveLength(13);
  });

  it("opções incluem a competência da API se ela não estiver entre as recentes", () => {
    expect(competenceOptions("2026-10-05", "202610").slice(0, 2)).toEqual([ "202610", "202609" ]);
    expect(competenceOptions("2026-10-05", "202501")).toContain("202501");
    expect(competenceOptions("2026-10-05", null)).toHaveLength(13);
  });
});

describe("competência corrente pelo dia da cidade", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    // 22h30 de 31/10 em São Paulo; em UTC já é 01/11.
    vi.setSystemTime(new Date("2026-11-01T01:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("às 22h30 de 31/10 ainda é 10/2026", () => {
    expect(competenceOf(todayInCity())).toBe("202610");
  });
});
