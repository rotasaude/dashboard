import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { listPanelNeighborhoods } from "./api";
import {
  NONE, neighborhoodParams, readNeighborhoodParam, useNeighborhoodParam, writeNeighborhoodParam
} from "./neighborhoodFilter";

const CENTRO = "11111111-1111-4111-8111-111111111111";

afterEach(() => { window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });

describe("readNeighborhoodParam", () => {
  it("aceita uuid e none", () => {
    expect(readNeighborhoodParam(`?bairro=${CENTRO}`)).toBe(CENTRO);
    expect(readNeighborhoodParam("?bairro=none")).toBe(NONE);
  });
  it("lixo ou ausente vira Todos (null), nunca um 422", () => {
    expect(readNeighborhoodParam("?bairro=centro")).toBeNull();
    expect(readNeighborhoodParam("?bairro=")).toBeNull();
    expect(readNeighborhoodParam("")).toBeNull();
  });
});

describe("writeNeighborhoodParam", () => {
  it("grava e apaga só o bairro, sem mexer no resto da URL", () => {
    window.history.replaceState(null, "", "/dashboard/?x=1");
    writeNeighborhoodParam(CENTRO);
    expect(window.location.pathname).toBe("/dashboard/");
    expect(new URLSearchParams(window.location.search).get("x")).toBe("1");
    expect(new URLSearchParams(window.location.search).get("bairro")).toBe(CENTRO);
    writeNeighborhoodParam(null);
    expect(window.location.search).toBe("?x=1");
  });

  it("avisa quem lê pelo hook", () => {
    const { result } = renderHook(() => useNeighborhoodParam());
    expect(result.current).toBeNull();
    act(() => writeNeighborhoodParam(NONE));
    expect(result.current).toBe(NONE);
  });
});

describe("neighborhoodParams", () => {
  it("Todos não manda o parâmetro", () => {
    expect(neighborhoodParams(null)).toEqual({ neighborhood_id: undefined });
    expect(neighborhoodParams(NONE)).toEqual({ neighborhood_id: "none" });
  });
});

describe("listPanelNeighborhoods", () => {
  const stub = (body: unknown) => {
    const fn = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  it("lê GET /admin/api/neighborhoods no formato combinado", async () => {
    const fn = stub({ neighborhoods: [ { id: CENTRO, name: "Centro", active: true } ] });
    expect(await listPanelNeighborhoods()).toEqual([ { id: CENTRO, name: "Centro", active: true } ]);
    expect(new URL(String(fn.mock.calls[0][0])).pathname).toBe("/admin/api/neighborhoods");
  });

  it("tolera o envelope { data, as_of } dos outros painéis e resposta sem a chave", async () => {
    stub({ data: { neighborhoods: [ { id: CENTRO, name: "Centro", active: true } ] }, as_of: "x" });
    expect(await listPanelNeighborhoods()).toHaveLength(1);
    stub({ data: { live: 0 } });
    expect(await listPanelNeighborhoods()).toEqual([]);
  });
});
