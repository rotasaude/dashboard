import { describe, it, expect, vi, afterEach } from "vitest";
import { adminFetch, ApiError } from "./api";
import { login, fetchCurrentSession } from "./api";
import { requestPasswordReset, resetPassword } from "./api";
import { enrollMfa, confirmMfa, stepUpMfa } from "./api";
import { listMemberships, grantRole, revokeMembership } from "./api";

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
