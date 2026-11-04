// Montar a viagem (módulo 30, F-30.2). Formas do api (api-surface §8): `companion_not_allowed` vem com path `companion`;
// `removePassenger` devolve a viagem; a agenda do 17 só vem com `health_unit_id` (destino nulo).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { renderWithProviders } from "../../test/campaignFixtures";
import { passenger, trip, trUser } from "../../test/transportFixtures";
import { PassengerList } from "./PassengerList";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), findScheduledCare: vi.fn(),
  addPassenger: vi.fn(), removePassenger: vi.fn(), fetchTripManifest: vi.fn(), lookupTransportPerson: vi.fn(), findTransportDuplicates: vi.fn(),
  listActiveUnits: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const SUGGESTION = { patient: { id: "pt7", display_name: "Carlos Souza", has_cpf: true, cns_masked: null, phone_masked: null }, origin: "regulation",
  origin_id: "rr7", appointment_at: "2026-11-03T10:00:00-03:00", destination: { destination_id: "t1", provider_name: "Hospital Regional", address: "Rua XV, 100" } };
const TWO_DESTINATIONS = [ { id: "s1", position: 1, kind: "boarding", destination_id: null, label: "Praça da Matriz" },
  { id: "s2", position: 2, kind: "destination", destination_id: "t1", label: "Curitiba" },
  { id: "s3", position: 3, kind: "destination", destination_id: "t2", label: "Ponta Grossa" } ];

function mount(t = trip(), roles?: string[], onChanged: (text: string) => void = () => {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser(roles));
  return renderWithProviders(<PassengerList trip={t} onChanged={onChanged} />);
}

async function pickSuggestion(item: unknown = SUGGESTION) {
  vi.mocked(api.findScheduledCare).mockResolvedValue([ item ] as never);
  fireEvent.click(await screen.findByRole("button", { name: "Buscar atendimentos marcados na data" }));
  fireEvent.click(await screen.findByRole("button", { name: "Pôr Carlos Souza na viagem" }));
  return screen.getByRole("form", { name: "Passageiro" });
}

