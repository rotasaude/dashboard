import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../lib/api";
import * as api from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { DEST_CURITIBA, DRIVER_D, DRIVER_EXPIRED, DRIVER_EXPIRING, TODAY30, VAN, trUser } from "../test/transportFixtures";
import { TransportFleet } from "./TransportFleet";
import { cnhAlertText } from "./transport/DriversPanel";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listVehicles: vi.fn(), createVehicle: vi.fn(),
  updateVehicle: vi.fn(), listDrivers: vi.fn(), listDriverCandidates: vi.fn(), createDriver: vi.fn(), updateDriver: vi.fn(), listDestinations: vi.fn(),
  createDestination: vi.fn(), updateDestination: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(roles?: string[]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser(roles));
  vi.mocked(api.listVehicles).mockResolvedValue([ VAN ]);
  vi.mocked(api.listDrivers).mockResolvedValue([ DRIVER_D, DRIVER_EXPIRED, DRIVER_EXPIRING ]);
  vi.mocked(api.listDriverCandidates).mockResolvedValue([ { user_id: "u-n", name: "Novo Motorista" } ]);
  vi.mocked(api.listDestinations).mockResolvedValue([ DEST_CURITIBA ]);
  return renderWithProviders(<TransportFleet today={TODAY30} />);
}

function fillDriver(form: HTMLElement, number = "01234567890") {
  fireEvent.change(within(form).getByLabelText("Pessoa"), { target: { value: "u-n" } });
  fireEvent.change(within(form).getByLabelText("Número da CNH"), { target: { value: number } });
  fireEvent.change(within(form).getByLabelText("Categoria"), { target: { value: "D" } });
  fireEvent.change(within(form).getByLabelText("Validade da CNH"), { target: { value: "2029-01-31" } });
}

function fillVehicle(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText("Placa"), { target: { value: "abc-1d23" } });
  fireEvent.change(within(form).getByLabelText("RENAVAM"), { target: { value: "12345678901" } });
  fireEvent.change(within(form).getByLabelText("Modelo"), { target: { value: "Sprinter" } });
  fireEvent.change(within(form).getByLabelText("Lugares para passageiros"), { target: { value: "15" } });
}

