// src/lib/api.clinicalDocuments.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addNursingProtocolVersion, addRemumeItem, cancelDocument, changeMedication, createNursingProtocol, fetchDocumentPdf,
  getCityDocumentsProfile, getClinicalDocument, getPrescriptionRenewal, issueAttendanceDeclaration, issueDocument,
  listConsultationDocuments, listNursingProtocols, listPatientMedications, listRemume, removeRemumeItem, searchMedications, setCityCnpj
} from "./api";
import { medication, nursingProtocol, remumeEntry, renewalItem, searchItem, sickNoteDoc } from "../test/documentFixtures";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
// Toda escrita por cookie exige JSON (CSRF do api): método, header e corpo.
function expectJsonWrite(fn: ReturnType<typeof stub>, method: string, body: unknown, i = 0) {
  expect(call(fn, i)[1].method).toBe(method);
  expect((call(fn, i)[1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  expect(JSON.parse(call(fn, i)[1].body as string)).toEqual(body);
}

describe("cliente dos documentos clínicos — consulta", () => {
  it("lista os documentos da consulta pelo id", async () => {
    const fn = stub({ items: [ sickNoteDoc() ] });
    expect((await listConsultationDocuments("cs1"))[0].short_code).toBe("K7Q2M-9XW4P");
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/documents");
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("emite com kind e content no corpo; o CID vai no corpo, nunca na URL", async () => {
    const fn = stub(sickNoteDoc(), 201);
    await issueDocument("cs1", { kind: "sick_note", content: { type: "leave", days: 3, start_on: "2026-10-09", cid10: { code: "J069" }, cid_authorized: true } });
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/documents");
    expectJsonWrite(fn, "POST", { kind: "sick_note", content: { type: "leave", days: 3, start_on: "2026-10-09", cid10: { code: "J069" }, cid_authorized: true } });
    expect(call(fn)[0]).not.toMatch(/J069/);
  });

  it("emitir outro manda replaces_document_id", async () => {
    const fn = stub(sickNoteDoc({ id: "doc9", replaces_document_id: "doc1" }), 201);
    await issueDocument("cs1", { kind: "exam_requisition", content: {} }, "doc1");
    expectJsonWrite(fn, "POST", { kind: "exam_requisition", content: {}, replaces_document_id: "doc1" });
  });

  it("declaração da recepção vai pelo atendimento", async () => {
    const fn = stub(sickNoteDoc(), 201);
    await issueAttendanceDeclaration("a1", { period: "morning" });
    expect(call(fn)[0]).toBe("/attendance/attendances/a1/declarations");
    expectJsonWrite(fn, "POST", { content: { period: "morning" } });
  });

  it("lê um documento e cancela com o motivo no corpo", async () => {
    let fn = stub(sickNoteDoc());
    await getClinicalDocument("doc1");
    expect(call(fn)[0]).toBe("/attendance/documents/doc1");
    fn = stub(sickNoteDoc({ status: "cancelled" }));
    await cancelDocument("doc1", "emitido com dias errados");
    expect(call(fn)[0]).toBe("/attendance/documents/doc1/cancel");
    expectJsonWrite(fn, "POST", { reason: "emitido com dias errados" });
  });

  it("o PDF é lido com a sessão e Accept application/pdf", async () => {
    const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("%PDF-1.7", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    vi.stubGlobal("fetch", fn);
    const file = await fetchDocumentPdf("doc1");
    expect(await file.blob.text()).toBe("%PDF-1.7");
    expect(fn.mock.calls[0][0]).toBe("/attendance/documents/doc1/print");
    expect(((fn.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Accept).toBe("application/pdf");
  });
});

describe("cliente dos documentos clínicos — medicamentos", () => {
  it("lista os medicamentos em uso do paciente", async () => {
    const fn = stub({ items: [ medication() ] });
    expect((await listPatientMedications("pa1"))[0].label).toBe("Metformina 850 mg");
    expect(call(fn)[0]).toBe("/attendance/patients/pa1/medications");
  });

  it("muda a lista pela consulta; o nome do medicamento de fora vai no corpo", async () => {
    const fn = stub(medication());
    await changeMedication("cs1", { action: "add_external", free_text: "Losartana 50 mg", dosage_summary: "1 cp/dia", continuous: true });
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/medications");
    expectJsonWrite(fn, "POST", { action: "add_external", free_text: "Losartana 50 mg", dosage_summary: "1 cp/dia", continuous: true });
    expect(call(fn)[0]).not.toMatch(/Losartana/);
  });

  it("renovação e busca no catálogo (termo no corpo; unit_id só quando há unidade)", async () => {
    let fn = stub({ items: [ renewalItem() ] });
    expect((await getPrescriptionRenewal("cs1"))[0].dosage_instructions).toBe("1 cp/dia");
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/renewal");
    fn = stub({ items: [ searchItem() ] });
    await searchMedications("metformina", "u1");
    expect(call(fn)[0]).toBe("/attendance/medications/search");
    expectJsonWrite(fn, "POST", { q: "metformina", unit_id: "u1" });
    fn = stub({ items: [] });
    await searchMedications("dipirona");
    expectJsonWrite(fn, "POST", { q: "dipirona" });
  });
});

describe("cliente dos documentos clínicos — cidade (municipal_admin)", () => {
  it("CNPJ: lê e grava com PUT JSON", async () => {
    let fn = stub({ name: "Curitiba", cnpj: null });
    expect((await getCityDocumentsProfile()).cnpj).toBeNull();
    expect(call(fn)[0]).toBe("/clinical_documents/city_profile");
    fn = stub({ name: "Curitiba", cnpj: "11222333000181" });
    await setCityCnpj("11222333000181");
    expect(call(fn)[0]).toBe("/clinical_documents/city_profile");
    expectJsonWrite(fn, "PUT", { cnpj: "11222333000181" });
  });

  it("REMUME: lista, inclui (unidades só quando escolhidas) e tira com DELETE JSON", async () => {
    let fn = stub({ items: [ remumeEntry() ] });
    expect((await listRemume())[0].catalog_item.id).toBe("ci1");
    expect(call(fn)[0]).toBe("/clinical_documents/remume");
    fn = stub(remumeEntry({ unit_ids: [ "u1" ] }), 201);
    await addRemumeItem("ci1", [ "u1" ]);
    expectJsonWrite(fn, "POST", { catalog_item_id: "ci1", unit_ids: [ "u1" ] });
    fn = stub(remumeEntry(), 201);
    await addRemumeItem("ci1", []);
    expectJsonWrite(fn, "POST", { catalog_item_id: "ci1" });
    fn = stub(undefined, 204);
    await removeRemumeItem("ci1");
    expect(call(fn)[0]).toBe("/clinical_documents/remume/ci1");
    expectJsonWrite(fn, "DELETE", {});
  });

  it("protocolos: lista, cria e cria versão", async () => {
    let fn = stub({ items: [ nursingProtocol() ] });
    expect((await listNursingProtocols())[0].number).toBe("007/2025");
    expect(call(fn)[0]).toBe("/clinical_documents/nursing_protocols");
    const input = { title: "Protocolo", number: "007/2025", year: 2025, valid_from: "2026-10-09", items: [ { catalog_item_id: "ci4", max_dose: { quantity: 2, unit: "frasco" } } ] };
    fn = stub(nursingProtocol(), 201);
    await createNursingProtocol(input);
    expectJsonWrite(fn, "POST", input);
    fn = stub(nursingProtocol(), 201);
    await addNursingProtocolVersion("np1", { valid_from: "2026-10-09", items: [ { catalog_item_id: "ci4" } ] });
    expect(call(fn)[0]).toBe("/clinical_documents/nursing_protocols/np1/versions");
    expectJsonWrite(fn, "POST", { valid_from: "2026-10-09", items: [ { catalog_item_id: "ci4" } ] });
  });
});
