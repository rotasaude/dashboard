// src/modules/VectorBlocks.test.tsx — "Quarteirões e imóveis" da coordenação de endemias (módulo 35a, F-35.1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listPanelNeighborhoods: vi.fn(), listCityBlocks: vi.fn(), createCityBlock: vi.fn(), updateCityBlock: vi.fn(),
    addBlockNeighbor: vi.fn(), removeBlockNeighbor: vi.fn(), listVectorHouseholds: vi.fn(), assignHouseholdsBlock: vi.fn(),
    updateHouseholdProfile: vi.fn(), getVectorDomains: vi.fn(), listVectorMapPoints: vi.fn()
  };
});

const handle = vi.hoisted(() => ({
  setPoints: vi.fn(), fitTo: vi.fn(), onPointClick: vi.fn(), startCorrection: vi.fn(), stopCorrection: vi.fn(), destroy: vi.fn()
}));
vi.mock("./territory/map/fieldMap", () => ({ createFieldMap: vi.fn(() => handle) }));

import * as api from "../lib/api";
import { ApiError, type VectorHousehold } from "../lib/api";
import { blockNumberProblem } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { MAP_MANIFEST } from "../test/territoryMapFixtures";
import { VC_DOMAINS, cityBlock, vcUser, vectorHousehold } from "../test/vectorControlFixtures";
import { VectorBlocks } from "./VectorBlocks";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CB1 = cityBlock();
const CB2 = cityBlock({ id: "cb2", number: "13", neighbor_ids: [ "cb1" ], households_count: 0 });
const CB9 = cityBlock({ id: "cb9", neighborhood: { id: "nb2", name: "Batel" }, number: "1", neighbor_ids: [] });

