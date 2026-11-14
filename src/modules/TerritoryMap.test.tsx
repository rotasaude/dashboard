// src/modules/TerritoryMap.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTerritoryContext: vi.fn(), listMapHouseholds: vi.fn(), getHousehold: vi.fn(), updateHousehold: vi.fn() };
});

const handle = vi.hoisted(() => ({
  setPoints: vi.fn(), fitTo: vi.fn(), onPointClick: vi.fn(), startCorrection: vi.fn(), stopCorrection: vi.fn(), destroy: vi.fn()
}));
vi.mock("./territory/map/fieldMap", () => ({ createFieldMap: vi.fn(() => handle) }));

import * as api from "../lib/api";
import { createFieldMap } from "./territory/map/fieldMap";
import { TerritoryMap } from "./TerritoryMap";
import { STALE_TEXT, TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../lib/territoryRegistry";
import { renderWithProviders } from "../test/campaignFixtures";
import { territoryContext, territoryUser } from "../test/territoryFixtures";
import { MAP_MANIFEST, householdWithLocation, mapHousehold, mapHouseholds } from "../test/territoryMapFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const NO_MAP = "o mapa desta cidade ainda não foi gerado — peça à equipe de manutenção";
const NO_POINTS = "nenhum domicílio desta microárea tem ponto marcado — o ponto é marcado no app de campo";
const mount = () => renderWithProviders(<TerritoryMap />);
const lastPoints = () => handle.setPoints.mock.calls[handle.setPoints.mock.calls.length - 1][0] as {
  features: { properties: { id: string; selected: boolean; label: string } }[];
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getTerritoryContext, api.listMapHouseholds, api.getHousehold, api.updateHousehold, createFieldMap,
    ...Object.values(handle) ]) mocked(fn).mockClear();
  mocked(createFieldMap).mockImplementation(() => handle);
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.getTerritoryContext).mockResolvedValue(territoryContext());
  mocked(api.listMapHouseholds).mockReset();
  mocked(api.listMapHouseholds).mockResolvedValue(mapHouseholds());
  mocked(api.getHousehold).mockReset();
  mocked(api.updateHousehold).mockReset();
});

