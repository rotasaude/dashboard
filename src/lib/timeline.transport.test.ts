import { describe, expect, it } from "vitest";
import { detailTarget, timelineKindLabel, timelineKinds } from "./timeline";
import type { TimelineEntry } from "./api";

describe("linha do tempo: transporte (módulo 30)", () => {
  it("filtro só com sanitary_transport; rótulo", () => {
    expect(timelineKinds(false, false, false, false, true).map((k) => k.key)).toContain("transport");
    expect(timelineKinds(false).map((k) => k.key)).not.toContain("transport");
    expect(timelineKindLabel("transport")).toBe("Transporte");
  });
  it("entrada de viagem não abre detalhe (D12)", () => {
    const entry: TimelineEntry = { id: "e1", kind: "transport", occurred_at: "2026-11-03T05:30:00-03:00", unit: null, professional: null,
      title: "Viagem para Curitiba", summary: null, status: null, detail_ref: null } as TimelineEntry;
    expect(detailTarget(entry, true)).toBeNull();
  });
});
