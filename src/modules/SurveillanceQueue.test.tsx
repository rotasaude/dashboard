import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listNotifications: vi.fn(), countNotifications: vi.fn(), listSurveillanceDiseases: vi.fn(),
    listSurveillanceUnits: vi.fn(), getNotification: vi.fn(), lookupSurveillancePerson: vi.fn(), createManualNotification: vi.fn() };
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
      api.listSurveillanceDiseases, api.listSurveillanceUnits, api.lookupSurveillancePerson, api.createManualNotification ]) mocked(fn).mockReset();
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

  it("a ação Abrir fica numa coluna própria: a linha não é botão, e cada botão tem nome distinto", async () => {
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    const rows = await screen.findAllByRole("row", { name: /Joana Lima/ });
    expect(rows[0].tagName).toBe("DIV");
    expect(within(rows[0]).getByRole("button", { name: "Abrir notificação de Sarampo de 26/10/2026" })).not.toBeNull();
    expect(within(rows[1]).getByRole("button", { name: "Abrir notificação de Dengue de 26/10/2026" })).not.toBeNull();
    // O nome do botão não leva o nome da pessoa.
    const names = screen.getAllByRole("button", { name: /^Abrir notificação/ }).map((b) => b.getAttribute("aria-label"));
    expect(names.some((n) => /Joana/.test(n ?? ""))).toBe(false);
  });

  it("Abrir mostra o detalhe acima da tabela, lê uma vez, e Fechar o tira", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ id: "nt2", version: 3 }));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    const rows = await screen.findAllByRole("row", { name: /Joana Lima/ });
    expect(mocked(api.getNotification)).not.toHaveBeenCalled();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Abrir notificação de Sarampo de 26/10/2026" }));
    expect(await screen.findByRole("region", { name: "Detalhe da notificação" })).not.toBeNull();
    expect(mocked(api.getNotification)).toHaveBeenCalledWith("nt2");
    expect(mocked(api.getNotification)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("region", { name: "Detalhe da notificação" })).toBeNull();
  });

  it("a tag imediata só vale com a notificação aberta", async () => {
    const immediate = { code: "sarampo", name: "Sarampo", deadline: "immediate" };
    mocked(api.listNotifications).mockResolvedValue({ notifications: [
      notification({ id: "a", status: "notified", deadline: "immediate", disease: immediate }),
      notification({ id: "b", status: "possible", deadline: "immediate", disease: immediate }),
      notification({ id: "c", status: "investigating", deadline: "immediate", disease: immediate }),
      notification({ id: "d", status: "closed", deadline: "immediate", disease: immediate }),
      notification({ id: "e", status: "entered", deadline: "immediate", disease: immediate }),
      notification({ id: "f", status: "dismissed", deadline: "immediate", disease: immediate }) ], next_before: null });
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    await screen.findAllByRole("row", { name: /Joana Lima/ });
    expect(bodyRows().map((r) => within(r).queryByText("imediata") !== null)).toEqual([ true, true, true, false, false, false ]);
  });

  it("página que chega depois de trocar de aba não mexe nas páginas da aba nova", async () => {
    let late: (page: api.NotificationPage) => void = () => {};
    mocked(api.listNotifications)
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt1" }) ], next_before: "c1" })
      .mockReturnValueOnce(new Promise((resolve) => { late = resolve; }))
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt5" }) ], next_before: "c5" })
      .mockResolvedValueOnce({ notifications: [ notification({ id: "nt6" }) ], next_before: null });
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    fireEvent.click(screen.getByRole("tab", { name: "Possíveis não feitas (2)" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "possible", disease: null, unitId: null }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    // A página atrasada da aba antiga chega agora e é ignorada.
    await act(async () => { late({ notifications: [ notification({ id: "nt2" }) ], next_before: null }); });
    await new Promise((r) => setTimeout(r, 20));
    expect(bodyRows()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
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

  it("Notificação manual abre o painel; Cancelar fecha; criada, abre o detalhe da nova", async () => {
    mocked(api.lookupSurveillancePerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Joana Lima", registration_id: null });
    mocked(api.createManualNotification).mockResolvedValue(notification({ id: "nt9", origin: "manual" }));
    mocked(api.getNotification).mockResolvedValue(notification({ id: "nt9", origin: "manual" }));
    renderWithProviders(<SurveillanceQueue today={TODAY25} />);
    fireEvent.click(await screen.findByRole("button", { name: "Notificação manual" }));
    expect(screen.getByRole("region", { name: "Notificação manual" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("region", { name: "Notificação manual" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notificação manual" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Notificar Joana Lima" }));
    await screen.findByRole("option", { name: "UBS Centro · CNES 2384299" });
    fireEvent.change(screen.getByLabelText("Doença ou agravo"), { target: { value: "sarampo" } });
    fireEvent.change(screen.getByLabelText("Unidade notificadora"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar notificação" }));
    await waitFor(() => expect(mocked(api.getNotification)).toHaveBeenCalledWith("nt9"));
    expect(screen.queryByRole("region", { name: "Notificação manual" })).toBeNull();
    expect(await screen.findByRole("region", { name: "Detalhe da notificação" })).not.toBeNull();
  });
});
