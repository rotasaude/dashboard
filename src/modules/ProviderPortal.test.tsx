import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listProviderOrders: vi.fn(), providerSchedule: vi.fn(), providerCollect: vi.fn(),
    providerResult: vi.fn(), uploadExamFile: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ProviderPortal } from "./ProviderPortal";
import { DETAIL_TRANSITION_REREAD } from "../lib/exams";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21, TODAY21, examUser, pdfFile, providerOrder } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listProviderOrders, api.providerSchedule, api.providerCollect, api.providerResult, api.uploadExamFile ];
const provider = () => examUser([ "exam_provider" ], { id: "lab1", email_address: "lab@curitiba.demo" });

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openGuide() {
  fireEvent.click(await screen.findByRole("button", { name: "Abrir guia K7M2Q9XW3P" }));
  return screen.getByRole("region", { name: "Guia K7M2Q9XW3P" });
}

describe("ProviderPortal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW21));
    for (const fn of ALL) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(provider());
    mocked(api.listProviderOrders).mockResolvedValue({ orders: [ providerOrder() ], next_before: null, overdue_count: 2 });
    mocked(api.providerSchedule).mockResolvedValue(undefined);
    mocked(api.providerCollect).mockResolvedValue(undefined);
    mocked(api.providerResult).mockResolvedValue(undefined);
    mocked(api.uploadExamFile).mockResolvedValue("up1");
  });

  it("lista as guias só com nome, nascimento e o final do CPF", async () => {
    renderWithProviders(<ProviderPortal />);
    const list = await screen.findByRole("region", { name: "Guias do prestador" });
    await within(list).findByText("Joana Lima");
    expect(within(list).getByText("02/05/1980")).not.toBeNull();
    expect(within(list).getByText("CPF final 725")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("2 guias em atraso");
    expect(screen.getByRole("tab", { name: "Em atraso (2)" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/prontu[aá]rio|linha do tempo|consulta/i);
    expect(api.listProviderOrders).toHaveBeenCalledWith({ statuses: [ "awaiting_schedule" ], before: null });
  });

  it("abas: situação ou atraso", async () => {
    renderWithProviders(<ProviderPortal />);
    fireEvent.click(await screen.findByRole("tab", { name: "Agendadas" }));
    await waitFor(() => expect(api.listProviderOrders).toHaveBeenLastCalledWith({ statuses: [ "scheduled" ], before: null }));
    fireEvent.click(screen.getByRole("tab", { name: "Em atraso (2)" }));
    await waitFor(() => expect(api.listProviderOrders).toHaveBeenLastCalledWith({ overdue: true, before: null }));
  });

  it("agenda sem escolher prestador", async () => {
    renderWithProviders(<ProviderPortal />);
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole("button", { name: "Agendar" }));
    const form = within(guide).getByRole("form", { name: "Agendar exame" });
    expect(within(form).queryByLabelText("Prestador")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-20T08:30" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Posto Centro" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(api.providerSchedule).toHaveBeenCalledWith("eo1", { scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Posto Centro" }));
    expect(await screen.findByText("Guia agendada.")).not.toBeNull();
  });

  it("registra o resultado com campos e a marca de crítico", async () => {
    mocked(api.listProviderOrders).mockResolvedValue({ orders: [ providerOrder({ status: "collected" }) ], next_before: null, overdue_count: 0 });
    renderWithProviders(<ProviderPortal />);
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole("button", { name: "Registrar resultado" }));
    const form = within(guide).getByRole("form", { name: "Registrar resultado" });
    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"), { target: { files: [ pdfFile() ] } });
    await within(form).findByText("anexado: laudo.pdf");
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Laboratório Simulado" } });
    fireEvent.change(within(form).getByLabelText("Hemoglobina (g/dL)"), { target: { value: "6.9" } });
    fireEvent.click(within(form).getByLabelText("Resultado crítico (vai direto para a fila da equipe)"));
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado" }));
    await waitFor(() => expect(api.providerResult).toHaveBeenCalledWith("eo1", {
      upload_id: "up1", released_on: TODAY21, laboratory_name: "Laboratório Simulado", critical: true, values: [ { key: "hemoglobina", value: "6.9" } ]
    }));
  });

  it("reagenda uma guia agendada, sem escolher prestador", async () => {
    mocked(api.listProviderOrders).mockResolvedValue({ orders: [ providerOrder({ status: "scheduled" }) ], next_before: null, overdue_count: 0 });
    renderWithProviders(<ProviderPortal />);
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole("button", { name: "Reagendar" }));
    const form = within(guide).getByRole("form", { name: "Agendar exame" });
    expect(within(form).queryByLabelText("Prestador")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-21T09:00" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Posto Norte" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(api.providerSchedule).toHaveBeenCalledWith("eo1", { scheduled_at: "2026-10-21T09:00:00-03:00", scheduled_place: "Posto Norte" }));
  });

  it("resultado já registrado (422) mostra a mensagem", async () => {
    mocked(api.listProviderOrders).mockResolvedValue({ orders: [ providerOrder({ status: "collected" }) ], next_before: null, overdue_count: 0 });
    mocked(api.providerResult).mockRejectedValue(new ApiError(422, { error: "result_already_registered" }, "x"));
    renderWithProviders(<ProviderPortal />);
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole("button", { name: "Registrar resultado" }));
    const form = within(guide).getByRole("form", { name: "Registrar resultado" });
    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"), { target: { files: [ pdfFile() ] } });
    await within(form).findByText("anexado: laudo.pdf");
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Lab" } });
    fireEvent.change(within(form).getByLabelText("Hemoglobina (g/dL)"), { target: { value: "13" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o resultado deste exame já foi registrado");
  });

  it("409: fecha o formulário, explica e mostra a guia relida (sem ação velha)", async () => {
    mocked(api.listProviderOrders)
      .mockResolvedValueOnce({ orders: [ providerOrder({ status: "scheduled" }) ], next_before: null, overdue_count: 0 })
      .mockResolvedValue({ orders: [ providerOrder({ status: "collected" }) ], next_before: null, overdue_count: 0 });
    mocked(api.providerCollect).mockRejectedValue(new ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<ProviderPortal />);
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole("button", { name: "Registrar coleta" }));
    fireEvent.click(within(guide).getByRole("button", { name: "Confirmar" }));
    expect((await within(guide).findByRole("alert")).textContent).toBe(DETAIL_TRANSITION_REREAD);
    await within(guide).findByText("coletado");
    expect(within(guide).queryByRole("button", { name: "Registrar coleta" })).toBeNull();
    expect(within(guide).getByRole("button", { name: "Registrar resultado" })).not.toBeNull();
  });

  it("404 (guia de outro prestador): relê e fecha a guia", async () => {
    mocked(api.listProviderOrders)
      .mockResolvedValueOnce({ orders: [ providerOrder({ status: "scheduled" }) ], next_before: null, overdue_count: 0 })
      .mockResolvedValue({ orders: [], next_before: null, overdue_count: 0 });
    mocked(api.providerCollect).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    renderWithProviders(<ProviderPortal />);
    const guide = await openGuide();
    fireEvent.click(within(guide).getByRole("button", { name: "Registrar coleta" }));
    fireEvent.click(within(guide).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Guia K7M2Q9XW3P" })).toBeNull());
    expect(screen.queryByText("Joana Lima")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("exame não encontrado — atualize a lista");
    expect(api.listProviderOrders).toHaveBeenCalledTimes(2);
  });

  it("só o papel do prestador, com o rastreamento ligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "health_professional" ]));
    renderWithProviders(<ProviderPortal />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "exam_provider" ], { features: [] }));
    renderWithProviders(<ProviderPortal />);
    expect(await screen.findByText("o rastreamento de exames está desligado nesta cidade")).not.toBeNull();
    expect(api.listProviderOrders).not.toHaveBeenCalled();
  });
});
