// src/lib/api.billing.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelProcedure, closeBillingPeriod, fetchBillingExportFile, getBillingSettings, getPeriodPending, listBillingEstablishments,
  listBillingPeriods, listBillingProfessionals, listPeriodExports, listProcedures, lookupBillingPatient, recordProcedure,
  reopenBillingPeriod, saveBillingSettings, saveVerificationDemographics, searchBillingSigtap, updatePatientDemographics
} from "./api";

function ok(body: unknown, init: ResponseInit = {}): Promise<Response> {
  return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" }, ...init
  }));
}

describe("cliente do faturamento (contrato §3–§6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(() => ok({}));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => fetchMock.mock.calls[i][1] as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));

  it("busca SIGTAP: termo e competência na URL; lista em procedures", async () => {
    fetchMock.mockImplementationOnce(() => ok({ procedures: [ { code: "0301060061" } ] }));
    expect(await searchBillingSigtap("urgencia", "202610")).toEqual([ { code: "0301060061" } ]);
    expect(urlOf().pathname).toBe("/billing/sigtap/search");
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({ q: "urgencia", competence: "202610" });
  });

  it("registrar: tudo no corpo, com JSON; nada na URL", async () => {
    const input = {
      patient_id: "pa1", establishment: { type: "health_unit" as const, id: "u7" }, performed_on: "2026-10-21",
      sigtap_code: "0401010066", quantity: 2, cid10: "S610", character: "urgent" as const, attendance_id: "a1"
    };
    await recordProcedure(input);
    expect(urlOf().pathname).toBe("/billing/procedures");
    expect(urlOf().search).toBe("");
    expect(initOf().method).toBe("POST");
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(bodyOf()).toEqual(input);
  });

  it("lista: só ids, códigos e competência na URL; envelope com next_before", async () => {
    fetchMock.mockImplementationOnce(() => ok({ procedures: [], next_before: "c2" }));
    expect(await listProcedures({
      establishmentType: "lab_provider", establishmentId: "pv9", competence: "202609", billable: false,
      reason: "cbo_not_allowed", patientId: "pa1", before: "c1"
    })).toEqual({ procedures: [], next_before: "c2" });
    expect(urlOf().pathname).toBe("/billing/procedures");
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({
      establishment_type: "lab_provider", establishment_id: "pv9", competence: "202609", billable: "false",
      reason: "cbo_not_allowed", patient_id: "pa1", before: "c1", limit: "50"
    });
    fetchMock.mockImplementationOnce(() => ok({}));
    expect(await listProcedures({ attendanceId: "a1" })).toEqual({ procedures: [], next_before: null });
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ attendance_id: "a1", limit: "50" });
  });

  it("cancelar e reabrir: motivo no corpo; fechar manda {} com JSON", async () => {
    await cancelProcedure("pp1", "lançado no paciente errado");
    expect(urlOf().pathname).toBe("/billing/procedures/pp1/cancel");
    expect(urlOf().search).toBe("");
    expect(bodyOf()).toEqual({ reason: "lançado no paciente errado" });
    await closeBillingPeriod("bp1");
    expect(urlOf(1).pathname).toBe("/billing/periods/bp1/close");
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual({});
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
    await reopenBillingPeriod("bp1", "CNS do profissional corrigido");
    expect(urlOf(2).pathname).toBe("/billing/periods/bp1/reopen");
    expect(urlOf(2).search).toBe("");
    expect(bodyOf(2)).toEqual({ reason: "CNS do profissional corrigido" });
  });

  it("paciente pelo CPF no corpo de um POST, nunca na URL", async () => {
    fetchMock.mockImplementationOnce(() => ok({ patient: { id: "pa1", display_name: "Joana Lima", cpf_masked: "***.982.247-**" } }));
    expect((await lookupBillingPatient("52998224725")).id).toBe("pa1");
    expect(urlOf().pathname).toBe("/billing/patient_lookup");
    expect(urlOf().search).toBe("");
    expect(initOf().method).toBe("POST");
    expect(bodyOf()).toEqual({ cpf: "52998224725" });
  });

  it("estabelecimentos, profissionais, competências, pendências e versões: envelopes", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ establishments: [ { id: "u7" } ] }))
      .mockImplementationOnce(() => ok({ professionals: [ { user_id: "us1" } ] }))
      .mockImplementationOnce(() => ok({ periods: [ { id: "bp1" } ] }))
      .mockImplementationOnce(() => ok({ items: [ { procedure_id: "pp1" } ] }))
      .mockImplementationOnce(() => ok({ exports: [ { id: "ex1" } ] }));
    expect(await listBillingEstablishments()).toEqual([ { id: "u7" } ]);
    expect(urlOf(0).pathname).toBe("/billing/establishments");
    expect(await listBillingProfessionals({ type: "health_unit", id: "u7" })).toEqual([ { user_id: "us1" } ]);
    expect(urlOf(1).pathname).toBe("/billing/professionals");
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ establishment_type: "health_unit", establishment_id: "u7" });
    expect(await listBillingPeriods("202609")).toEqual([ { id: "bp1" } ]);
    expect(urlOf(2).pathname).toBe("/billing/periods");
    expect(Object.fromEntries(urlOf(2).searchParams)).toEqual({ competence: "202609" });
    expect(await getPeriodPending("bp1")).toEqual([ { procedure_id: "pp1" } ]);
    expect(urlOf(3).pathname).toBe("/billing/periods/bp1/pending");
    expect(await listPeriodExports("bp1")).toEqual([ { id: "ex1" } ]);
    expect(urlOf(4).pathname).toBe("/billing/periods/bp1/exports");
  });

  it("competências abertas: status=open na URL, com ou sem competência (E18)", async () => {
    fetchMock.mockImplementationOnce(() => ok({ periods: [ { id: "bp1" } ] }));
    expect(await listBillingPeriods(null, "open")).toEqual([ { id: "bp1" } ]);
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ status: "open" });
    await listBillingPeriods("202609", "open");
    expect(Object.fromEntries(urlOf(1).searchParams)).toEqual({ competence: "202609", status: "open" });
  });

  it("envelope ausente vira lista vazia", async () => {
    expect(await listBillingEstablishments()).toEqual([]);
    expect(await listBillingPeriods("202609")).toEqual([]);
    expect(await getPeriodPending("bp1")).toEqual([]);
    expect(await listPeriodExports("bp1")).toEqual([]);
  });

  it("arquivo: text/plain lido com fetch, com o nome seguro do api", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("01#BPA#202609\r\n", {
      status: 200, headers: { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=\"bpa-2384299-202609-v1.txt\"" }
    })));
    const file = await fetchBillingExportFile("ex1");
    expect(urlOf().pathname).toBe("/billing/exports/ex1/file");
    expect((initOf().headers as Record<string, string>).Accept).toBe("text/plain");
    expect(file.filename).toBe("bpa-2384299-202609-v1.txt");
    expect(file.blob.size).toBe(15);
  });

  it("configuração: GET normaliza ausentes e gestão estranha para null; PUT com JSON", async () => {
    fetchMock.mockImplementationOnce(() => ok({ management: "X" }));
    expect(await getBillingSettings()).toEqual({
      origin_name: null, origin_acronym: null, origin_cnpj: null, destination_body: null, management: null
    });
    const input = {
      origin_name: "SMS CURITIBA", origin_acronym: "SMS", origin_cnpj: "11222333000181",
      destination_body: "SECRETARIA MUNICIPAL DE SAUDE", management: "M" as const
    };
    await saveBillingSettings(input);
    expect(urlOf(1).pathname).toBe("/billing/settings");
    expect(initOf(1).method).toBe("PUT");
    expect(headersOf(1)["Content-Type"]).toBe("application/json");
    expect(bodyOf(1)).toEqual(input);
  });

  it("dados do paciente: PATCH com JSON, tudo no corpo, só o id na URL", async () => {
    const input = { race_color: "05", ethnicity: "0001", address_zip: "80010000", address_street: "RUA XV DE NOVEMBRO",
      address_number: "100", address_district: "CENTRO" };
    await updatePatientDemographics("pa3", input);
    expect(urlOf().pathname).toBe("/billing/patients/pa3/demographics");
    expect(urlOf().search).toBe("");
    expect(initOf().method).toBe("PATCH");
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(bodyOf()).toEqual(input);
    fetchMock.mockImplementationOnce(() => ok({ race_color_set: true, address_set: false }));
    expect(await saveVerificationDemographics("v9", { race_color: "03" })).toEqual({ race_color_set: true, address_set: false });
    expect(urlOf(1).pathname).toBe("/attendance/verifications/v9/names");
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual({ race_color: "03" });
  });
});
