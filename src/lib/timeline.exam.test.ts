// src/lib/timeline.exam.test.ts
import { describe, expect, it } from "vitest";
import { TIMELINE_KINDS, detailTarget, filtersFrom, statusLabel, timelineKindLabel } from "./timeline";
import { entry } from "../test/timelineFixtures";

describe("linha do tempo — exames (módulo 21a; contrato §10)", () => {
  const exam = entry({ id: "exam:eo1", kind: "exam", title: "Hemograma completo", status: "awaiting_schedule", detail_ref: { type: "exam_order", id: "eo1" } });

  it("tipo e situações em português", () => {
    expect(timelineKindLabel("exam")).toBe("Exame");
    expect(TIMELINE_KINDS[TIMELINE_KINDS.length - 1]).toEqual({ key: "exam", label: "Exame" });
    expect(statusLabel("awaiting_schedule")).toBe("a agendar");
    expect(statusLabel("resulted")).toBe("resultado registrado");
    expect(statusLabel("acknowledged")).toBe("ciência dada");
    expect(statusLabel("denied")).toBe("negado");
  });

  it("abre o exame em contexto; pela abertura justificada, não", () => {
    expect(detailTarget(exam, true)).toEqual({ type: "exam_order", id: "eo1" });
    expect(detailTarget(exam, false)).toBeNull();
  });

  it("todos os tipos marcados continuam sem kinds[]; só exame vai como kinds[]=exam", () => {
    const all = TIMELINE_KINDS.map((k) => k.key);
    expect(filtersFrom({ kinds: all, from: "", to: "" }).kinds).toEqual([]);
    expect(filtersFrom({ kinds: [ "exam" ], from: "", to: "" }).kinds).toEqual([ "exam" ]);
  });

  it("resultado externo (api: status external, detail_ref exam_result): rótulo próprio e sem detalhe", () => {
    expect(statusLabel("external")).toBe("resultado externo");
    const ext = entry({ id: "exam:er1", kind: "exam", status: "external", detail_ref: { type: "exam_result", id: "er1" } });
    expect(detailTarget(ext, true)).toBeNull();
  });

  it("situação desconhecida usa o status_label do api, se houver", () => {
    expect(statusLabel("novo_codigo", "Rótulo do api")).toBe("Rótulo do api");
    expect(statusLabel("novo_codigo")).toBe("novo_codigo");
    expect(statusLabel("resulted", "Outro")).toBe("resultado registrado");
  });
});
