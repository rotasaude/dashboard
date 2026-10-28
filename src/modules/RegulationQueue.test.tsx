import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listRegulationRequests: vi.fn(), countRegulationRequests: vi.fn(), getRegulationRequest: vi.fn(), searchRegulationTargets: vi.fn(),
  listCareOffers: vi.fn(), fetchStateExportCsv: vi.fn(), returnRegulationRequest: vi.fn(), setRegulationExternal: vi.fn() }));
import * as api from "../lib/api";
import type { RegulationQuery } from "../lib/api";
import { RegulationQueue } from "./RegulationQueue";
import { REGULATION_DISABLED, REGULATION_NO_ROLE } from "../lib/regulation";
import { renderWithProviders } from "../test/campaignFixtures";
import { CARDIO, TODAY26, regCounts, regRequest, regUser } from "../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const queries = () => mocked(api.listRegulationRequests).mock.calls.map((c) => c[0] as RegulationQuery);

describe("RegulationQueue", () => {
  const OVERDUE = regRequest({ id: "rr2", color: "red", suggested_color: "yellow", due_on: "2026-10-25", overdue: true,
    requested_at: "2026-10-18T09:00:00-03:00", patient: { id: "pa2", display_name: "Marcos Souza", has_cpf: false, cns_masked: "*** **** **** 4321" } });
  beforeEach(() => {
    for (const fn of [ api.listRegulationRequests, api.countRegulationRequests, api.searchRegulationTargets ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser());
    mocked(api.countRegulationRequests).mockResolvedValue(regCounts());
    mocked(api.searchRegulationTargets).mockResolvedValue([ CARDIO ]);
    mocked(api.getRegulationRequest).mockReset();
    mocked(api.getRegulationRequest).mockResolvedValue(regRequest());
    mocked(api.returnRegulationRequest).mockReset();
    mocked(api.returnRegulationRequest).mockResolvedValue(regRequest({ status: "returned" }));
    // A ordem é do api: vencidos, cor, data (contrato §13 G2); uma leitura só.
    mocked(api.listRegulationRequests).mockResolvedValue({ requests: [ OVERDUE, regRequest() ], next_before: "c1" });
  });

  it("pedido pendente sem cor confirmada mostra a cor sugerida, marcada como sugerida", async () => {
    mocked(api.listRegulationRequests).mockResolvedValue({ requests: [ regRequest({ color: null, suggested_color: "green" }) ], next_before: null });
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    const row = await screen.findByRole("row", { name: /Joana Lima/ });
    expect(within(row).getByText("verde")).not.toBeNull();
    expect(within(row).getByText("sugerida")).not.toBeNull();
  });

  it("abas com contagens, aviso e bloco dos vencidos no topo; cor, espera e prazo; sem posição", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    expect((await screen.findByRole("status")).textContent).toBe("3 pedidos vencidos");
    expect(screen.getByRole("tab", { name: "Aguardando (12)" }).getAttribute("aria-selected")).toBe("true");
    for (const name of [ "Devolvidos (2)", "Autorizados (5)", "Agendados", "Pelo estado (1)", "Encerrados" ])
      expect(screen.getByRole("tab", { name })).not.toBeNull();
    const late = await screen.findByRole("region", { name: "Vencidos" });
    const onTime = screen.getByRole("region", { name: "No prazo" });
    expect(late.compareDocumentPosition(onTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const lateRow = await within(late).findByRole("row", { name: /Marcos Souza/ });
    expect(within(lateRow).getByText("vermelho")).not.toBeNull();
    expect(within(lateRow).queryByText("sugerida")).toBeNull();
    expect(within(lateRow).getByText("vencido há 3 dias")).not.toBeNull();
    expect(within(lateRow).getByText("10 dias")).not.toBeNull();
    const row = await within(onTime).findByRole("row", { name: /Joana Lima/ });
    expect(within(row).getByText("amarelo")).not.toBeNull();
    expect(within(row).getByText("até 07/11")).not.toBeNull();
    expect(within(row).getByText("20 dias")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/posição|position|#\d/i);
    expect(queries()).toEqual([ { status: "pending", type: null, targetCode: null, color: null } ]);
  });

  it("filtros e abas: o que vai ao api", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    await screen.findByRole("region", { name: "Vencidos" });
    fireEvent.change(screen.getByLabelText("Cor"), { target: { value: "red" } });
    fireEvent.change(screen.getByLabelText("Especialidade ou procedimento"), { target: { value: "cardio" } });
    fireEvent.click(await screen.findByRole("button", { name: /225120 — Cardiologia/ }));
    await waitFor(() => expect(queries()).toContainEqual({ status: "pending", type: "specialty", targetCode: "225120", color: "red" }));
    expect(queries().every((q) => q.overdue === undefined)).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Devolvidos (2)" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "returned", type: "specialty", targetCode: "225120", color: "red" }));
    expect(screen.queryByRole("region", { name: "Vencidos" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Encerrados" }));
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "denied" } });
    await waitFor(() => expect(queries().at(-1)).toMatchObject({ status: "denied" }));
    expect(queries().every((q) => q.overdue === undefined)).toBe(true);
  });

  it("Carregar mais usa o cursor da lista e a página nova entra em No prazo", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    await screen.findByRole("region", { name: "No prazo" });
    expect(screen.getAllByRole("button", { name: "Carregar mais" })).toHaveLength(1);
    mocked(api.listRegulationRequests).mockResolvedValueOnce({
      requests: [ regRequest({ id: "rr3", patient: { id: "pa3", display_name: "Ana Reis", has_cpf: true, cns_masked: null } }) ], next_before: null });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(queries().at(-1)).toEqual({ status: "pending", type: null, targetCode: null, color: null, before: "c1" }));
    const onTime = screen.getByRole("region", { name: "No prazo" });
    expect(await within(onTime).findByRole("row", { name: /Ana Reis/ })).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Vencidos" })).queryByRole("row", { name: /Ana Reis/ })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull());
  });

  it("Abrir mostra o detalhe; Voltar à fila sem decisão não relê a lista nem a contagem", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    const onTime = await screen.findByRole("region", { name: "No prazo" });
    await waitFor(() => expect(mocked(api.countRegulationRequests)).toHaveBeenCalled());
    fireEvent.click(within(onTime).getByRole("button", { name: /^Abrir pedido de Cardiologia/ }));
    expect(await screen.findByRole("region", { name: "Cardiologia" })).not.toBeNull();
    expect(mocked(api.getRegulationRequest)).toHaveBeenCalledWith("rr1");
    expect(screen.queryByRole("region", { name: "No prazo" })).toBeNull();
    const lists = mocked(api.listRegulationRequests).mock.calls.length;
    const counts = mocked(api.countRegulationRequests).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    expect(await screen.findByRole("region", { name: "No prazo" })).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.listRegulationRequests).mock.calls.length).toBe(lists);
    expect(mocked(api.countRegulationRequests).mock.calls.length).toBe(counts);
    expect(screen.queryByText(/devolvido à unidade/)).toBeNull();
  });

  it("decidir volta à fila com a frase, relê UMA vez a primeira página (sem before) e a contagem", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    await screen.findByRole("region", { name: "Vencidos" });
    // Duas páginas carregadas: a releitura volta a uma só.
    mocked(api.listRegulationRequests).mockResolvedValueOnce({
      requests: [ regRequest({ id: "rr3", patient: { id: "pa3", display_name: "Ana Reis", has_cpf: true, cns_masked: null } }) ], next_before: null });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await screen.findByRole("row", { name: /Ana Reis/ });
    const onTime = screen.getByRole("region", { name: "No prazo" });
    fireEvent.click(within(onTime).getAllByRole("button", { name: /^Abrir pedido de Cardiologia/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Devolver para complementar" }));
    fireEvent.change(screen.getByLabelText("Motivo da devolução"), { target: { value: "Falta o resultado do teste ergométrico" } });
    const lists = mocked(api.listRegulationRequests).mock.calls.length;
    const counts = mocked(api.countRegulationRequests).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
    const notice = await screen.findByText("Pedido devolvido à unidade solicitante para complementar.");
    expect(notice.getAttribute("role")).toBe("status");
    expect(await screen.findByRole("region", { name: "No prazo" })).not.toBeNull();
    await waitFor(() => expect(mocked(api.countRegulationRequests).mock.calls.length).toBe(counts + 1));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.listRegulationRequests).mock.calls.length).toBe(lists + 1);
    expect(queries().at(-1)).toEqual({ status: "pending", type: null, targetCode: null, color: null });
    expect(screen.queryByRole("region", { name: "Cardiologia" })).toBeNull();
  });

  it("trocar de aba tira a frase da decisão", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    const onTime = await screen.findByRole("region", { name: "No prazo" });
    fireEvent.click(within(onTime).getByRole("button", { name: /^Abrir pedido de Cardiologia/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Devolver para complementar" }));
    fireEvent.change(screen.getByLabelText("Motivo da devolução"), { target: { value: "Falta o resultado do teste ergométrico" } });
    fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
    await screen.findByText("Pedido devolvido à unidade solicitante para complementar.");
    fireEvent.click(screen.getByRole("tab", { name: "Devolvidos (2)" }));
    expect(screen.queryByText("Pedido devolvido à unidade solicitante para complementar.")).toBeNull();
  });

  it("volta à aba e reconecta: a lista não relê", async () => {
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    await screen.findAllByRole("row", { name: /Cardiologia/ });
    const before = mocked(api.listRegulationRequests).mock.calls.length;
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.listRegulationRequests).mock.calls.length).toBe(before);
  });

  it("portão: interruptor e papel", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "care_regulator" ], { features: [] }));
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    expect(await screen.findByText(REGULATION_DISABLED)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "health_professional" ]));
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    expect(await screen.findByText(REGULATION_NO_ROLE)).not.toBeNull();
    expect(mocked(api.listRegulationRequests)).not.toHaveBeenCalled();
  });
});

