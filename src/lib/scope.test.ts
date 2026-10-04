import { describe, it, expect } from "vitest";
import { scopeParams, type Scope } from "./scope";

const base: Scope = { period: "7d", citySlug: "muni-1", setPeriod: () => {} };

describe("scopeParams", () => {
  it("inclui period", () => {
    expect(scopeParams(base)).toEqual({ period: "7d" });
  });
  it("reflete a mudança de period", () => {
    expect(scopeParams({ ...base, period: "30d" }).period).toBe("30d");
  });
  it("não manda município nem cidade: o escopo é o banco da cidade do host", () => {
    expect(scopeParams({ period: "7d", citySlug: null, setPeriod: () => {} }))
      .toEqual({ period: "7d" });
  });
});
