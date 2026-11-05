// RAAS do mês (F-31.6; P14, P15, P24, P42, P43, P57, P58): pendências e avisos por registro, sem dado clínico; situação de rua por
// registro (só com o registro aberto); fechar e reabrir com step-up (`month_has_problems` na linha do registro); remessa com step-up
// (`raas_layout_unavailable` é o caminho de hoje); fichas espelho (PRÉVIA da coordenação; faturista só com remessa, R12). As frases
// vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_II, MONTH31, TODAY31, month, monthRecord, psyUser, raasExport } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import {
  BILLING_SHEETS_NOTE, MONTH_CLOSED_DONE, MONTH_REOPENED, MONTH_STALE_TEXT, NO_RAAS_EXPORTS, ORPHAN_PROBLEMS_TEXT, PSY_ERRORS, PSY_MONTH_KEY,
  RAAS_DOWNLOAD_NOTE, closeBlockedHint, monthCountsText, psyError,
  monthProblemLabel, monthWarningLabel, reasonProblem, recentMonths
} from "../lib/psychosocial";
import { saveFile } from "./lab/saveFile";
import { SHEETS_POPUP_BLOCKED } from "./psychosocial/openSheets";
import { CapsRaas } from "./CapsRaas";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyMonth: vi.fn(),
  setPsyHomeless: vi.fn(), closePsyMonth: vi.fn(), reopenPsyMonth: vi.fn(), listPsyRaasExports: vi.fn(), createPsyRaasExport: vi.fn(),
  fetchPsyRaasFile: vi.fn(), fetchPsySheets: vi.fn(), stepUpMfa: vi.fn() }));
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const REC = "3f2b8c1e-7d4a-4c5e-9b1a-2e6f8d0c4a71";
const GONE = "9a1c7e2b-5d3f-4b6a-8c0e-1f2a3b4c5d6e";
const LEAD = { user_id: "u-1", name: "Ana Coordenadora", cbo_code: "251510" };
const REASON = "ação lançada no mês errado";
const PDF = { blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null };

beforeEach(() => {
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
  vi.mocked(api.getPsyMonth).mockResolvedValue(month());
  vi.mocked(api.listPsyRaasExports).mockResolvedValue([]);
  vi.mocked(api.stepUpMfa).mockResolvedValue(undefined as never);
});

function mount(user = psyUser([ "psychosocial_lead" ]), extra: Partial<api.SessionUser> = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue({ ...user, ...extra });
  return renderWithProviders(<CapsRaas today={TODAY31} />);
}
const rowOf = (name: string) => screen.getByText(name).closest("[role='row']") as HTMLElement;
const fillTotpAndConfirm = async (code: string) => {
  fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
};

