// src/lib/examsAdmin.test.ts
import { describe, expect, it } from "vitest";
import { catalogBody, catalogDraft, catalogProblem, providerBody, providerDraft, providerProblem } from "./examsAdmin";
import { examCatalogItem, examProvider } from "../test/examFixtures";

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

describe("prestador (contrato §5)", () => {
  const labelOf = (id: string) => (id === "ci1" ? "Hemograma completo" : id);

  it("rascunho do prestador existente e corpo de volta", () => {
    const d = providerDraft(examProvider());
    expect(d.items).toEqual({ ci1: { authorize: "", schedule: "", collect: "", result: "5", acknowledge: "" } });
    expect(providerBody(d)).toEqual({
      name: "Laboratório Simulado", cnes: "1234567", kind: "accredited", active: true,
      items: [ { catalog_item_id: "ci1", deadlines: { authorize: null, schedule: null, collect: null, result: 5, acknowledge: null } } ]
    });
  });

  it("o corpo nunca leva simulated, token nem usuários", () => {
    const body = providerBody(providerDraft(examProvider({ simulated: true, has_fhir_token: true, users: [ { user_id: "u1", email: "a@b.co" } ] })));
    expect(Object.keys(body).sort()).toEqual([ "active", "cnes", "items", "kind", "name" ]);
  });

  it("nome, CNES e prazos por exame", () => {
    const d = providerDraft();
    expect(providerProblem(d, labelOf)).toBe("informe o nome do prestador");
    expect(providerProblem({ ...d, name: "Lab", cnes: "12" }, labelOf)).toBe("o CNES tem 7 dígitos");
    const bad = { ...d, name: "Lab", items: { ci1: { authorize: "", schedule: "", collect: "x", result: "", acknowledge: "" } } };
    expect(providerProblem(bad, labelOf)).toBe("Hemograma completo: prazo de coleta: use dias inteiros de 1 a 365, ou deixe em branco");
    expect(providerBody({ ...d, name: " Lab ", cnes: " " }).cnes).toBeNull();
  });
});
