import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { DEST_CURITIBA, TODAY30, series, trUser } from "../test/transportFixtures";
import { TransportSeries } from "./TransportSeries";
import { TransportPending } from "./TransportPending";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listSeries: vi.fn(), createSeries: vi.fn(),
  updateSeries: vi.fn(), suspendSeries: vi.fn(), listTransportPending: vi.fn(), listNoShows: vi.fn(), listDestinations: vi.fn(),
  lookupTransportPerson: vi.fn(), findTransportDuplicates: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(list = [ series() ]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser());
  vi.mocked(api.listSeries).mockResolvedValue(list);
  vi.mocked(api.listDestinations).mockResolvedValue([ DEST_CURITIBA ]);
}

async function pickPatient() {
  vi.mocked(api.lookupTransportPerson).mockResolvedValue({ patient_id: "pt2", citizen_id: null, display_name: "José", registration_id: null, has_cpf: true, cns_masked: null });
  fireEvent.click(await screen.findByRole("button", { name: "Nova série" }));
  fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "12345678909" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
  fireEvent.click(await screen.findByRole("button", { name: /José/ }));
  return screen.getByRole("form", { name: "Série recorrente" });
}

function fillValid(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText("Destino"), { target: { value: "t1" } });
  for (const d of [ "seg", "qua" ]) fireEvent.click(within(form).getByLabelText(d));
  fireEvent.change(within(form).getByLabelText("Horário do atendimento"), { target: { value: "07:00" } });
  fireEvent.change(within(form).getByLabelText("Horário de saída"), { target: { value: "05:30" } });
  fireEvent.change(within(form).getByLabelText("Horário de volta"), { target: { value: "12:00" } });
  fireEvent.change(within(form).getByLabelText("Embarque"), { target: { value: "Praça da Matriz" } });
  fireEvent.change(within(form).getByLabelText("Início"), { target: { value: "2026-11-09" } });
}

