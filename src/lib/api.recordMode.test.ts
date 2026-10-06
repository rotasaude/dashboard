// src/lib/api.recordMode.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, applyCnesProposals, cadsusLookup, checkIntegrationCredential, getCnes, getIntegrations, getProduction,
  resendFicha, setIntegrationCredential, verifyCitizen
} from "./api";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];
const ITEM = {
  kind: "ledi", set: true, set_at: "2026-10-01T13:00:00Z", set_by: "admin@curitiba.demo",
  last_check_at: null, last_check_status: null, last_check_message: null
};

describe("cliente de Integrações (contratos §5.1)", () => {
  it("lê /integrations com o cookie", async () => {
    const fn = stub({ record_mode: "off", pec_url_set: false, ibge_code_set: true, credentials: [], features: [] });
    expect((await getIntegrations()).ibge_code_set).toBe(true);
    expect(call(fn)[0]).toBe("/integrations");
    expect(call(fn)[1].credentials).toBe("include");
  });

  it("a senha vai como digitada, sem trim, e só no corpo", async () => {
    const fn = stub(ITEM);
    await setIntegrationCredential("ledi", "integ.pec", "  s3nh@ com espaço  ");
    expect(call(fn)[0]).toBe("/integrations/credentials/ledi");
    expect(call(fn)[1].method).toBe("PUT");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual({ username: "integ.pec", password: "  s3nh@ com espaço  " });
    expect(call(fn)[0]).not.toContain("s3nh");
  });

  it("testa a conexão com POST e devolve o item atualizado", async () => {
    const fn = stub({ ...ITEM, kind: "cadsus", last_check_status: "ok" });
    expect((await checkIntegrationCredential("cadsus")).last_check_status).toBe("ok");
    expect(call(fn)[0]).toBe("/integrations/credentials/cadsus/check");
    expect(call(fn)[1].method).toBe("POST");
  });

  it("409 credential_missing é exceção com o código", async () => {
    stub({ error: "credential_missing" }, 409);
    const err = await checkIntegrationCredential("ledi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toEqual({ error: "credential_missing" });
  });
});

describe("cliente do CNES (contratos §5.2)", () => {
  it("lê /cnes e aplica o lote em /cnes/apply", async () => {
    const fn = stub({ snapshot: null, proposals: [], divergences: [] });
    expect((await getCnes()).snapshot).toBeNull();
    expect(call(fn)[0]).toBe("/cnes");
    const fn2 = stub({ applied: 1, skipped: [ { id: "p2", reason: "stale" } ] });
    expect((await applyCnesProposals([ "p1", "p2" ])).skipped[0].reason).toBe("stale");
    expect(call(fn2)[0]).toBe("/cnes/apply");
    expect(call(fn2)[1].method).toBe("POST");
    expect(JSON.parse(call(fn2)[1].body as string)).toEqual({ proposal_ids: [ "p1", "p2" ] });
  });
});

describe("cliente da Produção (contratos §5.3)", () => {
  const PROD = {
    competence: "202610", deadline_on: "2026-11-16", business_days_left: 7, alert: "none",
    counts: { accepted: 0, rejected: 0, pending: 0, sending: 0, failed: 0 }, rejections: [], fichas: [], fichas_total: 0
  };

  it("sem competência nem página: /production puro (a API usa a corrente)", async () => {
    const fn = stub(PROD);
    await getProduction(null, 1);
    expect(call(fn)[0]).toBe("/production");
  });

  it("competência e página vão na query", async () => {
    const fn = stub(PROD);
    await getProduction("202609", 3);
    expect(call(fn)[0]).toBe("/production?competence=202609&page=3");
  });

  it("corpo sem counts.sending volta como veio", async () => {
    const { sending: _omit, ...counts } = PROD.counts;
    stub({ ...PROD, counts });
    const prod = await getProduction(null, 1);
    expect(prod.counts).toEqual({ accepted: 0, rejected: 0, pending: 0, failed: 0 });
    expect(prod.counts.sending).toBeUndefined();
  });

  it("reenvia a ficha com POST no id escapado", async () => {
    const fn = stub({ id: "a/b", ficha_type: "synthetic", status: "pending", attempts: 2, last_error: null,
      created_at: "2026-10-02T13:00:00Z", accepted_at: null });
    expect((await resendFicha("a/b")).status).toBe("pending");
    expect(call(fn)[0]).toBe("/production/fichas/a%2Fb/resend");
    expect(call(fn)[1].method).toBe("POST");
  });
});

describe("CADSUS no balcão (contratos §5.4)", () => {
  const PROFILE = { birth_date: "1963-04-02", sex: "female" as const, gender_identity: null };

  it("consulta com CPF e código no corpo, nunca na URL", async () => {
    const fn = stub({ found: true, cns_masked: "7** **** **** 1234", birth_date_matches: true, sex_matches: null });
    expect((await cadsusLookup("529.982.247-25", "123456")).cns_masked).toBe("7** **** **** 1234");
    expect(call(fn)[0]).toBe("/attendance/cadsus_lookup");
    expect(JSON.parse(call(fn)[1].body as string)).toEqual({ cpf: "529.982.247-25", code: "123456" });
  });

  it("validação sem extra manda o corpo de antes; com extra, cadsus_confirmed", async () => {
    const fn = stub({ verification: { id: "v1" } }, 201);
    await verifyCitizen("529.982.247-25", "123456", PROFILE);
    expect(JSON.parse(call(fn)[1].body as string))
      .toEqual({ cpf: "529.982.247-25", code: "123456", document_checked: true, ...PROFILE });
    await verifyCitizen("529.982.247-25", "123456", PROFILE, { cadsus_confirmed: true });
    expect(JSON.parse(call(fn, 1)[1].body as string))
      .toEqual({ cpf: "529.982.247-25", code: "123456", document_checked: true, ...PROFILE, cadsus_confirmed: true });
  });
});
