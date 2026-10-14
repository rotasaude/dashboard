import { describe, expect, it } from "vitest";
import { addendumChanges, checkDraft, draftFrom, setPriority } from "./consultation";
import { consultation } from "../test/consultationFixtures";

describe("prioridade do exame no rascunho (módulo 21a, D10)", () => {
  const exam = { sigtap_code: "0202020380", label: "Hemograma completo" };

  it("setPriority troca só o exame pedido", () => {
    const next = setPriority([ exam, { sigtap_code: "0202010503", label: "HbA1c" } ], "0202020380", "urgent");
    expect(next.map((e) => e.priority)).toEqual([ "urgent", undefined ]);
  });

  it("o corpo do autosave leva a prioridade quando há, e nada quando não há", () => {
    const d = draftFrom(consultation({ exam_requests: [ { ...exam, priority: "urgent" }, { sigtap_code: "0202010503", label: "HbA1c" } ] }));
    expect(checkDraft(d).input.exam_requests).toEqual([
      { sigtap_code: "0202020380", label: "Hemograma completo", priority: "urgent" },
      { sigtap_code: "0202010503", label: "HbA1c" }
    ]);
  });

  it("adendo: mesmo exame com a prioridade trocada (removido e pedido de novo) conta como mudança", () => {
    const base = consultation({ exam_requests: [ { ...exam, priority: "routine" } ] });
    const changes = addendumChanges(base, { problems: [], conducts: base.conducts, exams: [ { ...exam, priority: "urgent" } ] });
    expect(changes?.exam_requests).toEqual([ { ...exam, priority: "urgent" } ]);
    expect(addendumChanges(base, { problems: [], conducts: base.conducts, exams: [ exam ] })).toBeUndefined();
  });
});
