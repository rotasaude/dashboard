import { describe, it, expect } from "vitest";
import { parseDefinition, TEMPLATE } from "./editor";

describe("parseDefinition", () => {
  it("ok for valid JSON", () => {
    const r = parseDefinition('{"a":1}');
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });
  it("error for invalid JSON", () => {
    const r = parseDefinition("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });
});

describe("TEMPLATE", () => {
  it("parses to a definition with name/version/steps", () => {
    const r = parseDefinition(TEMPLATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as Record<string, unknown>;
      expect(v.name).toBeTruthy();
      expect(v.version).toBe(1);
      expect(Array.isArray(v.steps)).toBe(true);
    }
  });
});
