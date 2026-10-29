// src/modules/territory/HouseholdForm.test.tsx
// Fichas de domicílio e de família (Task 11), nas formas do api REAL
// (preflight A14, C7, C8, C19): tipo de imóvel e renda em texto, logradouro
// com o tipo DNE à parte, família com `responsible: { patient_id }` e a
// versão do DOMICÍLIO.
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), createHousehold: vi.fn(), updateHousehold: vi.fn(), addFamily: vi.fn(), updateFamily: vi.fn(),
    listPanelNeighborhoods: vi.fn() };
});

import * as api from "../../lib/api";
import { HouseholdForm } from "./HouseholdForm";
import { FamilyForm } from "./FamilyForm";
import { STALE_TEXT } from "../../lib/territoryRegistry";
import { AuthProvider } from "../../lib/auth";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY24, family, household, territoryUser } from "../../test/territoryFixtures";

const NEIGHBORHOODS = [
  { id: "nb1", name: "Vila Verde", active: true },
  { id: "nb2", name: "Vila Velha", active: false },
  { id: "nb3", name: "Jardim das Américas e Arredores Sul", active: true }
];
// Os bairros já estão no cache quando o formulário monta (staleTime infinito: nenhuma leitura em segundo plano). Esperá-los
// com `findBy*` dependia do relógio: o formulário tem ~400 opções, cada render e cada consulta por papel custam centenas de
// ms sob carga, e o timeout de 1 s do `findBy` estourava ("Vila Verde" nunca aparecia) — flaky só com a máquina ocupada.
function renderHousehold(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(PANEL_NEIGHBORHOODS_KEY, NEIGHBORHOODS);
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  return { client, ...render(ui, { wrapper }) };
}
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.createHousehold, api.updateHousehold, api.addFamily, api.updateFamily, api.listPanelNeighborhoods ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.listPanelNeighborhoods).mockResolvedValue(NEIGHBORHOODS);
  mocked(api.createHousehold).mockResolvedValue(household());
  mocked(api.updateHousehold).mockResolvedValue(household({ version: 3 }));
  mocked(api.addFamily).mockResolvedValue(household({ version: 3 }));
  mocked(api.updateFamily).mockResolvedValue(household({ version: 3 }));
});

function fillAddress() {
  typeIn("CEP", "81020-000");
  pick("Tipo de logradouro", "081");
  typeIn("Logradouro", "das Flores");
  typeIn("Número", "120");
  pick("Bairro", "nb1");
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));

