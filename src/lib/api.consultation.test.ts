// src/lib/api.consultation.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, addAddendum, completeCitizenNames, fetchConsultationPdf, finalizeConsultation, getAttendanceRecord,
  getConsultation, getConsultationOptions, getJustifiedRecord, listOpenings, openClinicalRecord, saveConsultationDraft,
  searchSigtap, searchTerminology, startConsultation, verifyCitizen
} from "./api";
import { consultation, finalized, opening, openingRow, options, record } from "../test/consultationFixtures";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
const sent = (fn: ReturnType<typeof stub>, i = 0) => JSON.parse(call(fn, i)[1].body as string);
const draftInput = {
  subjective: "dor no peito", objective: "", assessment: "", plan: "", vitals: { systolic: 150, diastolic: 95 },
  care_type: "5", evaluated_problems: [], conducts: [ "9" ], exam_requests: []
};

describe("cliente do módulo 19 — prontuário e consulta", () => {
  it("prontuário em contexto e opções da consulta são GET com só o id na URL", async () => {
    let fn = stub(record());
    expect((await getAttendanceRecord("a/1")).patient.display_name).toBe("Joana Lima");
    expect(call(fn)[0]).toBe("/attendance/attendances/a%2F1/record");
    expect(call(fn)[1].method).toBeUndefined();
    expect(call(fn)[1].credentials).toBe("include");

    fn = stub(options());
    expect((await getConsultationOptions()).cid10_allowed_for_cbo).toBe(true);
    expect(call(fn)[0]).toBe("/attendance/consultation_options");
  });

  it("iniciar, ler, salvar e finalizar", async () => {
    let fn = stub(consultation(), 201);
    expect((await startConsultation("a1")).status).toBe("draft");
    expect(call(fn)[0]).toBe("/attendance/attendances/a1/consultation");
    expect(call(fn)[1].method).toBe("POST");

    fn = stub(consultation());
    await getConsultation("cs1");
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1");
    expect(call(fn)[1].method).toBeUndefined();

    fn = stub(consultation({ subjective: "dor no peito" }));
    await saveConsultationDraft("cs1", draftInput);
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1");
    expect(call(fn)[1].method).toBe("PATCH");
    expect(sent(fn)).toEqual(draftInput);

    fn = stub(finalized());
    await finalizeConsultation("cs1", { outcome: "referred", referral_unit_id: "u2" });
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/finalize");
    expect(sent(fn)).toEqual({ outcome: { outcome: "referred", referral_unit_id: "u2" } });
  });

  it("adendo manda motivo, texto, mudanças e a abertura no corpo", async () => {
    const fn = stub({ id: "ad1", author_name: "Enf. Lúcia Prado", created_at: "2026-10-07T10:40:00-03:00",
      reason: "correção do plano", text: "Retorno em 15 dias.", changes: { conducts: [ "12" ] } }, 201);
    const out = await addAddendum("cs1", { reason: "correção do plano", text: "Retorno em 15 dias.",
      changes: { conducts: [ "12" ] }, opening_id: "op1" });
    expect(out.id).toBe("ad1");
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/addenda");
    expect(sent(fn)).toEqual({ reason: "correção do plano", text: "Retorno em 15 dias.", changes: { conducts: [ "12" ] }, opening_id: "op1" });
  });

  it("impresso: pede PDF com a sessão e devolve o arquivo; 409 vira ApiError com o código", async () => {
    let fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } }));
    vi.stubGlobal("fetch", fn);
    const blob = await fetchConsultationPdf("cs1");
    expect(blob.size).toBe(8);
    expect(fn.mock.calls[0][0]).toBe("/attendance/consultations/cs1/print");
    expect((fn.mock.calls[0][1] as RequestInit).credentials).toBe("include");
    expect(((fn.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Accept).toBe("application/pdf");

    fn = stub({ error: "patient_name_missing" }, 409);
    const err = await fetchConsultationPdf("cs1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toEqual({ error: "patient_name_missing" });
  });
});

