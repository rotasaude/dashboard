import { describe, it, expect, vi, afterEach } from "vitest";
import { gateProtocol, previewProtocol, saveProtocolDraft } from "./api";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    body === undefined ? "" : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json" } }
  )));
}

describe("gateProtocol", () => {
  it("valid:true on 200", async () => {
    mockFetch(200, { valid: true });
    expect(await gateProtocol({})).toEqual({ valid: true });
  });
  it("valid:false + errors on 422", async () => {
    mockFetch(422, { valid: false, errors: ["schema: /x"] });
    expect(await gateProtocol({})).toEqual({ valid: false, errors: ["schema: /x"] });
  });
});

describe("previewProtocol", () => {
  it("returns outcome on 200", async () => {
    mockFetch(200, { outcome: { status: "terminal", tier: "alta" } });
    const r = await previewProtocol({}, { tosse: "true" });
    expect(r.outcome?.tier).toBe("alta");
  });
  it("returns errors on 422", async () => {
    mockFetch(422, { valid: false, errors: ["schema: /y"] });
    const r = await previewProtocol({}, {});
    expect(r.errors).toEqual(["schema: /y"]);
  });
});

describe("saveProtocolDraft", () => {
  it("returns the saved descriptor on 200", async () => {
    mockFetch(200, { id: "abc", name: "respiratoria", version: 1, status: "draft" });
    expect((await saveProtocolDraft({})).status).toBe("draft");
  });
  it("maps 422 version_not_editable", async () => {
    mockFetch(422, { error: "version_not_editable", message: "versão 1 está published" });
    expect((await saveProtocolDraft({})).error).toBe("version_not_editable");
  });
  it("maps 403 forbidden", async () => {
    mockFetch(403, undefined);
    expect((await saveProtocolDraft({})).error).toBe("forbidden");
  });
});
