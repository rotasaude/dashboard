// Módulo 27b (Task 6; F-21): o CNES do almoxarifado central na edição do local; a tabela mostra o CNES efetivo de todos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listAdminLocations: vi.fn(), createAdminLocation: vi.fn(), updateAdminLocation: vi.fn(), addLocationStaff: vi.fn(), removeLocationStaff: vi.fn(),
  getPharmacySettings: vi.fn(), updatePharmacySettings: vi.fn(), listAllUnits: vi.fn(), listMemberships: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { BNAFAR_ERRORS } from "../lib/bnafarErrors";
import { PharmacyAdmin } from "./PharmacyAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { adminLocation, phSettings, phUser } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CNES_LABEL = "CNES do almoxarifado (opcional, 7 dígitos)";
const HELP = "obrigatório para o envio à BNAFAR; precisa ser um CNES desta cidade";
const central = (over = {}) => adminLocation({ id: "l1", name: "Almoxarifado Central", kind: "central", health_unit: null, staff: [], cnes: null, ...over });
const unit = adminLocation({ cnes: "2345678" });

async function editCentral() {
  renderWithProviders(<PharmacyAdmin />);
  const row = await screen.findByRole("row", { name: /Almoxarifado Central/ });
  fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
}
const type = (value: string) => fireEvent.change(screen.getByLabelText(CNES_LABEL), { target: { value } });
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Salvar local" }));
}

describe("CNES do almoxarifado central (27b)", () => {
  beforeEach(() => {
    for (const fn of [ api.createAdminLocation, api.updateAdminLocation ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "municipal_admin" ]));
    mocked(api.listAdminLocations).mockResolvedValue([ unit, central() ]);
    mocked(api.listAllUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", kind: "ubs", active: true } ]);
    mocked(api.listMemberships).mockResolvedValue([]);
    mocked(api.getPharmacySettings).mockResolvedValue(phSettings());
    mocked(api.updateAdminLocation).mockResolvedValue(central({ cnes: "1234567" }));
  });

  it("a tabela mostra o CNES efetivo; o central sem CNES diz 'sem CNES'", async () => {
    renderWithProviders(<PharmacyAdmin />);
    expect((await screen.findByRole("row", { name: /Almoxarifado Central/ })).textContent).toContain("sem CNES");
    expect(screen.getByRole("row", { name: /Farmácia UBS Centro/ }).textContent).toContain("2345678");
  });

  it("'1234-567' manda cnes '1234567'", async () => {
    await editCentral();
    expect(screen.getByText(HELP)).not.toBeNull();
    type("1234-567");
    await save();
    await waitFor(() => expect(mocked(api.updateAdminLocation)).toHaveBeenCalledWith("l1", { kind: "central", name: "Almoxarifado Central", active: true, cnes: "1234567" }));
  });

  it("'123456' é recusado antes de enviar", async () => {
    await editCentral();
    type("123456");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o CNES tem 7 dígitos");
    expect(screen.queryByRole("button", { name: "Salvar local" })).toBeNull();
    expect(mocked(api.updateAdminLocation)).not.toHaveBeenCalled();
  });

  it("apagar o CNES manda null; sem mexer, a chave não vai", async () => {
    mocked(api.listAdminLocations).mockResolvedValue([ unit, central({ cnes: "1234567" }) ]);
    await editCentral();
    expect((screen.getByLabelText(CNES_LABEL) as HTMLInputElement).value).toBe("1234567");
    type("");
    await save();
    await waitFor(() => expect(mocked(api.updateAdminLocation)).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateAdminLocation).mock.calls[0][1]).toEqual({ kind: "central", name: "Almoxarifado Central", active: true, cnes: null });
    cleanup();
    mocked(api.updateAdminLocation).mockClear();
    await editCentral();
    fireEvent.click(screen.getByLabelText("Ativo"));
    await save();
    await waitFor(() => expect(mocked(api.updateAdminLocation)).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateAdminLocation).mock.calls[0][1]).not.toHaveProperty("cnes");
  });

  it("422 invalid_request com path cnes cai no campo", async () => {
    mocked(api.updateAdminLocation).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "cnes" }, "422"));
    await editCentral();
    type("1234567");
    await save();
    await waitFor(() => expect(screen.getByLabelText(CNES_LABEL).getAttribute("aria-invalid")).toBe("true"));
    const id = screen.getByLabelText(CNES_LABEL).getAttribute("aria-describedby") ?? "";
    expect(id.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" ")).toContain("o CNES tem 7 dígitos");
  });

  it("409 cnes_in_use mostra a frase do api", async () => {
    mocked(api.updateAdminLocation).mockRejectedValue(new ApiError(409, { error: "cnes_in_use" }, "409"));
    await editCentral();
    type("2345678");
    await save();
    expect(await screen.findByText(BNAFAR_ERRORS.cnes_in_use)).not.toBeNull();
  });

  it("a farmácia da unidade e o novo local não mostram o campo", async () => {
    renderWithProviders(<PharmacyAdmin />);
    const row = await screen.findByRole("row", { name: /Farmácia UBS Centro/ });
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
    expect(screen.queryByLabelText(CNES_LABEL)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Novo local" }));
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "central" } });
    expect(screen.queryByLabelText(CNES_LABEL)).toBeNull();
  });
});
