import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listCeoProfiles: vi.fn(), putCeoProfile: vi.fn(), getAuxiliaryProcedures: vi.fn(), putAuxiliaryProcedures: vi.fn(), searchDentalProcedures: vi.fn() }));
import * as api from "../lib/api";
import { DentalAdmin } from "./DentalAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { FLUOR, SCALING, ceoProfile, dentalUser } from "../test/dentalFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("DentalAdmin", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(dentalUser([ "municipal_admin" ]));
    mocked(api.listCeoProfiles).mockResolvedValue([ ceoProfile({ ceo_type: null, specialties: [] }) ]);
    mocked(api.putCeoProfile).mockResolvedValue(ceoProfile());
    mocked(api.getAuxiliaryProcedures).mockResolvedValue([ { sigtap: FLUOR.sigtap, name: FLUOR.name } ]);
    mocked(api.putAuxiliaryProcedures).mockResolvedValue([]);
    mocked(api.searchDentalProcedures).mockResolvedValue([ SCALING, FLUOR ]);
  });

  it("perfil do CEO: tipo obrigatório antes; especialidades no corpo, com step-up", async () => {
    renderWithProviders(<DentalAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Salvar perfil — CEO Boqueirão" }));
    expect(screen.getByText("escolha o tipo do CEO")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Tipo do CEO — CEO Boqueirão"), { target: { value: "II" } });
    fireEvent.click(screen.getByLabelText("Endodontia — CEO Boqueirão"));
    fireEvent.click(screen.getByLabelText("Prótese dentária — CEO Boqueirão"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil — CEO Boqueirão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.putCeoProfile)).toHaveBeenCalledWith("u9", { ceo_type: "II", specialties: [ "endodontics", "prosthesis" ] }));
  });

  it("recusa do api mostra a frase junto do campo", async () => {
    const { ApiError } = await import("../lib/api");
    mocked(api.listCeoProfiles).mockResolvedValue([ ceoProfile() ]);
    mocked(api.putCeoProfile).mockRejectedValue(new ApiError(422, { error: "unit_not_ceo", path: "health_unit_id" }, "422"));
    renderWithProviders(<DentalAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Salvar perfil — CEO Boqueirão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => (a.textContent ?? "").startsWith("health_unit_id:"))).toBe(true);
  });

  it("lista do TSB/ASB: acrescenta sem repetir, remove e salva", async () => {
    renderWithProviders(<DentalAdmin />);
    expect(await screen.findByText(`${FLUOR.sigtap} — ${FLUOR.name}`)).not.toBeNull();
    expect(screen.getByText("TSB e ASB registram só estes procedimentos e só dão baixa no plano com eles.")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "rasp" } });
    fireEvent.click(await screen.findByRole("button", { name: `${SCALING.sigtap} — ${SCALING.name}` }));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "flu" } });
    fireEvent.click(await screen.findByRole("button", { name: `${FLUOR.sigtap} — ${FLUOR.name}` }));
    expect(screen.getAllByText(`${FLUOR.sigtap} — ${FLUOR.name}`).filter((el) => el.tagName !== "BUTTON")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Salvar lista" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.putAuxiliaryProcedures)).toHaveBeenCalledWith([ FLUOR.sigtap, SCALING.sigtap ]));
  });

  it("remover tira o item da lista a salvar", async () => {
    renderWithProviders(<DentalAdmin />);
    await screen.findByText(`${FLUOR.sigtap} — ${FLUOR.name}`);
    fireEvent.click(screen.getByRole("button", { name: `Remover ${FLUOR.sigtap}` }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lista" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.putAuxiliaryProcedures)).toHaveBeenCalledWith([]));
  });

  it("sem unidade CEO, o caminho para cadastrar", async () => {
    mocked(api.listCeoProfiles).mockResolvedValue([]);
    renderWithProviders(<DentalAdmin />);
    expect(await screen.findByText("Nenhuma unidade CEO. Cadastre a unidade com o tipo CEO em Atendimento → Unidades.")).not.toBeNull();
  });
});
