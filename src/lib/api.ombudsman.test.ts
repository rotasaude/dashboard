import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelOmbudsmanForwarding, createDepartment, createOmbudsmanManifestation, createOmbudsmanResponder, createOmbudsmanSubject,
  decideReopenRequest, declineOmbudsmanInbox, extendOmbudsmanInbox, fetchOmbudsmanFile, getAnnualReport, getOmbudsmanAttachmentUrl,
  getOmbudsmanDashboard, getOmbudsmanManifestation, getOmbudsmanOptions, getOmbudsmanProfessionalsPanel, getOmbudsmanReceipt,
  getOmbudsmanSettings, listDepartments, listOmbudsmanInbox, listOmbudsmanManifestations, listOmbudsmanResponders,
  listOmbudsmanSubjects, listResponderCandidates, lookupOmbudsmanPerson, publishAnnualReport, recordIdentityConsent,
  replyOmbudsmanInbox, revealOmbudsmanIdentity, runOmbudsmanAction, updateAnnualReport, updateDepartment, updateOmbudsmanResponder,
  updateOmbudsmanSettings, updateOmbudsmanSubject, uploadOmbudsmanAttachment
} from "./api";
import {
  annualReport, can33, dashboard33, forwarding, fullIdentity, inboxItem, listItem, manifestation, options, preserved, settings33,
  subjects33
} from "../test/ombudsmanFixtures";

const calls: { url: string; init: RequestInit }[] = [];
function stub(body: unknown, status = 200, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }));
}
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
const last = () => calls[calls.length - 1];
const bodyOf = () => JSON.parse(String(last().init.body));
// O que nunca pode ir na URL: CPF, nome, contato, texto, extrato, resposta, motivo e justificativa.
const SECRET_IN_URL = /52998224725|529\.982|Maria|Joana|losartana|pressão|denúncia|laudo|Reposição|levantado|farmácia|justific|41 9/;
const noSecretInUrl = () => { for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL); };

