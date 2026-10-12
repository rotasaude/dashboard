import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { parseHash, slugOf, toHash, useHashRoute, type Route } from "./router";

const IDS = new Set([ "overview", "team", "my-agenda" ]);
const SLUGS = new Set([ "visao-geral", "atendimento", "e-sus" ]);

function setHash(hash: string) {
  window.history.replaceState(null, "", `/dashboard/${hash}`);
}

beforeEach(() => setHash(""));
afterEach(() => vi.restoreAllMocks());

describe("slugOf", () => {
  it("tira acento, põe minúsculas e troca espaço por hífen", () => {
    expect(slugOf("Visão geral")).toBe("visao-geral");
    expect(slugOf("e-SUS")).toBe("e-sus");
    expect(slugOf("Comunicação")).toBe("comunicacao");
  });
});

describe("parseHash e toHash", () => {
  const cases: [string, Route][] = [
    [ "#/", { kind: "home" } ],
    [ "#/acessibilidade", { kind: "a11y" } ],
    [ "#/grupo/atendimento", { kind: "group", slug: "atendimento" } ],
    [ "#/my-agenda", { kind: "screen", id: "my-agenda" } ]
  ];
  it.each(cases)("%s ida e volta", (hash, route) => {
    expect(parseHash(hash, IDS, SLUGS)).toEqual(route);
    expect(toHash(route)).toBe(hash);
  });

  it("vazio é o Início", () => {
    expect(parseHash("", IDS, SLUGS)).toEqual({ kind: "home" });
  });

  it("slug ou id desconhecido, ou lixo, dá null", () => {
    expect(parseHash("#/grupo/nada", IDS, SLUGS)).toBeNull();
    expect(parseHash("#/nada", IDS, SLUGS)).toBeNull();
    expect(parseHash("#conteudo", IDS, SLUGS)).toBeNull();
  });
});

describe("useHashRoute", () => {
  const allowAll = () => true;

  it("go empilha no histórico e muda o hash", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed: allowAll }));
    act(() => result.current.go({ kind: "screen", id: "team" }));
    expect(window.location.hash).toBe("#/team");
    expect(result.current.route).toEqual({ kind: "screen", id: "team" });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("Voltar (popstate) relê o hash", () => {
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed: allowAll }));
    act(() => { setHash("#/grupo/atendimento"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(result.current.route).toEqual({ kind: "group", slug: "atendimento" });
  });

  it("rota não permitida vira Início com replaceState, sem histórico novo", () => {
    setHash("#/team");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const isAllowed = (r: Route) => !(r.kind === "screen" && r.id === "team");
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed }));
    expect(result.current.route).toEqual({ kind: "home" });
    expect(window.location.hash).toBe("#/");
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("hash inválido vira Início", () => {
    setHash("#/xyz");
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed: allowAll }));
    expect(result.current.route).toEqual({ kind: "home" });
  });

  it("rota inicial (retorno de assinatura) entra sem empilhar", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() =>
      useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed: allowAll, initial: { kind: "screen", id: "my-agenda" } }));
    expect(result.current.route).toEqual({ kind: "screen", id: "my-agenda" });
    expect(window.location.hash).toBe("#/my-agenda");
    expect(push).not.toHaveBeenCalled();
  });

  it("atalho interno não é filtrado", () => {
    const isAllowed = (r: Route) => r.kind !== "screen";
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed }));
    act(() => result.current.go({ kind: "screen", id: "team" }));
    expect(result.current.route).toEqual({ kind: "screen", id: "team" });
  });

  it("preserva a query (?bairro=) ao navegar", () => {
    window.history.replaceState(null, "", "/dashboard/?bairro=none#/");
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed: allowAll }));
    act(() => result.current.go({ kind: "screen", id: "overview" }));
    expect(window.location.search).toBe("?bairro=none");
  });
});

describe("go para o lugar atual (A-07)", () => {
  it("não empilha histórico", () => {
    setHash("#/team");
    const { result } = renderHook(() => useHashRoute({ ids: IDS, slugs: SLUGS, isAllowed: () => true }));
    const push = vi.spyOn(window.history, "pushState");
    act(() => result.current.go({ kind: "screen", id: "team" }));
    expect(push).not.toHaveBeenCalled();
    act(() => result.current.go({ kind: "home" }));
    expect(push).toHaveBeenCalledTimes(1);
  });
});
