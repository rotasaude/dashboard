import { describe, it, expect, vi, afterEach } from "vitest";
import { adminFetch, ApiError } from "./api";
import { login, fetchCurrentSession } from "./api";
import { requestPasswordReset, resetPassword } from "./api";
import { enrollMfa, confirmMfa, stepUpMfa } from "./api";
import { listMemberships, grantRole, revokeMembership } from "./api";
import { submitProtocol, signProtocol, publishProtocolVersion, activateProtocol, retireProtocol, revertProtocol } from "./api";
import { listVerifications } from "./api";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json" } }
  )));
}

describe("adminFetch", () => {
  it("devolve o envelope { data, as_of } em 2xx", async () => {
    mockFetch(200, { data: { total: 3 }, as_of: "2026-06-26T12:00:00Z" });
    const env = await adminFetch<{ total: number }>("/overview", { period: "7d", municipality_id: "m1" });
    expect(env.data.total).toBe(3);
    expect(env.as_of).toBe("2026-06-26T12:00:00Z");
  });
  it("lança ApiError em status != 2xx", async () => {
    mockFetch(422, { error: "bad" });
    await expect(adminFetch("/overview")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("sessão", () => {
  it("login faz POST e devolve SessionUser", async () => {
    mockFetch(200, { id: "u1", email_address: "a@curitiba.demo", operator: false, memberships: [] });
    const u = await login("a@curitiba.demo", "pw");
    expect(u.email_address).toBe("a@curitiba.demo");
  });
  it("fetchCurrentSession devolve null em 401", async () => {
    mockFetch(401, { error: "unauth" });
    expect(await fetchCurrentSession()).toBe(null);
  });
});

describe("password reset", () => {
  it("requestPasswordReset POSTs to /passwords and resolves on 204", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestPasswordReset("a@x.com")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/passwords");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ email_address: "a@x.com" });
  });

  it("resetPassword PUTs to /passwords/:token and resolves on 204", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resetPassword("tok-1", "newpw", "newpw")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/passwords/tok-1");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ password: "newpw", password_confirmation: "newpw" });
  });

  it("resetPassword rejects with ApiError on 422", async () => {
    mockFetch(422, { error: "invalid_token" });
    await expect(resetPassword("bad", "a", "a")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("mfa", () => {
  function lastCall() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [ url, init ] = fetchMock.mock.calls.at(-1) as [ string, RequestInit ];
    return { url, init, headers: init.headers as Record<string, string> };
  }

  it("enrollMfa: POST /mfa/enroll com JSON (a API recusa escrita por cookie sem JSON)", async () => {
    mockFetch(200, { otpauth_uri: "otpauth://totp/x?secret=ABC", recovery_codes: [ "a1" ] });
    const out = await enrollMfa();
    const { url, init, headers } = lastCall();
    expect(url).toBe("/mfa/enroll");
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(out.recovery_codes).toEqual([ "a1" ]);
  });

  it("confirmMfa e stepUpMfa mandam { code }", async () => {
    mockFetch(200, { ok: true });
    await confirmMfa("123456");
    expect(lastCall().url).toBe("/mfa/confirm");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ code: "123456" });

    mockFetch(200, { ok: true });
    await stepUpMfa("654321");
    expect(lastCall().url).toBe("/mfa/step_up");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ code: "654321" });
  });
});

describe("memberships", () => {
  function lastCall() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [ url, init ] = fetchMock.mock.calls.at(-1) as [ string, RequestInit ];
    return { url, init };
  }

  it("listMemberships devolve data", async () => {
    mockFetch(200, { data: [ { id: "m1", user: { id: "u1", email_address: "a@b" }, role: "viewer", granted_at: "2026-09-01T00:00:00Z" } ] });

    const rows = await listMemberships();

    expect(lastCall().url).toBe("/setup/memberships");
    expect(rows).toHaveLength(1);
    expect(rows[0].user.email_address).toBe("a@b");
  });

  it("grantRole manda user_id e role em JSON", async () => {
    mockFetch(201, { id: "m2" });

    await grantRole("u1", "protocol_reviewer");

    const { url, init } = lastCall();
    expect(url).toBe("/setup/memberships");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ user_id: "u1", role: "protocol_reviewer" });
  });

  it("revokeMembership chama a rota de revogação", async () => {
    mockFetch(200, { id: "m2", revoked_at: "2026-09-22T00:00:00Z" });

    await revokeMembership("m2");

    const { url, init } = lastCall();
    expect(url).toBe("/setup/memberships/m2/revoke");
    expect(init.method).toBe("POST");
  });
});

