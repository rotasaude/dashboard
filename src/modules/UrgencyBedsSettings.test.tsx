import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { UBS, UPA, urgencyUser } from "../test/urgencyFixtures";
import * as api from "../lib/api";
import { URGENCY_DISABLED, URGENCY_ERRORS } from "../lib/urgency";
import { BED_ADDED, BED_DEACTIVATED, BED_LABEL_TEXT, BED_REACTIVATED, URGENCY_BEDS_KEY } from "../lib/urgencyObservation";
import { UrgencyBedsSettings, URGENCY_BEDS_NO_ROLE } from "./UrgencyBedsSettings";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listActiveUnits: vi.fn(), listUrgencyBeds: vi.fn(),
  createUrgencyBed: vi.fn(), updateUrgencyBed: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const bed = (o: Partial<api.UrgencyBed> = {}): api.UrgencyBed => ({ id: "b1", health_unit_id: "upa1", label: "Obs 1", active: true, occupied: false, ...o });

function mount(user = urgencyUser([ "municipal_admin" ]), units: unknown[] = [ UPA, UBS ], onGoToSecurity = () => undefined) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.listActiveUnits).mockResolvedValue(units as never);
  vi.mocked(api.listUrgencyBeds).mockResolvedValue([ bed(), bed({ id: "b2", label: "Obs 2", active: false }) ]);
  return renderWithProviders(<UrgencyBedsSettings onGoToSecurity={onGoToSecurity} />);
}
const confirmStepUp = async () => fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
async function chooseUpa() {
  fireEvent.change(await screen.findByLabelText("UPA"), { target: { value: "upa1" } });
  await screen.findByText("Obs 1");
}

describe("leitos de observação (F-32.7)", () => {
  it("só UPAs na escolha; adicionar passa pelo step-up e relê", async () => {
    vi.mocked(api.createUrgencyBed).mockResolvedValue(bed({ id: "b3", label: "Obs 3" }));
    const { client } = mount();
    const select = await screen.findByLabelText("UPA");
    expect(within(select).queryByRole("option", { name: "UBS Centro" })).toBeNull();
    fireEvent.change(select, { target: { value: "upa1" } });
    fireEvent.change(await screen.findByLabelText("Rótulo do leito"), { target: { value: "Obs 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar leito" }));
    await confirmStepUp();
    await waitFor(() => expect(vi.mocked(api.createUrgencyBed).mock.calls[0]).toEqual([ { health_unit_id: "upa1", label: "Obs 3", active: true } ]));
    expect(await screen.findByText(BED_ADDED)).not.toBeNull();
    await waitFor(() => expect(vi.mocked(api.listUrgencyBeds).mock.calls.length).toBe(2));
    expect(client.getQueryCache().findAll({ queryKey: [ URGENCY_BEDS_KEY ] }).map((q) => q.queryKey)).toEqual([ [ URGENCY_BEDS_KEY, "admin", "upa1" ] ]);
  });
  it("sem UPA ativa, diz que não há", async () => {
    mount(undefined, [ UBS ]);
    expect(await screen.findByText("nenhuma UPA ativa")).not.toBeNull();
  });
  it("rótulo de 21 caracteres não sai", async () => {
    mount();
    await chooseUpa();
    fireEvent.change(screen.getByLabelText("Rótulo do leito"), { target: { value: "x".repeat(21) } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar leito" }));
    expect(screen.getByText(BED_LABEL_TEXT)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.createUrgencyBed).not.toHaveBeenCalled();
  });
  it("409 bed_label_taken mostra a frase dentro da confirmação", async () => {
    vi.mocked(api.createUrgencyBed).mockRejectedValue(new api.ApiError(409, { error: "bed_label_taken", path: "label" }, "409"));
    mount();
    await chooseUpa();
    fireEvent.change(screen.getByLabelText("Rótulo do leito"), { target: { value: "Obs 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar leito" }));
    await confirmStepUp();
    expect(await screen.findByText("já existe um leito com este rótulo nesta UPA")).not.toBeNull();
    expect(URGENCY_ERRORS.bed_label_taken).toBe("já existe um leito com este rótulo nesta UPA");
  });
  it("desativar um leito ocupado (409 bed_occupied) mostra a frase", async () => {
    vi.mocked(api.updateUrgencyBed).mockRejectedValue(new api.ApiError(409, { error: "bed_occupied", path: "active" }, "409"));
    mount();
    await chooseUpa();
    const row = screen.getByText("Obs 1").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Desativar" }));
    await confirmStepUp();
    expect(await screen.findByText("este leito está ocupado — encerre a observação ou troque o paciente de leito antes")).not.toBeNull();
  });
  it("desativa e reativa com o corpo {active} e avisa", async () => {
    vi.mocked(api.updateUrgencyBed).mockResolvedValue(bed());
    mount();
    await chooseUpa();
    const r1 = screen.getByText("Obs 1").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(r1).getByRole("button", { name: "Desativar" }));
    await confirmStepUp();
    expect(await screen.findByText(BED_DEACTIVATED)).not.toBeNull();
    expect(vi.mocked(api.updateUrgencyBed).mock.calls[0]).toEqual([ "b1", { active: false } ]);
    const r2 = screen.getByText("Obs 2").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(r2).getByRole("button", { name: "Reativar" }));
    await confirmStepUp();
    expect(await screen.findByText(BED_REACTIVATED)).not.toBeNull();
    expect(vi.mocked(api.updateUrgencyBed).mock.calls[1]).toEqual([ "b2", { active: true } ]);
  });
  it("reativar com a UPA desativada (422 not_an_upa) não vira 'null'", async () => {
    vi.mocked(api.updateUrgencyBed).mockRejectedValue(new api.ApiError(422, { error: "not_an_upa", path: "active" }, "422"));
    mount();
    await chooseUpa();
    const r2 = screen.getByText("Obs 2").closest("[role=row]") as HTMLElement;
    fireEvent.click(within(r2).getByRole("button", { name: "Reativar" }));
    await confirmStepUp();
    const alertBox = await screen.findAllByRole("alert");
    expect(alertBox.some((a) => a.textContent && !a.textContent.includes("null") && a.textContent.length > 5)).toBe(true);
  });
  it("sem urgency_care ou sem admin, o portão", async () => {
    mount(urgencyUser([ "municipal_admin" ], [ "clinical_record" ]));
    expect(await screen.findByText(URGENCY_DISABLED)).not.toBeNull();
    cleanup();
    mount(urgencyUser([ "health_professional" ]));
    expect(await screen.findByText(URGENCY_BEDS_NO_ROLE)).not.toBeNull();
    expect(api.listUrgencyBeds).not.toHaveBeenCalled();
  });
});
