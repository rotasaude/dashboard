import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAR, DEST_CURITIBA, DEST_NEAR, DRIVER_B, DRIVER_D, DRIVER_EXPIRED, DRIVER_EXPIRING, TODAY30, VAN, trip, trUser } from "../test/transportFixtures";
import { TransportTrips } from "./TransportTrips";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listTrips: vi.fn(), createTrip: vi.fn(),
  updateTrip: vi.fn(), confirmTrip: vi.fn(), cancelTrip: vi.fn(), listVehicles: vi.fn(), listDrivers: vi.fn(), listDestinations: vi.fn(),
  findScheduledCare: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(trips = [ trip({ status: "planned", vehicle: null, driver: null }) ]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser());
  vi.mocked(api.listTrips).mockResolvedValue(trips);
  vi.mocked(api.listVehicles).mockResolvedValue([ VAN, CAR ]);
  vi.mocked(api.listDrivers).mockResolvedValue([ DRIVER_D, DRIVER_B, DRIVER_EXPIRED, DRIVER_EXPIRING ]);
  vi.mocked(api.listDestinations).mockResolvedValue([ DEST_CURITIBA, DEST_NEAR ]);
  return renderWithProviders(<TransportTrips today={TODAY30} />);
}

const refusal = (...problems: { path: string; error: string }[]) => new ApiError(422, { error: problems[0].error, problems }, "422");

