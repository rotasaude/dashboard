import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { EMPTY_ADDRESS } from "./unitAddress";
import { CAPS_AD_III, CAPS_II, OPTIONS, bedBoard, enrollmentRow, month } from "../test/psychosocialFixtures";

const calls: { url: string; init: RequestInit }[] = [];
function stub(body: unknown, status = 200, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }));
}
// Uma resposta por chamada, na ordem (paginação).
function stubSeq(...bodies: unknown[]) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
const last = () => calls[calls.length - 1];
const bodyOf = () => JSON.parse(String(last().init.body));
const headerOf = (name: string) => (last().init.headers as Record<string, string>)[name];
// O que nunca pode ir na URL: CPF, CNS, nome, CID, substância e texto clínico.
const SECRET_IN_URL = /12345678909|898000000000002|Maria|F32|F322|alcohol|Idea|Relata|risco|Caso|ação lançada|registrada/;

describe("cliente do CAPS (módulo 31)", () => {
  it("unidades e opções: envelope { items }; opções pela unidade", async () => {
    stub({ items: [ CAPS_II, CAPS_AD_III ] });
    const units = await api.listPsyUnits();
    expect(last().url).toBe("/psychosocial/units");
    expect(units.map((u) => u.night_capable)).toEqual([ false, true ]);
    stub(OPTIONS);
    const o = await api.getPsyOptions("caps2");
    expect(last().url).toBe("/psychosocial/options?health_unit_id=caps2");
    expect(o.procedures[0].instrument_codes).toEqual([ "02", "09" ]);
    stub({});
    expect(await api.listPsyUnits()).toEqual([]);
  });

  it("lista de usuários: só unidade, situação e cursor na URL, nunca q; lê todas as páginas", async () => {
    stubSeq({ items: [ enrollmentRow() ], next_before: "c1" }, { items: [ enrollmentRow({ id: "en2" }) ], next_before: null });
    const rows = await api.listPsyEnrollments({ unitId: "caps2", status: "open" });
    expect(calls[0].url).toBe("/psychosocial/enrollments?health_unit_id=caps2&status=open");
    expect(calls[1].url).toBe("/psychosocial/enrollments?health_unit_id=caps2&status=open&before=c1");
    expect(rows.map((r) => r.id)).toEqual([ "en1", "en2" ]);
    expect(calls.some((c) => /[?&]q=/.test(c.url))).toBe(false);
  });

  it("lista de usuários: cursor que volta ou não acaba não prende o laço (Set de cursores, teto de 50 páginas)", async () => {
    // Freio do teste: o laço antigo nunca pararia.
    const runaway = (body: (i: number) => unknown) => {
      let i = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (calls.length > 60) throw new Error("runaway");
        return new Response(JSON.stringify(body(i++)), { status: 200, headers: { "Content-Type": "application/json" } });
      }));
    };
    runaway((i) => ({ items: [ enrollmentRow({ id: `en${i}` }) ], next_before: i % 2 === 0 ? "c1" : "c2" }));
    expect((await api.listPsyEnrollments({ unitId: "caps2", status: "open" })).length).toBe(3);
    expect(calls.length).toBe(3);
    calls.length = 0;
    runaway((i) => ({ items: [ enrollmentRow({ id: `en${i}` }) ], next_before: `c${i + 1}` }));
    expect((await api.listPsyEnrollments({ unitId: "caps2", status: "open" })).length).toBe(50);
    expect(calls.length).toBe(50);
  });

  it("encaminhamento da UBS: motivo só no corpo, com JSON; devolve o criado", async () => {
    stub({ id: "rf1", health_unit_id: "caps2", priority: "priority", status: "pending", created_at: "2026-11-04T10:00:00-03:00" }, 201);
    const r = await api.createPsyReferral({ patient_id: "pt1", health_unit_id: "caps2", reason: "Ideação suicida relatada na consulta", priority: "priority" });
    expect(last().url).toBe("/psychosocial/referrals");
    expect(last().init.method).toBe("POST");
    expect(last().url).not.toMatch(SECRET_IN_URL);
    expect(bodyOf()).toEqual({ patient_id: "pt1", health_unit_id: "caps2", reason: "Ideação suicida relatada na consulta", priority: "priority" });
    expect(headerOf("Content-Type")).toBe("application/json");
    expect(r.status).toBe("pending");
  });

  it("fila: pendentes por padrão, cursor de volta; detalhe sem query", async () => {
    stub({ items: [], next_before: "c9" });
    const page = await api.listPsyReferrals("caps2");
    expect(last().url).toBe("/psychosocial/referrals?health_unit_id=caps2&status=pending");
    expect(page).toEqual({ items: [], next_before: "c9" });
    await api.listPsyReferrals("caps2", { status: "received", before: "c9" });
    expect(last().url).toBe("/psychosocial/referrals?health_unit_id=caps2&status=received&before=c9");
    stub({ id: "rf1", reason: "x" });
    await api.getPsyReferral("rf1");
    expect(last().url).toBe("/psychosocial/referrals/rf1");
  });

  it("busca de pessoa pelo CAPS é POST com o CPF ou o CNS no corpo (P30); duplicados por POST", async () => {
    stub({ patient_id: "pt1", display_name: "Maria", has_cpf: true, cns_masked: null });
    const p = await api.lookupPsyPerson("12345678909");
    expect(last().url).toBe("/psychosocial/person_lookup");
    expect(last().init.method).toBe("POST");
    expect(bodyOf()).toEqual({ cpf: "12345678909" });
    expect(p).toEqual({ patient_id: "pt1", display_name: "Maria", has_cpf: true, cns_masked: null, citizen_id: null, registration_id: null });
    await api.lookupPsyPersonByCns("898000000000002");
    expect(last().url).toBe("/psychosocial/person_lookup");
    expect(bodyOf()).toEqual({ cns: "898000000000002" });
    stub({ candidates: [ { patient_id: "pt1", display_name: "Maria", birth_date: "1980-01-01", has_cpf: false } ] });
    const c = await api.findPsyDuplicates({ full_name: "Maria da Silva", birth_date: "1980-01-01" });
    expect(last().url).toBe("/psychosocial/patients/duplicates");
    expect(last().init.method).toBe("POST");
    expect(last().url).not.toMatch(SECRET_IN_URL);
    expect(bodyOf()).toEqual({ full_name: "Maria da Silva", birth_date: "1980-01-01" });
    expect(c[0].registration_id).toBeNull();
    expect(calls.every((call) => !SECRET_IN_URL.test(call.url))).toBe(true);
  });

  it("pré-preenchimento: só ids na URL", async () => {
    stub({ esf_covered: true, esf_cnes: null, usf: null, team: null });
    const p = await api.getPsyPrefill("caps2", "pt1");
    expect(last().url).toBe("/psychosocial/prefill?patient_id=pt1&health_unit_id=caps2");
    expect(p.esf_covered).toBe(true);
  });

  it("acolhimento com matrícula na mesma chamada; CID e substâncias no corpo; evolução vazia não vai", async () => {
    stub({ reception_id: "re1", enrollment_id: "en9" }, 201);
    const r = await api.recordPsyReception({ health_unit_id: "caps2", patient_id: "pt1", referral_id: null, at: "2026-11-04T09:00:00-03:00",
      sigtap_code: "0301080232", notes: "", outcome: "enrolled", enrollment: { started_on: "2026-11-04", origin: "01", cid_main: "F32.2",
        cid_secondary: [], substances: [ "01" ], esf_covered: false, esf_cnes: null, reference_user_id: "u-1" } });
    expect(last().url).toBe("/psychosocial/receptions");
    expect(last().url).not.toMatch(SECRET_IN_URL);
    expect(bodyOf().enrollment.cid_main).toBe("F32.2");
    expect(bodyOf().enrollment.substances).toEqual([ "01" ]);
    expect("notes" in bodyOf()).toBe(false);
    expect("referral_id" in bodyOf()).toBe(false);
    expect(r).toEqual({ reception_id: "re1", enrollment_id: "en9" });
    await api.recordPsyReception({ health_unit_id: "caps2", patient_id: "pt1", referral_id: "rf1", at: "2026-11-04T09:00:00-03:00",
      sigtap_code: "0301080232", notes: "Relata insônia", outcome: "no_follow_up" });
    expect(bodyOf()).toMatchObject({ referral_id: "rf1", notes: "Relata insônia" });
    expect("enrollment" in bodyOf()).toBe(false);
  });

  it("matrícula: criar, ler, corrigir (PATCH) e encerrar", async () => {
    stub({ id: "en1" }, 201);
    await api.createPsyEnrollment({ health_unit_id: "caps2", patient_id: "pt1", started_on: "2026-11-04", origin: "02", cid_main: "F322",
      substances: [ "99" ], esf_covered: true, esf_cnes: "2384299", reference_user_id: "u-1" });
    expect(last().url).toBe("/psychosocial/enrollments");
    expect(last().url).not.toMatch(SECRET_IN_URL);
    expect(bodyOf().cid_main).toBe("F322");
    await api.getPsyEnrollment("en1");
    expect(last().url).toBe("/psychosocial/enrollments/en1");
    expect(last().init.method).toBeUndefined();
    await api.updatePsyEnrollment("en1", { next_visit_at: "2026-11-10T14:00" });
    expect(last().init.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ next_visit_at: "2026-11-10T14:00" });
    await api.closePsyEnrollment("en1", { destination: "01", closed_on: "2026-11-04" });
    expect(last().url).toBe("/psychosocial/enrollments/en1/close");
    expect(bodyOf()).toEqual({ destination: "01", closed_on: "2026-11-04" });
  });

  it("PTS: lista em { items } e versão nova no corpo", async () => {
    stub({ items: [ { id: "cp1" } ] });
    expect((await api.listPsyCarePlans("en1")).map((c) => c.id)).toEqual([ "cp1" ]);
    expect(last().url).toBe("/psychosocial/enrollments/en1/care_plans");
    await api.createPsyCarePlan("en1", { needs: "Isolamento", goals: [ { text: "Grupo", responsible_user_id: "u-1", due_on: null } ],
      intensity: "intensive", review_on: "2026-12-01" });
    expect(last().init.method).toBe("POST");
    expect(last().url).not.toMatch(/Isolamento/);
    expect(bodyOf().needs).toBe("Isolamento");
  });

  it("grupos e Hoje: filtro de ativos só quando pedido; data opcional", async () => {
    stub({ items: [] });
    await api.listPsyGroups("caps2");
    expect(last().url).toBe("/psychosocial/groups?health_unit_id=caps2");
    await api.listPsyGroups("caps2", { active: true });
    expect(last().url).toBe("/psychosocial/groups?health_unit_id=caps2&active=true");
    await api.createPsyGroup({ health_unit_id: "caps2", name: "Oficina", kind: "workshop", weekday: 3, starts_at: "14:00", ends_at: "16:00",
      responsible_user_id: "u-1", capacity: 25, sigtap_code: "0301080216" });
    expect(last().url).toBe("/psychosocial/groups");
    await api.updatePsyGroup("g1", { active: false });
    expect(last().url).toBe("/psychosocial/groups/g1");
    expect(last().init.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ active: false });
    stub({ date: "2026-11-04", groups: [], visits: [] });
    await api.getPsyToday("caps2", "2026-11-04");
    expect(last().url).toBe("/psychosocial/today?health_unit_id=caps2&date=2026-11-04");
    await api.getPsyToday("caps2");
    expect(last().url).toBe("/psychosocial/today?health_unit_id=caps2");
  });

  it("ação coletiva: participantes e evolução no corpo; vazios não vão", async () => {
    stub({ id: "ac9" }, 201);
    await api.createPsyAction({ health_unit_id: "caps2", sigtap_code: "0301080216", performed_at: "2026-11-04T14:00:00-03:00", place: "caps",
      quantity: 1, notes: "", authorization_number: null, group_id: "g1", participants: [ { enrollment_id: "en1" }, { family_name: "Ana Souza" } ] });
    expect(last().url).toBe("/psychosocial/actions");
    expect(bodyOf().participants).toEqual([ { enrollment_id: "en1" }, { family_name: "Ana Souza" } ]);
    expect("notes" in bodyOf()).toBe(false);
    expect("authorization_number" in bodyOf()).toBe(false);
    expect(bodyOf().group_id).toBe("g1");
    await api.createPsyAction({ health_unit_id: "caps2", sigtap_code: "0301080208", performed_at: "2026-11-04T09:00", place: "territory",
      notes: "Relata melhora", group_id: null, participants: [ { enrollment_id: "en1" } ] });
    expect(last().url).not.toMatch(SECRET_IN_URL);
    expect(bodyOf().notes).toBe("Relata melhora");
    expect("group_id" in bodyOf()).toBe(false);
    // Texto opcional só com espaços não vai (o api recusa ""); o que vai, vai aparado.
    await api.createPsyAction({ health_unit_id: "caps2", sigtap_code: "0301080208", performed_at: "2026-11-04T09:00", place: "caps",
      notes: "   ", authorization_number: " \n ", group_id: null, participants: [ { enrollment_id: "en1" } ] });
    expect("notes" in bodyOf()).toBe(false);
    expect("authorization_number" in bodyOf()).toBe(false);
    await api.createPsyAction({ health_unit_id: "caps2", sigtap_code: "0301080208", performed_at: "2026-11-04T09:00", place: "caps",
      notes: "  Relata melhora  ", participants: [ { enrollment_id: "en1" } ] });
    expect(bodyOf().notes).toBe("Relata melhora");
  });

  it("ações da matrícula paginadas; detalhe; cancelar com o motivo no corpo", async () => {
    stub({ items: [], next_before: null });
    expect(await api.listPsyActions("en1")).toEqual({ items: [], next_before: null });
    expect(last().url).toBe("/psychosocial/actions?enrollment_id=en1");
    await api.listPsyActions("en1", "c2");
    expect(last().url).toBe("/psychosocial/actions?enrollment_id=en1&before=c2");
    stub({ id: "ac1" });
    await api.getPsyAction("ac1");
    expect(last().url).toBe("/psychosocial/actions/ac1");
    stub({ id: "ac1", cancelled: true });
    const row = await api.cancelPsyAction("ac1", "registrada no usuário errado");
    expect(last().url).toBe("/psychosocial/actions/ac1/cancel");
    expect(bodyOf()).toEqual({ reason: "registrada no usuário errado" });
    expect(row.cancelled).toBe(true);
  });

  it("documentos da ação: lista em { items }; receita e atestado pelo mesmo POST", async () => {
    stub({ items: [] });
    expect(await api.listPsyActionDocuments("ac1")).toEqual([]);
    expect(last().url).toBe("/psychosocial/actions/ac1/documents");
    stub({ id: "d1" }, 201);
    await api.issuePsyPrescription("ac1", { items: [] });
    expect(last().url).toBe("/psychosocial/actions/ac1/documents");
    expect(bodyOf()).toEqual({ kind: "prescription", content: { items: [] } });
    await api.issuePsyDocument("ac1", { kind: "sick_note", content: { type: "leave", days: 2, cid_authorized: false } }, "d0");
    expect(bodyOf()).toEqual({ kind: "sick_note", content: { type: "leave", days: 2, cid_authorized: false }, replaces_document_id: "d0" });
  });

  it("leitos (admin): lista pela unidade; criar e mudar no corpo", async () => {
    stub({ items: [] });
    await api.listPsyBeds("capsad3");
    expect(last().url).toBe("/psychosocial/beds?health_unit_id=capsad3");
    stub({ id: "b1" }, 201);
    await api.createPsyBed({ health_unit_id: "capsad3", label: "Leito 1", active: true });
    expect(last().url).toBe("/psychosocial/beds");
    expect(bodyOf()).toEqual({ health_unit_id: "capsad3", label: "Leito 1", active: true });
    await api.updatePsyBed("b1", { active: false });
    expect(last().url).toBe("/psychosocial/beds/b1");
    expect(last().init.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ active: false });
  });

  it("acolhimento noturno: mapa em { items }; entrada e saída com reavaliação só quando passada", async () => {
    stub(bedBoard());
    const board = await api.getPsyBedBoard("capsad3", "2026-11-04");
    expect(last().url).toBe("/psychosocial/beds/board?health_unit_id=capsad3&date=2026-11-04");
    expect(board.items[1].nights_used).toBe(9);
    stub({ id: "ns1" }, 201);
    await api.startPsyNightStay({ bed_id: "b1", enrollment_id: "en1", started_at: "2026-11-04T19:00:00-03:00", expected_end_at: "2026-11-05T08:00:00-03:00" });
    expect(last().url).toBe("/psychosocial/night_stays");
    expect(bodyOf().reassessment).toBeUndefined();
    await api.startPsyNightStay({ bed_id: "b1", enrollment_id: "en1", started_at: "2026-11-04T19:00:00-03:00", expected_end_at: "2026-11-05T08:00:00-03:00",
      reassessment: { reason: "risco de recaída na semana" } });
    expect(bodyOf().reassessment).toEqual({ reason: "risco de recaída na semana" });
    expect(last().url).not.toMatch(SECRET_IN_URL);
    await api.getPsyNightStay("ns1");
    expect(last().url).toBe("/psychosocial/night_stays/ns1");
    await api.closePsyNightStay("ns1", { ended_at: "2026-11-05T08:00", reason: "alta do acolhimento" });
    expect(last().url).toBe("/psychosocial/night_stays/ns1/close");
    expect(bodyOf()).toEqual({ ended_at: "2026-11-05T08:00", reason: "alta do acolhimento" });
  });

  it("regras da cidade: leitura e PATCH parcial", async () => {
    stub({ night_limits: {}, care_plan_review_days: 90 });
    await api.getPsySettings();
    expect(last().url).toBe("/psychosocial/settings");
    await api.updatePsySettings({ care_plan_review_days: 60 });
    expect(last().init.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ care_plan_review_days: 60 });
  });

  it("mês: leitura, fechar, reabrir e situação de rua", async () => {
    stub(month());
    const m = await api.getPsyMonth("2026-11", "caps2");
    expect(last().url).toBe("/psychosocial/months/2026-11?health_unit_id=caps2");
    expect(m.records[0].problems).toEqual([ "homeless_missing" ]);
    await api.closePsyMonth("2026-11", "caps2");
    expect(last().url).toBe("/psychosocial/months/2026-11/close");
    expect(bodyOf()).toEqual({ health_unit_id: "caps2" });
    await api.reopenPsyMonth("2026-11", "caps2", "ação lançada no mês errado");
    expect(last().url).toBe("/psychosocial/months/2026-11/reopen");
    expect(bodyOf()).toEqual({ health_unit_id: "caps2", reason: "ação lançada no mês errado" });
    await api.setPsyHomeless("mr1", false);
    expect(last().url).toBe("/psychosocial/monthly_records/mr1");
    expect(last().init.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ homeless: false });
    expect(calls.every((call) => !SECRET_IN_URL.test(call.url))).toBe(true);
  });

  it("remessa: lista e geração; arquivo e fichas espelho por fetch binário", async () => {
    stub({ items: [] });
    await api.listPsyRaasExports("caps2", "2026-11");
    expect(last().url).toBe("/psychosocial/raas_exports?health_unit_id=caps2&month=2026-11");
    await api.listPsyRaasExports("caps2");
    expect(last().url).toBe("/psychosocial/raas_exports?health_unit_id=caps2");
    stub({ id: "rx1" }, 201);
    await api.createPsyRaasExport("caps2", "2026-11");
    expect(last().url).toBe("/psychosocial/raas_exports");
    expect(bodyOf()).toEqual({ health_unit_id: "caps2", month: "2026-11" });
    stub("%PDF", 200, { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"RAAS-fichas-2384299-202611.pdf\"" });
    const f = await api.fetchPsySheets("2026-11", { unitId: "caps2", enrollmentId: "en1" });
    expect(last().url).toBe("/psychosocial/months/2026-11/sheets.pdf?health_unit_id=caps2&enrollment_id=en1");
    expect(headerOf("Accept")).toBe("application/pdf");
    expect(f.filename).toBe("RAAS-fichas-2384299-202611.pdf");
    await api.fetchPsySheets("2026-11", { unitId: "caps2", enrollmentId: null });
    expect(last().url).toBe("/psychosocial/months/2026-11/sheets.pdf?health_unit_id=caps2");
    stub("RAAS", 200, { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=\"RAAS-2384299-202612.txt\"" });
    const file = await api.fetchPsyRaasFile("rx1");
    expect(last().url).toBe("/psychosocial/raas_exports/rx1/file");
    expect(headerOf("Accept")).toMatch(/application\/octet-stream/);
    expect(file.filename).toBe("RAAS-2384299-202612.txt");
  });

  it("matriciamento: lista paginada sem mês; tema e texto do caso no corpo; o caso volta sozinho", async () => {
    stub({ items: [], next_before: null });
    await api.listPsyMatrixSupports("caps2");
    expect(last().url).toBe("/psychosocial/matrix_supports?health_unit_id=caps2");
    await api.listPsyMatrixSupports("caps2", "c3");
    expect(last().url).toBe("/psychosocial/matrix_supports?health_unit_id=caps2&before=c3");
    stub({ id: "ms1", cases: [] }, 201);
    await api.createPsyMatrixSupport({ health_unit_id: "caps2", health_team_id: "ht1", held_on: "2026-11-04", topic: "Casos de risco",
      participants_user_ids: [ "u-1" ], sigtap_code: "0301080305" });
    expect(last().url).toBe("/psychosocial/matrix_supports");
    expect(bodyOf().topic).toBe("Casos de risco");
    await api.getPsyMatrixSupport("ms1");
    expect(last().url).toBe("/psychosocial/matrix_supports/ms1");
    stub({ id: "mc1", patient: { patient_id: "pt1", name: "Maria", cns_masked: null }, shared_text: "Caso grave", created_at: "x" }, 201);
    const c = await api.addPsyMatrixCase("ms1", { patient_id: "pt1", shared_text: "Caso grave" });
    expect(last().url).toBe("/psychosocial/matrix_supports/ms1/cases");
    expect(bodyOf()).toEqual({ patient_id: "pt1", shared_text: "Caso grave" });
    expect(c.id).toBe("mc1");
    expect(calls.every((call) => !SECRET_IN_URL.test(call.url))).toBe(true);
  });

  it("vínculo na UBS, linha do tempo do CAPS e painel com lt5", async () => {
    stub({ enrolled: false });
    const link = await api.getPsyLink("pt1");
    expect(last().url).toBe("/psychosocial/patients/pt1/link");
    expect(link.enrolled).toBe(false);
    stub({ items: [], next_before: "c1" });
    const page: api.PsyTimelinePage = await api.getPsyEnrollmentTimeline("en1");
    expect(page).toEqual({ items: [], next_before: "c1" });
    expect(last().url).toBe("/psychosocial/enrollments/en1/timeline");
    await api.getPsyEnrollmentTimeline("en1", "c1");
    expect(last().url).toBe("/psychosocial/enrollments/en1/timeline?before=c1");
    stub({ month: "2026-11", new_in_month: "lt5" });
    const d = await api.getPsyDashboard({ month: "2026-11", unitId: null });
    expect(last().url).toBe("/psychosocial/dashboard?month=2026-11");
    expect(d.new_in_month).toBe("lt5");
    await api.getPsyDashboard({ month: "2026-11", unitId: "caps2" });
    expect(last().url).toBe("/psychosocial/dashboard?month=2026-11&health_unit_id=caps2");
  });

  it("unidade CAPS: modalidade, classificação e telefone no corpo da unidade, só quando recebidos", async () => {
    stub({ unit: { id: "caps2" } }, 201);
    await api.createUnit("CAPS II Centro", "caps", EMPTY_ADDRESS, "2384299",
      { caps_modality: "caps_ii", service_classification: "002", phone: "4133334444" });
    expect(bodyOf()).toMatchObject({ kind: "caps", caps_modality: "caps_ii", service_classification: "002", phone: "4133334444", cnes: "2384299" });
    await api.createUnit("UBS Nova", "ubs", EMPTY_ADDRESS);
    expect("caps_modality" in bodyOf()).toBe(false);
    expect("phone" in bodyOf()).toBe(false);
    await api.createUnit("UBS Nova", "ubs", EMPTY_ADDRESS, null, { phone: null });
    expect(bodyOf().phone).toBeNull();
    expect("service_classification" in bodyOf()).toBe(false);
    stub({ unit: { id: "caps2" } });
    await api.updateUnit("caps2", "CAPS II Centro", "caps", EMPTY_ADDRESS, undefined, undefined, undefined, undefined,
      { caps_modality: "caps_ii", service_classification: null, phone: "41999998888" });
    expect(last().url).toBe("/attendance/units/caps2");
    expect(bodyOf()).toMatchObject({ caps_modality: "caps_ii", service_classification: null, phone: "41999998888" });
    await api.updateUnit("u1", "UBS", "ubs", EMPTY_ADDRESS);
    expect("caps_modality" in bodyOf()).toBe(false);
  });
});