describe("cliente da ouvidoria (módulo 33)", () => {
  it("caixa: filtros repetidos com [] e cursor na URL, na ordem; lista vazia, nulo e limit nunca vão", async () => {
    stub({ items: [ listItem() ], next_before: "c2" });
    const p = await listOmbudsmanManifestations({ state: [ "in_analysis", "forwarded" ], color: [ "red" ], kind: [], subject_id: "s1",
      health_unit_id: null, q: "2026-000123", before: "c1" });
    expect(last().url).toBe("/ombudsman/manifestations?state%5B%5D=in_analysis&state%5B%5D=forwarded&color%5B%5D=red&subject_id=s1&q=2026-000123&before=c1");
    expect(p).toEqual({ items: [ listItem() ], next_before: "c2" });
    stub({ items: [], next_before: null });
    await listOmbudsmanManifestations({ channel: [ "phone" ], health_unit_id: "ubs1", before: null });
    expect(last().url).toBe("/ombudsman/manifestations?channel%5B%5D=phone&health_unit_id=ubs1");
    await listOmbudsmanManifestations({});
    expect(last().url).toBe("/ombudsman/manifestations");
    expect(calls.some((c) => /limit=/.test(c.url))).toBe(false);
  });

  it("detalhe, opções e recibo: GET pelo id, sem corpo", async () => {
    stub(manifestation());
    expect((await getOmbudsmanManifestation("m1")).can.final_response).toBe(true);
    expect(last()).toMatchObject({ url: "/ombudsman/manifestations/m1" });
    expect(last().init.method).toBeUndefined();
    stub(options());
    expect((await getOmbudsmanOptions()).health_units[0].has_active_responder).toBe(true);
    expect(last().url).toBe("/ombudsman/options");
    stub({ protocol: "2026-000130", kind: "complaint", received_at: "2026-11-11T09:58:00-03:00", due_on: "2026-12-11", channel: "phone" });
    expect((await getOmbudsmanReceipt("m9")).protocol).toBe("2026-000130");
    expect(last().url).toBe("/ombudsman/manifestations/m9/receipt");
  });

  it("toda ação leva expected_state no corpo e vai ao caminho da ação", async () => {
    stub(manifestation({ state: "forwarded", pending_forwardings: 1 }));
    await runOmbudsmanAction("m1", "forward", { expected_state: "in_analysis", department_id: "dep1", extract: "x".repeat(20) });
    expect(last().url).toBe("/ombudsman/manifestations/m1/forward");
    expect(last().init.method).toBe("POST");
    expect(bodyOf()).toEqual({ expected_state: "in_analysis", department_id: "dep1", extract: "x".repeat(20) });
    await runOmbudsmanAction("m1", "archive", { expected_state: "in_analysis", reason: "duplicate", duplicate_of_protocol: "2026-000100" });
    expect(last().url).toBe("/ombudsman/manifestations/m1/archive");
    expect(bodyOf()).toEqual({ expected_state: "in_analysis", reason: "duplicate", duplicate_of_protocol: "2026-000100" });
    await runOmbudsmanAction("m1", "final_response", { expected_state: "in_analysis", text: "A UBS recebeu a losartana em 10/11.",
      resolution: "resolved" });
    expect(last().url).toBe("/ombudsman/manifestations/m1/final_response");
    noSecretInUrl();
  });

  it("identidade, consentimento e anexo protegido: justificativa e texto só no corpo", async () => {
    stub(fullIdentity());
    expect((await revealOmbudsmanIdentity("m2", "conferir denúncia repetida do mesmo autor")).full_name).toBe("Joana Prado Lima");
    expect(last()).toMatchObject({ url: "/ombudsman/manifestations/m2/identity", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ justification: "conferir denúncia repetida do mesmo autor" });
    stub(manifestation());
    await recordIdentityConsent("m2", { granted: true, text: "Joana autorizou por telefone em 11/11." });
    expect(last()).toMatchObject({ url: "/ombudsman/manifestations/m2/identity_consent", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ granted: true, text: "Joana autorizou por telefone em 11/11." });
    stub({ url: "/ombudsman/files/tok1", expires_at: "2026-11-11T13:05:00Z" });
    expect(await getOmbudsmanAttachmentUrl("a1", "abrir laudo anexado")).toBe("/ombudsman/files/tok1");
    expect(last()).toMatchObject({ url: "/ombudsman/attachments/a1/link", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ justification: "abrir laudo anexado" });
    stub({ url: "/ombudsman/files/tok2", expires_at: "2026-11-11T13:05:00Z" });
    await getOmbudsmanAttachmentUrl("a2");
    expect(bodyOf()).toEqual({});
    noSecretInUrl();
  });

  it("arquivo do link: pela base da ouvidoria, aceitando PDF e imagem", async () => {
    stub("%PDF-1.4", 200, { "Content-Type": "application/pdf" });
    const f = await fetchOmbudsmanFile("/ombudsman/files/tok1");
    expect(last().url).toBe("/ombudsman/files/tok1");
    expect((last().init.headers as Record<string, string>).Accept).toBe("application/pdf,image/jpeg,image/png");
    expect(await f.blob.text()).toBe("%PDF-1.4");
  });

  it("registro pela equipe: só os campos preenchidos, aparados; busca de pessoa por POST, null sem par verificado", async () => {
    stub({ citizen_id: "c1", name: "Maria Lima", cpf_masked: "***.982.247-**" });
    expect(await lookupOmbudsmanPerson("52998224725")).toEqual({ citizen_id: "c1", name: "Maria Lima", cpf_masked: "***.982.247-**" });
    expect(last()).toMatchObject({ url: "/ombudsman/person_lookup", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ cpf: "52998224725" });
    stub("null");
    expect(await lookupOmbudsmanPerson("529.982.247-25")).toBeNull();
    stub({ id: "m9", protocol: "2026-000130", due_on: "2026-12-11" }, 201);
    expect(await createOmbudsmanManifestation({ kind: "complaint", identification_mode: "identified", channel: "phone", citizen_id: "c1",
      body: "Fui à UBS Centro três vezes e não havia losartana.", manifestant_name: "  ", health_unit_id: null, attachment_ids: [] }))
      .toEqual({ id: "m9", protocol: "2026-000130", due_on: "2026-12-11" });
    expect(last()).toMatchObject({ url: "/ombudsman/manifestations", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ kind: "complaint", identification_mode: "identified", channel: "phone", citizen_id: "c1",
      body: "Fui à UBS Centro três vezes e não havia losartana." });
    await createOmbudsmanManifestation({ kind: "report", identification_mode: "preserved", channel: "ouvidorsus",
      ouvidorsus_number: " 123456 ", manifestant_name: " Joana Prado ", manifestant_contact: "(41) 99876-1234",
      manifestant_cpf: "52998224725", body: "Denúncia de cobrança indevida na UPA.", health_unit_id: "upa1", attachment_ids: [ "a1" ] });
    expect(bodyOf()).toEqual({ kind: "report", identification_mode: "preserved", channel: "ouvidorsus", ouvidorsus_number: "123456",
      manifestant_name: "Joana Prado", manifestant_contact: "(41) 99876-1234", manifestant_cpf: "52998224725",
      body: "Denúncia de cobrança indevida na UPA.", health_unit_id: "upa1", attachment_ids: [ "a1" ] });
    noSecretInUrl();
  });

  it("anexo: anexo-N.<ext>, tipo e base64 — o nome real do arquivo nunca vai (Q2)", async () => {
    stub({ id: "a1" }, 201);
    expect(await uploadOmbudsmanAttachment(new File([ "%PDF-1.4" ], "RG Maria Lima.pdf", { type: "application/pdf" }), 1))
      .toEqual({ id: "a1" });
    expect(last()).toMatchObject({ url: "/ombudsman/attachments", init: { method: "POST" } });
    expect(Object.keys(bodyOf()).sort()).toEqual([ "content_type", "data", "filename" ]);
    expect(bodyOf()).toMatchObject({ filename: "anexo-1.pdf", content_type: "application/pdf", data: btoa("%PDF-1.4") });
    expect(bodyOf().filename).toMatch(/^anexo-\d+\.(pdf|jpg|png)$/);
    expect(JSON.stringify(bodyOf())).not.toMatch(/Maria|RG/);
    await uploadOmbudsmanAttachment(new File([ "x" ], "foto da Maria.jpeg", { type: "image/jpeg" }), 2);
    expect(bodyOf().filename).toBe("anexo-2.jpg");
    await uploadOmbudsmanAttachment(new File([ "x" ], "Maria.png", { type: "image/png" }), 3);
    expect(bodyOf().filename).toBe("anexo-3.png");
    noSecretInUrl();
  });

  it("ponto de resposta: lista paginada; resposta, recusa e prorrogação com expected_state do encaminhamento (Q33)", async () => {
    stub({ items: [ inboxItem() ], next_before: "c9" });
    expect(await listOmbudsmanInbox()).toEqual({ items: [ inboxItem() ], next_before: "c9" });
    expect(last().url).toBe("/ombudsman/inbox");
    await listOmbudsmanInbox({ before: "c9" });
    expect(last().url).toBe("/ombudsman/inbox?before=c9");
    stub(inboxItem({ state: "replied", reply: "Reposição feita em 10/11; a UBS já tem o medicamento." }));
    expect((await replyOmbudsmanInbox("f1", "pending", "Reposição feita em 10/11; a UBS já tem o medicamento.")).state).toBe("replied");
    expect(last()).toMatchObject({ url: "/ombudsman/inbox/f1/reply", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ expected_state: "pending", body: "Reposição feita em 10/11; a UBS já tem o medicamento." });
    await declineOmbudsmanInbox("f1", "pending", "Quem cuida é a farmácia central.");
    expect(last().url).toBe("/ombudsman/inbox/f1/decline");
    expect(bodyOf()).toEqual({ expected_state: "pending", reason: "Quem cuida é a farmácia central." });
    await extendOmbudsmanInbox("f1", "pending", "Aguardamos o fornecedor até a semana que vem.");
    expect(last().url).toBe("/ombudsman/inbox/f1/extend");
    expect(bodyOf()).toEqual({ expected_state: "pending", reason: "Aguardamos o fornecedor até a semana que vem." });
    noSecretInUrl();
  });

  it("encaminhamento cancelado com o estado lido e decisão do pedido de reabertura", async () => {
    stub(manifestation({ forwardings: [ forwarding({ state: "cancelled", color: null }) ] }));
    await cancelOmbudsmanForwarding("f1", "pending");
    expect(last()).toMatchObject({ url: "/ombudsman/forwardings/f1/cancel", init: { method: "POST", body: "{\"expected_state\":\"pending\"}" } });
    await decideReopenRequest("r1", { decision: "reject", text: "A resposta já tratou o ponto levantado." });
    expect(last()).toMatchObject({ url: "/ombudsman/reopen_requests/r1/decide", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ decision: "reject", text: "A resposta já tratou o ponto levantado." });
    noSecretInUrl();
  });

  it("setores, respondentes e assuntos: listas em { items }, escrita com corpo", async () => {
    stub({ items: [ { id: "d1", name: "Ouvidoria", active: true } ] });
    expect(await listDepartments()).toEqual([ { id: "d1", name: "Ouvidoria", active: true } ]);
    expect(last().url).toBe("/departments");
    stub({ id: "d1", name: "Ouvidoria", active: true }, 201);
    await createDepartment("Ouvidoria");
    expect(last()).toMatchObject({ url: "/departments", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ name: "Ouvidoria" });
    stub({ id: "d1", name: "Ouvidoria", active: false });
    await updateDepartment("d1", { name: "Ouvidoria", active: false });
    expect(last()).toMatchObject({ url: "/departments/d1", init: { method: "PATCH" } });
    expect(bodyOf()).toEqual({ name: "Ouvidoria", active: false });

    const responder = { id: "r1", user: { id: "u2", email: "ana@curitiba.demo", name: "Ana Souza" },
      destination: { kind: "department", id: "dep1", name: "Assistência Farmacêutica" }, active: true };
    stub({ items: [ responder ] });
    expect(await listOmbudsmanResponders()).toEqual([ responder ]);
    expect(last().url).toBe("/ombudsman/responders");
    stub({ items: [ { id: "u2", name: "Ana Souza", email: "ana@curitiba.demo" } ] });
    expect((await listResponderCandidates())[0].name).toBe("Ana Souza");
    expect(last().url).toBe("/ombudsman/responder_candidates");
    stub(responder, 201);
    await createOmbudsmanResponder({ user_id: "u2", health_unit_id: "ubs1" });
    expect(last()).toMatchObject({ url: "/ombudsman/responders", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ user_id: "u2", health_unit_id: "ubs1" });
    await updateOmbudsmanResponder("r1", { active: false });
    expect(last()).toMatchObject({ url: "/ombudsman/responders/r1", init: { method: "PATCH" } });
    expect(bodyOf()).toEqual({ active: false });

    stub({ items: subjects33() });
    expect((await listOmbudsmanSubjects())[0].children?.map((c) => c.active)).toEqual([ true, true, false ]);
    expect(last().url).toBe("/ombudsman/subjects");
    stub({ id: "s7", name: "Medicamentos", active: true, children: [] }, 201);
    await createOmbudsmanSubject({ name: "Medicamentos", parent_id: null });
    expect(last()).toMatchObject({ url: "/ombudsman/subjects", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ name: "Medicamentos" });
    await createOmbudsmanSubject({ name: "Falta", parent_id: "s7" });
    expect(bodyOf()).toEqual({ name: "Falta", parent_id: "s7" });
    await updateOmbudsmanSubject("s7", { name: "Medicamentos", active: false });
    expect(last()).toMatchObject({ url: "/ombudsman/subjects/s7", init: { method: "PATCH" } });
    expect(bodyOf()).toEqual({ name: "Medicamentos", active: false });
  });

  it("prazos, painel e relatório pelos caminhos do contrato §7 e §11", async () => {
    stub(settings33());
    expect(await getOmbudsmanSettings()).toEqual(settings33());
    expect(last().url).toBe("/ombudsman/settings");
    await updateOmbudsmanSettings(settings33({ warning_days: 3 }));
    expect(last()).toMatchObject({ url: "/ombudsman/settings", init: { method: "PATCH" } });
    expect(bodyOf()).toEqual(settings33({ warning_days: 3 }));
    stub(dashboard33());
    expect((await getOmbudsmanDashboard({ from: "2026-11-01", to: "2026-11-11" })).by_kind.total).toBe(42);
    expect(last().url).toBe("/ombudsman/dashboard?from=2026-11-01&to=2026-11-11");
    const row = { professional: { id: "p1", name: "Carlos Mendes" },
      by_kind: { complaint: 2, report: 0, praise: 1, suggestion: 0, request: 0 }, total: 3 };
    stub({ items: [ row ] });
    expect(await getOmbudsmanProfessionalsPanel({ from: "2026-11-01", to: "2026-11-11" })).toEqual([ row ]);
    expect(last().url).toBe("/ombudsman/dashboard/professionals?from=2026-11-01&to=2026-11-11");
    stub(annualReport());
    expect((await getAnnualReport(2025)).state).toBe("draft");
    expect(last().url).toBe("/ombudsman/annual_reports/2025");
    await updateAnnualReport(2025, { recurring_problems: "Falta de medicamento", actions_taken: "", notes: "" });
    expect(last()).toMatchObject({ url: "/ombudsman/annual_reports/2025", init: { method: "PATCH" } });
    expect(bodyOf()).toEqual({ recurring_problems: "Falta de medicamento", actions_taken: "", notes: "" });
    stub(annualReport({ state: "published", published_at: "2026-01-15T12:00:00Z" }));
    await publishAnnualReport(2025);
    expect(last()).toMatchObject({ url: "/ombudsman/annual_reports/2025/publish", init: { method: "POST", body: "{}" } });
  });

  it("toda escrita leva Content-Type JSON (o api responde 415 sem ele)", async () => {
    stub(manifestation());
    await cancelOmbudsmanForwarding("f1", "pending");
    await publishAnnualReport(2025);
    await getOmbudsmanAttachmentUrl("a2");
    for (const c of calls) expect((c.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("dados de teste do módulo 33", () => {
  it("o detalhe tem a forma do api: can segue o estado, sem chaves que o api não manda", () => {
    const m = manifestation();
    expect("cycle_started_on" in m).toBe(false);
    expect(m.attachments).toEqual([]);
    expect("text" in m.events[0]).toBe(false);
    expect("reply" in forwarding()).toBe(false);
    expect(m.can).toMatchObject({ classify: true, forward: true, final_response: true, cancel_forwarding: false, reopen: false });
    const fw = manifestation({ state: "forwarded", pending_forwardings: 1 });
    expect(fw.can).toMatchObject({ final_response: false, cancel_forwarding: true, forward: true, classify: false });
    const done = manifestation({ state: "answered", color: null, resolution: "resolved" });
    expect(done.can).toMatchObject({ reopen: true, change_resolution: true, interim_response: false, archive: false });
    const { can: _ignored, ...rest } = m;
    void _ignored;
    expect(can33(rest, false)).toMatchObject({ extend: false, archive: false, open_identity: false, classify: true });
    expect(preserved()).toMatchObject({ identification_mode: "preserved", identity: "preserved", kind: "report" });
    expect(options().health_units.map((u) => u.id)).toEqual([ "ubs1", "upa1" ]);
  });
});
