// src/lib/timeline.pharmacy.test.ts
import { describe, expect, it } from "vitest";
import { TIMELINE_KINDS, statusLabel, timelineKindLabel, timelineKinds } from "./timeline";

describe("dispensação na linha do tempo (módulo 27a)", () => {
  it("só com a farmácia ligada; rótulo e situação em português", () => {
    expect(timelineKinds(false, false, true).map((k) => k.key)).toContain("dispensation");
    expect(timelineKinds(true, true).map((k) => k.key)).not.toContain("dispensation");
    expect(timelineKinds(true, true, true)).toEqual(TIMELINE_KINDS);
    expect(timelineKindLabel("dispensation")).toBe("Dispensação");
    expect(statusLabel("dispensed")).toBe("dispensado");
  });
});
