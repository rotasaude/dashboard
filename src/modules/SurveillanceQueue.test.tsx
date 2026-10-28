import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listNotifications: vi.fn(), countNotifications: vi.fn(), listSurveillanceDiseases: vi.fn(),
    listSurveillanceUnits: vi.fn(), getNotification: vi.fn() };
});
import * as api from "../lib/api";
import type { NotificationQuery } from "../lib/api";
import { SurveillanceQueue } from "./SurveillanceQueue";
import { SURVEILLANCE_DISABLED, SURVEILLANCE_NO_ROLE } from "../lib/surveillance";
import { renderWithProviders } from "../test/campaignFixtures";
import { DENGUE, MEASLES, TODAY25, UBS_CENTRO, counts, notification, survUser } from "../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const queries = () => mocked(api.listNotifications).mock.calls.map((c) => c[0] as NotificationQuery);
const bodyRows = () => screen.getAllByRole("row").filter((r) => within(r).queryAllByRole("columnheader").length === 0);

describe("SurveillanceQueue", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listNotifications, api.countNotifications, api.getNotification,
      api.listSurveillanceDiseases, api.listSurveillanceUnits ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
    mocked(api.countNotifications).mockResolvedValue(counts());
    mocked(api.listSurveillanceDiseases).mockResolvedValue([ DENGUE, MEASLES ]);
    mocked(api.listSurveillanceUnits).mockResolvedValue([ { ...UBS_CENTRO, kind: "ubs", notifying: true } ]);
    mocked(api.listNotifications).mockResolvedValue({ notifications: [
      // O prazo da notificação (K5) é o `deadline` da própria notificação.
      notification({ id: "nt2", disease: { code: "sarampo", name: "Sarampo", deadline: "immediate" }, deadline: "immediate", overdue: true }),
      notification() ], next_before: "c1" });
  });

  it("abas com as contagens, aviso das imediatas e vencidas, a ordem do api", async () => {
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    // role="status" (não "alert"): o aviso é permanente e não pode colidir com as mensagens de erro.
    expect((await screen.findByRole("status")).textContent).toBe("1 notificação imediata aberta · 3 vencidas");
    expect(screen.getByRole("tab", { name: "Possíveis não feitas (2)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Notificadas (5)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Em investigação (1)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Sem número oficial (4)" })).not.toBeNull();
    // As duas últimas abas não têm contagem.
    expect(screen.getByRole("tab", { name: "Digitadas" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Descartadas" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Notificadas (5)" }).getAttribute("aria-selected")).toBe("true");
    const rows = await screen.findAllByRole("row", { name: /Joana Lima/ });
    expect(within(rows[0]).getByText("vencida")).not.toBeNull();
    expect(within(rows[0]).getByText("imediata")).not.toBeNull();
    expect(within(rows[0]).getByText("Sarampo")).not.toBeNull();
    expect(within(rows[1]).queryByText("vencida")).toBeNull();
    expect(within(rows[1]).queryByText("imediata")).toBeNull();
    expect(queries()[0]).toEqual({ status: "notified", disease: null, unitId: null });
  });

  it("sem imediata nem vencida, não há aviso; no singular e no plural", async () => {
    mocked(api.countNotifications).mockResolvedValue(counts({ immediate_open: 0, overdue: 0 }));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    await screen.findByRole("tab", { name: "Vencidas (0)" });
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    mocked(api.countNotifications).mockResolvedValue(counts({ immediate_open: 2, overdue: 1 }));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    expect((await screen.findByRole("status")).textContent).toBe("2 notificações imediatas abertas · 1 vencida");
    cleanup();
    mocked(api.countNotifications).mockResolvedValue(counts({ immediate_open: 0, overdue: 2 }));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    expect((await screen.findByRole("status")).textContent).toBe("2 vencidas");
  });

  it("aba Vencidas pede overdue sem situação; filtros por doença e unidade; carregar mais", async () => {
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Vencidas (3)" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ overdue: true, disease: null, unitId: null }));
    fireEvent.change(await screen.findByLabelText("Doença"), { target: { value: "dengue" } });
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "u1" } });
    await waitFor(() => expect(queries().at(-1)).toEqual({ overdue: true, disease: "dengue", unitId: "u1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ overdue: true, disease: "dengue", unitId: "u1", before: "c1" }));
  });

  it("cada aba pede o seu filtro; 'todas' nunca manda doença vazia (A7)", async () => {
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    const click = async (name: string, expected: NotificationQuery) => {
      fireEvent.click(await screen.findByRole("tab", { name }));
      await waitFor(() => expect(queries().at(-1)).toEqual(expected));
    };
    await click("Possíveis não feitas (2)", { status: "possible", disease: null, unitId: null });
    await click("Em investigação (1)", { status: "investigating", disease: null, unitId: null });
    await click("Sem número oficial (4)", { withoutOfficialNumber: true, disease: null, unitId: null });
    await click("Digitadas", { status: "entered", disease: null, unitId: null });
    await click("Descartadas", { status: "dismissed", disease: null, unitId: null });
    fireEvent.change(await screen.findByLabelText("Doença"), { target: { value: "dengue" } });
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "dismissed", disease: "dengue", unitId: null }));
    fireEvent.change(screen.getByLabelText("Doença"), { target: { value: "" } });
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "dismissed", disease: null, unitId: null }));
    for (const q of queries()) {
      expect(q.disease === null || q.disease === undefined || q.disease.length > 0).toBe(true);
      expect(q.unitId === null || q.unitId === undefined || q.unitId.length > 0).toBe(true);
    }
  });

  it("carregar mais anexa a página sem repetir linhas (A12) e some quando acaba", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocked(api.listNotifications)
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt1" }), notification({ id: "nt2" }) ], next_before: "c1" })
      // A linha pode repetir entre páginas (ordem por prazo): nt2 volta, nt3 é nova.
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt2" }), notification({ id: "nt3" }) ], next_before: null });
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    await screen.findAllByRole("row", { name: /Joana Lima/ });
    expect(bodyRows()).toHaveLength(2);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("trocar de aba zera as páginas extras", async () => {
    mocked(api.listNotifications)
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt1" }) ], next_before: "c1" })
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt2" }) ], next_before: null })
      .mockResolvedValue({ notifications: [ notification({ id: "nt9" }) ], next_before: "c9" });
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("tab", { name: "Possíveis não feitas (2)" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "possible", disease: null, unitId: null }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    // O cursor da aba nova é o da primeira página dela.
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "possible", disease: null, unitId: null, before: "c9" }));
  });

  it("a ação Abrir fica numa coluna própria: a linha não é botão", async () => {
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    const rows = await screen.findAllByRole("row", { name: /Joana Lima/ });
    expect(rows[0].tagName).toBe("DIV");
    expect(within(rows[0]).getByRole("button", { name: "Abrir" })).not.toBeNull();
  });

  it("pessoa sem nome, documento, bairro e situação nova aparecem; nada some", async () => {
    mocked(api.listNotifications).mockResolvedValue({ notifications: [
      notification({ id: "nt1", patient: { id: "pa1", display_name: null, has_cpf: false, cns_masked: "***********1234" }, neighborhood: null,
        status: "em_analise", classification: null }) ], next_before: null });
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    const row = (await screen.findAllByRole("row")).find((r) => r.textContent?.includes("em_analise"));
    expect(row).toBeDefined();
    expect(within(row as HTMLElement).getByText("pessoa sem nome no cadastro")).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/CNS \*+1234/)).not.toBeNull();
    expect(within(row as HTMLElement).getByText("não informado")).not.toBeNull();
  });

  it("lista vazia e erro da lista", async () => {
    mocked(api.listNotifications).mockResolvedValueOnce({ notifications: [], next_before: null });
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    expect(await screen.findByText("nenhuma notificação nesta aba")).not.toBeNull();
    cleanup();
    mocked(api.listNotifications).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_filter" }, "422"));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    expect((await screen.findByRole("alert")).textContent).toBe("filtro inválido — recarregue a tela");
  });

  it("sem permissão para a lista de doenças, a tela segue sem o filtro de doença", async () => {
    mocked(api.listSurveillanceDiseases).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    await screen.findAllByRole("row", { name: /Joana Lima/ });
    await screen.findByLabelText("Unidade");
    expect(screen.queryByLabelText("Doença")).toBeNull();
  });

  it("volta à aba e reconecta: a lista não relê", async () => {
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    await screen.findAllByRole("row", { name: /Joana Lima/ });
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.listNotifications)).toHaveBeenCalledTimes(1);
  });

  it("sem o interruptor ou sem o papel: só a frase, nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser([ "surveillance" ], { features: [] }));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    expect(await screen.findByText(SURVEILLANCE_DISABLED)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser([ "analyst" ]));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    expect(await screen.findByText(SURVEILLANCE_NO_ROLE)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.listNotifications)).not.toHaveBeenCalled();
    expect(mocked(api.countNotifications)).not.toHaveBeenCalled();
    expect(mocked(api.listSurveillanceDiseases)).not.toHaveBeenCalled();
  });
});
