// src/modules/vectorControl/VectorMapPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listVectorMapPoints: vi.fn(), getVectorDomains: vi.fn() };
});

const handle = vi.hoisted(() => ({
  setPoints: vi.fn(), fitTo: vi.fn(), onPointClick: vi.fn(), startCorrection: vi.fn(), stopCorrection: vi.fn(), destroy: vi.fn()
}));
vi.mock("../territory/map/fieldMap", () => ({ createFieldMap: vi.fn(() => handle) }));

import * as api from "../../lib/api";
import type { VectorMapPoint, VectorMapQuery } from "../../lib/api";
import { createFieldMap } from "../territory/map/fieldMap";
import { CATEGORY_COLORS, NO_VECTOR_POINTS, VectorMapPanel } from "./VectorMapPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { MAP_MANIFEST } from "../../test/territoryMapFixtures";
import { VC_DOMAINS, vcUser } from "../../test/vectorControlFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const point = (o: Partial<VectorMapPoint> = {}): VectorMapPoint =>
  ({ id: "h1", latitude: -25.42851, longitude: -49.2733, category: "red", label: "12", ...o });
// 2 red, 1 green
const mapPoints = (): VectorMapPoint[] => [
  point(), point({ id: "h2", latitude: -25.43, longitude: -49.28 }), point({ id: "h3", latitude: -25.41, longitude: -49.26, category: "green", label: "13" })
];
const mount = (query: VectorMapQuery, title = "Mapa de risco") => renderWithProviders(<VectorMapPanel query={query} title={title} />);
const lastPoints = () => handle.setPoints.mock.calls[handle.setPoints.mock.calls.length - 1][0] as {
  features: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[];
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listVectorMapPoints, api.getVectorDomains, createFieldMap, ...Object.values(handle) ]) mocked(fn).mockReset();
  mocked(createFieldMap).mockImplementation(() => handle);
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
});