describe("frota, motoristas e destinos", () => {
  it("alerta de CNH no topo e na linha; texto, não só cor", async () => {
    mount();
    expect(await screen.findByText("1 motorista com CNH vencida · 1 vence em até 30 dias")).not.toBeNull();
    expect(screen.getByText("CNH vencida em 30/10/2026")).not.toBeNull();
    expect(screen.getByText("CNH vence em 20/11/2026")).not.toBeNull();
    // Só os 4 últimos dígitos da CNH aparecem (api-surface §3).
    expect(screen.getByText("final 4321")).not.toBeNull();
    expect(screen.getByText("final 1111")).not.toBeNull();
    expect(screen.getByText("final 2222")).not.toBeNull();
  });

  it("novo motorista: escolhe entre quem tem o papel; CNH só no corpo", async () => {
    vi.mocked(api.createDriver).mockResolvedValue({ ...DRIVER_D, id: "d9", user: { id: "u-n", name: "Novo Motorista" } });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo motorista" }));
    const form = await screen.findByRole("form", { name: "Motorista" });
    await within(form).findByRole("option", { name: "Novo Motorista" });
    fillDriver(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.createDriver).toHaveBeenCalledWith({ user_id: "u-n", license_number: "01234567890", license_category: "D", license_expires_on: "2029-01-31", active: true }));
    expect(await screen.findByText("Motorista cadastrado.")).not.toBeNull();
    expect(document.body.textContent).not.toContain("01234567890");
  });

  it("motorista já cadastrado (409 user_already_driver) aparece no campo Pessoa", async () => {
    vi.mocked(api.createDriver).mockRejectedValue(new ApiError(409, { error: "user_already_driver", path: "user_id" }, "409"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo motorista" }));
    const form = await screen.findByRole("form", { name: "Motorista" });
    await within(form).findByRole("option", { name: "Novo Motorista" });
    fillDriver(form);
    fireEvent.submit(form);
    const text = await screen.findByText("esta pessoa já está cadastrada como motorista");
    expect(within(form).getByLabelText("Pessoa").getAttribute("aria-invalid")).toBe("true");
    expect(within(form).getByLabelText("Pessoa").getAttribute("aria-describedby")).toBe(text.id);
  });

  it("editar motorista: CNH vazia não vai no corpo e user_id nunca vai", async () => {
    vi.mocked(api.updateDriver).mockResolvedValue({ ...DRIVER_D, active: false });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Editar motorista João Motorista" }));
    const form = await screen.findByRole("form", { name: "Motorista" });
    expect(within(form).getByText("deixe vazio para manter")).not.toBeNull();
    expect(within(form).queryByLabelText("Pessoa")).toBeNull();
    fireEvent.click(within(form).getByLabelText("Ativo"));
    fireEvent.submit(form);
    await waitFor(() => expect(api.updateDriver).toHaveBeenCalledWith("d1", { license_category: "D", license_expires_on: "2028-05-10", active: false }));
    expect(await screen.findByText("Motorista atualizado.")).not.toBeNull();
  });

  it("veículo: placa inválida e RENAVAM curto juntos; recusa do api (409 sem caminho) traduzida no campo", async () => {
    vi.mocked(api.createVehicle).mockRejectedValue(new ApiError(409, { error: "plate_taken" }, "409"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo veículo" }));
    const form = await screen.findByRole("form", { name: "Veículo" });
    fireEvent.change(within(form).getByLabelText("Placa"), { target: { value: "AB-12" } });
    fireEvent.change(within(form).getByLabelText("RENAVAM"), { target: { value: "123" } });
    fireEvent.submit(form);
    expect(screen.getByText("placa inválida — use o formato ABC1234 ou ABC1D23")).not.toBeNull();
    expect(screen.getByText("RENAVAM tem 11 dígitos")).not.toBeNull();
    expect(api.createVehicle).not.toHaveBeenCalled();
    fillVehicle(form);
    fireEvent.submit(form);
    const text = await screen.findByText("já existe um veículo com esta placa");
    expect(api.createVehicle).toHaveBeenCalledWith({ plate: "ABC1D23", renavam: "12345678901", model: "Sprinter", kind: "van", renem_code: null,
      seats: 15, wheelchair_spots: 0, cnes: null, active: true });
    expect(within(form).getByLabelText("Placa").getAttribute("aria-describedby")).toContain(text.id);
  });

  it("veículo salvo: frase de sucesso recebe o foco e a lista é relida", async () => {
    vi.mocked(api.createVehicle).mockResolvedValue(VAN);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo veículo" }));
    const form = await screen.findByRole("form", { name: "Veículo" });
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText("Placa")));
    fillVehicle(form);
    fireEvent.submit(form);
    const ok = await screen.findByText("Veículo salvo.");
    await waitFor(() => expect(document.activeElement).toBe(ok));
    await waitFor(() => expect(vi.mocked(api.listVehicles).mock.calls.length).toBe(2));
    expect(screen.queryByRole("form", { name: "Veículo" })).toBeNull();
  });

  it("destino: IBGE repetido (409) vai no campo; distância 0 = dentro do município", async () => {
    vi.mocked(api.createDestination).mockRejectedValue(new ApiError(409, { error: "ibge_taken" }, "409"));
    mount();
    expect(await screen.findByText("A distância é a rodoviária, cadastrada pela cidade; ela decide o TFD e o deslocamento no BPA.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Novo destino" }));
    const form = await screen.findByRole("form", { name: "Destino" });
    fireEvent.change(within(form).getByLabelText("Código IBGE"), { target: { value: "4106902" } });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Curitiba" } });
    fireEvent.change(within(form).getByLabelText("Distância em km a partir da sede"), { target: { value: "0" } });
    fireEvent.submit(form);
    expect(await screen.findByText("já existe um destino com este código IBGE")).not.toBeNull();
    expect(api.createDestination).toHaveBeenCalledWith({ ibge_code: "4106902", name: "Curitiba", distance_km: 0, metropolitan: false, active: true });
  });

  it("destino salvo: frase de sucesso", async () => {
    vi.mocked(api.updateDestination).mockResolvedValue(DEST_CURITIBA);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Editar destino Curitiba" }));
    fireEvent.submit(await screen.findByRole("form", { name: "Destino" }));
    await waitFor(() => expect(api.updateDestination).toHaveBeenCalledWith("t1", { ibge_code: "4106902", name: "Curitiba", distance_km: 110, metropolitan: false, active: true }));
    expect(await screen.findByText("Destino salvo.")).not.toBeNull();
  });

  it("sem papel de central, nada é lido", async () => {
    mount([ "driver" ]);
    expect(await screen.findByText("seu papel não permite usar o transporte sanitário")).not.toBeNull();
    expect(api.listVehicles).not.toHaveBeenCalled();
    expect(api.listDrivers).not.toHaveBeenCalled();
    expect(api.listDestinations).not.toHaveBeenCalled();
  });
});

describe("cnhAlertText", () => {
  it("plural, só vencendo, nulo quando tudo válido, e inativo não conta", () => {
    expect(cnhAlertText([ DRIVER_D ])).toBeNull();
    expect(cnhAlertText([ DRIVER_EXPIRED, { ...DRIVER_EXPIRED, id: "x" }, DRIVER_EXPIRING, { ...DRIVER_EXPIRING, id: "y" } ])).toBe("2 motoristas com CNH vencida · 2 vencem em até 30 dias");
    expect(cnhAlertText([ DRIVER_EXPIRING ])).toBe("1 motorista com CNH que vence em até 30 dias");
    expect(cnhAlertText([ { ...DRIVER_EXPIRED, active: false } ])).toBeNull();
  });
});
