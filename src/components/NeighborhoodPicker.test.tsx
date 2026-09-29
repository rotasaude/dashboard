import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, listPanelNeighborhoods: vi.fn() };
});

import * as api from "../lib/api";
import { SUPPRESSED_HINT } from "../lib/smallCount";
import { NeighborhoodPicker } from "./NeighborhoodPicker";

const CENTRO = "11111111-1111-4111-8111-111111111111";
const BATEL = "22222222-2222-4222-8222-222222222222";
const AGUA = "33333333-3333-4333-8333-333333333333";
const SUMIU = "99999999-9999-4999-8999-999999999999";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><NeighborhoodPicker /></QueryClientProvider>);
}
const picker = () => screen.getByLabelText("Bairro") as HTMLSelectElement;
const ready = () => waitFor(() => expect(picker().disabled).toBe(false));

beforeEach(() => {
  mocked(api.listPanelNeighborhoods).mockReset().mockResolvedValue([
    { id: CENTRO, name: "Centro", active: true },
    { id: BATEL, name: "Batel", active: false },
    { id: AGUA, name: "Água Verde", active: true }
  ]);
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("NeighborhoodPicker", () => {
  it("Todos, Sem bairro e os bairros por nome, com os inativos marcados", async () => {
    renderIt();
    await ready();
    expect(Array.from(picker().options).map((o) => o.textContent)).toEqual([
      "Todos", "Sem bairro", "Água Verde", "Batel (inativo)", "Centro"
    ]);
  });

  it("escolher grava ?bairro= e mostra a regra do '< 5'; Todos apaga", async () => {
    renderIt();
    await ready();
    fireEvent.change(picker(), { target: { value: CENTRO } });
    expect(new URLSearchParams(window.location.search).get("bairro")).toBe(CENTRO);
    expect(screen.getByText(SUPPRESSED_HINT)).toBeTruthy();
    fireEvent.change(picker(), { target: { value: "" } });
    expect(window.location.search).toBe("");
    expect(screen.queryByText(SUPPRESSED_HINT)).toBeNull();
  });

  it("?bairro=none vem selecionado como Sem bairro", async () => {
    window.history.replaceState(null, "", "/dashboard/?bairro=none");
    renderIt();
    await ready();
    expect(picker().value).toBe("none");
  });

  it("bairro desconhecido na URL volta para Todos", async () => {
    window.history.replaceState(null, "", `/dashboard/?bairro=${SUMIU}`);
    renderIt();
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(picker().value).toBe("");
  });

  it("lista que não carrega: o seletor continua com Todos e Sem bairro, e a URL não é apagada", async () => {
    mocked(api.listPanelNeighborhoods).mockRejectedValue(new api.ApiError(500, "", "x"));
    window.history.replaceState(null, "", `/dashboard/?bairro=${CENTRO}`);
    renderIt();
    expect(await screen.findByText("não foi possível carregar os bairros")).toBeTruthy();
    expect(Array.from(picker().options).map((o) => o.textContent)).toEqual([ "Todos", "Sem bairro", "bairro selecionado" ]);
    expect(picker().value).toBe(CENTRO);
    expect(new URLSearchParams(window.location.search).get("bairro")).toBe(CENTRO);
    fireEvent.change(picker(), { target: { value: "" } });
    expect(window.location.search).toBe("");
  });
});