describe("TerritoryMap (24c)", () => {
  it("sem mapa da cidade: aviso; a lista segue; nada do MapLibre", async () => {
    mocked(api.listMapHouseholds).mockResolvedValue({ map: null, items: [ mapHousehold() ] });
    mount();
    expect(await screen.findByText(/o mapa desta cidade ainda não foi gerado/)).not.toBeNull();
    expect(screen.getByText(NO_MAP)).not.toBeNull();
    expect(await screen.findByText("das Flores, 120")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver no mapa das Flores, 120" })).toBeNull();
    expect(createFieldMap).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("sem ponto na microárea: frase do app de campo; o mapa abre mesmo assim", async () => {
    mocked(api.listMapHouseholds).mockResolvedValue({ map: MAP_MANIFEST, items: [] });
    mount();
    expect(await screen.findByText(NO_POINTS)).not.toBeNull();
    await waitFor(() => expect(createFieldMap).toHaveBeenCalledTimes(1));
    expect(handle.fitTo).not.toHaveBeenCalled();
  });

  it("mapa pronto: pontos no adaptador; leitura nominal uma vez, sem releitura sozinha", async () => {
    mount();
    await waitFor(() => expect(handle.setPoints).toHaveBeenCalled());
    expect(api.listMapHouseholds).toHaveBeenCalledTimes(1);
    expect(api.listMapHouseholds).toHaveBeenCalledWith("ma1");
    expect(lastPoints().features.map((f) => f.properties)).toEqual([ { id: "hh1", selected: false, label: "das Flores, 120" } ]);
    expect(handle.fitTo).toHaveBeenCalledWith([ [ -49.27325411, -25.42847123 ], [ -49.27325411, -25.42847123 ] ]);
    act(() => { window.dispatchEvent(new Event("focus")); });
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    expect(api.listMapHouseholds).toHaveBeenCalledTimes(1);
    expect(api.getTerritoryContext).toHaveBeenCalledTimes(1);
  });

  it("o adaptador recebe a URL do arquivo no próprio dashboard e as cores vêm do tema", async () => {
    mount();
    await waitFor(() => expect(createFieldMap).toHaveBeenCalledTimes(1));
    const [ container, opts ] = mocked(createFieldMap).mock.calls[0] as [ HTMLElement, { mapUrl: string; base: string; colors: Record<string, string> } ];
    expect(container.getAttribute("aria-label")).toBe("Mapa da microárea");
    expect(opts.mapUrl).toBe(`${window.location.origin}/territory/map`);
    expect(Object.keys(opts.colors).sort()).toEqual([ "outline", "point", "selected" ]);
  });

  it("lista: endereço curto e famílias; 'Ver no mapa' seleciona o ponto e enquadra nele", async () => {
    mocked(api.listMapHouseholds).mockResolvedValue(mapHouseholds({ items: [
      mapHousehold(),
      mapHousehold({ id: "hh2", address: { street: "Ipê Amarelo", number: null }, families_count: 2,
        location: { latitude: -25.5, longitude: -49.3, source: "map" } })
    ] }));
    mount();
    const list = await screen.findByRole("list", { name: "Domicílios com ponto" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("das Flores, 120"), expect.stringContaining("Ipê Amarelo, S/N")
    ]);
    expect(within(items[0]).getByText("1 família")).not.toBeNull();
    expect(within(items[1]).getByText("2 famílias")).not.toBeNull();
    await waitFor(() => expect(handle.setPoints).toHaveBeenCalled());

    fireEvent.click(within(items[1]).getByRole("button", { name: "Ver no mapa Ipê Amarelo, S/N" }));
    await waitFor(() => expect(lastPoints().features.map((f) => f.properties.selected)).toEqual([ false, true ]));
    expect(handle.fitTo).toHaveBeenLastCalledWith([ [ -49.3, -25.5 ], [ -49.3, -25.5 ] ]);
    expect(within(items[1]).getByText("no mapa")).not.toBeNull();
    expect(within(items[0]).queryByText("no mapa")).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("clicar num ponto do mapa marca o domicílio na lista", async () => {
    mount();
    await waitFor(() => expect(handle.onPointClick).toHaveBeenCalled());
    const cb = handle.onPointClick.mock.calls[handle.onPointClick.mock.calls.length - 1][0] as (id: string) => void;
    act(() => cb("hh1"));
    const item = within(screen.getByRole("list", { name: "Domicílios com ponto" })).getByRole("listitem");
    expect(await within(item).findByText("no mapa")).not.toBeNull();
    await waitFor(() => expect(lastPoints().features[0].properties.selected).toBe(true));
  });

  it("enfermeiro vê a microárea sem can_register, sem 'Corrigir o ponto'", async () => {
    mount();
    const select = await screen.findByLabelText("Microárea");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([ "01 · Vila Verde de cima", "02 · Vila Verde de baixo" ]);
    fireEvent.change(select, { target: { value: "ma2" } });
    await waitFor(() => expect(api.listMapHouseholds).toHaveBeenCalledWith("ma2"));
    expect(await screen.findByText("das Flores, 120")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Corrigir o ponto" })).toBeNull();
  });

  it("trocar de microárea desmonta o mapa anterior", async () => {
    mount();
    await waitFor(() => expect(createFieldMap).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Microárea"), { target: { value: "ma2" } });
    await waitFor(() => expect(handle.destroy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createFieldMap).toHaveBeenCalledTimes(2));
  });

  it("nenhuma requisição ao arquivo de mapa fora do MapLibre (sem sonda, Q14)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    mount();
    await waitFor(() => expect(handle.setPoints).toHaveBeenCalled());
    expect(fetchSpy.mock.calls.map(([ url ]) => String(url)).filter((u) => /\/territory\/map(\?|$)/.test(u))).toEqual([]);
  });

  it("recusa do api vira frase; sem papel ou sem o interruptor, nem lê", async () => {
    mocked(api.listMapHouseholds).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "403"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("esta microárea não é da sua equipe");
    cleanup();

    mocked(api.listMapHouseholds).mockClear();
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ]));
    mount();
    expect(await screen.findByText(TERRITORY_NO_ROLE)).not.toBeNull();
    cleanup();

    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    mount();
    expect(await screen.findByText(TERRITORY_DISABLED)).not.toBeNull();
    expect(api.listMapHouseholds).not.toHaveBeenCalled();
  });

  it("sem microárea nas equipes: estado vazio, sem leitura", async () => {
    mocked(api.getTerritoryContext).mockResolvedValue(territoryContext({ teams: [] }));
    mount();
    expect(await screen.findByText("nenhuma microárea nas suas equipes")).not.toBeNull();
    expect(api.listMapHouseholds).not.toHaveBeenCalled();
  });
});

describe("TerritoryMap: corrigir o ponto (24c)", () => {
  const MOVED = { latitude: -25.42847123, longitude: -49.27325412 };
  function mountReady(items = [ mapHousehold({ version: 4 }) ]) {
    mocked(api.listMapHouseholds).mockResolvedValue({ map: MAP_MANIFEST, items });
    return mount();
  }
  // Abre a correção do primeiro cartão e devolve o `onMove` que o mapa recebeu.
  async function startCorrection() {
    fireEvent.click(await screen.findByRole("button", { name: "Corrigir o ponto" }));
    await waitFor(() => expect(handle.startCorrection).toHaveBeenCalled());
    const [ from, onMove ] = handle.startCorrection.mock.calls[handle.startCorrection.mock.calls.length - 1] as
      [ { latitude: number; longitude: number }, (to: { latitude: number; longitude: number }) => void ];
    return { from, onMove };
  }

  it("corrigir: arredonda a 8 casas e manda source map, sem accuracy_m", async () => {
    mocked(api.getHousehold).mockResolvedValue(householdWithLocation({ version: 4 }));
    mocked(api.updateHousehold).mockResolvedValue(householdWithLocation({ version: 5 }));
    mountReady();
    const { from, onMove } = await startCorrection();
    expect(from).toEqual({ latitude: -25.42847123, longitude: -49.27325411 });
    expect(screen.getByText("Toque no mapa ou arraste o marcador")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Salvar ponto" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => onMove(MOVED));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ponto" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ponto" }));
    await waitFor(() => expect(api.updateHousehold).toHaveBeenCalledTimes(1));
    const [ id, input, version ] = mocked(api.updateHousehold).mock.calls[0];
    expect([ id, version ]).toEqual([ "hh1", 4 ]);
    expect(input.location).toEqual({ latitude: -25.42847123, longitude: -49.27325412, source: "map" });
    expect(input.micro_area_id).toBe("ma1"); // corpo inteiro do 24a
    expect(input.property_type).toBe("1");
    expect((await screen.findByRole("status")).textContent).toBe("ponto salvo");
    await waitFor(() => expect(api.listMapHouseholds).toHaveBeenCalledTimes(2));
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
    expect(handle.stopCorrection).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Salvar ponto" })).toBeNull();
  });

  it("versão mudou desde a leitura dos pontos: não grava e relê uma vez", async () => {
    mocked(api.getHousehold).mockResolvedValue(householdWithLocation({ version: 5 }));
    mountReady();
    const { onMove } = await startCorrection();
    act(() => onMove(MOVED));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ponto" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect(api.updateHousehold).not.toHaveBeenCalled();
    await waitFor(() => expect(api.listMapHouseholds).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Salvar ponto" })).toBeNull();
  });

  it("409 stale_version na gravação: a frase, uma releitura e nenhum reenvio", async () => {
    mocked(api.getHousehold).mockResolvedValue(householdWithLocation({ version: 4 }));
    mocked(api.updateHousehold).mockRejectedValue(new api.ApiError(409, { error: "stale_version" }, "409"));
    mountReady();
    const { onMove } = await startCorrection();
    act(() => onMove(MOVED));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ponto" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    await waitFor(() => expect(api.listMapHouseholds).toHaveBeenCalledTimes(2));
    expect(api.updateHousehold).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("422 invalid_location: frase; o marcador fica para tentar de novo", async () => {
    mocked(api.getHousehold).mockResolvedValue(householdWithLocation({ version: 4 }));
    mocked(api.updateHousehold).mockRejectedValue(new api.ApiError(422, { error: "invalid_location", path: "location.latitude" }, "422"));
    mountReady();
    const { onMove } = await startCorrection();
    act(() => onMove(MOVED));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ponto" }));
    expect((await screen.findByRole("alert")).textContent).toBe("ponto inválido — marque de novo no mapa");
    expect(handle.stopCorrection).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Salvar ponto" }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.listMapHouseholds).toHaveBeenCalledTimes(1);
    // A coordenada nunca aparece na tela.
    expect(document.body.textContent).not.toMatch(/-25\.4|-49\.2/);
  });

  it("Cancelar tira o marcador e não lê nem grava", async () => {
    mountReady();
    const { onMove } = await startCorrection();
    act(() => onMove(MOVED));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(handle.stopCorrection).toHaveBeenCalled());
    expect(api.getHousehold).not.toHaveBeenCalled();
    expect(api.updateHousehold).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Corrigir o ponto" })).not.toBeNull();
  });

  it("um ponto por vez: corrigindo um, o botão dos outros fica desabilitado; o endereço descreve o botão", async () => {
    mountReady([ mapHousehold({ version: 4 }), mapHousehold({ id: "hh2", address: { street: "Ipê Amarelo", number: "7" } }) ]);
    const buttons = await screen.findAllByRole("button", { name: "Corrigir o ponto" });
    expect(buttons).toHaveLength(2);
    expect(document.getElementById(buttons[1].getAttribute("aria-describedby") ?? "")?.textContent).toBe("Ipê Amarelo, 7");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(handle.startCorrection).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Corrigir o ponto" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem can_register na microárea, ou sem mapa: não há 'Corrigir o ponto'", async () => {
    const context = territoryContext();
    context.teams[0].micro_areas = context.teams[0].micro_areas.map((m) => ({ ...m, can_register: false }));
    mocked(api.getTerritoryContext).mockResolvedValue(context);
    mountReady();
    expect(await screen.findByText("das Flores, 120")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Corrigir o ponto" })).toBeNull();
    cleanup();

    mocked(api.getTerritoryContext).mockResolvedValue(territoryContext());
    mocked(api.listMapHouseholds).mockResolvedValue({ map: null, items: [ mapHousehold() ] });
    mount();
    expect(await screen.findByText("das Flores, 120")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Corrigir o ponto" })).toBeNull();
  });
});