describe("passageiros da viagem", () => {
  it("a lista não mostra dado clínico; mostra origem pelo rótulo", async () => {
    // Campo clínico que o api nunca manda: se viesse, a tela não o mostraria (só os campos de <passenger>).
    const leaky = { ...passenger({ origin: "tfd" }), cid10: "H25.1", sigtap_name: "FACOEMULSIFICACAO", justification: "oftalmo cirúrgica" } as never;
    mount(trip({ passengers: [ leaky ] }));
    expect(await screen.findByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByText("TFD")).not.toBeNull();
    expect(screen.queryByText(/H25|FACOEMULSIFICACAO|oftalmo/i)).toBeNull();
  });

  it("atendimentos marcados na data viram passageiro com a origem; CPF nunca na URL", async () => {
    vi.mocked(api.addPassenger).mockResolvedValue(passenger({ id: "p7", patient: { ...SUGGESTION.patient } }));
    const onChanged = vi.fn();
    mount(trip(), undefined, onChanged);
    const form = await pickSuggestion();
    expect(api.findScheduledCare).toHaveBeenCalledWith({ date: "2026-11-03", destinationId: null, healthUnitId: null });
    fireEvent.submit(form);
    await waitFor(() => expect(vi.mocked(api.addPassenger).mock.calls[0][1]).toEqual({ patient_id: "pt7", origin: "regulation", origin_id: "rr7",
      destination_id: "t1", stop_id: "s1", provider_name: "Hospital Regional", address: "Rua XV, 100", appointment_at: "2026-11-03T10:00:00-03:00",
      takes_seat: true, wheelchair: false }));
    expect(await screen.findByText("Passageiro incluído.")).not.toBeNull();
    expect(onChanged).toHaveBeenCalledWith("Passageiro incluído.");
    expect(screen.queryByRole("form", { name: "Passageiro" })).toBeNull();
  });

  it("quem já está na viagem aparece sem botão", async () => {
    vi.mocked(api.findScheduledCare).mockResolvedValue([ { ...SUGGESTION, patient: { ...SUGGESTION.patient, id: "pt1", display_name: "Maria da Silva" } } ] as never);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Buscar atendimentos marcados na data" }));
    expect(await screen.findByText("já nesta viagem")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Pôr Maria da Silva na viagem" })).toBeNull();
  });

  it("agenda da unidade: manda health_unit_id; sem destino na sugestão, a central escolhe", async () => {
    vi.mocked(api.listActiveUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", kind: "ubs" } ]);
    const item = { ...SUGGESTION, origin: "appointment", origin_id: "ap7", destination: { destination_id: null, provider_name: "UBS Centro", address: "Rua A, 1" } };
    mount(trip({ stops: TWO_DESTINATIONS as never }), [ "transport_dispatcher", "municipal_admin" ]);
    fireEvent.change(await screen.findByLabelText("Unidade (agenda da cidade)"), { target: { value: "u1" } });
    const form = await pickSuggestion(item);
    expect(api.findScheduledCare).toHaveBeenCalledWith({ date: "2026-11-03", destinationId: null, healthUnitId: "u1" });
    expect((within(form).getByLabelText("Destino") as HTMLSelectElement).value).toBe("");
    fireEvent.submit(form);
    expect(screen.getByText("escolha o destino")).not.toBeNull();
    expect(api.addPassenger).not.toHaveBeenCalled();
  });

  it("sem papel que leia as unidades: nenhuma busca de unidade", async () => {
    mount();
    await screen.findByRole("button", { name: "Buscar atendimentos marcados na data" });
    expect(screen.queryByLabelText("Unidade (agenda da cidade)")).toBeNull();
    expect(api.listActiveUnits).not.toHaveBeenCalled();
  });

  it("sem atendimento: busca por CPF e exige o motivo", async () => {
    vi.mocked(api.lookupTransportPerson).mockResolvedValue({ patient_id: "pt9", citizen_id: null, display_name: "Lúcia Lima", registration_id: null, has_cpf: true, cns_masked: null });
    vi.mocked(api.addPassenger).mockResolvedValue(passenger({ id: "p9" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Passageiro sem atendimento marcado" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: /Lúcia Lima/ }));
    expect(api.lookupTransportPerson).toHaveBeenCalledWith("12345678909");
    const form = screen.getByRole("form", { name: "Passageiro" });
    fireEvent.submit(form);
    expect(screen.getByText("informe por que o passageiro vai sem atendimento marcado")).not.toBeNull();
    expect(api.addPassenger).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Motivo da viagem sem atendimento"), { target: { value: "other" } });
    fireEvent.change(within(form).getByLabelText("Descreva o motivo"), { target: { value: "levar exame ao hospital" } });
    fireEvent.submit(form);
    await waitFor(() => expect(vi.mocked(api.addPassenger).mock.calls[0][1]).toEqual({ patient_id: "pt9", origin: "exception",
      exception_reason: "other", exception_note: "levar exame ao hospital", stop_id: "s1", destination_id: "t1", takes_seat: true, wheelchair: false }));
  });

  it("pessoa sem cadastro: a central manda cadastrar no balcão", async () => {
    vi.mocked(api.lookupTransportPerson).mockRejectedValue(new ApiError(404, { error: "person_not_found" }, "404"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Passageiro sem atendimento marcado" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    expect(screen.getByText("esta pessoa não tem cadastro — cadastre no balcão de atendimento antes de pôr na viagem")).not.toBeNull();
    expect(screen.queryByRole("form", { name: "Passageiro" })).toBeNull();
  });

  it("acompanhante fora da regra: a frase pede o motivo e o campo ganha foco", async () => {
    vi.mocked(api.addPassenger).mockRejectedValue(new ApiError(422, { error: "invalid", problems: [ { path: "companion", error: "companion_not_allowed" } ] }, "422"));
    mount();
    const form = await pickSuggestion();
    fireEvent.click(within(form).getByLabelText("Com acompanhante"));
    fireEvent.change(within(form).getByLabelText("Nome do acompanhante"), { target: { value: "Joana Souza" } });
    fireEvent.submit(form);
    expect(await screen.findByText("acompanhante fora da regra da cidade — informe o motivo")).not.toBeNull();
    expect(document.activeElement).toBe(within(form).getByLabelText("Motivo do acompanhante"));
    expect(vi.mocked(api.addPassenger).mock.calls[0][1].companion).toEqual({ name: "Joana Souza" });
  });

  it("TFD sem acompanhante no laudo: o motivo não resolve", async () => {
    vi.mocked(api.addPassenger).mockRejectedValue(new ApiError(422, { error: "companion_not_allowed", path: "companion" }, "422"));
    mount();
    const form = await pickSuggestion({ ...SUGGESTION, origin: "tfd", origin_id: "c1" });
    fireEvent.click(within(form).getByLabelText("Com acompanhante"));
    fireEvent.change(within(form).getByLabelText("Nome do acompanhante"), { target: { value: "Joana Souza" } });
    fireEvent.submit(form);
    expect(await screen.findByText("o laudo não indica acompanhante — tire o acompanhante")).not.toBeNull();
  });

  it("paciente já na viagem: a frase vai ao topo do formulário", async () => {
    vi.mocked(api.addPassenger).mockRejectedValue(new ApiError(422, { error: "patient_already_on_trip", path: "patient_id" }, "422"));
    mount();
    const form = await pickSuggestion();
    fireEvent.submit(form);
    const top = await within(form).findByText("este paciente já está nesta viagem");
    expect(document.activeElement).toBe(top);
  });

  it("lotada: a tela avisa antes de enviar", async () => {
    mount(trip({ occupancy: { seats_used: 15, seats: 15, wheelchair_used: 0, wheelchair_spots: 1 } }));
    const form = await pickSuggestion();
    fireEvent.submit(form);
    expect(screen.getByText("a viagem está lotada")).not.toBeNull();
    expect(api.addPassenger).not.toHaveBeenCalled();
  });

  it("retirar pede motivo; PDF abre em janela nova sem dado na URL", async () => {
    vi.mocked(api.removePassenger).mockResolvedValue(trip({ passengers: [] }));
    vi.mocked(api.fetchTripManifest).mockResolvedValue({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null });
    const win = { location: { href: "" }, opener: {}, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => win));
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const onChanged = vi.fn();
    mount(trip(), undefined, onChanged);
    fireEvent.click(await screen.findByRole("button", { name: "Lista de passageiros (PDF)" }));
    await waitFor(() => expect(win.location.href).toBe("blob:x"));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(api.fetchTripManifest).toHaveBeenCalledWith("tr1");
    fireEvent.click(screen.getByRole("button", { name: "Retirar Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    expect(api.removePassenger).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "consulta remarcada pelo hospital" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.removePassenger).toHaveBeenCalledWith("tr1", "p1", "consulta remarcada pelo hospital"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("Passageiro retirado."));
  });

  it("PDF não encontrado: a frase aparece", async () => {
    vi.mocked(api.fetchTripManifest).mockRejectedValue(new ApiError(404, { error: "not_found" }, "404"));
    const win = { location: { href: "" }, opener: {}, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => win));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Lista de passageiros (PDF)" }));
    expect(await screen.findByText("lista não encontrada")).not.toBeNull();
    expect(win.close).toHaveBeenCalled();
  });

  it("viagem em andamento: só a lista e o PDF", async () => {
    mount(trip({ status: "in_progress" }));
    expect(await screen.findByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Lista de passageiros (PDF)" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Buscar atendimentos marcados na data" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Passageiro sem atendimento marcado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retirar Maria da Silva" })).toBeNull();
  });
});
