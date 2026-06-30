import { describe, it, expect, vi, afterEach } from "vitest";
import { listAuthorProtocols, loadProtocolDefinition } from "./api";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    body === undefined ? "" : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json" } }
  )));
}

describe("listAuthorProtocols", () => {
  it("flattens the admin envelope to {name, version, status} rows", async () => {
    mockFetch(200, { data: { list: [
      { name: "respiratoria", version: "2", status: "draft" },
      { name: "dengue", version: "1", status: "published" }
    ] }, as_of: "2026-06-27T00:00:00Z" });
    const rows = await listAuthorProtocols();
    expect(rows).toEqual([
      { name: "respiratoria", version: "2", status: "draft" },
      { name: "dengue", version: "1", status: "published" }
    ]);
  });
});

describe("loadProtocolDefinition", () => {
  it("returns the definition body on 200", async () => {
    mockFetch(200, { definition: { name: "respiratoria", version: 1 } });
    expect(await loadProtocolDefinition("respiratoria", "1")).toEqual({ name: "respiratoria", version: 1 });
  });
  it("returns null on 404", async () => {
    mockFetch(404, undefined);
    expect(await loadProtocolDefinition("nope", "9")).toBeNull();
  });
});