describe("RegulationQueue — exportação para o sistema do estado", () => {
  beforeEach(() => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser());
    mocked(api.countRegulationRequests).mockResolvedValue(regCounts());
    mocked(api.listRegulationRequests).mockResolvedValue({ requests: [ regRequest({ status: "external", state_regulated: true }) ], next_before: null });
    mocked(api.fetchStateExportCsv).mockReset().mockResolvedValue({ blob: new Blob([ "a;b" ]), filename: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  function captureDownloads() {
    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") { anchors.push(el as HTMLAnchorElement); (el as HTMLAnchorElement).click = vi.fn(); }
      return el;
    });
    class FakeURL extends URL {}
    Object.assign(FakeURL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.stubGlobal("URL", FakeURL);
    return anchors;
  }

  it("CSV com nome sem dado pessoal; nada no storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const anchors = captureDownloads();
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Pelo estado (1)" }));
    expect(await screen.findByText("Regulados pelo estado não entram na fila municipal nem consomem cota.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV para o sistema do estado" }));
    await waitFor(() => expect(mocked(api.fetchStateExportCsv)).toHaveBeenCalledWith("external"));
    await waitFor(() => expect(anchors.at(-1)?.download).toBe("regulacao-estado-2026-10-28.csv"));
    expect(setItem).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("o status da aba vai ao api; o nome seguro do api vale; a nota só na aba do estado", async () => {
    const anchors = captureDownloads();
    mocked(api.fetchStateExportCsv).mockResolvedValue({ blob: new Blob([ "a;b" ]), filename: "regulacao-estado-2026-10-27.csv" });
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    await screen.findAllByRole("row", { name: /Cardiologia/ });
    expect(screen.queryByText("Regulados pelo estado não entram na fila municipal nem consomem cota.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV para o sistema do estado" }));
    await waitFor(() => expect(mocked(api.fetchStateExportCsv)).toHaveBeenCalledWith("pending"));
    await waitFor(() => expect(anchors.at(-1)?.download).toBe("regulacao-estado-2026-10-27.csv"));
    vi.restoreAllMocks();
  });

  it("falha no CSV: a frase do módulo, sem repetir o corpo do api", async () => {
    mocked(api.fetchStateExportCsv).mockRejectedValue(new api.ApiError(500, { error: "boom", detail: "Joana Lima" }, "x"));
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    await screen.findAllByRole("row", { name: /Cardiologia/ });
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV para o sistema do estado" }));
    const alertBox = await screen.findByRole("alert");
    expect(alertBox.textContent).not.toContain("Joana");
    expect(alertBox.textContent).not.toBe("");
  });

  it("número externo no detalhe: grava, fica no detalhe com a frase, e a fila relê ao voltar", async () => {
    const ext = regRequest({ status: "external", state_regulated: true, version: 2 });
    mocked(api.listRegulationRequests).mockResolvedValue({ requests: [ ext ], next_before: null });
    mocked(api.getRegulationRequest).mockResolvedValue(ext);
    mocked(api.setRegulationExternal).mockReset().mockResolvedValue({ ...ext, version: 3, external: { system: "sisreg", number: "2026/123456" } });
    renderWithProviders(<RegulationQueue today={TODAY26} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Pelo estado (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Abrir pedido de Cardiologia/ }));
    fireEvent.change(await screen.findByLabelText("Número no sistema do estado"), { target: { value: "2026/123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    await waitFor(() => expect(mocked(api.setRegulationExternal)).toHaveBeenCalledWith("rr1", "sisreg", "2026/123456", 2));
    expect((await screen.findByText("Número externo registrado.")).getAttribute("role")).toBe("status");
    expect(screen.getByText("SISREG 2026/123456")).not.toBeNull();
    expect(mocked(api.getRegulationRequest)).toHaveBeenCalledTimes(1);
    const listReads = mocked(api.listRegulationRequests).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Voltar à fila" }));
    await waitFor(() => expect(mocked(api.listRegulationRequests).mock.calls.length).toBe(listReads + 1));
  });
});
