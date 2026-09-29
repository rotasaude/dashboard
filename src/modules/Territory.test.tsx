import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, listNeighborhoods: vi.fn(), createNeighborhood: vi.fn(), renameNeighborhood: vi.fn(),
    setNeighborhoodActive: vi.fn(), replaceCoverage: vi.fn(), listActiveUnits: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError, type Neighborhood } from "../lib/api";
import { PANEL_NEIGHBORHOODS_KEY } from "../lib/neighborhoodFilter";
import { Territory } from "./Territory";

afterEach(cleanup);
let lastClient: QueryClient;
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const centro: Neighborhood = { id: "n1", name: "Centro", active: true, source: "seed",
  units: [ { id: "u1", name: "UBS Centro", active: true }, { id: "u9", name: "UPA Velha", active: false } ] };
const saoBraz: Neighborhood = { id: "n2", name: "São Braz", active: true, source: "manual", units: [] };
const batel: Neighborhood = { id: "n3", name: "Batel", active: false, source: "seed", units: [] };

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = client;
  render(<Territory />, {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
}

const rowOf = (name: string) => within(screen.getByText(name).closest("[role=row]") as HTMLElement);

describe("Territory", () => {
  beforeEach(() => {
    for (const fn of [ api.listNeighborhoods, api.createNeighborhood, api.renameNeighborhood, api.setNeighborhoodActive,
      api.replaceCoverage, api.listActiveUnits ]) mocked(fn).mockReset();
    mocked(api.listNeighborhoods).mockResolvedValue([ centro, saoBraz, batel ]);
    mocked(api.listActiveUnits).mockResolvedValue([
      { id: "u1", name: "UBS Centro", kind: "ubs" }, { id: "u2", name: "UPA Norte", kind: "upa" }
    ]);
  });

  it("lista por nome, com origem, estado e o número de unidades ativas", async () => {
    renderIt();
    await screen.findByText("Centro");
    const rows = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows[0]).toMatch(/^Batel/);
    expect(rows[1]).toMatch(/^Centro/);
    expect(rows[2]).toMatch(/^São Braz/);
    expect(rowOf("Centro").getByText("semente")).toBeTruthy();
    expect(rowOf("Centro").getByText("ativo")).toBeTruthy();
    expect(rowOf("Centro").getByText("1")).toBeTruthy();
    expect(rowOf("São Braz").getByText("manual")).toBeTruthy();
    expect(rowOf("Batel").getByText("inativo")).toBeTruthy();
  });

  it("busca sem diferenciar maiúsculas e acentos", async () => {
    renderIt();
    await screen.findByText("Centro");
    fireEvent.change(screen.getByLabelText("Buscar bairro"), { target: { value: "SAO" } });
    expect(screen.getByText("São Braz")).toBeTruthy();
    expect(screen.queryByText("Centro")).toBeNull();
  });

  it("cria bairro com o nome aparado e relê a lista", async () => {
    mocked(api.createNeighborhood).mockResolvedValue(undefined);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Novo bairro" }));
    fireEvent.change(screen.getByLabelText("Nome do bairro"), { target: { value: "  Rebouças " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.createNeighborhood).toHaveBeenCalledWith("Rebouças"));
    await waitFor(() => expect(api.listNeighborhoods).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nome vazio é recusado na tela, sem chamar a API", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Novo bairro" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o nome do bairro");
    expect(api.createNeighborhood).not.toHaveBeenCalled();
  });

  it("name_taken aparece traduzido e o diálogo continua aberto", async () => {
    mocked(api.createNeighborhood).mockRejectedValue(new ApiError(422, { error: "name_taken" }, "x"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Novo bairro" }));
    fireEvent.change(screen.getByLabelText("Nome do bairro"), { target: { value: "centro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("já existe um bairro com este nome")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("renomeia a partir do nome atual", async () => {
    mocked(api.renameNeighborhood).mockResolvedValue(undefined);
    renderIt();
    await screen.findByText("Centro");
    fireEvent.click(rowOf("Centro").getByRole("button", { name: "Renomear" }));
    const input = screen.getByLabelText("Nome do bairro") as HTMLInputElement;
    expect(input.value).toBe("Centro");
    fireEvent.change(input, { target: { value: "Centro Histórico" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.renameNeighborhood).toHaveBeenCalledWith("n1", "Centro Histórico"));
  });

  it("toda escrita invalida também a lista do seletor dos painéis", async () => {
    mocked(api.setNeighborhoodActive).mockResolvedValue(undefined);
    renderIt();
    await screen.findByText("Centro");
    const spy = vi.spyOn(lastClient, "invalidateQueries");
    fireEvent.click(rowOf("Centro").getByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PANEL_NEIGHBORHOODS_KEY }));
  });

  it("desativa o ativo e reativa o inativo", async () => {
    mocked(api.setNeighborhoodActive).mockResolvedValue(undefined);
    renderIt();
    await screen.findByText("Centro");
    fireEvent.click(rowOf("Centro").getByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(api.setNeighborhoodActive).toHaveBeenCalledWith("n1", false));
    // Uma ação por vez: espera a primeira terminar antes do segundo clique.
    await waitFor(() => expect((rowOf("Centro").getByRole("button", { name: "Desativar" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(rowOf("Batel").getByRole("button", { name: "Reativar" }));
    await waitFor(() => expect(api.setNeighborhoodActive).toHaveBeenCalledWith("n3", true));
  });

  it("bairro inativo não oferece cobertura", async () => {
    renderIt();
    await screen.findByText("Batel");
    expect(rowOf("Batel").queryByRole("button", { name: "Cobertura" })).toBeNull();
    expect(rowOf("Centro").getByRole("button", { name: "Cobertura" })).toBeTruthy();
  });

  it("cobertura: caixas das unidades ativas, marcadas pelo que já cobre, e substitui o conjunto", async () => {
    mocked(api.replaceCoverage).mockResolvedValue(undefined);
    renderIt();
    await screen.findByText("Centro");
    fireEvent.click(rowOf("Centro").getByRole("button", { name: "Cobertura" }));
    const ubs = await screen.findByLabelText("UBS Centro") as HTMLInputElement;
    const upa = screen.getByLabelText("UPA Norte") as HTMLInputElement;
    expect(ubs.checked).toBe(true);
    expect(upa.checked).toBe(false);
    fireEvent.click(upa);
    fireEvent.click(screen.getByRole("button", { name: "Salvar cobertura" }));
    await waitFor(() => expect(api.replaceCoverage).toHaveBeenCalledWith("n1", [ "u1", "u2" ]));
  });

  it("unidade desativada na cobertura sai ao salvar, com aviso", async () => {
    mocked(api.replaceCoverage).mockResolvedValue(undefined);
    renderIt();
    await screen.findByText("Centro");
    fireEvent.click(rowOf("Centro").getByRole("button", { name: "Cobertura" }));
    expect(await screen.findByText(/UPA Velha/)).toBeTruthy();
    expect(screen.getByText(/saem da cobertura ao salvar/)).toBeTruthy();
    // O aviso aparece de imediato; o botão só habilita quando as unidades ativas chegam.
    await screen.findByLabelText("UBS Centro");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cobertura" }));
    await waitFor(() => expect(api.replaceCoverage).toHaveBeenCalledWith("n1", [ "u1" ]));
  });

  it("inactive_unit ao salvar a cobertura aparece traduzido", async () => {
    mocked(api.replaceCoverage).mockRejectedValue(new ApiError(422, { error: "inactive_unit" }, "x"));
    renderIt();
    await screen.findByText("Centro");
    fireEvent.click(rowOf("Centro").getByRole("button", { name: "Cobertura" }));
    await screen.findByLabelText("UBS Centro");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cobertura" }));
    expect(await screen.findByText("há unidade desativada ou inexistente na cobertura — recarregue e tente de novo")).toBeTruthy();
  });
});
