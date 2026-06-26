import { describe, it, expect, vi, afterEach } from "vitest";
import { adminFetch, ApiError } from "./api";

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
