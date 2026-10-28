import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), fetchWeekCsv: vi.fn(), listNotifications: vi.fn(), getNotification: vi.fn() };
});
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { saveFile } from "./lab/saveFile";
import { SurveillanceReports } from "./SurveillanceReports";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY25, notification, survUser } from "../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("SurveillanceReports", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchWeekCsv, api.listNotifications, api.getNotification, saveFile ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
    mocked(api.fetchWeekCsv).mockResolvedValue({ blob: new Blob([ "a;b" ]), filename: null });
    mocked(api.listNotifications).mockResolvedValue({ notifications: [ notification({ status: "closed", classification: "confirmed" }) ], next_before: null });
    mocked(api.getNotification).mockResolvedValue(notification({ status: "closed", classification: "confirmed" }));
  });

  it("CSV da semana anterior, com nome sem dado pessoal", async () => {
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    expect(((await screen.findByLabelText("Semana (AAAA-SS)")) as HTMLInputElement).value).toBe("2026-42");
    expect(screen.getByText("Sem CPF; CNS mascarado.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(mocked(saveFile).mock.calls[0][1]).toBe("notificacoes-2026-42.csv"));
    expect(mocked(api.fetchWeekCsv).mock.calls[0][0]).toBe("2026-42");
  });

  it("usa o nome que o api mandou", async () => {
    mocked(api.fetchWeekCsv).mockResolvedValue({ blob: new Blob([ "a;b" ]), filename: "notificacoes-2026-42.csv" });
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    await screen.findByLabelText("Semana (AAAA-SS)");
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(mocked(saveFile)).toHaveBeenCalledTimes(1));
    expect(mocked(saveFile).mock.calls[0][1]).toBe("notificacoes-2026-42.csv");
  });

  it("na primeira semana do ano, o CSV vai com 2025-53", async () => {
    renderWithProviders(<SurveillanceReports today="2026-01-06" />);
    expect(((await screen.findByLabelText("Semana (AAAA-SS)")) as HTMLInputElement).value).toBe("2025-53");
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(mocked(api.fetchWeekCsv).mock.calls[0][0]).toBe("2025-53"));
    await waitFor(() => expect(mocked(saveFile).mock.calls[0][1]).toBe("notificacoes-2025-53.csv"));
  });

  it("a semana em curso é aceita", async () => {
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    fireEvent.change(await screen.findByLabelText("Semana (AAAA-SS)"), { target: { value: " 2026-43 " } });
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(mocked(api.fetchWeekCsv).mock.calls[0][0]).toBe("2026-43"));
  });

  it("semana sem casos: arquivo vazio também é salvo, com o nome da semana", async () => {
    mocked(api.fetchWeekCsv).mockResolvedValue({ blob: new Blob([ "" ]), filename: null });
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    await screen.findByLabelText("Semana (AAAA-SS)");
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(mocked(saveFile)).toHaveBeenCalledTimes(1));
    expect(mocked(saveFile).mock.calls[0][1]).toBe("notificacoes-2026-42.csv");
  });

  it("o aviso da semana some ao editar a semana", async () => {
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    const input = await screen.findByLabelText("Semana (AAAA-SS)");
    fireEvent.change(input, { target: { value: "2026-44" } });
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    await screen.findByRole("alert");
    fireEvent.change(input, { target: { value: "2026-43" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("semana inválida não baixa", async () => {
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    fireEvent.change(await screen.findByLabelText("Semana (AAAA-SS)"), { target: { value: "2026-44" } });
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    expect((await screen.findByRole("alert")).textContent).toBe("semana no futuro");
    expect(mocked(api.fetchWeekCsv)).not.toHaveBeenCalled();
  });

  it("recusa do api no CSV aparece e não salva", async () => {
    mocked(api.fetchWeekCsv).mockRejectedValue(new ApiError(422, { error: "invalid_week" }, "x"));
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    await screen.findByLabelText("Semana (AAAA-SS)");
    fireEvent.click(screen.getByRole("button", { name: "Baixar CSV" }));
    expect((await screen.findByRole("alert")).textContent).toBe("semana inválida");
    expect(mocked(saveFile)).not.toHaveBeenCalled();
  });

  it("encerradas sem número: só lê no clique, sem número oficial", async () => {
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    await screen.findByRole("button", { name: "Mostrar a lista" });
    expect(mocked(api.listNotifications)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar a lista" }));
    expect(await screen.findByRole("row", { name: /Joana Lima/ })).not.toBeNull();
    expect(mocked(api.listNotifications).mock.calls[0][0]).toEqual({ withoutOfficialNumber: true });
  });

  it("Abrir leva ao detalhe, onde está o número oficial", async () => {
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar a lista" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Abrir notificação de Dengue/ }));
    await waitFor(() => expect(mocked(api.getNotification)).toHaveBeenCalledWith("nt1"));
    expect(await screen.findByRole("button", { name: "Registrar número oficial" })).not.toBeNull();
  });

  it("carrega mais sem repetir a linha", async () => {
    mocked(api.listNotifications)
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt1" }) ], next_before: "c1" })
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt1" }), notification({ id: "nt2", patient: { id: "pa2", display_name: "Rui Costa", has_cpf: true, cns_masked: null } }) ], next_before: null });
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar a lista" }));
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("row", { name: /Rui Costa/ })).not.toBeNull();
    expect(screen.getAllByRole("row", { name: /Joana Lima/ })).toHaveLength(1);
    expect(mocked(api.listNotifications).mock.calls[1][0]).toEqual({ withoutOfficialNumber: true, before: "c1" });
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("erro ao ler a lista aparece", async () => {
    mocked(api.listNotifications).mockRejectedValue(new ApiError(403, { error: "forbidden" }, "x"));
    renderWithProviders(<SurveillanceReports today={TODAY25} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar a lista" }));
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
  });
});
