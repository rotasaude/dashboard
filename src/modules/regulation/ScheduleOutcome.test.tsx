import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  scheduleRegulationRequest: vi.fn(), recordRegulationOutcome: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ScheduleOutcome } from "./ScheduleOutcome";
import { STALE_TEXT } from "../../lib/regulation";
import { renderWithProviders } from "../../test/campaignFixtures";
import { regRequest, regUser } from "../../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const auth = (kind: string) => ({ offer_id: "of3", provider: { id: "pr3", name: "Consórcio Leste", kind }, month: "2026-10", skip_reason: null,
  at: "2026-10-20T10:00:00-03:00", by: { name: "Regulador" } });

describe("ScheduleOutcome", () => {
  let onChanged: ReturnType<typeof vi.fn>;
  let onApplied: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    for (const fn of [ api.scheduleRegulationRequest, api.recordRegulationOutcome ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser());
    onChanged = vi.fn();
    onApplied = vi.fn();
  });

  it("prestador externo: data no fuso da cidade, local e versão; datas e local conferidos antes", async () => {
    const after = regRequest({ status: "scheduled" });
    mocked(api.scheduleRegulationRequest).mockResolvedValue(after);
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "authorized", authorization: auth("consortium"), version: 5 })}
      onChanged={onChanged} onApplied={onApplied} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    text("Data e hora", "2026-11-10T14:30");
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o local (até 200 caracteres)");
    text("Local", "Consórcio Leste — Av. Brasil, 2000");
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(mocked(api.scheduleRegulationRequest)).toHaveBeenCalledWith("rr1",
      { at: "2026-11-10T14:30:00-03:00", place: "Consórcio Leste — Av. Brasil, 2000", notes: null, version: 5 }));
    expect(onChanged).toHaveBeenCalledWith("Agendamento registrado: o cidadão vê a data e o local no celular.");
    expect(onApplied).toHaveBeenCalledWith(after);
    expect(mocked(api.scheduleRegulationRequest)).toHaveBeenCalledTimes(1);
  });

  it("data inválida e observação longa são recusadas antes de enviar; observação preenchida vai aparada", async () => {
    mocked(api.scheduleRegulationRequest).mockResolvedValue(regRequest({ status: "scheduled" }));
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "authorized", authorization: auth("ppi") })} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("data e hora inválidas");
    text("Data e hora", "2026-11-10T14:30");
    text("Local", "Clínica");
    text("Observação (opcional)", "x".repeat(501));
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a observação passa de 500 caracteres");
    expect(mocked(api.scheduleRegulationRequest)).not.toHaveBeenCalled();
    text("Observação (opcional)", "  levar exames  ");
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(mocked(api.scheduleRegulationRequest)).toHaveBeenCalledWith("rr1",
      { at: "2026-11-10T14:30:00-03:00", place: "Clínica", notes: "levar exames", version: 3 }));
  });

  it("remarcar: já há agendamento; local e observação vêm preenchidos e a data fica por digitar", async () => {
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "scheduled", authorization: auth("contracted"),
      schedule: { at: "2026-11-10T14:30:00-03:00", place: "Clínica", notes: "jejum" } })} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remarcar" }));
    expect(screen.queryByRole("button", { name: "Registrar agendamento" })).toBeNull();
    expect((screen.getByLabelText("Data e hora") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Local") as HTMLInputElement).value).toBe("Clínica");
    expect((screen.getByLabelText("Observação (opcional)") as HTMLTextAreaElement).value).toBe("jejum");
  });

  it("stale_version: STALE_TEXT, o formulário e o que foi digitado ficam", async () => {
    mocked(api.scheduleRegulationRequest).mockRejectedValue(new ApiError(409, { error: "stale_version" }, ""));
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "authorized", authorization: auth("consortium") })} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar agendamento" }));
    text("Data e hora", "2026-11-10T14:30");
    text("Local", "Clínica");
    fireEvent.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect((screen.getByLabelText("Local") as HTMLInputElement).value).toBe("Clínica");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("stale_version no desfecho: avisa por onStale quando quem chama oferece o Recarregar", async () => {
    const onStale = vi.fn();
    mocked(api.recordRegulationOutcome).mockRejectedValue(new ApiError(409, { error: "stale_version" }, ""));
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "scheduled", authorization: auth("contracted"),
      schedule: { at: "2026-11-10T14:30:00-03:00", place: "Clínica", notes: null } })} onChanged={onChanged} onStale={onStale} />);
    fireEvent.click(await screen.findByRole("button", { name: "Realizado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(onStale).toHaveBeenCalledWith(STALE_TEXT));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([
    [ "completed", "Realizado", regRequest({ status: "completed" }), "Atendimento realizado registrado." ],
    [ "missed", "Faltou", regRequest({ status: "pending", misses: 1 }), "Falta registrada: o pedido voltou para a fila (primeira falta; a vaga não volta para a cota)." ],
    [ "missed", "Faltou", regRequest({ status: "external", misses: 1, state_regulated: true }), "Falta registrada: o pedido voltou para a fila (primeira falta; a vaga não volta para a cota)." ],
    [ "missed", "Faltou", regRequest({ status: "closed", misses: 2 }), "Segunda falta: o pedido foi encerrado." ],
    [ "completed", "Realizado", regRequest({ status: "authorized" }), "Desfecho registrado." ]
  ])("desfecho %s pela resposta do api (%#)", async (result, button, after, phrase) => {
    mocked(api.recordRegulationOutcome).mockResolvedValue(after);
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "scheduled", authorization: auth("contracted"), version: 6,
      schedule: { at: "2026-11-10T14:30:00-03:00", place: "Clínica", notes: null } })} onChanged={onChanged} onApplied={onApplied} />);
    fireEvent.click(await screen.findByRole("button", { name: button }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.recordRegulationOutcome)).toHaveBeenCalledWith("rr1", result, 6));
    expect(onChanged).toHaveBeenCalledWith(phrase);
    expect(onApplied).toHaveBeenCalledWith(after);
  });

  it("rede própria: segue o 17, sem formulário", async () => {
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "authorized", authorization: auth("own"), appointment_request_id: "ar9" })} onChanged={onChanged} />);
    expect(await screen.findByText("O agendamento é feito pela unidade de destino (pedido de agendamento do módulo 17).")).not.toBeNull();
    expect(screen.getByText("ar9")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar agendamento" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Faltou" })).toBeNull();
  });

  it("regulado pelo estado e ainda em `external`: pode registrar o agendamento", async () => {
    renderWithProviders(<ScheduleOutcome request={regRequest({ status: "external", state_regulated: true })} onChanged={onChanged} />);
    expect(await screen.findByRole("button", { name: "Registrar agendamento" })).not.toBeNull();
  });

  it("sem ação possível (pendente): não desenha nada", async () => {
    const { container } = renderWithProviders(<ScheduleOutcome request={regRequest({ status: "pending" })} onChanged={onChanged} />);
    await waitFor(() => expect(mocked(api.fetchCurrentSession)).toHaveBeenCalled());
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
