// src/lib/oauthReturn.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { errorReturnTo, readReturnParams, safeReturnTo } from "./oauthReturn";

describe("leitor da URL de retorno", () => {
  it("só no caminho certo, sob a base, com barra final tolerada; vazio vira null", () => {
    expect(readReturnParams("x/callback", [ "a", "b" ], "/dashboard/x/callback", "?a=1&b=%20", "/dashboard/")).toEqual({ a: "1", b: null });
    expect(readReturnParams("x/callback", [ "a" ], "/dashboard/x/callback//", "?a=1", "/dashboard/")).toEqual({ a: "1" });
    expect(readReturnParams("x/callback", [ "a" ], "/x/callback", "?a=1", "/dashboard/")).toBeNull();
    expect(readReturnParams("x/callback", [ "a" ], "/dashboard/", "?a=1", "/dashboard/")).toBeNull();
  });
});

describe("destino seguro", () => {
  it("só caminho local de módulo; o resto vira o padrão", () => {
    expect(safeReturnTo("/sncr", "/x")).toBe("/sncr");
    for (const bad of [ "//evil.example", "/\\evil", "\\evil", "https://evil.example", "/", "", null, undefined, 42 ]) {
      expect(safeReturnTo(bad, "/x")).toBe("/x");
    }
  });

  it("return_to da recusa do api (quando o state era do usuário)", () => {
    expect(errorReturnTo(new ApiError(409, { error: "authorization_expired", return_to: "/sncr" }, "409"))).toBe("/sncr");
    expect(errorReturnTo(new ApiError(422, { error: "invalid_state" }, "422"))).toBeNull();
    expect(errorReturnTo(new ApiError(500, "", "500"))).toBeNull();
    expect(errorReturnTo(new Error("x"))).toBeNull();
  });
});
