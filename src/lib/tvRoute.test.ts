import { describe, expect, it } from "vitest";
import { isTvHash } from "./tvRoute";

describe("isTvHash", () => {
  it("reconhece só a rota da TV", () => {
    expect(isTvHash("#/tv")).toBe(true);
    expect(isTvHash("#/tv/")).toBe(true);
    expect(isTvHash("#/")).toBe(false);
    expect(isTvHash("")).toBe(false);
    expect(isTvHash("#/tv-x")).toBe(false);
    expect(isTvHash("#/grupo/tv")).toBe(false);
  });
});