describe("RAAS do mês", () => {
  it("meses: o corrente da cidade e os 12 anteriores, nunca futuro", () => {
    const list = recentMonths(TODAY31);
    expect(list).toHaveLength(13);
    expect(list[0]).toBe("2026-11");
    expect(list[12]).toBe("2025-11");
    expect(recentMonths("2026-01-31", 2)).toEqual([ "2026-01", "2025-12" ]);
  });

  it("pendências por registro, sem dado clínico; situação de rua por registro", async () => {
    // O api não manda dado clínico no mês; se mandar por engano, a tela não mostra.
    vi.mocked(api.getPsyMonth).mockResolvedValue(month({
      counts: { records: 2, open: 2, closed: 0, exported: 0, with_problems: 1, with_warnings: 1, actions: 3 },
      records: [
        { ...monthRecord(), cid_main: "F322", substances: [ "01" ], notes: "segredo clínico" } as never,
        monthRecord({ id: "mr2", enrollment_id: "en2", patient: { patient_id: "pt2", name: "José Pereira", cns_masked: null }, homeless: true,
          actions_count: 0, problems: [], warnings: [ "no_actions", "phone_missing" ] })
      ]
    }));
    vi.mocked(api.setPsyHomeless).mockResolvedValue({ id: "mr1", enrollment_id: "en1", health_unit_id: CAPS_II.id, month: MONTH31, status: "open", homeless: false });
    mount();
    expect(await screen.findByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByText(monthCountsText({ records: 2, with_problems: 1, with_warnings: 1, actions: 3 }))).not.toBeNull();
    expect(monthCountsText({ records: 1, with_problems: 1, with_warnings: 0, actions: 3 })).toBe("1 registro · 1 com pendência · 3 ações");
    expect(within(rowOf("Maria da Silva")).getByText(monthProblemLabel("homeless_missing"))).not.toBeNull();
    expect(within(rowOf("José Pereira")).getByText(monthWarningLabel("no_actions"))).not.toBeNull();
    expect(within(rowOf("José Pereira")).getByText(monthWarningLabel("phone_missing"))).not.toBeNull();
    expect(screen.queryByText(/F32|segredo/)).toBeNull();
    // Pendência na tela: "Fechar o mês" desabilitado, com a dica.
    expect((screen.getByRole("button", { name: "Fechar o mês" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(closeBlockedHint(1))).not.toBeNull();
    // Filtro local.
    fireEvent.click(screen.getByLabelText("Só com pendência"));
    expect(screen.queryByText("José Pereira")).toBeNull();
    fireEvent.click(screen.getByLabelText("Só com pendência"));
    fireEvent.change(screen.getByLabelText("Situação de rua em novembro de 2026 — Maria da Silva"), { target: { value: "no" } });
    await waitFor(() => expect(api.setPsyHomeless).toHaveBeenCalledWith("mr1", false));
    await waitFor(() => expect(api.getPsyMonth).toHaveBeenCalledTimes(2));
    expect(api.getPsyMonth).toHaveBeenCalledWith(MONTH31, CAPS_II.id);
  });

  it("situação de rua com o registro já fechado: frase e releitura", async () => {
    vi.mocked(api.setPsyHomeless).mockRejectedValueOnce(new ApiError(409, { error: "record_not_open" }, "409"));
    mount(psyUser([ "psychosocial_staff" ]));
    fireEvent.change(await screen.findByLabelText("Situação de rua em novembro de 2026 — Maria da Silva"), { target: { value: "yes" } });
    expect(await screen.findByText(PSY_ERRORS.record_not_open)).not.toBeNull();
    await waitFor(() => expect(api.getPsyMonth).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Situação de rua em novembro de 2026 — Maria da Silva") as HTMLSelectElement).value).toBe("");
  });

  it("fechar com step-up e pendência nova; remessa sem layout; reabrir exportado", async () => {
    const clean = monthRecord({ id: REC, problems: [], homeless: false });
    vi.mocked(api.getPsyMonth).mockResolvedValue(month({ counts: { records: 1, open: 1, closed: 0, exported: 0, with_problems: 0, with_warnings: 0, actions: 3 }, records: [ clean ] }));
    const { client } = mount(psyUser([ "psychosocial_lead" ]), { mfa_verified_at: null });
    fireEvent.click(await screen.findByRole("button", { name: "Fechar o mês" }));
    // A pendência nova apareceu depois da leitura: o api manda a lista com o id do registro.
    vi.mocked(api.closePsyMonth).mockRejectedValueOnce(new ApiError(422, { error: "month_has_problems", problems: [
      { error: "cid_missing", path: `records.${REC}` }, { error: "patient_cns_missing", path: `records.${GONE}` } ] }, "422"));
    // A releitura demora: enquanto isso, a lista da recusa vale.
    let reread: (m: api.PsyMonth) => void = () => undefined;
    vi.mocked(api.getPsyMonth).mockImplementationOnce(() => new Promise((res) => { reread = res; }));
    // Depois do código, a sessão volta com a janela aberta.
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser([ "psychosocial_lead" ]));
    await fillTotpAndConfirm("123456");
    expect(await screen.findByText(PSY_ERRORS.month_has_problems)).not.toBeNull();
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(api.closePsyMonth).toHaveBeenCalledTimes(1);
    expect(api.closePsyMonth).toHaveBeenCalledWith(MONTH31, CAPS_II.id);
    await waitFor(() => expect(api.getPsyMonth).toHaveBeenCalledTimes(2));
    // A pendência vai para a linha do registro (o path preserva o uuid); a de registro que a tela não tem, ao topo, com contexto.
    expect(within(rowOf("Maria da Silva")).getByText(monthProblemLabel("cid_missing"))).not.toBeNull();
    expect(screen.getByText(ORPHAN_PROBLEMS_TEXT)).not.toBeNull();
    expect(screen.getByText(monthProblemLabel("patient_cns_missing"))).not.toBeNull();
    expect((screen.getByRole("button", { name: "Fechar o mês" }) as HTMLButtonElement).disabled).toBe(true);
    // A releitura chega: ela é a verdade, e a lista da recusa sai.
    reread(month({ counts: { records: 1, open: 1, closed: 0, exported: 0, with_problems: 1, with_warnings: 0, actions: 3 },
      records: [ { ...clean, problems: [ "homeless_missing" ] } ] }));
    expect(await within(rowOf("Maria da Silva")).findByText(monthProblemLabel("homeless_missing"))).not.toBeNull();
    expect(within(rowOf("Maria da Silva")).queryByText(monthProblemLabel("cid_missing"))).toBeNull();
    expect(screen.queryByText(ORPHAN_PROBLEMS_TEXT)).toBeNull();

    vi.mocked(api.getPsyMonth).mockResolvedValue(month({ status: "closed", closure: { closed_at: "2026-11-04T09:00:00-03:00", closed_by: LEAD },
      counts: { records: 1, open: 0, closed: 1, exported: 0, with_problems: 0, with_warnings: 0, actions: 3 }, records: [ { ...clean, status: "closed" } ] }));
    vi.mocked(api.createPsyRaasExport).mockRejectedValueOnce(new ApiError(422, { error: "raas_layout_unavailable" }, "422"));
    await client.invalidateQueries({ queryKey: [ PSY_MONTH_KEY ] });
    expect(await screen.findByText("fechado em 04/11/2026 por Ana Coordenadora")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar o mês" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar remessa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    const status = await screen.findByText(PSY_ERRORS.raas_layout_unavailable);
    expect(status.getAttribute("role")).toBe("status");
    expect(api.createPsyRaasExport).toHaveBeenCalledWith(CAPS_II.id, MONTH31);
    expect(screen.getByRole("button", { name: "Fichas espelho do mês (PDF)" })).not.toBeNull();

    vi.mocked(api.reopenPsyMonth).mockRejectedValueOnce(new ApiError(409, { error: "already_exported" }, "409"));
    fireEvent.click(screen.getByRole("button", { name: "Reabrir o mês" }));
    fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.getByText(reasonProblem("curto") as string)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(PSY_ERRORS.already_exported)).not.toBeNull();
    expect(api.reopenPsyMonth).toHaveBeenCalledWith(MONTH31, CAPS_II.id, REASON);
  });

  it("fechar e reabrir com sucesso; remessa gerada e baixada; ficha da linha e do mês", async () => {
    vi.mocked(api.getPsyMonth).mockResolvedValue(month({ counts: { records: 1, open: 1, closed: 0, exported: 0, with_problems: 0, with_warnings: 0, actions: 3 },
      records: [ monthRecord({ problems: [], homeless: false }) ] }));
    vi.mocked(api.closePsyMonth).mockResolvedValue(month({ status: "closed" }));
    const win = { location: { href: "" }, close: vi.fn(), opener: null };
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.mocked(api.fetchPsySheets).mockResolvedValue(PDF);
    mount();
    // Mês aberto: a coordenação vê a PRÉVIA das fichas (mês e linha).
    // Duplo clique abre uma janela só.
    const one = await screen.findByRole("button", { name: "Ficha (PDF) de Maria da Silva" });
    fireEvent.click(one);
    fireEvent.click(one);
    await waitFor(() => expect(api.fetchPsySheets).toHaveBeenCalledWith(MONTH31, { unitId: CAPS_II.id, enrollmentId: "en1" }));
    await waitFor(() => expect((one as HTMLButtonElement).disabled).toBe(false));
    expect(api.fetchPsySheets).toHaveBeenCalledTimes(1);
    const all = screen.getByRole("button", { name: "Fichas espelho do mês (PDF)" });
    fireEvent.click(all);
    fireEvent.click(all);
    await waitFor(() => expect(api.fetchPsySheets).toHaveBeenLastCalledWith(MONTH31, { unitId: CAPS_II.id, enrollmentId: null }));
    await waitFor(() => expect((all as HTMLButtonElement).disabled).toBe(false));
    expect(api.fetchPsySheets).toHaveBeenCalledTimes(2);
    expect(window.open).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Gerar remessa" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Fechar o mês" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(MONTH_CLOSED_DONE)).not.toBeNull();
    expect(api.closePsyMonth).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.getPsyMonth).toHaveBeenCalledTimes(2));

    vi.mocked(api.getPsyMonth).mockResolvedValue(month({ status: "closed", closure: { closed_at: "2026-11-04T09:00:00-03:00", closed_by: LEAD },
      records: [ monthRecord({ problems: [], homeless: false, status: "closed" }) ] }));
    vi.mocked(api.createPsyRaasExport).mockResolvedValue(raasExport());
    // Sem remessa até gerar; depois, a lista traz a nova.
    vi.mocked(api.listPsyRaasExports).mockResolvedValueOnce([]).mockResolvedValue([ raasExport() ]);
    vi.mocked(api.reopenPsyMonth).mockResolvedValue(month());
    cleanup();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar remessa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Remessa gerada · competência de apresentação 12/2026.")).not.toBeNull();
    expect(screen.getByText(RAAS_DOWNLOAD_NOTE)).not.toBeNull();
    const file = { blob: new Blob([ "x" ]), filename: "RAAS-1234567-202612.txt" };
    vi.mocked(api.fetchPsyRaasFile).mockResolvedValue(file);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar remessa de novembro de 2026" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(file, "RAAS-1234567-202612.txt"));
    expect(api.fetchPsyRaasFile).toHaveBeenCalledWith("rx1");

    fireEvent.click(screen.getByRole("button", { name: "Reabrir o mês" }));
    fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: REASON } });
    fireEvent.submit(screen.getByLabelText("Motivo da reabertura").closest("form") as HTMLFormElement);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(MONTH_REOPENED)).not.toBeNull();
    expect(api.reopenPsyMonth).toHaveBeenCalledTimes(1);
  });

  it("mês aberto: equipe só lê (sem fechar, gerar ou baixar)", async () => {
    mount(psyUser([ "psychosocial_staff" ]));
    await screen.findByText("Maria da Silva");
    expect(screen.queryByRole("button", { name: "Fechar o mês" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gerar remessa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fichas espelho do mês (PDF)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ficha (PDF) de Maria da Silva" })).toBeNull();
    expect(api.listPsyRaasExports).not.toHaveBeenCalled();
    // Outro mês: nova leitura com o id do CAPS.
    fireEvent.change(screen.getByLabelText("Mês de atendimento"), { target: { value: "2026-10" } });
    await waitFor(() => expect(api.getPsyMonth).toHaveBeenCalledWith("2026-10", CAPS_II.id));
    expect(screen.queryByRole("option", { name: "dezembro de 2026" })).toBeNull();
  });

  it("faturista: só remessas e fichas do CAPS e do mês, sem a lista nominal", async () => {
    vi.mocked(api.listPsyRaasExports).mockResolvedValue([ raasExport() ]);
    vi.mocked(api.fetchPsySheets).mockRejectedValueOnce(new ApiError(409, { error: "month_open" }, "409"));
    const win = { location: { href: "" }, close: vi.fn(), opener: null };
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    mount(psyUser([ "billing_clerk" ]));
    expect(await screen.findByRole("button", { name: "Baixar remessa de novembro de 2026" })).not.toBeNull();
    expect(api.getPsyMonth).not.toHaveBeenCalled();
    expect(api.listPsyRaasExports).toHaveBeenCalledWith(CAPS_II.id, MONTH31);
    expect(screen.queryByText("Maria da Silva")).toBeNull();
    // Já tem remessa: não gera de novo.
    expect(screen.queryByRole("button", { name: "Gerar remessa" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fichas espelho do mês (PDF)" }));
    expect(await screen.findByText(PSY_ERRORS.month_open)).not.toBeNull();
    expect(win.close).toHaveBeenCalled();
  });

  it("faturista sem remessa no mês: fichas em qualquer mês (mês aberto é recusado); gera com step-up", async () => {
    vi.mocked(api.createPsyRaasExport).mockRejectedValueOnce(new ApiError(409, { error: "month_open" }, "409"));
    vi.mocked(api.fetchPsySheets).mockRejectedValueOnce(new ApiError(409, { error: "month_open" }, "409"));
    const win = { location: { href: "" }, close: vi.fn(), opener: null };
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    mount(psyUser([ "billing_clerk" ]), { mfa_verified_at: null });
    expect(await screen.findByText(NO_RAAS_EXPORTS)).not.toBeNull();
    expect(screen.getByText(BILLING_SHEETS_NOTE)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fichas espelho do mês (PDF)" }));
    expect(await screen.findByText(PSY_ERRORS.month_open)).not.toBeNull();
    expect(win.close).toHaveBeenCalled();
    expect(api.getPsyMonth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gerar remessa" }));
    await fillTotpAndConfirm("654321");
    expect(await screen.findByText(PSY_ERRORS.month_open)).not.toBeNull();
    expect(api.stepUpMfa).toHaveBeenCalledWith("654321");
    expect(api.createPsyRaasExport).toHaveBeenCalledTimes(1);
  });

  it("pendência rebaixada a aviso não bloqueia o fechamento", async () => {
    vi.mocked(api.getPsyMonth).mockResolvedValue(month({ counts: { records: 1, open: 1, closed: 0, exported: 0, with_problems: 0, with_warnings: 1, actions: 0 },
      records: [ monthRecord({ problems: [], homeless: false, actions_count: 0, warnings: [ "cid_missing", "no_actions" ] }) ] }));
    mount();
    await screen.findByText("Maria da Silva");
    expect(within(rowOf("Maria da Silva")).getByText(monthWarningLabel("cid_missing"))).not.toBeNull();
    expect(within(rowOf("Maria da Silva")).getByText(monthWarningLabel("no_actions"))).not.toBeNull();
    expect((screen.getByRole("button", { name: "Fechar o mês" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(closeBlockedHint(1))).toBeNull();
  });

  it("releitura com erro: a lista antiga fica, com aviso", async () => {
    const offline = new ApiError(500, { error: "server_error" }, "500");
    vi.mocked(api.setPsyHomeless).mockResolvedValue({ id: "mr1", enrollment_id: "en1", health_unit_id: CAPS_II.id, month: MONTH31, status: "open", homeless: true });
    mount(psyUser([ "psychosocial_staff" ]));
    await screen.findByText("Maria da Silva");
    vi.mocked(api.getPsyMonth).mockRejectedValueOnce(offline);
    fireEvent.change(screen.getByLabelText("Situação de rua em novembro de 2026 — Maria da Silva"), { target: { value: "yes" } });
    expect(await screen.findByText(`${MONTH_STALE_TEXT} ${psyError(offline)}`)).not.toBeNull();
    expect(screen.getByText("Maria da Silva")).not.toBeNull();
  });

  it("janela do pop-up bloqueada: frase", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Fichas espelho do mês (PDF)" }));
    expect(await screen.findByText(SHEETS_POPUP_BLOCKED)).not.toBeNull();
    expect(api.fetchPsySheets).not.toHaveBeenCalled();
  });
});