describe("HouseholdForm", () => {
  it("cria um domicílio com moradia; o corpo tem só o que a ficha leva", async () => {
    const onSaved = vi.fn();
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={onSaved} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "1");
    pick("Localização", "83");
    pick("Situação de moradia ou posse da terra", "75");
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalledTimes(1));
    expect(mocked(api.createHousehold).mock.calls[0][0]).toEqual({
      micro_area_id: "ma1",
      address: { zip: "81020000", street_type: "081", street: "das Flores", number: "120", no_number: false, complement: null,
        neighborhood_id: "nb1", district: null, reference: null },
      property_type: "1", living_conditions: { localizacao: 83, situacao_moradia_posse_terra: 75 }, contact_phone: null, refused: false
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(household()));
  });

  it("comércio: a seção de moradia some e não vai no corpo", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "1");
    pick("Localização", "83");
    pick("Tipo de imóvel", "2");
    expect(screen.queryByLabelText("Localização")).toBeNull();
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalledTimes(1));
    expect(mocked(api.createHousehold).mock.calls[0][0].living_conditions).toBeNull();
    // Voltar a domicílio devolve a seção vazia (foi limpa, não escondida).
    pick("Tipo de imóvel", "1");
    expect((screen.getByLabelText("Localização") as HTMLSelectElement).value).toBe("");
  });

  it("recusa do domicílio: sem moradia nem família; endereço fica", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "1");
    pick("Localização", "83");
    fireEvent.click(screen.getByLabelText("O morador recusou o cadastro do domicílio"));
    expect(screen.queryByLabelText("Localização")).toBeNull();
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalled());
    const body = mocked(api.createHousehold).mock.calls[0][0];
    expect(body.refused).toBe(true);
    expect(body.living_conditions).toBeNull();
    expect(body.address.street).toBe("das Flores");
  });

  it("recusa sem endereço: o endereço vai nulo", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Tipo de imóvel", "1");
    fireEvent.click(screen.getByLabelText("O morador recusou o cadastro do domicílio"));
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalled());
    expect(mocked(api.createHousehold).mock.calls[0][0].address).toBeNull();
  });

  it("CEP ruim é recusado antes de enviar, com o campo", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "2");
    typeIn("CEP", "8102");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("CEP com 8 dígitos");
    expect(document.activeElement).toBe(screen.getByLabelText("CEP"));
    expect(screen.getByLabelText("CEP").getAttribute("aria-invalid")).toBe("true");
    expect(api.createHousehold).not.toHaveBeenCalled();
  });

  it("o nome do logradouro não repete o tipo", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "2");
    typeIn("Logradouro", "Rua das Flores");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("o nome do logradouro não repete o tipo (RUA)");
    expect(document.activeElement).toBe(screen.getByLabelText("Logradouro"));
    expect(api.createHousehold).not.toHaveBeenCalled();
  });

  it("bairro: inativos e nomes acima de 30 letras ficam fora; sem bairro da lista, vai o texto", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    const options = Array.from((screen.getByLabelText("Bairro") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual([ "", "nb1" ]);
    expect(screen.queryByLabelText("Bairro (texto)")).toBeNull();
    pick("Bairro", "");
    typeIn("Bairro (texto)", "Jardim Novo");
    pick("Tipo de imóvel", "2");
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalled());
    expect(mocked(api.createHousehold).mock.calls[0][0].address).toEqual(
      expect.objectContaining({ neighborhood_id: null, district: "Jardim Novo" }));
  });

  it("sem número: o número sai e vai no_number", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    fireEvent.click(screen.getByLabelText("Sem número"));
    expect(screen.queryByLabelText("Número")).toBeNull();
    pick("Tipo de imóvel", "2");
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalled());
    expect(mocked(api.createHousehold).mock.calls[0][0].address).toEqual(expect.objectContaining({ number: null, no_number: true }));
  });

  it("abrigo (07): pede a instituição de permanência com o responsável técnico", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "7");
    pick("Localização", "83");
    // Campos que não cabem em abrigo nem aparecem.
    expect(screen.queryByLabelText("Número de cômodos")).toBeNull();
    expect(screen.queryByLabelText("Tem animais no domicílio")).toBeNull();
    save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/instituição de permanência e o responsável técnico/);
    expect(document.activeElement).toBe(screen.getByLabelText("Nome do responsável técnico"));
    expect(api.createHousehold).not.toHaveBeenCalled();
    typeIn("Nome do responsável técnico", "Joana Prado Lima");
    save();
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalled());
    expect(mocked(api.createHousehold).mock.calls[0][0].living_conditions).toEqual({
      localizacao: 83, instituicao_permanencia: { nome_responsavel_tecnico: "Joana Prado Lima" }
    });
  });

  it("edição: começa da versão gravada e manda tudo de volta com a versão", async () => {
    renderHousehold(<HouseholdForm microAreaId="ma1" initial={household()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("Logradouro") as HTMLInputElement).value).toBe("das Flores");
    expect((screen.getByLabelText("Número de cômodos") as HTMLInputElement).value).toBe("4");
      save();
    await waitFor(() => expect(api.updateHousehold).toHaveBeenCalled());
    const [ id, body, version ] = mocked(api.updateHousehold).mock.calls[0];
    expect(id).toBe("hh1");
    expect(version).toBe(2);
    expect(body).toEqual({
      micro_area_id: "ma1", address: household().address, property_type: "1",
      living_conditions: { localizacao: 83, situacao_moradia_posse_terra: 75, nu_comodos: 4, nu_moradores: 3, st_disponibilidade_energia_eletrica: true },
      contact_phone: "41999990000", refused: false
    });
  });

  it("409 stale_version: frase, o formulário fica, recarregar relê", async () => {
    mocked(api.updateHousehold).mockRejectedValue(new api.ApiError(409, { error: "stale_version" }, "409"));
    const onCancel = vi.fn();
    const { client } = renderHousehold(<HouseholdForm microAreaId="ma1" initial={household()} onSaved={vi.fn()} onCancel={onCancel} />);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    typeIn("Ponto de referência", "em frente à praça");
    save();
    expect(await screen.findByText(STALE_TEXT)).not.toBeNull();
    expect(mocked(api.updateHousehold).mock.calls[0][2]).toBe(2);
    expect((screen.getByLabelText("Ponto de referência") as HTMLInputElement).value).toBe("em frente à praça");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(onCancel).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    expect(api.updateHousehold).toHaveBeenCalledTimes(1);
  });

  it("422 invalid_household com path mostra a frase e marca o campo", async () => {
    mocked(api.createHousehold).mockRejectedValue(new api.ApiError(422, { error: "invalid_household", path: "address.number" }, "422"));
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "2");
    save();
    expect(await screen.findByText("confira o campo destacado")).not.toBeNull();
    expect(screen.getByLabelText("Número").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Número"));
  });

  it("nada da ficha vai para o storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderHousehold(<HouseholdForm microAreaId="ma1" onSaved={vi.fn()} onCancel={vi.fn()} />);
    fillAddress();
    pick("Tipo de imóvel", "1");
    pick("Localização", "83");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

const CANDIDATES = [ { patient_id: "pa1", display_name: "Maria das Dores" }, { patient_id: "pa2", display_name: null } ];
const saveFamily = () => fireEvent.click(screen.getByRole("button", { name: "Salvar família" }));

describe("FamilyForm", () => {
  it("nova família com a versão do domicílio; responsável é morador com cadastro", async () => {
    renderWithProviders(<FamilyForm household={household({ families: [] })} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const options = Array.from((screen.getByLabelText("Responsável") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "— escolha —", "Maria das Dores", "pessoa sem nome no cadastro" ]);
    pick("Responsável", "pa1");
    typeIn("Número de membros", "3");
    pick("Renda familiar", "3");
    expect(screen.queryByLabelText("Mudou-se")).toBeNull();
    saveFamily();
    await waitFor(() => expect(api.addFamily).toHaveBeenCalledWith("hh1",
      { responsible: { patient_id: "pa1" }, income_band: "3", members_count: 3, living_since: null, moved_out: false }, 2));
  });

  it("sem responsável não envia", async () => {
    renderWithProviders(<FamilyForm household={household({ families: [] })} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    saveFamily();
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o responsável");
    expect(document.activeElement).toBe(screen.getByLabelText("Responsável"));
    expect(api.addFamily).not.toHaveBeenCalled();
  });

  it("reside desde no futuro é recusado", async () => {
    renderWithProviders(<FamilyForm household={household({ families: [] })} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Responsável", "pa1");
    typeIn("Reside desde", "2026-11");
    saveFamily();
    expect((await screen.findByRole("alert")).textContent).toBe("reside desde depois deste mês");
    expect(api.addFamily).not.toHaveBeenCalled();
  });

  it("famílias somam mais que os moradores do domicílio: frase que manda corrigir o domicílio", async () => {
    renderWithProviders(<FamilyForm household={household()} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Responsável", "pa2");
    typeIn("Número de membros", "2");
    saveFamily();
    expect((await screen.findByRole("alert")).textContent).toBe("moradores menos que a soma das famílias (5) — edite o domicílio antes de salvar a família");
    expect(api.addFamily).not.toHaveBeenCalled();
  });

  it("edição: responsável fixo, mudança definitiva com aviso; sem responsável no corpo", async () => {
    renderWithProviders(<FamilyForm household={household()} initial={family()} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Responsável")).toBeNull();
    expect(screen.getByText("Responsável: Maria das Dores")).not.toBeNull();
    expect((screen.getByLabelText("Reside desde") as HTMLInputElement).value).toBe("2019-05");
    fireEvent.click(screen.getByLabelText("Mudou-se"));
    expect(screen.getByText(/a mudança é definitiva/)).not.toBeNull();
    saveFamily();
    await waitFor(() => expect(api.updateFamily).toHaveBeenCalledWith("fa1",
      { income_band: "3", members_count: 3, living_since: "2019-05", moved_out: true }, 2));
  });

  it("409 stale_version: frase, fica, recarregar fecha", async () => {
    mocked(api.updateFamily).mockRejectedValue(new api.ApiError(409, { error: "stale_version" }, "409"));
    const onCancel = vi.fn();
    renderWithProviders(<FamilyForm household={household()} initial={family()} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={onCancel} />);
    typeIn("Número de membros", "2");
    saveFamily();
    expect(await screen.findByText(STALE_TEXT)).not.toBeNull();
    expect((screen.getByLabelText("Número de membros") as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(onCancel).toHaveBeenCalled();
    expect(api.updateFamily).toHaveBeenCalledTimes(1);
  });

  it("422 invalid_household da gravação da família: a frase aponta o domicílio", async () => {
    mocked(api.addFamily).mockRejectedValue(new api.ApiError(422, { error: "invalid_household", path: "living_conditions.nu_moradores" }, "422"));
    renderWithProviders(<FamilyForm household={household({ families: [] })} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Responsável", "pa1");
    saveFamily();
    expect((await screen.findByRole("alert")).textContent).toBe("o número de moradores do domicílio é menor que a soma das famílias — edite o domicílio antes de salvar a família");
  });

  it("422 invalid_family com path marca o campo", async () => {
    mocked(api.addFamily).mockRejectedValue(new api.ApiError(422, { error: "invalid_family", path: "members_count" }, "422"));
    renderWithProviders(<FamilyForm household={household({ families: [] })} candidates={CANDIDATES} today={TODAY24} onSaved={vi.fn()} onCancel={vi.fn()} />);
    pick("Responsável", "pa1");
    typeIn("Número de membros", "3");
    saveFamily();
    expect(await screen.findByText("confira o campo destacado")).not.toBeNull();
    expect(screen.getByLabelText("Número de membros").getAttribute("aria-invalid")).toBe("true");
  });
});
