import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY30, driverView, passenger, trip, trUser } from "../test/transportFixtures";
import { TransportMyTrips } from "./TransportMyTrips";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyTrips: vi.fn(), startMyTrip: vi.fn(),
  recordAttendance: vi.fn(), closeMyTrip: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// O api manda ao motorista o paciente sem `has_cpf` e sem `cns_masked` (driverView).
const twoPassengers = driverView(trip({ status: "in_progress", passengers: [
  passenger({ patient: { id: "pt1", display_name: "Maria da Silva", phone_masked: "(41) ****-1234" } }),
  passenger({ id: "p2", stop_id: "s1", patient: { id: "pt2", display_name: "Carlos Souza", phone_masked: null }, companion: { name: "Joana", document_last4: null }, companion_attendance: "pending" })
] }));

function mount(t: api.Trip = twoPassengers) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "driver" ]));
  vi.mocked(api.listMyTrips).mockResolvedValue([ t ]);
  return renderWithProviders(<TransportMyTrips today={TODAY30} />);
}

describe("tela do motorista (celular)", () => {
  it("cartões por parada, sem tabela; sem CNS nem dado clínico", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: /Praça da Matriz/ })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/\*\*\* \*\*\*\*/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Embarcou/ }).length).toBe(3);
    expect(api.listMyTrips).toHaveBeenCalledWith(TODAY30);
  });

  it("motorista sem cadastro na frota (403 missing_role): diz que falta o cadastro", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "driver" ]));
    vi.mocked(api.listMyTrips).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<TransportMyTrips today={TODAY30} />);
    expect(await screen.findByText("você ainda não está cadastrado como motorista na frota")).not.toBeNull();
  });

  it("sem viagem hoje: frase vazia", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "driver" ]));
    vi.mocked(api.listMyTrips).mockResolvedValue([]);
    renderWithProviders(<TransportMyTrips today={TODAY30} />);
    expect(await screen.findByText("nenhuma viagem sua hoje")).not.toBeNull();
  });

  it("iniciar só na viagem confirmada do dia", async () => {
    vi.mocked(api.startMyTrip).mockResolvedValue(driverView(trip({ status: "in_progress" })));
    mount(driverView(trip({ status: "confirmed" })));
    expect(screen.queryByRole("button", { name: /^Embarcou/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar viagem" }));
    await waitFor(() => expect(api.startMyTrip).toHaveBeenCalledWith("tr1"));
    expect(await screen.findByRole("button", { name: "Embarcou — Maria da Silva" })).not.toBeNull();
  });

  it("confirmada de outro dia não oferece iniciar", async () => {
    mount(driverView(trip({ status: "confirmed", date: "2026-11-04", departure_at: "2026-11-04T05:30:00-03:00", return_at: "2026-11-04T18:00:00-03:00" })));
    expect(await screen.findByText(/só começa no dia dela/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar viagem" })).toBeNull();
  });

  it("iniciar recusado pela CNH: a frase aparece", async () => {
    vi.mocked(api.startMyTrip).mockRejectedValue(new ApiError(422, { error: "driver_license_expired", path: "driver_id" }, "422"));
    mount(driverView(trip({ status: "confirmed" })));
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar viagem" }));
    expect(await screen.findByText("a CNH deste motorista está vencida na data da viagem")).not.toBeNull();
  });

  it("toque duplo grava uma vez; falha devolve a presença anterior na linha (Review Focus 1)", async () => {
    let fail!: (e: unknown) => void;
    vi.mocked(api.recordAttendance).mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));
    mount();
    const card = (await screen.findByText("Maria da Silva")).closest("section") as HTMLElement;
    const boarded = within(card).getByRole("button", { name: "Embarcou — Maria da Silva" });
    fireEvent.click(boarded);
    fireEvent.click(boarded);
    expect(api.recordAttendance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.recordAttendance).mock.calls[0][1]).toEqual([ { passenger_id: "p1", attendance: "boarded" } ]);
    // Enquanto corre: valor otimista e o par travado.
    expect(boarded.getAttribute("aria-pressed")).toBe("true");
    expect((within(card).getByRole("button", { name: "Faltou — Maria da Silva" }) as HTMLButtonElement).disabled).toBe(true);
    fail(new TypeError("network"));
    expect(await within(card).findByRole("alert")).not.toBeNull();
    expect(boarded.getAttribute("aria-pressed")).toBe("false");
    expect((boarded as HTMLButtonElement).disabled).toBe(false);
    const other = (screen.getByText("Carlos Souza").closest("section")) as HTMLElement;
    expect(within(other).queryByRole("alert")).toBeNull();
  });

  it("toque no acompanhante leva a presença atual do paciente; sucesso mostra o valor do api", async () => {
    vi.mocked(api.recordAttendance).mockResolvedValue(driverView(trip({ status: "in_progress", passengers: [
      twoPassengers.passengers[0], { ...twoPassengers.passengers[1], companion_attendance: "no_show" }
    ] })));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Faltou — acompanhante de Carlos Souza" }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledWith("tr1", [ { passenger_id: "p2", attendance: "pending", companion_attendance: "no_show" } ]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Faltou — acompanhante de Carlos Souza" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("fechar barrado com presença pendente; com tudo marcado, envia odômetro e abastecimento", async () => {
    vi.mocked(api.closeMyTrip).mockResolvedValue(driverView(trip({ status: "done" })));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Fechar viagem" }));
    const form = screen.getByRole("form", { name: "Fechamento da viagem" });
    fireEvent.change(within(form).getByLabelText("Odômetro na saída"), { target: { value: "1000" } });
    fireEvent.change(within(form).getByLabelText("Odômetro na chegada"), { target: { value: "1220" } });
    fireEvent.submit(form);
    expect(screen.getByText("marque embarcou ou faltou para todos, inclusive acompanhantes")).not.toBeNull();
    expect(api.closeMyTrip).not.toHaveBeenCalled();
    cleanup();
    mount(driverView(trip({ status: "in_progress", passengers: [ passenger({ attendance: "no_show" }) ] })));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar viagem" }));
    const f2 = screen.getByRole("form", { name: "Fechamento da viagem" });
    fireEvent.change(within(f2).getByLabelText("Odômetro na saída"), { target: { value: "1000" } });
    fireEvent.change(within(f2).getByLabelText("Odômetro na chegada"), { target: { value: "1220" } });
    fireEvent.click(within(f2).getByRole("button", { name: "Adicionar abastecimento" }));
    fireEvent.change(within(f2).getByLabelText("Litros 1"), { target: { value: "40,5" } });
    fireEvent.change(within(f2).getByLabelText("Valor 1"), { target: { value: "250,00" } });
    fireEvent.change(within(f2).getByLabelText("Posto 1"), { target: { value: "Posto Central" } });
    const reads = vi.mocked(api.listMyTrips).mock.calls.length;
    fireEvent.submit(f2);
    fireEvent.submit(f2);
    // closeBody (Task 2) omite `expenses` sem linhas.
    await waitFor(() => expect(api.closeMyTrip).toHaveBeenCalledWith("tr1", { odometer_start: 1000, odometer_end: 1220,
      fuel: [ { liters: 40.5, amount_cents: 25000, station: "Posto Central" } ] }));
    expect(api.closeMyTrip).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Viagem fechada.")).not.toBeNull();
    await waitFor(() => expect(vi.mocked(api.listMyTrips).mock.calls.length).toBe(reads + 1));
  });

  it("despesa: tipo, valor e observação vão no corpo", async () => {
    vi.mocked(api.closeMyTrip).mockResolvedValue(driverView(trip({ status: "done" })));
    mount(driverView(trip({ status: "in_progress", passengers: [ passenger({ attendance: "boarded" }) ] })));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar viagem" }));
    const form = screen.getByRole("form", { name: "Fechamento da viagem" });
    fireEvent.change(within(form).getByLabelText("Odômetro na saída"), { target: { value: "10" } });
    fireEvent.change(within(form).getByLabelText("Odômetro na chegada"), { target: { value: "20" } });
    fireEvent.click(within(form).getByRole("button", { name: "Adicionar despesa" }));
    fireEvent.change(within(form).getByLabelText("Tipo da despesa 1"), { target: { value: "toll" } });
    fireEvent.change(within(form).getByLabelText("Valor da despesa 1"), { target: { value: "1.234,56" } });
    fireEvent.change(within(form).getByLabelText("Observação da despesa 1"), { target: { value: "praça BR-277" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.closeMyTrip).toHaveBeenCalledWith("tr1", { odometer_start: 10, odometer_end: 20,
      expenses: [ { kind: "toll", amount_cents: 123456, note: "praça BR-277" } ] }));
  });

  it("odômetro de chegada menor: recusa na tela sem enviar", async () => {
    mount(driverView(trip({ status: "in_progress", passengers: [ passenger({ attendance: "boarded" }) ] })));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar viagem" }));
    const form = screen.getByRole("form", { name: "Fechamento da viagem" });
    fireEvent.change(within(form).getByLabelText("Odômetro na saída"), { target: { value: "500" } });
    fireEvent.change(within(form).getByLabelText("Odômetro na chegada"), { target: { value: "400" } });
    fireEvent.submit(form);
    expect(screen.getByText("o odômetro de chegada é menor que o de saída")).not.toBeNull();
    expect(api.closeMyTrip).not.toHaveBeenCalled();
  });

  it("recusa attendance_pending do api também aparece", async () => {
    vi.mocked(api.closeMyTrip).mockRejectedValue(new ApiError(422, { error: "attendance_pending" }, "422"));
    mount(driverView(trip({ status: "in_progress", passengers: [ passenger({ attendance: "boarded" }) ] })));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar viagem" }));
    const form = screen.getByRole("form", { name: "Fechamento da viagem" });
    fireEvent.change(within(form).getByLabelText("Odômetro na saída"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText("Odômetro na chegada"), { target: { value: "2" } });
    fireEvent.submit(form);
    expect(await screen.findByText("marque embarcou ou faltou para todos, inclusive acompanhantes")).not.toBeNull();
  });

  it("viagem concluída: resumo do fechamento, sem botões", async () => {
    mount(driverView(trip({ status: "done", passengers: [ passenger({ attendance: "boarded" }) ], log: {
      odometer_start: 1000, odometer_end: 1220, fuel: [ { liters: 40.5, amount_cents: 25000, station: "Posto Central" } ],
      expenses: [ { kind: "parking", amount_cents: 1500, note: null } ], closed_at: "2026-11-03T18:10:00-03:00", closed_by_name: "João Motorista" } })));
    expect(await screen.findByText(/220 km/)).not.toBeNull();
    expect(screen.getByText(/Posto Central/)).not.toBeNull();
    expect(screen.getByText(/estacionamento/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Embarcou|Faltou|Fechar viagem|Iniciar viagem/ })).toBeNull();
  });
});
