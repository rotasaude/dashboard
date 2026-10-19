// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { cityLabel, fetchCityIdentity, shiftGreeting, useCityIdentity } from "./cityIdentity";

const IDENTITY = { name: "Curitiba", uf: "PR", time_zone: "America/Sao_Paulo", health_department_name: null, coat_of_arms_url: null };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shiftGreeting", () => {
  it.each([
    ["2026-10-19T07:59:00Z", "Boa noite."], ["2026-10-19T08:00:00Z", "Bom dia."],
    ["2026-10-19T14:59:00Z", "Bom dia."], ["2026-10-19T15:00:00Z", "Boa tarde."],
    ["2026-10-19T20:59:00Z", "Boa tarde."], ["2026-10-19T21:00:00Z", "Boa noite."],
  ])("shiftGreeting(%s, America/Sao_Paulo) = %s", (iso, g) => {
    expect(shiftGreeting(new Date(iso), "America/Sao_Paulo")).toBe(g);
  });
  it("respeita outro fuso", () => {
    expect(shiftGreeting(new Date("2026-10-19T09:30:00Z"), "America/Manaus")).toBe("Bom dia.");
  });
});

describe("cityLabel", () => {
  it("com e sem UF", () => {
    expect(cityLabel({ name: "Curitiba", uf: "PR" })).toBe("Curitiba · PR");
    expect(cityLabel({ name: "Curitiba", uf: null })).toBe("Curitiba");
  });
});

describe("fetchCityIdentity", () => {
  it("chama /city_identity sem credenciais e devolve o JSON", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => IDENTITY });
    vi.stubGlobal("fetch", f);
    await expect(fetchCityIdentity()).resolves.toEqual(IDENTITY);
    expect(f).toHaveBeenCalledWith("/city_identity", expect.objectContaining({ credentials: "omit" }));
  });
  it("lança em resposta não ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(fetchCityIdentity()).rejects.toThrow();
  });
});

describe("useCityIdentity", () => {
  it("devolve a identidade quando o fetch dá certo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => IDENTITY }));
    const { result } = renderHook(() => useCityIdentity());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(IDENTITY));
  });
  it("fica null com fetch rejeitado e não loga erro", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn().mockRejectedValue(new Error("rede"));
    vi.stubGlobal("fetch", f);
    const { result } = renderHook(() => useCityIdentity());
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });
  it("aborta ao desmontar (o signal termina aborted)", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise(() => {}); }));
    const { unmount } = renderHook(() => useCityIdentity());
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
