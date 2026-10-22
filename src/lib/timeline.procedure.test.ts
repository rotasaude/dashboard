// src/lib/timeline.procedure.test.ts
import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, TIMELINE_KINDS, detailTarget, filtersFrom, statusLabel, timelineKinds, timelineKindLabel, toggleKind } from "./timeline";
import { entry } from "../test/timelineFixtures";

describe("linha do tempo — procedimentos (módulo 22; contrato §9)", () => {
  const proc = entry({
    id: "procedure:pp1", kind: "procedure", title: "Atendimento de urgência em atenção especializada", summary: null,
    status: "recorded", detail_ref: null
  });

  it("tipo e situação em português; não abre detalhe", () => {
    expect(timelineKindLabel("procedure")).toBe("Procedimento");
    expect(TIMELINE_KINDS[TIMELINE_KINDS.length - 1]).toEqual({ key: "procedure", label: "Procedimento" });
    expect(statusLabel("recorded")).toBe("registrado");
    expect(statusLabel("cancelled")).toBe("cancelado");
    expect(detailTarget(proc, true)).toBeNull();
  });

  it("sem procedure_billing, o tipo não existe nos filtros nem vai no pedido", () => {
    const kinds = timelineKinds(true, false);
    expect(kinds.some((k) => k.key === "procedure")).toBe(false);
    expect(kinds.some((k) => k.key === "exam")).toBe(true);
    expect(timelineKinds(false, true).map((k) => k.key)).toContain("procedure");
    expect(timelineKinds(true, true)).toEqual(TIMELINE_KINDS);
    expect(filtersFrom(toggleKind(EMPTY_DRAFT, "campaign"), kinds).kinds).not.toContain("procedure");
  });

  it("com ele, só procedimento vai como kinds[]=procedure", () => {
    expect(filtersFrom({ kinds: [ "procedure" ], from: "", to: "" }).kinds).toEqual([ "procedure" ]);
  });
});
