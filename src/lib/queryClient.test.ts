import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createAppQueryClient } from "./queryClient";

// F-05.1/F-05.2 — fronteira de sessão do app: um 401 em qualquer painel manda
// o AuthProvider reler a sessão (e a tela volta ao Login), sem repetir a
// chamada; 404 também não repete; outros erros tentam uma vez mais.
describe("createAppQueryClient", () => {
  it("avisa a sessão num 401 e não repete a chamada", async () => {
    const onUnauthorized = vi.fn();
    const client = createAppQueryClient(onUnauthorized);
    const fn = vi.fn(async () => { throw new ApiError(401, null, "unauthorized"); });

    await expect(client.fetchQuery({ queryKey: [ "x" ], queryFn: fn })).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("não repete um 404 e não trata como sessão expirada", async () => {
    const onUnauthorized = vi.fn();
    const client = createAppQueryClient(onUnauthorized);
    const fn = vi.fn(async () => { throw new ApiError(404, null, "not_found"); });

    await expect(client.fetchQuery({ queryKey: [ "y" ], queryFn: fn })).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("tenta de novo uma vez um erro de servidor", async () => {
    const client = createAppQueryClient(vi.fn());
    const fn = vi.fn(async () => { throw new ApiError(500, null, "boom"); });

    await expect(
      client.fetchQuery({ queryKey: [ "z" ], queryFn: fn, retryDelay: 0 })
    ).rejects.toBeInstanceOf(ApiError);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