describe("viagens do dia", () => {
  it("lê o dia de hoje; trocar a data relê", async () => {
    mount();
    expect(await screen.findByText("planejada")).not.toBeNull();
    expect(api.listTrips).toHaveBeenCalledWith({ date: TODAY30, vehicleId: null });
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "2026-11-04" } });
    fireEvent.submit(screen.getByRole("form", { name: "Escolher o dia" }));
    await waitFor(() => expect(api.listTrips).toHaveBeenLastCalledWith({ date: "2026-11-04", vehicleId: null }));
  });

  it("nova viagem pelo teclado: Enter envia; motorista vencido aparece marcado", async () => {
    vi.mocked(api.createTrip).mockResolvedValue(trip({ id: "tr2", status: "planned" }));
    mount([]);
    fireEvent.click(await screen.findByRole("button", { name: "Nova viagem" }));
    const form = screen.getByRole("form", { name: "Viagem" });
    const driver = within(form).getByLabelText("Motorista") as HTMLSelectElement;
    await waitFor(() => expect([ ...driver.options ].map((o) => o.textContent)).toContain("Pedro Vencido (CNH vencida)"));
    expect([ ...driver.options ].find((o) => o.textContent === "Pedro Vencido (CNH vencida)")?.disabled).toBe(true);
    expect([ ...driver.options ].map((o) => o.textContent)).toContain("Rita Avencer (CNH vence em 20/11/2026)");
    fireEvent.change(within(form).getByLabelText("Saída"), { target: { value: "05:30" } });
    fireEvent.change(within(form).getByLabelText("Retorno"), { target: { value: "18:00" } });
    fireEvent.change(within(form).getByLabelText("Embarque 1"), { target: { value: "Praça da Matriz" } });
    fireEvent.change(within(form).getByLabelText("Destino 1"), { target: { value: "t1" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.createTrip).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createTrip).mock.calls[0][0];
    expect(body.departure_at).toBe("2026-11-03T05:30:00-03:00");
    expect(body.date).toBe(TODAY30);
    expect("vehicle_id" in body).toBe(false);
    expect(body.stops).toEqual([ { position: 1, kind: "boarding", label: "Praça da Matriz" }, { position: 2, kind: "destination", destination_id: "t1", label: "" } ]);
    const done = await screen.findByText("Viagem criada.");
    await waitFor(() => expect(document.activeElement).toBe(done));
    expect(api.listTrips).toHaveBeenCalledTimes(2);
  });

  it("formulário incompleto não envia e diz cada problema", async () => {
    mount([]);
    fireEvent.click(await screen.findByRole("button", { name: "Nova viagem" }));
    fireEvent.submit(screen.getByRole("form", { name: "Viagem" }));
    expect(await screen.findByText("informe a hora de saída")).not.toBeNull();
    expect(screen.getByText("cada ponto de embarque tem de 3 a 120 caracteres")).not.toBeNull();
    expect(screen.getByText("escolha ao menos um destino")).not.toBeNull();
    expect(api.createTrip).not.toHaveBeenCalled();
  });

  it("confirmar com motorista B na van recusa antes de enviar", async () => {
    mount([ trip({ status: "planned", driver: { id: "d2", name: "Ana Condutora" } }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar viagem" }));
    expect(await screen.findByText("veículo com mais de 8 lugares exige CNH D ou E")).not.toBeNull();
    expect(api.confirmTrip).not.toHaveBeenCalled();
  });

  it("confirmar: recusas do api todas de uma vez e a agenda é relida; sucesso avisa", async () => {
    vi.mocked(api.confirmTrip).mockRejectedValueOnce(refusal({ path: "driver_id", error: "driver_license_expired" }, { path: "vehicle_id", error: "seats_full" }));
    mount([ trip({ status: "planned" }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar viagem" }));
    expect(await screen.findByText("a CNH deste motorista está vencida na data da viagem")).not.toBeNull();
    expect(screen.getByText("a viagem está lotada")).not.toBeNull();
    await waitFor(() => expect(api.listTrips).toHaveBeenCalledTimes(2));
    vi.mocked(api.confirmTrip).mockResolvedValueOnce(trip({ status: "confirmed" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar viagem" }));
    expect(await screen.findByText("Viagem confirmada.")).not.toBeNull();
    expect(api.confirmTrip).toHaveBeenCalledWith("tr1");
  });

  it("resposta de confirmação que chega depois de trocar o dia é ignorada", async () => {
    let resolve: (t: ReturnType<typeof trip>) => void = () => {};
    vi.mocked(api.confirmTrip).mockReturnValue(new Promise((r) => { resolve = r; }));
    mount([ trip({ status: "planned" }) ]);
    const button = await screen.findByRole("button", { name: "Confirmar viagem" });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(api.listTrips).mockResolvedValue([]);
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "2026-11-04" } });
    fireEvent.submit(screen.getByRole("form", { name: "Escolher o dia" }));
    expect(await screen.findByText("nenhuma viagem neste dia")).not.toBeNull();
    resolve(trip({ status: "confirmed" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Viagem confirmada.")).toBeNull();
    expect(api.confirmTrip).toHaveBeenCalledTimes(1);
  });

  it("sobreposição de veículo e motorista ao salvar: as duas frases, nada muda, agenda relida (Review Focus 2)", async () => {
    vi.mocked(api.updateTrip).mockRejectedValue(refusal({ path: "vehicle_id", error: "vehicle_overlap" }, { path: "driver_id", error: "driver_overlap" }));
    mount([ trip({ status: "planned" }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const form = screen.getByRole("form", { name: "Viagem" });
    fireEvent.change(within(form).getByLabelText("Saída"), { target: { value: "06:00" } });
    fireEvent.submit(form);
    expect(await screen.findByText("o veículo já está em outra viagem nesse horário")).not.toBeNull();
    expect(screen.getByText("o motorista já está em outra viagem nesse horário")).not.toBeNull();
    expect(screen.getByText("planejada")).not.toBeNull();
    await waitFor(() => expect(api.listTrips).toHaveBeenCalledTimes(2));
    expect(api.updateTrip).toHaveBeenCalledTimes(1);
    const still = screen.getByRole("form", { name: "Viagem" });
    expect((within(still).getByLabelText("Saída") as HTMLInputElement).value).toBe("06:00");
    expect((within(still).getByLabelText("Veículo") as HTMLSelectElement).value).toBe("v1");
  });

  it("editar: tirar o veículo manda null, renomear embarque mantém a parada", async () => {
    vi.mocked(api.updateTrip).mockResolvedValue(trip({ status: "planned", vehicle: null }));
    mount([ trip({ status: "planned" }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const form = screen.getByRole("form", { name: "Viagem" });
    fireEvent.change(within(form).getByLabelText("Veículo"), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText("Embarque 1"), { target: { value: "Praça Central" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.updateTrip).toHaveBeenCalledTimes(1));
    const [ id, body ] = vi.mocked(api.updateTrip).mock.calls[0];
    expect(id).toBe("tr1");
    expect(body.vehicle_id).toBeNull();
    expect(body.driver_id).toBe("d1");
    expect(body.stops).toEqual([ { id: "s1", position: 1, kind: "boarding", label: "Praça Central" }, { id: "s2", position: 2, kind: "destination", destination_id: "t1", label: "" } ]);
    expect(await screen.findByText("Viagem atualizada.")).not.toBeNull();
  });

  it("trocar o dia de viagem com série ou TFD: a frase aparece no campo do dia", async () => {
    vi.mocked(api.updateTrip).mockRejectedValue(refusal({ path: "date", error: "trip_day_locked" }));
    mount([ trip({ status: "confirmed" }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const form = screen.getByRole("form", { name: "Viagem" });
    fireEvent.change(within(form).getByLabelText("Dia da viagem"), { target: { value: "2026-11-05" } });
    expect((within(form).getByLabelText("Data do retorno") as HTMLInputElement).value).toBe("2026-11-05");
    fireEvent.submit(form);
    await waitFor(() => expect(api.updateTrip).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTrip).mock.calls[0][1].date).toBe("2026-11-05");
    const msg = await screen.findByText("a viagem tem passageiro de série ou trecho de TFD — mude só o horário");
    expect((within(form).getByLabelText("Dia da viagem") as HTMLInputElement).getAttribute("aria-describedby")).toBe(msg.id);
  });

  it("parada com passageiro removida: stop_in_use aparece nas paradas", async () => {
    vi.mocked(api.updateTrip).mockRejectedValue(refusal({ path: "stops", error: "stop_in_use" }));
    mount([ trip({ status: "planned" }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const form = screen.getByRole("form", { name: "Viagem" });
    fireEvent.click(within(form).getByRole("button", { name: "Adicionar embarque" }));
    fireEvent.change(within(form).getByLabelText("Embarque 2"), { target: { value: "Posto do Bairro Alto" } });
    fireEvent.click(within(form).getByRole("button", { name: "Remover embarque 1" }));
    fireEvent.submit(form);
    await waitFor(() => expect(api.updateTrip).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTrip).mock.calls[0][1].stops?.[0]).toEqual({ position: 1, kind: "boarding", label: "Posto do Bairro Alto" });
    expect(await screen.findByText("esta parada tem passageiro — mude o passageiro de parada antes")).not.toBeNull();
  });

  it("cancelar pede motivo e avisa que os passageiros serão avisados", async () => {
    vi.mocked(api.cancelTrip).mockResolvedValue(trip({ status: "cancelled" }));
    mount([ trip() ]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar viagem" }));
    expect(screen.getByText(/os passageiros recebem o aviso do cancelamento/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    expect(api.cancelTrip).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "veículo quebrado na garagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.cancelTrip).toHaveBeenCalledWith("tr1", "veículo quebrado na garagem"));
    expect(await screen.findByText("Viagem cancelada.")).not.toBeNull();
  });

  it("viagem planejada: cancelar diz que ninguém recebe aviso", async () => {
    mount([ trip({ status: "planned" }) ]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar viagem" }));
    expect(screen.getByText(/ainda não foi confirmada, os passageiros não recebem aviso/)).not.toBeNull();
  });

  it("cancelada, em andamento e situação nova: sem ações; código novo aparece cru", async () => {
    mount([ trip({ id: "a", status: "cancelled" }), trip({ id: "b", status: "in_progress", departure_at: "2026-11-03T07:00:00-03:00" }),
      trip({ id: "c", status: "parked", departure_at: "2026-11-03T08:00:00-03:00" }) ]);
    expect(await screen.findByText("cancelada")).not.toBeNull();
    expect(screen.getByText("em andamento")).not.toBeNull();
    expect(screen.getByText("parked")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar viagem" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar viagem" })).toBeNull();
  });

  it("cartão: título, veículo, motorista, lotação e paradas em ordem", async () => {
    mount([ trip({ status: "planned", departure_at: "2026-11-03T09:00:00-03:00" }), trip({ id: "tr0", status: "planned", vehicle: null, driver: null }) ]);
    const articles = await screen.findAllByRole("article");
    expect(articles.map((a) => a.getAttribute("aria-labelledby") && document.getElementById(a.getAttribute("aria-labelledby") as string)?.textContent))
      .toEqual([ "05:30 → 18:00 · Curitiba", "09:00 → 18:00 · Curitiba" ]);
    expect(within(articles[0]).getByText("sem veículo")).not.toBeNull();
    expect(within(articles[0]).getByText("sem motorista")).not.toBeNull();
    expect(within(articles[1]).getByText("ABC1D23 · Sprinter 415")).not.toBeNull();
    expect(within(articles[1]).getByText("João Motorista")).not.toBeNull();
    expect(within(articles[1]).getByText("1 de 15 lugares · 0 de 1 cadeira")).not.toBeNull();
    // Os passageiros entram no cartão (Task 9).
    expect(within(articles[1]).getByRole("region", { name: "Passageiros" })).not.toBeNull();
    expect(within(articles[1]).getByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByText("A lista não leva diagnóstico, procedimento nem especialidade.")).not.toBeNull();
  });
});
