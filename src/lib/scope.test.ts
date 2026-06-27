import { describe, it, expect } from "vitest";
import { scopeParams, type Scope } from "./scope";

const base: Scope = { period: "7d", municipalityId: "muni-1", setPeriod: () => {} };

describe("scopeParams", () => {
  it("inclui period e municipality_id", () => {
    expect(scopeParams(base)).toEqual({ period: "7d", municipality_id: "muni-1" });
  });
  it("reflete a mudança de period", () => {
    expect(scopeParams({ ...base, period: "30d" }).period).toBe("30d");
  });
  it("omite municipality_id quando null", () => {
    expect(scopeParams({ period: "7d", municipalityId: null, setPeriod: () => {} }))
      .toEqual({ period: "7d" });
  });
});