describe("VectorMapPanel (35a)", () => {
  it("sem mapa da cidade: aviso, nada do MapLibre", async () => {
    vi.mocked(api.listVectorMapPoints).mockResolvedValue({ map: null, points: [] });
    mount({ layer: "risk", neighborhoodId: "nb1" });
    expect(await screen.findByText(/o mapa desta cidade ainda não foi gerado/)).not.toBeNull();
    expect(screen.queryByText(NO_VECTOR_POINTS)).toBeNull();
    expect(createFieldMap).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("mapa sem pontos: a frase do app de campo, sem MapLibre", async () => {
    vi.mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: [] });
    mount({ layer: "risk", neighborhoodId: "nb1" });
    expect(await screen.findByText("nenhum imóvel desta seleção tem ponto marcado — o ponto é marcado no app de campo")).not.toBeNull();
    expect(createFieldMap).not.toHaveBeenCalled();
  });

  it("pontos por categoria, sem cluster, com a legenda contada", async () => {
    vi.mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: mapPoints() }); // 2 red, 1 green
    mount({ layer: "risk", neighborhoodId: "nb1" });
    await waitFor(() => expect(handle.setPoints).toHaveBeenCalled());
    expect(vi.mocked(createFieldMap).mock.calls[0][1]).toMatchObject({ cluster: false, colors: { categories: expect.objectContaining({ red: expect.any(String) }) } });
    expect(Object.keys(vi.mocked(createFieldMap).mock.calls[0][1].colors.categories!).sort()).toEqual([ "gray", "green", "none", "purple", "red", "yellow" ]);
    expect(await screen.findByText("Vermelho (alto): 2")).not.toBeNull();
    expect(screen.getByText("Verde (baixo): 1")).not.toBeNull();
    expect(api.listVectorMapPoints).toHaveBeenCalledWith({ layer: "risk", neighborhoodId: "nb1" });
    expect(lastPoints().features.map((f) => f.properties)).toEqual([
      { id: "h1", selected: false, label: "12", category: "red" },
      { id: "h2", selected: false, label: "12", category: "red" },
      { id: "h3", selected: false, label: "13", category: "green" }
    ]);
    expect(handle.fitTo).toHaveBeenCalledWith([ [ -49.28, -25.43 ], [ -49.26, -25.41 ] ]);
    expect(screen.getByRole("application", { name: "Mapa de risco" })).not.toBeNull();
  });

  it("o rótulo do ponto só aparece depois do clique; destroy ao sair", async () => {
    vi.mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: mapPoints() });
    const view = mount({ layer: "risk", neighborhoodId: "nb1" });
    await waitFor(() => expect(handle.onPointClick).toHaveBeenCalled());
    await screen.findByText("Vermelho (alto): 2");
    expect(screen.queryByText(/quarteirão 13/)).toBeNull();
    act(() => { (handle.onPointClick.mock.calls[0][0] as (id: string) => void)("h3"); });
    expect(screen.getByText("quarteirão 13 · Verde (baixo)")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar o ponto" }));
    expect(screen.queryByText(/quarteirão 13/)).toBeNull();
    view.unmount();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
  });

  it("ovitrampas: legenda pelas frases do 35a; categoria desconhecida aparece crua", async () => {
    vi.mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: [
      point({ id: "o1", category: "alert", label: "A-01 · 120" }), point({ id: "o2", category: "negative", label: "A-02 · 0" }),
      point({ id: "o3", category: "not_counted", label: "A-03 · —" }), point({ id: "o4", category: "positive", label: "A-04 · 5" }),
      point({ id: "o5", category: "brand_new", label: "A-05 · 1" })
    ] });
    mount({ layer: "ovitraps", neighborhoodId: "nb1", epiWeek: "2026-46" }, "Ovitrampas da semana");
    expect(await screen.findByText("acima do alerta: 1")).not.toBeNull();
    for (const t of [ "negativa: 1", "positiva: 1", "não contada: 1", "brand_new: 1" ]) expect(screen.getByText(t)).not.toBeNull();
    expect(api.getVectorDomains).not.toHaveBeenCalled();
    expect(Object.keys(vi.mocked(createFieldMap).mock.calls[0][1].colors.categories!).sort()).toEqual([ "alert", "negative", "not_counted", "positive" ]);
  });

  it("camada do bloqueio: só o id do bloqueio na consulta; uma leitura, sem releitura no foco (trilha)", async () => {
    vi.mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: [ point({ category: "area", label: "area" }) ] });
    mount({ layer: "transmission", transmissionBlockId: "tb1" }, "Área do bloqueio");
    expect(await screen.findByText("área do bloqueio: 1")).not.toBeNull();
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1);
    expect(api.listVectorMapPoints).toHaveBeenCalledWith({ layer: "transmission", transmissionBlockId: "tb1" });
    act(() => { window.dispatchEvent(new Event("focus")); });
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1);
    expect(api.getVectorDomains).not.toHaveBeenCalled();
    // Q28: o ponto do bloqueio não diz quarteirão nem caso; o clique mostra só a área.
    act(() => { (handle.onPointClick.mock.calls[0][0] as (id: string) => void)("h1"); });
    expect(screen.getByText("área do bloqueio", { selector: "strong" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/caso|quarteirão/);
  });

  it("erro do api: a frase, sem MapLibre", async () => {
    vi.mocked(api.listVectorMapPoints).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    mount({ layer: "risk", neighborhoodId: "nb1" });
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(createFieldMap).not.toHaveBeenCalled();
  });

  it("CATEGORY_COLORS cobre as categorias do api e nada mais (Q13(7))", () => {
    expect(Object.keys(CATEGORY_COLORS.risk).sort()).toEqual([ "gray", "green", "none", "purple", "red", "yellow" ]);
    expect(Object.keys(CATEGORY_COLORS.ovitraps).sort()).toEqual([ "alert", "negative", "not_counted", "positive" ]);
    expect(Object.keys(CATEGORY_COLORS.transmission)).toEqual([ "area" ]);
  });
});
