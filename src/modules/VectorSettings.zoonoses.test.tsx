// src/modules/VectorSettings.zoonoses.test.tsx — "Produtos e parâmetros" numa cidade só com `zoonoses` (módulo 35b, F-35.12, F-35.15; Q3, Q11).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getVectorDomains: vi.fn(), listVectorProducts: vi.fn(), createVectorProduct: vi.fn(),
    updateVectorProduct: vi.fn(), getVectorParameters: vi.fn(), putVectorParameters: vi.fn(), getVectorSettings: vi.fn(), putVectorSettings: vi.fn(),
    getVectorDiseases: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type VectorProduct } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { LARVICIDE, VC_DOMAINS } from "../test/vectorControlFixtures";
import { VACCINE, zooUser } from "../test/zoonosesFixtures";
import { productProblems } from "./vectorControl/ProductsPanel";
import { VectorSettings } from "./VectorSettings";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const checkbox = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const mount = () => renderWithProviders(<VectorSettings />);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === "function" && "mockReset" in fn) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "endemic_coordinator" ]));
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  mocked(api.listVectorProducts).mockResolvedValue([ LARVICIDE, VACCINE ]);
  mocked(api.getVectorSettings).mockResolvedValue({ stock_location: null, options: [ { id: "loc-uvz", name: "Almoxarifado da UVZ" } ] });
});

describe("VectorSettings só com zoonoses", () => {
  it("sem o painel de parâmetros do 35a e sem ler os parâmetros; produtos e local ficam", async () => {
    mount();
    expect(await screen.findByText("Produtos de campo")).not.toBeNull();
    expect(await screen.findByText("Local de estoque")).not.toBeNull();
    // O painel do 35a tem os próprios controles (parâmetros versionados); nenhum aparece.
    expect(screen.queryByText("Parâmetros técnicos")).toBeNull();
    expect(screen.queryByRole("region", { name: /Parâmetros técnicos/ })).toBeNull();
    expect(api.getVectorParameters).not.toHaveBeenCalled();
    expect(api.getVectorDiseases).not.toHaveBeenCalled();
  });

  it("produto novo com a vacina: un e 1,00 fixos, corpo exato; collar desabilita os outros usos", async () => {
    mocked(api.createVectorProduct).mockResolvedValue(VACCINE);
    mocked(api.listVectorProducts).mockResolvedValue([ LARVICIDE ]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
    // Só os usos do portão.
    expect(screen.queryByLabelText("Focal (larvicida)")).toBeNull();
    type("Código", "VAR"); type("Nome", "Vacina antirrábica animal");
    fireEvent.click(checkbox("vacina antirrábica animal"));
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).value).toBe("un");
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Tamanho da carga") as HTMLInputElement).value).toBe("1,00");
    expect(checkbox("coleira").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.createVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.createVectorProduct).mock.calls[0][0]).toEqual({
      code: "VAR", name: "Vacina antirrábica animal", unit: "un", charge_size: "1.00", uses: [ "rabies_vaccine" ], active: true
    });
  });

  it("marcar a coleira desabilita a vacina; desmarcar libera", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
    fireEvent.click(checkbox("coleira"));
    expect(checkbox("vacina antirrábica animal").disabled).toBe(true);
    fireEvent.click(checkbox("coleira"));
    expect(checkbox("vacina antirrábica animal").disabled).toBe(false);
  });

  it("com os dois interruptores: os cinco usos; a vacina desabilita os do 35a e vice-versa", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "endemic_coordinator" ], [ "clinical_record", "territory_registry", "home_visits", "vector_control", "zoonoses" ]));
    mocked(api.getVectorParameters).mockResolvedValue({} as never);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
    for (const l of [ "Focal (larvicida)", "Perifocal (adulticida residual)", "Espacial (UBV)", "vacina antirrábica animal", "coleira" ]) expect(screen.getByLabelText(l)).not.toBeNull();
    fireEvent.click(checkbox("Focal (larvicida)"));
    expect(checkbox("vacina antirrábica animal").disabled).toBe(true);
    expect(checkbox("coleira").disabled).toBe(true);
    fireEvent.click(checkbox("Focal (larvicida)"));
    fireEvent.click(checkbox("coleira"));
    expect(checkbox("Focal (larvicida)").disabled).toBe(true);
  });

  it("produto antigo focal aparece marcado e desabilitado; a edição manda só o que mudou", async () => {
    mocked(api.updateVectorProduct).mockResolvedValue({ ...LARVICIDE, name: "Novo nome" } as VectorProduct);
    mount();
    await screen.findByRole("table", { name: "Produtos de campo" });
    fireEvent.click(screen.getByRole("button", { name: `Editar ${LARVICIDE.code}` }));
    expect(checkbox("Focal (larvicida)").checked).toBe(true);
    expect(checkbox("Focal (larvicida)").disabled).toBe(true);
    type("Nome", "Novo nome");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ LARVICIDE.id, { name: "Novo nome" } ]);
  });

  it("a vacina existente: uso fixo, não atravessa a família; PATCH só do que mudou", async () => {
    mocked(api.updateVectorProduct).mockResolvedValue(VACCINE);
    mount();
    await screen.findByRole("table", { name: "Produtos de campo" });
    fireEvent.click(screen.getByRole("button", { name: `Editar ${VACCINE.code}` }));
    expect(checkbox("vacina antirrábica animal").checked).toBe(true);
    expect(checkbox("vacina antirrábica animal").disabled).toBe(true);
    expect(checkbox("coleira").disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Ativo"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ VACCINE.id, { active: false } ]);
  });

  it("recusa do api na edição vira frase, sem reenviar", async () => {
    mocked(api.updateVectorProduct).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "uses" }, "x"));
    mount();
    await screen.findByRole("table", { name: "Produtos de campo" });
    fireEvent.click(screen.getByRole("button", { name: `Editar ${VACCINE.code}` }));
    fireEvent.click(screen.getByLabelText("Ativo"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct)).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("alert")).textContent).toContain("marque ao menos um uso");
  });

  it("sub do painel de produtos: só zoonoses; os dois; só 35a", async () => {
    mount();
    expect(await screen.findByText("vacina antirrábica animal e coleira")).not.toBeNull();
  });
});

describe("productProblems com as finalidades de zoonoses (Q11)", () => {
  const base = { code: "X", name: "Y", unit: "un", charge: "1,00" };
  it("recusa a mistura e as duas finalidades de zoonoses", () => {
    expect(productProblems({ ...base, uses: [ "rabies_vaccine" ] }, [])).toEqual([]);
    expect(productProblems({ ...base, uses: [ "collar" ] }, [])).toEqual([]);
    expect(productProblems({ ...base, uses: [ "rabies_vaccine", "collar" ] }, []).map((p) => p.path)).toEqual([ "uses" ]);
    expect(productProblems({ ...base, uses: [ "rabies_vaccine", "focal" ] }, []).map((p) => p.path)).toEqual([ "uses" ]);
    expect(productProblems({ ...base, unit: "g", uses: [ "collar" ] }, []).map((p) => p.path)).toEqual([ "unit" ]);
    expect(productProblems({ ...base, charge: "2", uses: [ "collar" ] }, []).map((p) => p.path)).toEqual([ "charge_size" ]);
    expect(productProblems({ ...base, unit: "g", charge: "2", uses: [ "focal" ] }, [])).toEqual([]);
  });
});
