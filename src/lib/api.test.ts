import { describe, it, expect, vi, afterEach } from "vitest";
import { adminFetch, ApiError } from "./api";
import { login, fetchCurrentSession } from "./api";
import { requestPasswordReset, resetPassword } from "./api";

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
