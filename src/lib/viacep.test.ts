import { afterEach, describe, expect, it, vi } from "vitest";
import { VIACEP_TIMEOUT_MS, lookupCep } from "./viacep";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const respond = (body: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe("lookupCep", () => {
  it("consulta o ViaCEP direto do navegador, sem cookie, e devolve logradouro e bairro", async () => {
    const fetchMock = respond({ cep: "80010-000", logradouro: "Rua XV de Novembro", bairro: "Centro", localidade: "Curitiba", uf: "PR" });
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupCep("80010-000")).resolves.toEqual({ ok: true, street: "Rua XV de Novembro", neighborhood: "Centro" });
    const [ url, init ] = fetchMock.mock.calls[0] as [ string, RequestInit ];
    expect(url).toBe("https://viacep.com.br/ws/80010000/json/");
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([ [ { erro: true } ], [ { erro: "true" } ] ])("CEP inexistente (%o) é falha", async (body) => {
    vi.stubGlobal("fetch", respond(body));
    await expect(lookupCep("99999999")).resolves.toEqual({ ok: false });
  });

  it("HTTP fora de 2xx é falha", async () => {
    vi.stubGlobal("fetch", respond({}, 400));
    await expect(lookupCep("80010000")).resolves.toEqual({ ok: false });
  });

  it("erro de rede é falha, sem rejeitar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(lookupCep("80010000")).resolves.toEqual({ ok: false });
  });

  it("corpo que não é JSON é falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(lookupCep("80010000")).resolves.toEqual({ ok: false });
  });

  it("CEP sem 8 dígitos nem chama a rede", async () => {
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupCep("8001")).resolves.toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("desiste em 5 s: aborta e devolve falha", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    let settled = false;
    const result = lookupCep("80010000").then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(VIACEP_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: false });
    expect(VIACEP_TIMEOUT_MS).toBe(5000);
  });
});