describe("cliente do módulo 19 — buscas de terminologia", () => {
  it("CIAP-2 e CID-10 pela rota do módulo 18, com a terminologia no corpo", async () => {
    const fn = stub({ items: [ { code: "E11", label: "Diabetes mellitus não insulino-dependente" } ] });
    expect((await searchTerminology("diabetes", "cid10"))[0].code).toBe("E11");
    expect(call(fn)[0]).toBe("/attendance/ciap2/search");
    expect(sent(fn)).toEqual({ q: "diabetes", terminology: "cid10" });
  });

  it("SIGTAP no corpo, nunca na URL", async () => {
    const fn = stub({ items: [ { code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA" } ] });
    expect((await searchSigtap("hemoglobina glicada"))[0].code).toBe("0202010503");
    expect(call(fn)[0]).toBe("/attendance/sigtap/search");
    expect(sent(fn)).toEqual({ q: "hemoglobina glicada" });
  });
});

describe("cliente do módulo 19 — abertura justificada e relatório", () => {
  it("abrir manda CPF e motivo no corpo; ler pelo id do paciente", async () => {
    let fn = stub(opening(), 201);
    const out = await openClinicalRecord({ cpf: "529.982.247-25", reason_code: "other", reason_note: "revisão pedida pela equipe" });
    expect(out.opening_id).toBe("op1");
    expect(call(fn)[0]).toBe("/clinical_record/openings");
    expect(sent(fn)).toEqual({ cpf: "529.982.247-25", reason_code: "other", reason_note: "revisão pedida pela equipe" });

    fn = stub(record({ access: "justified" }));
    expect((await getJustifiedRecord("pa1")).access).toBe("justified");
    expect(call(fn)[0]).toBe("/clinical_record/patients/pa1");
  });

  it("relatório filtra por período e, quando escolhido, por profissional", async () => {
    let fn = stub({ items: [ openingRow() ] });
    expect(await listOpenings({ from: "2026-09-07", to: "2026-10-07" })).toHaveLength(1);
    expect(call(fn)[0]).toBe("/clinical_record/openings?from=2026-09-07&to=2026-10-07");

    fn = stub({ items: [] });
    await listOpenings({ from: "2026-09-07", to: "2026-10-07", userId: "us9" });
    expect(call(fn)[0]).toBe("/clinical_record/openings?from=2026-09-07&to=2026-10-07&user_id=us9");
  });
});

describe("cliente do módulo 19 — nomes na validação presencial", () => {
  it("validar manda os nomes junto do perfil conferido", async () => {
    const fn = stub({ verification: { id: "v1" } }, 201);
    await verifyCitizen("529.982.247-25", "123456",
      { birth_date: "1970-01-02", sex: "female", gender_identity: null, full_name: "Joana Lima", mother_name: "Maria Lima" });
    expect(sent(fn)).toEqual({ cpf: "529.982.247-25", code: "123456", document_checked: true, birth_date: "1970-01-02",
      sex: "female", gender_identity: null, full_name: "Joana Lima", mother_name: "Maria Lima" });
  });

  it("completar nomes de par já validado pela validação ativa", async () => {
    const fn = stub({ id: "c1" });
    await completeCitizenNames("v1", { full_name: "João Carlos Lima", social_name: "Joana Lima" });
    expect(call(fn)[0]).toBe("/attendance/verifications/v1/names");
    expect(call(fn)[1].method).toBe("POST");
    expect(sent(fn)).toEqual({ full_name: "João Carlos Lima", social_name: "Joana Lima" });
  });
});

describe("cliente do módulo 19 — campos opcionais omitidos pelo api", () => {
  it("problema sem onset_on, onset_precision e resolved_on é lido sem erro", async () => {
    stub(record({ problems: [ { id: "pp2", terminology: "cid10", code: "E11", label: "Diabetes", status: "active" } ] }));
    const out = await getAttendanceRecord("a1");
    expect(out.problems[0].onset_on ?? null).toBeNull();
    expect(out.problems[0].resolved_on ?? null).toBeNull();
  });
});
