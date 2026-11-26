// Módulo 27b (Task 6): o CATMAT do produto de campo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
  getVectorDomains: vi.fn(), listVectorProducts: vi.fn(), createVectorProduct: vi.fn(), updateVectorProduct: vi.fn(), getVectorParameters: vi.fn(),
  putVectorParameters: vi.fn(), getVectorSettings: vi.fn(), putVectorSettings: vi.fn(), getVectorDiseases: vi.fn() }));
import * as api from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { ADULTICIDE, LARVICIDE, VC_DOMAINS, parameterVersion, vcUser } from "../test/vectorControlFixtures";
import { VectorSettings } from "./VectorSettings";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const WITH_CATMAT = { ...ADULTICIDE, catmat_code: 267123 };
const LABEL = "CATMAT (opcional)";
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const rowOf = (text: string) => {
  const row = screen.getAllByRole("row").find((r) => within(r).queryAllByText(text).length > 0);
  if (!row) throw new Error(`sem a linha ${text}`);
  return within(row);
};
async function edit(code: string) {
  renderWithProviders(<VectorSettings />);
  await screen.findByRole("table", { name: "Produtos de campo" });
  fireEvent.click(rowOf(code).getByRole("button", { name: `Editar ${code}` }));
}

describe("CATMAT do produto de campo (27b)", () => {
  beforeEach(() => {
    for (const fn of [ api.createVectorProduct, api.updateVectorProduct ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
    mocked(api.listVectorProducts).mockResolvedValue([ LARVICIDE, WITH_CATMAT ]);
    mocked(api.getVectorParameters).mockResolvedValue(parameterVersion());
    mocked(api.getVectorSettings).mockResolvedValue({ stock_location: null, options: [] });
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.updateVectorProduct).mockResolvedValue(LARVICIDE);
  });

  it("a tabela ganha a coluna CATMAT", async () => {
    renderWithProviders(<VectorSettings />);
    await screen.findByRole("table", { name: "Produtos de campo" });
    expect(screen.getByRole("columnheader", { name: "CATMAT" })).not.toBeNull();
    expect(rowOf("MAL").getByText("267123")).not.toBeNull();
  });

  it("'267123' manda catmat_code 267123 (inteiro) e mostra a ajuda", async () => {
    await edit("PYR");
    expect(screen.getByText("código do produto no CATMAT; sem ele o produto fica fora do envio à BNAFAR")).not.toBeNull();
    type(LABEL, "267123");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ "pr1", { catmat_code: 267123 } ]);
  });

  it("'26A' é recusado antes de enviar", async () => {
    await edit("PYR");
    type(LABEL, "26A");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect((await screen.findByText("o CATMAT é um número inteiro positivo de até 9 dígitos"))).not.toBeNull();
    expect(screen.getByLabelText(LABEL).getAttribute("aria-invalid")).toBe("true");
    expect(api.updateVectorProduct).not.toHaveBeenCalled();
  });

  it("apagar manda null", async () => {
    await edit("MAL");
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).value).toBe("267123");
    type(LABEL, "");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ "pr2", { catmat_code: null } ]);
  });

  it("editar só o nome não manda catmat_code", async () => {
    await edit("MAL");
    type("Nome", "Malationa 44%");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ "pr2", { name: "Malationa 44%" } ]);
  });
});
