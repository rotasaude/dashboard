import { describe, it, expect, vi, afterEach } from "vitest";
import { municipalityId } from "./tenant";

afterEach(() => vi.unstubAllEnvs());

describe("municipalityId", () => {
  it("resolve VITE_MUNICIPALITY_ID", () => {
    vi.stubEnv("VITE_MUNICIPALITY_ID", "muni-123");
    expect(municipalityId()).toBe("muni-123");
  });
  it("lança quando ausente", () => {
    vi.stubEnv("VITE_MUNICIPALITY_ID", "");
    expect(() => municipalityId()).toThrow(/VITE_MUNICIPALITY_ID/);
  });
});
