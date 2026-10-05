import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCitizen } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("validação presencial com perfil", () => {
  it("manda data de nascimento, sexo e identidade conferidos junto do documento", async () => {
    const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ verification: { id: "v1" } }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fn);
    await verifyCitizen("529.982.247-25", "123456", { birth_date: "1963-04-02", sex: "female", gender_identity: null });
    const [ url, init ] = fn.mock.calls[0] as [ string, RequestInit ];
    expect(url).toBe("/attendance/verifications");
    expect(JSON.parse(init.body as string)).toEqual({
      cpf: "529.982.247-25", code: "123456", document_checked: true,
      birth_date: "1963-04-02", sex: "female", gender_identity: null
    });
  });
});
