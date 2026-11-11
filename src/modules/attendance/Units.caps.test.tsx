import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listAllUnits: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), setUnitActive: vi.fn(), listNeighborhoods: vi.fn(), drainUnit: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { PHONE_TEXT, PSY_ERRORS } from "../../lib/psychosocial";
import { Units } from "./Units";
import { EMPTY_ADDRESS } from "../../lib/unitAddress";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const UBS = { id: "u1", name: "UBS Centro", kind: "ubs", active: true };
const CAPS = { id: "c1", name: "CAPS AD III Boqueirão", kind: "caps", active: true, caps_modality: "caps_ad_iii", service_classification: "002", phone: "4133334444" };

function renderUnits(capsOn = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Units capsOn={capsOn} /></QueryClientProvider>);
}
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
const editRow = async (name: string) => {
  const row = (await screen.findByText(name)).closest("[role=row]") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /Editar/ }));
};

describe("Units — CAPS e telefone (módulo 31)", () => {
  beforeEach(() => {
    for (const fn of [ api.listAllUnits, api.createUnit, api.updateUnit, api.setUnitActive, api.listNeighborhoods, api.drainUnit ]) mocked(fn).mockReset();
    mocked(api.listAllUnits).mockResolvedValue([ UBS, CAPS ]);
    mocked(api.listNeighborhoods).mockResolvedValue([]);
  });

  it("lista o CAPS com a modalidade no lugar do tipo (o rótulo da modalidade já começa por CAPS)", async () => {
    renderUnits();
    expect(await screen.findByText("CAPS AD III")).not.toBeNull();
    expect(screen.queryByText("CAPS")).toBeNull();
  });
  it("cria o CAPS com modalidade, classificação e telefone no 5º argumento; sem classificação vai null", async () => {
    mocked(api.createUnit).mockResolvedValue(CAPS);
    renderUnits();
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    pick("Nome", "CAPS II Centro");
    pick("Tipo", "caps");
    pick("Modalidade do CAPS", "caps_ii");
    pick("Telefone", "41999991234");
    save();
    await waitFor(() => expect(api.createUnit).toHaveBeenCalledWith("CAPS II Centro", "caps", EMPTY_ADDRESS, undefined,
      { caps_modality: "caps_ii", service_classification: null, phone: "41999991234" }));
  });
  it("o CAPS não é oferecido sem o interruptor", async () => {
    renderUnits(false);
    fireEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    expect(screen.queryByRole("option", { name: "CAPS" })).toBeNull();
  });
  it("editar o CAPS reenvia a modalidade e a classificação; telefone só quando mudou; apagar manda null", async () => {
    mocked(api.updateUnit).mockResolvedValue(CAPS);
    renderUnits();
    await editRow("CAPS AD III Boqueirão");
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("4133334444");
    pick("Nome", "CAPS AD III Boqueirão 2");
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateUnit).mock.calls[0]).toEqual([ "c1", "CAPS AD III Boqueirão 2", "caps", EMPTY_ADDRESS, "walk_in", undefined, undefined, undefined,
      { caps_modality: "caps_ad_iii", service_classification: "002" } ]);
    await screen.findByText("UBS Centro");
    await editRow("CAPS AD III Boqueirão");
    pick("Telefone", "");
    pick("Classificação do serviço 115", "");
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateUnit).mock.calls[1][8]).toEqual({ caps_modality: "caps_ad_iii", service_classification: null, phone: null });
  });
  it("a unidade que deixa de ser CAPS apaga modalidade e classificação (null)", async () => {
    mocked(api.updateUnit).mockResolvedValue(UBS);
    renderUnits();
    await editRow("CAPS AD III Boqueirão");
    pick("Tipo", "ubs");
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateUnit).mock.calls[0][8]).toEqual({ caps_modality: null, service_classification: null });
  });
  it("telefone numa UBS vai no 5º argumento do createUnit; sem mexer no telefone, o corpo é o de sempre", async () => {
    mocked(api.createUnit).mockResolvedValue(UBS);
    mocked(api.updateUnit).mockResolvedValue(UBS);
    renderUnits();
    await editRow("UBS Centro");
    save();
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalled());
    expect(mocked(api.updateUnit).mock.calls[0]).toHaveLength(6);
    await screen.findByText("CAPS AD III Boqueirão");
    fireEvent.click(screen.getByRole("button", { name: "Nova unidade" }));
    pick("Nome", "UBS Nova");
    pick("Telefone", "4133334444");
    save();
    await waitFor(() => expect(api.createUnit).toHaveBeenCalledWith("UBS Nova", "ubs", EMPTY_ADDRESS, undefined, { phone: "4133334444" }));
  });
  it.each([
    [ 409, "unit_has_caps_records" ], [ 409, "caps_has_beds" ], [ 409, "unit_has_attendances" ],
    [ 422, "invalid_phone" ], [ 422, "caps_modality_mismatch" ], [ 422, "invalid_service_classification" ]
  ])("%s %s vira a frase da lib", async (status, code) => {
    mocked(api.updateUnit).mockRejectedValue(new ApiError(status, { error: code }, "x"));
    renderUnits();
    await editRow("CAPS AD III Boqueirão");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe(PSY_ERRORS[code]);
  });
  it("invalid_phone usa a mesma frase do formulário e o erro genérico da unidade continua o de antes", async () => {
    expect(PSY_ERRORS.invalid_phone).toBe(PHONE_TEXT);
    mocked(api.updateUnit).mockRejectedValue(new ApiError(422, { error: "unit_name_taken" }, "x"));
    renderUnits();
    await editRow("CAPS AD III Boqueirão");
    save();
    expect(await screen.findByText("já existe uma unidade com este nome")).not.toBeNull();
  });
  it("esvaziar unidade: o CAPS não é oferecido como destino (o api recusa caps_unit_not_allowed)", async () => {
    mocked(api.listAllUnits).mockResolvedValue([ { ...UBS, live_requests_count: 2 }, { id: "u7", name: "UBS Xaxim", kind: "ubs", active: true }, CAPS ]);
    renderUnits();
    const row = (await screen.findByText("UBS Centro")).closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Esvaziar" }));
    const select = await screen.findByLabelText("Unidade de destino");
    expect(within(select).getByRole("option", { name: "UBS Xaxim" })).not.toBeNull();
    expect(within(select).queryByRole("option", { name: /CAPS/ })).toBeNull();
  });
  it("a frase de unit_has_attendances é genérica: não nomeia o CAPS", () => {
    expect(PSY_ERRORS.unit_has_attendances).not.toMatch(/CAPS/);
  });

  it.each([ "deactivate", "kind" ])("409 upa_has_beds (%s) vira a frase da urgência", async (via) => {
    const UPA = { id: "up1", name: "UPA Boqueirão", kind: "upa", active: true };
    mocked(api.listAllUnits).mockResolvedValue([ UBS, UPA ]);
    const refusal = new ApiError(409, { error: "upa_has_beds" }, "x");
    mocked(api.setUnitActive).mockRejectedValue(refusal);
    mocked(api.updateUnit).mockRejectedValue(refusal);
    renderUnits();
    if (via === "deactivate") {
      const row = (await screen.findByText("UPA Boqueirão")).closest("[role=row]") as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: /Desativar/ }));
    } else {
      await editRow("UPA Boqueirão");
      save();
    }
    expect((await screen.findByRole("alert")).textContent).toBe("esta UPA tem leitos de observação ativos — desative os leitos antes");
  });
});
