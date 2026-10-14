// src/lib/examsAdmin.test.ts
import { describe, expect, it } from "vitest";
import { catalogBody, catalogDraft, catalogProblem } from "./examsAdmin";
import { examCatalogItem } from "../test/examFixtures";

describe("catálogo (contrato §5)", () => {
  it("rascunho vazio: sem autorização, depois da ciência, prazos herdados, ativo", () => {
    expect(catalogDraft()).toEqual({
      sigtapCode: "", requiresAuthorization: false, releasePolicy: "after_acknowledgement",
      deadlines: { authorize: "", schedule: "", collect: "", result: "", acknowledge: "" }, fields: [], active: true
    });
  });

  it("valida SIGTAP, prazos e campos, nessa ordem", () => {
    const d = catalogDraft(examCatalogItem());
    expect(catalogProblem(d)).toBeNull();
    expect(catalogProblem({ ...d, sigtapCode: "123" })).toBe("o código SIGTAP tem 10 dígitos");
    expect(catalogProblem({ ...d, deadlines: { ...d.deadlines, schedule: "400" } }))
      .toBe("prazo de agendamento: use dias inteiros de 1 a 365, ou deixe em branco");
    expect(catalogProblem({ ...d, fields: [ { key: "", label: "x", unit: null, loinc: null } ] }))
      .toBe("campo 1: a chave usa letras minúsculas, números e _ (ex.: hemoglobina)");
  });

  it("corpo: prazos em número ou null; unidade e LOINC vazios viram null", () => {
    const d = { ...catalogDraft(examCatalogItem()), fields: [ { key: " hba1c ", label: " HbA1c ", unit: "", loinc: " " } ] };
    expect(catalogBody(d)).toEqual({
      sigtap_code: "0202020380", requires_authorization: false, release_policy: "after_acknowledgement",
      deadlines: { authorize: null, schedule: null, collect: null, result: 10, acknowledge: null },
      result_fields: [ { key: "hba1c", label: "HbA1c", unit: null, loinc: null } ], active: true
    });
  });
});
