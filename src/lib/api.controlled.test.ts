import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeSncrOAuth, getLastPatientIdentification, getProfessionalContact, getSncrOverview, getSncrStock, recordNotification,
  requestSncrNumbers, saveProfessionalContact, type NotificationRecordInput
} from "./api";
import { address, contact, notificationDoc, rceDoc, sncrOverview, stock } from "../test/controlledFixtures";

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
// Dado pessoal e segredo de fluxo nunca na URL.
const SECRETS = /ST-\d|SID-1|39053344705|80010010|4133501234|Marechal|Deodoro|PR0012345/;

describe("cliente do SNCR", () => {
  it("lê o estoque do usuário corrente com a sessão", async () => {
    const fn = stub(stock());
    expect((await getSncrStock()).rce.free).toBe(812);
    expect(call(fn)[0]).toBe("/sncr/stock");
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("pede números com kind e return_to no corpo e devolve o authorize_url e o state", async () => {
    const fn = stub({ authorize_url: "https://sncr-auth.example.br/auth/login?client_url=x", state: "ST-1" });
    expect(await requestSncrNumbers("rce", "/sncr")).toEqual({ authorize_url: "https://sncr-auth.example.br/auth/login?client_url=x", state: "ST-1" });
    expect(call(fn)[0]).toBe("/sncr/requests");
    expectJsonWrite(fn, "POST", { kind: "rce", return_to: "/sncr" });
  });

  it("devolve state e session_id (ou o erro da volta) só no corpo", async () => {
    let fn = stub({ kind: "ret", received: 1000, batch_id: "b1", return_to: "/sncr" });
    expect((await completeSncrOAuth("ST-1", "SID-1")).received).toBe(1000);
    expect(call(fn)[0]).toBe("/sncr/oauth/callback");
    expectJsonWrite(fn, "POST", { state: "ST-1", session_id: "SID-1" });
    expect(call(fn)[0]).not.toMatch(SECRETS);
    fn = stub({ error: "authorization_denied", return_to: "/sncr" }, 403);
    await expect(completeSncrOAuth("ST-2", { error: "access_denied" })).rejects.toMatchObject({ status: 403 });
    expect(call(fn)[0]).toBe("/sncr/oauth/callback");
    expectJsonWrite(fn, "POST", { state: "ST-2", error: "access_denied" });
  });

  it("painel do admin", async () => {
    const fn = stub(sncrOverview());
    expect((await getSncrOverview()).professionals).toHaveLength(3);
    expect(call(fn)[0]).toBe("/sncr/admin/overview");
  });
});

describe("cliente do contato do profissional e da Notificação", () => {
  it("contato: lê e grava com PUT JSON; endereço e telefone só no corpo", async () => {
    let fn = stub(contact());
    expect((await getProfessionalContact()).phone).toBe("4133501234");
    expect(call(fn)[0]).toBe("/attendance/professional_profile/contact");
    fn = stub(contact());
    const body = { address: address(), phone: "4133501234" };
    await saveProfessionalContact(body);
    expect(call(fn)[0]).toBe("/attendance/professional_profile/contact");
    expect(call(fn)[0]).not.toMatch(SECRETS);
    expectJsonWrite(fn, "PUT", body);
  });

  it("registra a Notificação pela rota de documentos da consulta", async () => {
    const fn = stub(notificationDoc(), 201);
    const content: NotificationRecordInput = {
      notification_type: "B", paper_number: "PR0012345", numbering_uf: "PR",
      item: { catalog_item: { id: "ci3" }, quantity: 30, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido à noite", duration_days: 30 }
    };
    const doc = await recordNotification("cs1", content);
    expect(doc.short_code).toBeNull();
    expect(doc.verification_url).toBeNull();
    expect(doc.signature).toBeNull();
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/documents");
    expect(call(fn)[0]).not.toMatch(SECRETS);
    expectJsonWrite(fn, "POST", { kind: "controlled_notification_record", content });
  });

  it("última identificação: devolve a identificação, ou null no 200 sem anterior", async () => {
    const fn = stub({ patient_identification: { cpf: "39053344705", address: address() } });
    expect((await getLastPatientIdentification("cs1"))?.address.zip).toBe("80010010");
    expect(call(fn)[0]).toBe("/attendance/consultations/cs1/patient_identification");
    expect(call(fn)[1].method).toBeUndefined();
    stub({ patient_identification: null });
    expect(await getLastPatientIdentification("cs1")).toBeNull();
  });

  it("última identificação: 404 (consulta não encontrada) e 403 sobem, sem virar null", async () => {
    stub({ error: "not_found" }, 404);
    await expect(getLastPatientIdentification("cs1")).rejects.toMatchObject({ status: 404 });
    stub({ error: "not_author" }, 403);
    await expect(getLastPatientIdentification("cs1")).rejects.toMatchObject({ status: 403 });
  });

  it("as fixtures têm a forma do api: item de documento sem marcas, código no formato real, registro sem código", () => {
    const rce = rceDoc();
    const item = (rce.content as { items: { catalog_item?: Record<string, unknown> }[] }).items[0];
    expect(item.catalog_item).not.toHaveProperty("controlled_list");
    expect(rce.short_code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    const note = notificationDoc();
    expect(note.kind).toBe("controlled_notification_record");
    expect(note.short_code).toBeNull();
  });
});
