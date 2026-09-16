import { describe, it, expect } from "vitest";
import { scopeParams, type Scope } from "./scope";

const base: Scope = { period: "7d", municipalityId: "muni-1", setPeriod: () => {} };

describe("scopeParams", () => {
  it("inclui period", () => {
    expect(scopeParams(base)).toEqual({ period: "7d" });
  });
  it("reflete a mudança de period", () => {
    expect(scopeParams({ ...base, period: "30d" }).period).toBe("30d");
  });
  it("não manda municipality_id: o escopo é o banco da cidade do host", () => {
    expect(scopeParams({ period: "7d", municipalityId: null, setPeriod: () => {} }))
      .toEqual({ period: "7d" });
  });
});
