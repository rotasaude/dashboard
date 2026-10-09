import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, closeSignatureSession, completeSignatureOAuth, discoverCertificates, fetchSignatureFile, getCurrentCertificate,
  getSignature, getSignatureOverview, getSignatureSession, linkCertificate, listPendingSignatures, openSignatureSession,
  returnToPaper, startSignatureBatch, unlinkCertificate, verifySignature
} from "./api";
import { certificate, overview, pendingRequest, signatureDetail } from "../test/signatureFixtures";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
const json = (fn: ReturnType<typeof stub>, i = 0) =>
  (call(fn, i)[1].headers as Record<string, string>)["Content-Type"];
// Toda escrita por cookie exige JSON (CSRF do api): método, header e corpo.
function expectJsonWrite(fn: ReturnType<typeof stub>, method: string, body: unknown, i = 0) {
  expect(call(fn, i)[1].method).toBe(method);
  expect(json(fn, i)).toBe("application/json");
  expect(JSON.parse(call(fn, i)[1].body as string)).toEqual(body);
}

function stubFile(body: string, headers: Record<string, string>) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status: 200, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("cliente da assinatura digital — certificado", () => {
  it("lê o certificado corrente; 404 certificate_not_linked vira null; outra recusa sobe", async () => {
    const fn = stub(certificate());
    expect((await getCurrentCertificate())?.provider).toBe("vidaas");
    expect(call(fn)[0]).toBe("/signature/certificates/current");
    expect(call(fn)[1].method).toBeUndefined();
    expect(call(fn)[1].credentials).toBe("include");

    stub({ error: "certificate_not_linked" }, 404);
    expect(await getCurrentCertificate()).toBeNull();

    stub({ error: "feature_disabled", feature: "digital_signature" }, 403);
    await expect(getCurrentCertificate()).rejects.toBeInstanceOf(ApiError);
  });

  it("procurar, vincular (provider e return_to no corpo) e desvincular", async () => {
    let fn = stub({ providers: [ { provider: "vidaas", found: true } ], unavailable: [] });
    expect((await discoverCertificates()).providers[0].found).toBe(true);
    expect(call(fn)[0]).toBe("/signature/certificates/discover");
    expectJsonWrite(fn, "POST", {});

    fn = stub({ authorize_url: "https://psc.example/authorize?x=1" });
    expect((await linkCertificate("vidaas", "/signature")).authorize_url).toBe("https://psc.example/authorize?x=1");
    expect(call(fn)[0]).toBe("/signature/certificates/link");
    expectJsonWrite(fn, "POST", { provider: "vidaas", return_to: "/signature" });

    fn = stub(undefined, 204);
    await unlinkCertificate();
    expect(call(fn)[0]).toBe("/signature/certificates/current");
    expectJsonWrite(fn, "DELETE", {});
  });
});

describe("cliente da assinatura digital — sessão e retorno do prestador", () => {
  it("abrir, ler e encerrar a sessão", async () => {
    let fn = stub({ authorize_url: "https://psc.example/authorize?s=1" });
    expect((await openSignatureSession("/attendance")).authorize_url).toBe("https://psc.example/authorize?s=1");
    expect(call(fn)[0]).toBe("/signature/sessions");
    expectJsonWrite(fn, "POST", { return_to: "/attendance" });

    fn = stub({ active: true, expires_at: "2026-10-08T22:00:00-03:00", provider: "vidaas" });
    expect((await getSignatureSession()).active).toBe(true);
    expect(call(fn)[0]).toBe("/signature/sessions/current");

    fn = stub(undefined, 204);
    await closeSignatureSession();
    expect(call(fn)[0]).toBe("/signature/sessions/current");
    expectJsonWrite(fn, "DELETE", {});
  });

  it("state e code vão no corpo, nunca na URL", async () => {
    const fn = stub({ purpose: "session", result: { expires_at: "2026-10-08T22:00:00-03:00" }, return_to: "/attendance" });
    const out = await completeSignatureOAuth("st-1", "code-1");
    expect(out.purpose).toBe("session");
    expect(out.return_to).toBe("/attendance");
    expect(call(fn)[0]).toBe("/signature/oauth/callback");
    expectJsonWrite(fn, "POST", { state: "st-1", code: "code-1" });
  });

  it("recusa do prestador: state e error vão no corpo, nunca na URL (R11)", async () => {
    const fn = stub({ error: "authorization_denied", return_to: "/signature" }, 403);
    const err = await completeSignatureOAuth("st-1", { error: "access_denied" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).body).toEqual({ error: "authorization_denied", return_to: "/signature" });
    expect(call(fn)[0]).toBe("/signature/oauth/callback");
    expect(call(fn)[0]).not.toContain("st-1");
    expect(call(fn)[0]).not.toContain("access_denied");
    expectJsonWrite(fn, "POST", { state: "st-1", error: "access_denied" });
  });
});

