// src/lib/timeline.vaccination.test.ts
import { describe, expect, it } from "vitest";
import { TIMELINE_KINDS, detailTarget, statusLabel, timelineKindLabel, timelineKinds } from "./timeline";
import type { TimelineEntry } from "./api";

const entry = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({ id: "e1", kind: "vaccination", occurred_at: "2026-09-01T09:30:00-03:00",
  unit: { id: "u1", name: "UBS Centro" }, professional: { name: "Téc. Ana Souza", cbo_code: "322205" }, title: "Vacina Penta — 1ª dose",
  summary: null, status: "active", detail_ref: { type: "immunization", id: "im1" }, ...over });

describe("vacina na linha do tempo (módulo 29; fecha api#71)", () => {
  it("filtro só com o interruptor; rótulos", () => {
    expect(timelineKinds(false, false, false, true).map((k) => k.key)).toContain("vaccination");
    expect(timelineKinds(true, true, true).map((k) => k.key)).not.toContain("vaccination");
    expect(timelineKinds(true, true, true, true, true, true, true)).toEqual(TIMELINE_KINDS);
    expect(timelineKindLabel("vaccination")).toBe("Vacina");
    expect([ statusLabel("active"), statusLabel("cancelled") ]).toEqual([ "aplicada", "cancelado" ]);
  });
  it("abre o detalhe da dose só em contexto", () => {
    expect(detailTarget(entry(), true)).toEqual({ type: "immunization", id: "im1" });
    expect(detailTarget(entry(), false)).toBeNull();
    expect(detailTarget(entry({ detail_ref: null }), true)).toBeNull();
  });
});
