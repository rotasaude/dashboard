import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as api from "../../lib/api";
import { renderWithProviders } from "../../test/campaignFixtures";
import { ScheduleOutcome } from "./ScheduleOutcome";
import { ProviderForm } from "./ProviderForm";
import { regRequest, regUser } from "../../test/regulationFixtures";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listCareProviders: vi.fn(),
  scheduleRegulationRequest: vi.fn(), createCareProvider: vi.fn(), updateCareProvider: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const PROVIDERS = [
  { id: "cp1", name: "Hospital de Olhos", cnes: "1234567", kind: "contracted", health_unit: null, active: true, ibge_code: "4106902" },
  { id: "cp0", name: "UBS Centro", cnes: null, kind: "own", health_unit: { id: "u1", name: "UBS Centro" }, active: true, ibge_code: null },
  { id: "cp2", name: "Clínica Inativa", cnes: "7654321", kind: "contracted", health_unit: null, active: false, ibge_code: null } ];

function authorized() {
  return regRequest({ status: "authorized", authorization: { offer_id: "o1", provider: { id: "cp1", name: "Hospital de Olhos", kind: "contracted" },
    month: "2026-11", skip_reason: null, at: "2026-11-01T10:00:00-03:00", by: { name: "Reg" } } });
}
function setup() {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(regUser());
  vi.mocked(api.listCareProviders).mockResolvedValue(PROVIDERS as never);
}

describe("agendamento externo com prestador (módulo 30, D13)", () => {
  it("o prestador cadastrado vai no corpo; só ativos e não próprios; o local é preenchido", async () => {
    setup();
    const req = authorized();
    vi.mocked(api.scheduleRegulationRequest).mockResolvedValue({ ...req, status: "scheduled" });
    renderWithProviders(<ScheduleOutcome request={req} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    const select = (await screen.findByLabelText("Prestador cadastrado")) as HTMLSelectElement;
    await waitFor(() => expect([ ...select.options ].map((o) => o.textContent)).toEqual([ "Nenhum (só o local)", "Hospital de Olhos" ]));
    fireEvent.change(select, { target: { value: "cp1" } });
    expect((screen.getByLabelText("Local") as HTMLInputElement).value).toBe("Hospital de Olhos");
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-20T08:00" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "Rua XV, 100" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(vi.mocked(api.scheduleRegulationRequest).mock.calls[0][1]).toMatchObject({ care_provider_id: "cp1", place: "Rua XV, 100" }));
  });

  it("sem escolher prestador, o corpo não leva care_provider_id", async () => {
    setup();
    const req = authorized();
    vi.mocked(api.scheduleRegulationRequest).mockResolvedValue({ ...req, status: "scheduled" });
    renderWithProviders(<ScheduleOutcome request={req} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    await screen.findByLabelText("Prestador cadastrado");
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-20T08:00" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "Rua XV, 100" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(api.scheduleRegulationRequest).toHaveBeenCalled());
    expect(vi.mocked(api.scheduleRegulationRequest).mock.calls[0][1]).not.toHaveProperty("care_provider_id");
  });

  it("remarcar reenvia o prestador atual (o api troca o agendamento inteiro)", async () => {
    setup();
    const req = regRequest({ status: "scheduled", authorization: authorized().authorization,
      schedule: { at: "2026-11-20T08:00:00-03:00", place: "Rua XV, 100", notes: null, care_provider: { id: "cp1", name: "Hospital de Olhos" } } });
    vi.mocked(api.scheduleRegulationRequest).mockResolvedValue(req);
    renderWithProviders(<ScheduleOutcome request={req} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remarcar" }));
    const select = (await screen.findByLabelText("Prestador cadastrado")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cp1"));
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-25T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(vi.mocked(api.scheduleRegulationRequest).mock.calls[0][1]).toMatchObject({ care_provider_id: "cp1", place: "Rua XV, 100" }));
  });

  it("remarcar com prestador que deixou de ser elegível ainda o reenvia", async () => {
    setup();
    const req = regRequest({ status: "scheduled", authorization: authorized().authorization,
      schedule: { at: "2026-11-20T08:00:00-03:00", place: "Clínica", notes: null, care_provider: { id: "cp2", name: "Clínica Inativa" } } });
    vi.mocked(api.scheduleRegulationRequest).mockResolvedValue(req);
    renderWithProviders(<ScheduleOutcome request={req} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remarcar" }));
    const select = (await screen.findByLabelText("Prestador cadastrado")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cp2"));
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-25T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(vi.mocked(api.scheduleRegulationRequest).mock.calls[0][1]).toMatchObject({ care_provider_id: "cp2" }));
  });

  it("prestador externo: IBGE com 7 dígitos ou vazio", async () => {
    setup();
    renderWithProviders(<ProviderForm provider={null} units={[]} onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "contracted" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Hospital X" } });
    fireEvent.change(screen.getByLabelText("CNES"), { target: { value: "1234567" } });
    fireEvent.change(await screen.findByLabelText("Município (código IBGE)"), { target: { value: "41069" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.getByText("o código IBGE do município tem 7 dígitos")).not.toBeNull();
    expect(api.createCareProvider).not.toHaveBeenCalled();
  });

  it("prestador da rede própria não tem o campo de município", () => {
    setup();
    renderWithProviders(<ProviderForm provider={null} units={[]} onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "own" } });
    expect(screen.queryByLabelText("Município (código IBGE)")).toBeNull();
  });
});