describe("cliente da assinatura digital — pendentes e lote", () => {
  it("lista as pendentes e volta ao papel com o motivo no corpo", async () => {
    let fn = stub({ items: [ pendingRequest() ] });
    expect(await listPendingSignatures()).toHaveLength(1);
    expect(call(fn)[0]).toBe("/signature/requests?status=pending");

    fn = stub(pendingRequest({ status: "returned_to_paper", reason_code: "user_request" }));
    expect((await returnToPaper("sr/1", "paciente pediu o papel")).status).toBe("returned_to_paper");
    expect(call(fn)[0]).toBe("/signature/requests/sr%2F1/return_to_paper");
    expectJsonWrite(fn, "POST", { reason: "paciente pediu o papel" });
  });

  it("lote: sem ids manda só o return_to; com ids, os dois", async () => {
    let fn = stub({ authorize_url: "https://psc.example/authorize?b=1", count: 3 });
    expect((await startSignatureBatch("/signature-pending")).count).toBe(3);
    expect(call(fn)[0]).toBe("/signature/batches");
    expectJsonWrite(fn, "POST", { return_to: "/signature-pending" });

    fn = stub({ authorize_url: "https://psc.example/authorize?b=2", count: 1 });
    await startSignatureBatch("/signature-pending", [ "sr1" ]);
    expectJsonWrite(fn, "POST", { request_ids: [ "sr1" ], return_to: "/signature-pending" });
  });
});

describe("cliente da assinatura digital — assinatura e painel", () => {
  it("ler e revalidar a assinatura (verify manda JSON com corpo {}, senão o api responde 415)", async () => {
    let fn = stub(signatureDetail());
    expect((await getSignature("sg1")).policy).toBe("AD-RB");
    expect(call(fn)[0]).toBe("/signature/signatures/sg1");

    fn = stub(signatureDetail({ verification: "indeterminate" }));
    expect((await verifySignature("sg1")).verification).toBe("indeterminate");
    expect(call(fn)[0]).toBe("/signature/signatures/sg1/verify");
    expectJsonWrite(fn, "POST", {});
    expect(call(fn)[1].body).toBe("{}");
  });

  it("os tipos aceitam a assinatura simulada", async () => {
    stub(signatureDetail({ provider: "simulated", simulated: true }));
    const d = await getSignature("sg1");
    expect(d.simulated).toBe(true);
    expect(d.provider).toBe("simulated");
  });

  it("baixa PDF e pacote com a sessão; recusa vira ApiError com o código", async () => {
    let fn = stubFile("%PDF-1.7", { "Content-Type": "application/pdf" });
    expect((await fetchSignatureFile("sg1", "pdf")).blob.size).toBe(8);
    expect(fn.mock.calls[0][0]).toBe("/signature/signatures/sg1/pdf");
    expect((fn.mock.calls[0][1] as RequestInit).credentials).toBe("include");
    expect(((fn.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Accept).toBe("application/pdf");

    fn = stubFile("PK", { "Content-Type": "application/zip" });
    await fetchSignatureFile("sg1", "package");
    expect(fn.mock.calls[0][0]).toBe("/signature/signatures/sg1/package");
    expect(((fn.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Accept).toBe("application/zip");

    stub({ error: "out_of_context" }, 403);
    const err = await fetchSignatureFile("sg1", "pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toEqual({ error: "out_of_context" });
  });

  it("o nome do arquivo vem do Content-Disposition só quando é seguro; senão null", async () => {
    stubFile("PK", { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="documento-assinado-simulado.zip"' });
    expect((await fetchSignatureFile("sg1", "package")).filename).toBe("documento-assinado-simulado.zip");

    stubFile("%PDF", { "Content-Disposition": "attachment; filename*=UTF-8''documento-assinado.pdf" });
    expect((await fetchSignatureFile("sg1", "pdf")).filename).toBe("documento-assinado.pdf");

    stubFile("%PDF", { "Content-Disposition": 'attachment; filename="../etc/passwd"' });
    expect((await fetchSignatureFile("sg1", "pdf")).filename).toBeNull();

    stubFile("%PDF", { "Content-Disposition": 'attachment; filename="Joana Lima.pdf"' });
    expect((await fetchSignatureFile("sg1", "pdf")).filename).toBeNull();

    stubFile("%PDF", {});
    expect((await fetchSignatureFile("sg1", "pdf")).filename).toBeNull();
  });

  it("painel do admin: só as datas na URL", async () => {
    const fn = stub(overview());
    expect((await getSignatureOverview({ from: "2026-09-08", to: "2026-10-08" })).documents_by_mode.digital).toBe(42);
    expect(call(fn)[0]).toBe("/signature/admin/overview?from=2026-09-08&to=2026-10-08");
  });
});