describe("ciclo de vida de protocolo", () => {
  function lastCall() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [ url, init ] = fetchMock.mock.calls.at(-1) as [ string, RequestInit ];
    return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
  }

  it("submitProtocol manda o nome na rota da versão", async () => {
    mockFetch(200, { ok: true });
    await submitProtocol("dengue", "2");
    const { url, init, body } = lastCall();
    expect(url).toBe("/protocols/2/submit");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ name: "dengue" });
  });

  it("signProtocol manda a finalidade", async () => {
    mockFetch(200, { ok: true });
    await signProtocol("dengue", "2", "activation");
    expect(lastCall().url).toBe("/protocols/2/signatures");
    expect(lastCall().body).toEqual({ name: "dengue", purpose: "activation" });
  });

  it("publicar, ativar e aposentar usam a rota da versão", async () => {
    for (const [ fn, path ] of [
      [ publishProtocolVersion, "publish" ], [ activateProtocol, "activate" ], [ retireProtocol, "retire" ]
    ] as const) {
      mockFetch(200, { ok: true });
      await fn("dengue", "3");
      expect(lastCall().url).toBe(`/protocols/3/${path}`);
      expect(lastCall().body).toEqual({ name: "dengue" });
    }
  });

  it("revertProtocol manda nome e motivo, sem versão na rota", async () => {
    mockFetch(200, { ok: true });
    await revertProtocol("dengue", "regra errada em produção");
    expect(lastCall().url).toBe("/protocols/revert");
    expect(lastCall().body).toEqual({ name: "dengue", reason: "regra errada em produção" });
  });

  // A emenda entre o corpo REAL da API e a frase da tela. A rota devolve
  // `version` como NÚMERO (protocol_result_rendering.rb), e a previsão com que
  // a tela compara é STRING (admin/protocols_query.rb, `version.to_s`) — sem a
  // coerção, a comparação de divergência acusaria diferença onde não há, e a
  // tela diria "estava previsto v1; a cidade está com dengue v1" na hora em que
  // ninguém tem tempo de desconfiar.
  it("revertProtocol devolve a versão efetivada do corpo real, como string", async () => {
    mockFetch(200, { ok: true, protocol: { name: "dengue", version: 1, status: "active" } });
    await expect(revertProtocol("dengue", "x")).resolves.toEqual({ version: "1" });
  });

  it("revertProtocol manda a versão esperada no corpo", async () => {
    mockFetch(200, { ok: true, protocol: { name: "dengue", version: 1, status: "active" } });
    await revertProtocol("dengue", "x", "3");
    expect(lastCall().body).toEqual({ name: "dengue", reason: "x", expected_version: "3" });
  });

  // Sem token, o corpo é o de hoje — é o que sustenta o passo 1 do rollout.
  it("revertProtocol omite a chave quando não há versão esperada", async () => {
    mockFetch(200, { ok: true, protocol: { name: "dengue", version: 1, status: "active" } });
    await revertProtocol("dengue", "x");
    expect(lastCall().body).toEqual({ name: "dengue", reason: "x" });
  });

  it("revertProtocol devolve null quando a resposta não traz protocolo", async () => {
    mockFetch(200, { ok: true });
    await expect(revertProtocol("dengue", "x")).resolves.toBeNull();
  });

  it("o nome e a versão vão codificados na URL", async () => {
    mockFetch(200, { ok: true });
    await submitProtocol("a/b", "1 2");
    expect(lastCall().url).toBe("/protocols/1%202/submit");
  });

  it("recusa da API vira ApiError", async () => {
    mockFetch(422, { error: "invalid_state", message: "só in_review pode ser publicado" });
    await expect(publishProtocolVersion("dengue", "1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("histórico de validações", () => {
  it("listVerifications manda o CPF por POST, nunca na URL", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ verifications: [] }), { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    await listVerifications("529.982.247-25");

    const [ url, init ] = fetchMock.mock.calls[0] as [ string, RequestInit ];
    expect(url).toBe("/attendance/verifications/search");
    expect(String(url)).not.toContain("529");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ cpf: "529.982.247-25" });
  });
});