const mount = () => renderWithProviders(<VectorBlocks />);
async function selectNeighborhood(id: string) {
  const select = await screen.findByLabelText("Bairro");
  await screen.findByRole("option", { name: "Centro" });
  fireEvent.change(select, { target: { value: id } });
}
const pickOption = (label: string, text: string) => {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.textContent === text);
  if (!option) throw new Error(`sem a opção ${text} em ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
};
const pickBlock = (number: string) => pickOption("Quarteirão de destino", number);
const rowOf = (text: string) => {
  const row = screen.getAllByRole("row").find((r) => within(r).queryAllByText(text).length > 0);
  if (!row) throw new Error(`sem a linha ${text}`);
  return within(row);
};
const typeNumber = (v: string) => fireEvent.change(screen.getByLabelText("Número do quarteirão"), { target: { value: v } });
const blocksTable = () => screen.findByRole("table", { name: "Quarteirões do bairro" });
const openHouseholds = async () => fireEvent.click(await screen.findByRole("tab", { name: "Imóveis" }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === "function" && "mockReset" in fn) mocked(fn).mockReset();
  window.history.replaceState(null, "", "/");
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Centro", active: true }, { id: "nb2", name: "Batel", active: true } ]);
  mocked(api.listCityBlocks).mockImplementation(async (nb: string) => (nb === "nb1" ? [ CB1, CB2 ] : nb === "nb2" ? [ CB9 ] : []));
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  mocked(api.listVectorHouseholds).mockResolvedValue({ items: [], next_before: null });
});

describe("VectorBlocks (35a, F-35.1)", () => {
  it("só lê o que está na tela: sem bairro nada; na aba Quarteirões, nem imóveis nem mapa", async () => {
    mount();
    await screen.findByLabelText("Bairro");
    expect(await screen.findByText("Escolha um bairro para ver os quarteirões e os imóveis")).not.toBeNull();
    expect(api.listCityBlocks).not.toHaveBeenCalled();
    await selectNeighborhood("nb1");
    expect(await blocksTable()).not.toBeNull();
    expect(api.listCityBlocks).toHaveBeenCalledWith("nb1");
    expect(api.listVectorHouseholds).not.toHaveBeenCalled();
    expect(api.listVectorMapPoints).not.toHaveBeenCalled();
    // Colunas: número, imóveis ativos, vizinhos por número, ativo.
    const r = rowOf("12");
    expect(r.getByText("14")).not.toBeNull();
    expect(rowOf("12").queryAllByText("13").length).toBe(1);
    expect(window.location.search).toBe("");
  });

  it("novo quarteirão: número validado; block_number_taken no campo", async () => {
    mocked(api.createCityBlock).mockRejectedValue(new ApiError(422, { error: "block_number_taken", path: "number" }, "x"));
    mount(); await selectNeighborhood("nb1");
    await blocksTable();
    typeNumber("12 A");
    fireEvent.click(screen.getByRole("button", { name: "Criar quarteirão" }));
    expect(await screen.findByText(blockNumberProblem("12 A")!.text)).not.toBeNull();
    expect(api.createCityBlock).not.toHaveBeenCalled();
    // O número que já está na lista (sem caixa) nem vai ao api.
    typeNumber("13");
    fireEvent.click(screen.getByRole("button", { name: "Criar quarteirão" }));
    expect(await screen.findByText(VECTOR_ERRORS.block_number_taken)).not.toBeNull();
    expect(api.createCityBlock).not.toHaveBeenCalled();
    typeNumber("12-A");
    const button = screen.getByRole("button", { name: "Criar quarteirão" });
    fireEvent.click(button); fireEvent.click(button);   // clique duplo: uma chamada
    await waitFor(() => expect(api.createCityBlock).toHaveBeenCalledWith({ neighborhood_id: "nb1", number: "12-A" }));
    const field = screen.getByLabelText("Número do quarteirão");
    const describedBy = field.getAttribute("aria-describedby") ?? "";
    await waitFor(() => expect(document.getElementById(describedBy)?.textContent).toBe(VECTOR_ERRORS.block_number_taken));
    expect(api.createCityBlock).toHaveBeenCalledTimes(1);
    expect(api.listCityBlocks).toHaveBeenCalledTimes(1);
  });

  it("novo quarteirão gravado: relê a lista uma vez", async () => {
    mocked(api.createCityBlock).mockResolvedValue(cityBlock({ id: "cb3", number: "14", neighbor_ids: [], households_count: 0 }));
    mount(); await selectNeighborhood("nb1");
    await blocksTable();
    typeNumber("14");
    fireEvent.click(screen.getByRole("button", { name: "Criar quarteirão" }));
    expect(await screen.findByText("quarteirão 14 criado")).not.toBeNull();
    await waitFor(() => expect(api.listCityBlocks).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Número do quarteirão") as HTMLInputElement).value).toBe("");
  });

  it("vizinho: de outro bairro vale; remover pede confirmação; invalid_neighbor tem frase", async () => {
    mocked(api.addBlockNeighbor).mockRejectedValueOnce(new ApiError(422, { error: "invalid_neighbor", path: "neighbor_block_id" }, "x"))
      .mockResolvedValueOnce({ ...CB1, neighbor_ids: [ "cb2", "cb9" ], version: 2 });
    mocked(api.removeBlockNeighbor).mockResolvedValue({ ...CB1, neighbor_ids: [], version: 2 });
    mount(); await selectNeighborhood("nb1");
    await blocksTable();
    fireEvent.click(rowOf("12").getByRole("button", { name: "Vizinhos" }));
    await screen.findByLabelText("Quarteirão vizinho");
    // No próprio bairro: nem ele mesmo nem o vizinho que já tem.
    const own = Array.from((screen.getByLabelText("Quarteirão vizinho") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(own).not.toContain("12");
    expect(own).not.toContain("13");
    // Outro bairro: busca por bairro + número.
    fireEvent.change(screen.getByLabelText("Bairro do vizinho"), { target: { value: "nb2" } });
    await waitFor(() => expect(api.listCityBlocks).toHaveBeenCalledWith("nb2"));
    await waitFor(() => pickOption("Quarteirão vizinho", "1"));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar vizinho" }));
    expect(await screen.findByText(VECTOR_ERRORS.invalid_neighbor)).not.toBeNull();
    expect(api.addBlockNeighbor).toHaveBeenCalledWith("cb1", "cb9");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar vizinho" }));
    expect(await screen.findByText("vizinho adicionado")).not.toBeNull();
    expect(api.addBlockNeighbor).toHaveBeenCalledTimes(2);
    // Remover: dois passos, com a frase do histórico.
    fireEvent.click(screen.getByRole("button", { name: "Remover o vizinho 13" }));
    expect(screen.getByText("remover o vizinho 13? o par fica no histórico")).not.toBeNull();
    expect(api.removeBlockNeighbor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.removeBlockNeighbor).toHaveBeenCalledWith("cb1", "cb2"));
    expect(await screen.findByText("vizinho removido — o par fica no histórico")).not.toBeNull();
  });

  it("desativar com imóvel: 409 block_in_use → frase e uma releitura", async () => {
    mocked(api.updateCityBlock).mockRejectedValue(new ApiError(409, { error: "block_in_use" }, "x"));
    mount(); await selectNeighborhood("nb1");
    await blocksTable();
    fireEvent.click(rowOf("12").getByRole("button", { name: "Desativar" }));
    expect(api.updateCityBlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(VECTOR_ERRORS.block_in_use)).not.toBeNull();
    expect(api.updateCityBlock).toHaveBeenCalledWith("cb1", { active: false });
    await waitFor(() => expect(api.listCityBlocks).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.listCityBlocks).toHaveBeenCalledTimes(2);
    expect(api.updateCityBlock).toHaveBeenCalledTimes(1);
  });

  it("imóveis sem quarteirão: lista nominal lida uma vez; atribuir em lote manda os ids no corpo", async () => {
    mocked(api.assignHouseholdsBlock).mockResolvedValue({ assigned: 2 });
    vi.mocked(api.listVectorHouseholds).mockResolvedValue({ items: [ vectorHousehold({ id: "h1", block: null }), vectorHousehold({ id: "h2", block: null }) ], next_before: null });
    mount(); await selectNeighborhood("nb1"); fireEvent.click(await screen.findByRole("tab", { name: "Imóveis" }));
    fireEvent.click(await screen.findByLabelText("Selecionar a página"));
    pickBlock("12"); fireEvent.click(screen.getByRole("button", { name: "Atribuir ao quarteirão" }));
    await waitFor(() => expect(api.assignHouseholdsBlock).toHaveBeenCalledWith([ "h1", "h2" ], "cb1"));
    expect(await screen.findByText("2 imóveis atribuídos ao quarteirão 12")).not.toBeNull();
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(api.listVectorHouseholds).toHaveBeenCalledTimes(2); // a de abrir e a releitura depois da ação
    expect(api.listVectorHouseholds).toHaveBeenNthCalledWith(1, { neighborhoodId: "nb1", withoutBlock: true, before: null });
    expect(api.assignHouseholdsBlock).toHaveBeenCalledTimes(1);
  });

  it("lote com um imóvel sem bairro: a recusa marca aquele imóvel e a seleção fica", async () => {
    mocked(api.assignHouseholdsBlock).mockRejectedValue(new ApiError(422, { error: "household_without_neighborhood", path: "household_ids[1]" }, "x"));
    mocked(api.listVectorHouseholds).mockResolvedValue({ items: [
      vectorHousehold({ id: "h1", block: null }), vectorHousehold({ id: "h2", address_short: "Rua Sete, 45", block: null })
    ], next_before: null });
    mount(); await selectNeighborhood("nb1"); await openHouseholds();
    fireEvent.click(await screen.findByLabelText("Selecionar a página"));
    pickBlock("12");
    const button = screen.getByRole("button", { name: "Atribuir ao quarteirão" });
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText(VECTOR_ERRORS.household_without_neighborhood)).not.toBeNull();
    expect(rowOf("Rua Sete, 45").getByText(VECTOR_ERRORS.household_without_neighborhood)).not.toBeNull();
    expect(rowOf("Rua das Flores, 120").queryByText(VECTOR_ERRORS.household_without_neighborhood)).toBeNull();
    expect((screen.getByLabelText("Selecionar Rua das Flores, 120") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Selecionar Rua Sete, 45") as HTMLInputElement).checked).toBe(true);
    expect(api.assignHouseholdsBlock).toHaveBeenCalledTimes(1);
    expect(api.listVectorHouseholds).toHaveBeenCalledTimes(1);
  });

  it("quarteirão de outro bairro aparece marcado", async () => {
    mocked(api.listVectorHouseholds).mockResolvedValue({ items: [
      vectorHousehold({ neighborhood_id: "nb2", block: { id: "cb1", number: "12", neighborhood_id: "nb1" } }),
      vectorHousehold({ id: "h2", address_short: "Rua Sete, 45" })
    ], next_before: null });
    mount(); await selectNeighborhood("nb1"); await openHouseholds();
    await waitFor(() => expect(api.listVectorHouseholds).toHaveBeenCalledTimes(1));
    await waitFor(() => pickOption("Mostrar", "Quarteirão 12"));
    await waitFor(() => expect(api.listVectorHouseholds).toHaveBeenLastCalledWith({ cityBlockId: "cb1", before: null }));
    expect(await screen.findAllByText("quarteirão de outro bairro")).toHaveLength(1);
    expect(rowOf("Rua das Flores, 120").getByText("quarteirão de outro bairro")).not.toBeNull();
    expect(rowOf("Rua Sete, 45").queryByText("quarteirão de outro bairro")).toBeNull();
    expect(api.listVectorHouseholds).toHaveBeenCalledTimes(2);
  });

  it("editar perfil: só o que mudou; recusa no campo; sem reler a lista nominal", async () => {
    mocked(api.listVectorHouseholds).mockResolvedValue({ items: [ vectorHousehold() ], next_before: null });
    mocked(api.updateHouseholdProfile)
      .mockRejectedValueOnce(new ApiError(422, { error: "block_not_in_household_neighborhood", path: "city_block_id" }, "x"))
      .mockResolvedValueOnce(vectorHousehold({ risk_class: "red", block: { id: "cb2", number: "13", neighborhood_id: "nb1" } }));
    mount(); await selectNeighborhood("nb1"); await openHouseholds();
    fireEvent.click(await screen.findByRole("button", { name: "Editar perfil" }));
    pickOption("Quarteirão do imóvel", "13");
    pickOption("Risco", "Vermelho (alto)");
    const save = screen.getByRole("button", { name: "Salvar perfil" });
    fireEvent.click(save); fireEvent.click(save);
    expect(await screen.findByText(VECTOR_ERRORS.block_not_in_household_neighborhood)).not.toBeNull();
    expect(api.updateHouseholdProfile).toHaveBeenCalledTimes(1);
    expect(api.updateHouseholdProfile).toHaveBeenCalledWith("h1", { city_block_id: "cb2", risk_class: "red" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(await screen.findByText("perfil do imóvel salvo")).not.toBeNull();
    expect(rowOf("Rua das Flores, 120").getByText("Vermelho (alto)")).not.toBeNull();
    expect(api.listVectorHouseholds).toHaveBeenCalledTimes(1);
  });

  it("Mapa: imóveis por risco do bairro, lido só na aba", async () => {
    mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: [] });
    mount(); await selectNeighborhood("nb1");
    await blocksTable();
    fireEvent.click(screen.getByRole("tab", { name: "Mapa" }));
    expect(await screen.findByText("Imóveis por risco")).not.toBeNull();
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledWith({ layer: "risk", neighborhoodId: "nb1" }));
    expect(api.listVectorHouseholds).not.toHaveBeenCalled();
  });

  it("nenhum morador na lista", async () => {
    // Mesmo que o api mandasse a mais, a tela só mostra os campos do imóvel.
    const leaky = { ...vectorHousehold(), residents: [ { display_name: "Maria Lima" } ], responsible: { display_name: "José Lima" } } as VectorHousehold;
    mocked(api.listVectorHouseholds).mockResolvedValue({ items: [ leaky ], next_before: null });
    const { container } = mount(); await selectNeighborhood("nb1"); await openHouseholds();
    await screen.findByText("Rua das Flores, 120");
    for (const name of [ "Maria Lima", "José Lima", "Ana Prado", "Joana ACS" ]) expect(container.textContent).not.toContain(name);
    expect(container.textContent).not.toMatch(/undefined|null/);
    expect(window.location.search).toBe("");
    expect(window.localStorage.length).toBe(0);
  });
});
