import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeProsthesisStage, createProsthesisOrder, getAuxiliaryProcedures, getCeoGoals, getDentalChart, getDentalIndicators, listCeoProfiles,
  listChartEvents, listDentalLaboratories, listDentalPlans, listDentalTeams, listEndodonticTreatments, listProsthesisOrders, putAuxiliaryProcedures,
  putCeoProfile, saveConsultationDraft, searchDentalProcedures, startConsultation
} from "./api";
import { fields, toothLoc } from "../test/dentalFixtures";

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}
// Dente, face, situação, procedimento e motivo nunca na URL (O13: nem o filtro de dente do histórico).
const SENSITIVE = /caries|restored|RESTAURA|quebrou|desistiu|oclusal|0307010031|tooth/i;

describe("cliente da saúde bucal (contrato §3–§10, §16)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => ok({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));
  const writeOf = (i = 0) => [ urlOf(i).pathname, initOf(i).method, (initOf(i).headers as Record<string, string>)["Content-Type"] ];

  it("iniciar: sem argumento manda {}; odontológica e registro inicial no corpo", async () => {
    await startConsultation("a1");
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/attendance/attendances/a1/consultation", "POST", "application/json", {} ]);
    await startConsultation("a1", { kind: "dental" });
    expect(bodyOf(1)).toEqual({ kind: "dental" });
    await startConsultation("a1", { kind: "dental", baseline: true });
    expect(bodyOf(2)).toEqual({ kind: "dental", baseline: true });
  });

  it("rascunho leva o bloco dental no corpo do PATCH", async () => {
    const dental = fields({ procedures: [ { sigtap: "0307010031", location: toothLoc("16", "O"), quantity: 1, plan_item_id: "pi1" } ] });
    await saveConsultationDraft("cs1", { subjective: "", objective: "", assessment: "", plan: "", vitals: {}, care_type: null,
      evaluated_problems: [], conducts: [], exam_requests: [], dental });
    expect([ ...writeOf(0), bodyOf(0).dental ]).toEqual([ "/attendance/consultations/cs1", "PATCH", "application/json", dental ]);
  });

  it("odontograma, eventos, planos e endodontia: só ids e filtros na URL, sob /dental (O1, O13)", async () => {
    await getDentalChart("pa1");
    expect(urlOf(0).pathname).toBe("/dental/patients/pa1/dental_chart");
    fetchMock.mockImplementationOnce(() => ok({ events: [ { id: "ev1" } ], next_before: "c1" }));
    expect(await listChartEvents("pa1", { before: "c0" })).toEqual({ events: [ { id: "ev1" } ], next_before: "c1" });
    expect([ urlOf(1).pathname, Object.fromEntries(urlOf(1).searchParams) ])
      .toEqual([ "/dental/patients/pa1/dental_chart/events", { before: "c0", limit: "50" } ]);
    expect(await listChartEvents("pa1", {})).toEqual({ events: [], next_before: null });
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ limit: "50" });
    fetchMock.mockImplementationOnce(() => ok({ plans: [ { id: "dp1" } ] }));
    expect(await listDentalPlans("pa1", { healthUnitId: "u1", status: "open" })).toEqual([ { id: "dp1" } ]);
    expect([ urlOf(3).pathname, Object.fromEntries(urlOf(3).searchParams) ])
      .toEqual([ "/dental/patients/pa1/dental_plans", { health_unit_id: "u1", status: "open" } ]);
    fetchMock.mockImplementationOnce(() => ok({ treatments: [ { tooth: "16" } ] }));
    expect(await listEndodonticTreatments("pa1")).toEqual([ { tooth: "16" } ]);
    expect(urlOf(4).pathname).toBe("/dental/patients/pa1/endodontic_treatments");
    expect(await listEndodonticTreatments("pa1")).toEqual([]);
  });

  it("busca de procedimento no corpo, envelope procedures (O5)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ procedures: [ { sigtap: "0307010031" } ] }));
    expect(await searchDentalProcedures("resina")).toEqual([ { sigtap: "0307010031" } ]);
    expect([ ...writeOf(0), urlOf(0).search, bodyOf(0) ]).toEqual([ "/dental/procedures/search", "POST", "application/json", "", { q: "resina" } ]);
    expect(await searchDentalProcedures("x")).toEqual([]);
  });

  it("prótese: pedido, etapa com motivo no corpo, lista e laboratórios", async () => {
    const input = { patient_id: "pa1", consultation_id: "cs1", sigtap: "0701070137", laboratory: { name: "Lab Sorriso" } };
    await createProsthesisOrder(input);
    expect([ ...writeOf(0), bodyOf(0) ]).toEqual([ "/dental/prosthesis_orders", "POST", "application/json", input ]);
    await changeProsthesisStage("po1", { stage: "cancelled", reason: "paciente desistiu do tratamento" });
    expect([ ...writeOf(1), bodyOf(1) ]).toEqual([ "/dental/prosthesis_orders/po1/stages", "POST", "application/json",
      { stage: "cancelled", reason: "paciente desistiu do tratamento" } ]);
    expect(await listProsthesisOrders({ healthUnitId: "u1", stage: "sent", before: null })).toEqual({ orders: [], next_before: null });
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ health_unit_id: "u1", stage: "sent", limit: "50" });
    await listProsthesisOrders({ patientId: "pa1" });
    expect(Object.fromEntries(urlOf(3).searchParams)).toEqual({ patient_id: "pa1", limit: "50" });
    expect(await listDentalLaboratories()).toEqual([]);
    expect(urlOf(4).pathname).toBe("/dental/laboratories");
    fetchMock.mockImplementationOnce(() => ok({ laboratories: [ { id: "l1", name: "Lab" } ] }));
    expect(await listDentalLaboratories()).toEqual([ { id: "l1", name: "Lab" } ]);
  });

  it("administração: perfis do CEO e lista do auxiliar com envelope", async () => {
    fetchMock.mockImplementationOnce(() => ok({ profiles: [ { ceo_type: "II" } ] }));
    expect(await listCeoProfiles()).toEqual([ { ceo_type: "II" } ]);
    expect(urlOf(0).pathname).toBe("/dental/admin/ceo_profiles");
    await putCeoProfile("u9", { ceo_type: "II", specialties: [ "endodontics", "periodontics" ] });
    expect([ ...writeOf(1), bodyOf(1) ]).toEqual([ "/dental/admin/ceo_profiles/u9", "PUT", "application/json",
      { ceo_type: "II", specialties: [ "endodontics", "periodontics" ] } ]);
    fetchMock.mockImplementationOnce(() => ok({ procedures: [ { sigtap: "0101020074", name: "FLÚOR" } ] }));
    expect(await getAuxiliaryProcedures()).toEqual([ { sigtap: "0101020074", name: "FLÚOR" } ]);
    await putAuxiliaryProcedures([ "0101020074" ]);
    expect([ ...writeOf(3), bodyOf(3) ]).toEqual([ "/dental/admin/auxiliary_procedures", "PUT", "application/json",
      { procedures: [ { sigtap: "0101020074" } ] } ]);
  });

  it("painéis: só id, mês e período na URL", async () => {
    await getCeoGoals("u9", "2026-10");
    expect([ urlOf(0).pathname, Object.fromEntries(urlOf(0).searchParams) ]).toEqual([ "/dental/ceo_goals", { health_unit_id: "u9", month: "2026-10" } ]);
    expect(await listDentalTeams()).toEqual([]);
    expect(urlOf(1).pathname).toBe("/dental/teams");
    await getDentalIndicators("t1", "2026-10");
    expect([ urlOf(2).pathname, Object.fromEntries(urlOf(2).searchParams) ]).toEqual([ "/dental/indicators", { team_id: "t1", period: "2026-10" } ]);
  });

  it("nada clínico na URL", async () => {
    await saveConsultationDraft("cs1", { subjective: "", objective: "", assessment: "", plan: "", vitals: {}, care_type: null, evaluated_problems: [],
      conducts: [], exam_requests: [], dental: fields({ findings: [ { tooth: "16", face: "O", part: "crown", situation: "caries" } ],
        plan_changes: { add: [], cancel: [ { item_id: "pi1", reason: "dente quebrou e vai para extração" } ] } }) });
    await changeProsthesisStage("po1", { stage: "cancelled", reason: "paciente desistiu do tratamento" });
    await searchDentalProcedures("RESTAURAÇÃO 0307010031");
    await listChartEvents("pa1", { before: "c0" });
    for (const call of fetchMock.mock.calls) expect(decodeURIComponent(String(call[0]))).not.toMatch(SENSITIVE);
  });
});