describe("séries recorrentes", () => {
  it("lista com dias e horários; suspender pede data e motivo e diz o que acontece", async () => {
    setup();
    vi.mocked(api.suspendSeries).mockResolvedValue(series({ status: "suspended", suspended_from: "2026-11-05" }));
    renderWithProviders(<TransportSeries today={TODAY30} />);
    expect(await screen.findByText("seg, qua, sex · atendimento 07:00 · saída 05:30")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Suspender a série de José Hemodiálise" }));
    expect(screen.getByText(/o paciente sai das viagens a partir desta data/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("A partir de"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "paciente transferido para outra clínica" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.suspendSeries).toHaveBeenCalledWith("se1", { from_on: "2026-11-05", reason: "paciente transferido para outra clínica" }));
  });

  it("suspensão futura (status active + suspended_from) aparece como suspensa a partir de; sem botão de retomar e com a frase da série nova", async () => {
    setup([ series({ status: "active", suspended_from: "2026-11-20" }), series({ id: "se2", patient: { id: "pt3", display_name: "Ana Radio" }, status: "suspended", suspended_from: "2026-10-30" }) ]);
    renderWithProviders(<TransportSeries today={TODAY30} />);
    expect(await screen.findAllByText("suspensa a partir de 20/11/2026")).toHaveLength(1);
    expect(screen.getByText("suspensa a partir de 30/10/2026")).not.toBeNull();
    expect(screen.getAllByText(/para retomar, crie uma série nova/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /retomar|reativar/i })).toBeNull();
    // Já suspensa hoje: nada a suspender de novo.
    expect(screen.queryByRole("button", { name: "Suspender a série de Ana Radio" })).toBeNull();
  });

  it("suspender com data passada ou motivo curto é recusado antes de enviar", async () => {
    setup();
    renderWithProviders(<TransportSeries today={TODAY30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspender a série de José Hemodiálise" }));
    fireEvent.change(screen.getByLabelText("A partir de"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "paciente transferido" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("a data não pode ser anterior a hoje")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("A partir de"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    expect(api.suspendSeries).not.toHaveBeenCalled();
  });

  it("nova série: dias e horários conferidos antes de enviar", async () => {
    setup([]);
    renderWithProviders(<TransportSeries today={TODAY30} />);
    const form = await pickPatient();
    fireEvent.change(within(form).getByLabelText("Horário do atendimento"), { target: { value: "07:00" } });
    fireEvent.change(within(form).getByLabelText("Horário de saída"), { target: { value: "08:00" } });
    fireEvent.submit(form);
    expect(screen.getByText("escolha ao menos um dia da semana")).not.toBeNull();
    expect(screen.getByText("a saída precisa ser antes do horário do atendimento")).not.toBeNull();
    expect(screen.getByText("informe o horário de retorno")).not.toBeNull();
    expect(screen.getByText("o ponto de embarque tem de 3 a 120 caracteres")).not.toBeNull();
    expect(api.createSeries).not.toHaveBeenCalled();
  });

  it("nova série válida envia return_time, boarding_label e dias ISO, e avisa que salvou", async () => {
    setup([]);
    vi.mocked(api.createSeries).mockResolvedValue(series());
    renderWithProviders(<TransportSeries today={TODAY30} />);
    const form = await pickPatient();
    fillValid(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.createSeries).toHaveBeenCalledTimes(1));
    expect(api.createSeries).toHaveBeenCalledWith({
      patient_id: "pt2", destination_id: "t1", provider_name: null, weekdays: [ 1, 3 ], appointment_time: "07:00", departure_time: "05:30",
      return_time: "12:00", boarding_label: "Praça da Matriz", starts_on: "2026-11-09", ends_on: null, wheelchair: false, companion: null
    });
    expect(await screen.findByText("Série salva.")).not.toBeNull();
  });

  it("recusas do api vão ao campo: return_before_departure em Horário de volta e companion_not_allowed no motivo do acompanhante", async () => {
    setup([]);
    vi.mocked(api.createSeries).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", problems: [ { path: "return_time", error: "return_before_departure" } ] }, "x"));
    renderWithProviders(<TransportSeries today={TODAY30} />);
    const form = await pickPatient();
    fillValid(form);
    fireEvent.click(within(form).getByLabelText("Com acompanhante"));
    fireEvent.change(within(form).getByLabelText("Nome do acompanhante"), { target: { value: "Carlos Silva" } });
    fireEvent.submit(form);
    const field = await within(form).findByLabelText("Horário de volta");
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    vi.mocked(api.createSeries).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", problems: [ { path: "companion", error: "companion_not_allowed" } ] }, "x"));
    fireEvent.submit(form);
    const reason = await within(form).findByLabelText("Motivo do acompanhante");
    await waitFor(() => expect(reason.getAttribute("aria-invalid")).toBe("true"));
  });

  it("editar manda o PATCH sem patient_id", async () => {
    setup();
    vi.mocked(api.updateSeries).mockResolvedValue(series());
    renderWithProviders(<TransportSeries today={TODAY30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar a série de José Hemodiálise" }));
    const form = screen.getByRole("form", { name: "Série recorrente" });
    fireEvent.change(within(form).getByLabelText("Embarque"), { target: { value: "Posto central" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.updateSeries).toHaveBeenCalledTimes(1));
    const [ id, body ] = vi.mocked(api.updateSeries).mock.calls[0];
    expect(id).toBe("se1");
    expect(body).not.toHaveProperty("patient_id");
    expect(body).toMatchObject({ boarding_label: "Posto central", weekdays: [ 1, 3, 5 ], return_time: "12:00", destination_id: "t1" });
  });
});

describe("pendências e faltas", () => {
  it("pendência mostra paciente pela série; faltas por período", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser());
    vi.mocked(api.listSeries).mockResolvedValue([ series() ]);
    vi.mocked(api.listTransportPending).mockResolvedValue([ { series_id: "se1", date: "2026-11-05", reason: "no_seat" } ]);
    vi.mocked(api.listNoShows).mockResolvedValue([ { patient: { id: "pt1", display_name: "Maria da Silva" }, count: 2, dates: [ "2026-10-20", "2026-10-27" ] } ]);
    renderWithProviders(<TransportPending today={TODAY30} />);
    expect(await screen.findByText("José Hemodiálise")).not.toBeNull();
    expect(screen.getByText("sem lugar em viagem confirmada")).not.toBeNull();
    expect(screen.getByText(/resolva em "Viagens do dia"/)).not.toBeNull();
    expect(api.listNoShows).toHaveBeenCalledWith({ from: "2026-10-04", to: TODAY30 });
    expect(await screen.findByText("20/10/2026, 27/10/2026")).not.toBeNull();
  });

  it("motivo refused tem frase própria; código desconhecido aparece cru; série fora da lista vira série <id>", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser());
    vi.mocked(api.listSeries).mockResolvedValue([ series() ]);
    vi.mocked(api.listTransportPending).mockResolvedValue([
      { series_id: "se1", date: "2026-11-05", reason: "refused" }, { series_id: "se9", date: "2026-11-06", reason: "novo_motivo" }
    ]);
    vi.mocked(api.listNoShows).mockResolvedValue([]);
    renderWithProviders(<TransportPending today={TODAY30} />);
    expect(await screen.findByText("a série não coube na viagem por outro motivo — ponha o paciente manualmente")).not.toBeNull();
    expect(screen.getByText("novo_motivo")).not.toBeNull();
    expect(screen.getByText("série se9")).not.toBeNull();
  });

  it("faltas: período maior que 365 dias ou invertido é recusado; período válido refaz a consulta", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser());
    vi.mocked(api.listSeries).mockResolvedValue([]);
    vi.mocked(api.listTransportPending).mockResolvedValue([]);
    vi.mocked(api.listNoShows).mockResolvedValue([]);
    renderWithProviders(<TransportPending today={TODAY30} />);
    await screen.findByText("Nenhuma falta no período.");
    const form = screen.getByRole("form", { name: "Período das faltas" });
    fireEvent.change(within(form).getByLabelText("De"), { target: { value: "2025-01-01" } });
    fireEvent.submit(form);
    expect(screen.getByText("o período tem de ter menos de 366 dias")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("De"), { target: { value: "2026-11-04" } });
    fireEvent.submit(form);
    expect(screen.getByText("o fim não pode ser antes do início")).not.toBeNull();
    expect(api.listNoShows).toHaveBeenCalledTimes(1);
    fireEvent.change(within(form).getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.listNoShows).toHaveBeenLastCalledWith({ from: "2026-09-01", to: TODAY30 }));
  });
});
