// Matriciamento do CAPS (F-31.7): lista sem tema nem texto compartilhado (mais nova primeiro, "Carregar mais"), detalhe só no
// clique e fora do cache ao fechar, registro com a conferência inteira de uma vez e a crítica do api nos campos, caso compartilhado
// pela busca da pessoa e matriciamento cancelado sem "Adicionar caso". As frases vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_II, ME_PSY, NOW31, OPTIONS, TODAY31, matrixSupport, matrixSupportRow, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import {
  CASE_NOT_ENROLLED_NOTE, CASE_SAVED, CASE_TEXT, FUTURE_DATE_TEXT, MATRIX_BPAC_NOTE, MATRIX_CANCELLED_NOTE, MATRIX_LIST_NOTE, MATRIX_NO_CLINICAL_NOTE,
  MATRIX_PARTICIPANTS_MAX_TEXT, MATRIX_PARTICIPANTS_TEXT, MATRIX_PROCEDURE_TEXT, MATRIX_READ_NOTE, MATRIX_SAVED, MATRIX_TEAM_TEXT, MATRIX_TOPIC_TEXT,
  NO_MATRIX_PROCEDURES, NO_MATRIX_SUPPORTS, PSY_DETAIL_KEY, PSY_ERRORS, TRAIL_NOTE, defaultMatrixProcedure, emptyMatrixDraft, matrixProblems,
  matrixProcedures, matrixRefusal, matrixTeamLabel
} from "../lib/psychosocial";
import { CapsMatrix } from "./CapsMatrix";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyOptions: vi.fn(),
  listPsyMatrixSupports: vi.fn(), getPsyMatrixSupport: vi.fn(), createPsyMatrixSupport: vi.fn(), addPsyMatrixCase: vi.fn(), lookupPsyPerson: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const TEAM_UNIT = "ESF Vila Verde · UBS Vila Verde";
const SHARED = "Acompanhar adesão à medicação.";
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  // O api não manda tema nem texto compartilhado na lista; se mandar por engano, a tela não mostra.
  vi.mocked(api.listPsyMatrixSupports).mockResolvedValue({
    items: [ { ...matrixSupportRow(), topic: "TEMA NÃO DEVE APARECER", shared_text: "TEXTO NÃO DEVE APARECER" } as never ], next_before: null
  });
  vi.mocked(api.getPsyMatrixSupport).mockResolvedValue(matrixSupport());
  vi.mocked(api.createPsyMatrixSupport).mockResolvedValue({ ...matrixSupport(), id: "ms9", cases: [] });
  vi.mocked(api.addPsyMatrixCase).mockResolvedValue({ id: "mc2", patient: { patient_id: "pt1", name: "Maria da Silva", cns_masked: null },
    shared_text: "Combinar visita domiciliar com a ACS.", created_at: "2026-11-04T10:05:00-03:00" });
});

function mount(o: { options?: api.PsyOptions; realClock?: boolean } = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
  vi.mocked(api.getPsyOptions).mockResolvedValue(o.options ?? OPTIONS);
  return renderWithProviders(o.realClock ? <CapsMatrix today={TODAY31} /> : <CapsMatrix today={TODAY31} now={NOW31} />);
}
const openForm = async () => { fireEvent.click(await screen.findByRole("button", { name: "Registrar matriciamento" })); await screen.findByLabelText("Equipe da UBS"); };
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar matriciamento" }));
const sentCreate = (i = 0) => vi.mocked(api.createPsyMatrixSupport).mock.calls[i][0];
async function fillForm() {
  fireEvent.change(screen.getByLabelText("Equipe da UBS"), { target: { value: "ht1" } });
  fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "Casos de uso de álcool" } });
  fireEvent.click(screen.getByRole("checkbox", { name: ME_PSY.name }));
}
async function openSupport() {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Abrir matriciamento de 03/11/2026" }));
  await screen.findByText(SHARED);
}
async function pickPerson() {
  vi.mocked(api.lookupPsyPerson).mockResolvedValue({ patient_id: "pt1", display_name: "Maria da Silva", has_cpf: true, cns_masked: null,
    citizen_id: null, registration_id: null });
  fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "123.456.789-09" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
  fireEvent.click(await screen.findByRole("button", { name: "Escolher Maria da Silva" }));
}

describe("Matriciamento do CAPS", () => {
  it("lista sem tema nem texto compartilhado; o detalhe só no clique e fora do cache ao fechar", async () => {
    const { client } = mount();
    expect(await screen.findByText(TEAM_UNIT)).not.toBeNull();
    expect(screen.getByText("03/11/2026")).not.toBeNull();
    expect(screen.getByText(ME_PSY.name)).not.toBeNull();
    expect(screen.getByText("MATRICIAMENTO DE EQUIPES DA ATENCAO BASICA")).not.toBeNull();
    expect(screen.getByText("registrado")).not.toBeNull();
    expect(screen.getByText(MATRIX_LIST_NOTE)).not.toBeNull();
    expect(screen.getByText(TRAIL_NOTE)).not.toBeNull();
    expect(screen.queryByText("TEMA NÃO DEVE APARECER")).toBeNull();
    expect(screen.queryByText("TEXTO NÃO DEVE APARECER")).toBeNull();
    expect(vi.mocked(api.listPsyMatrixSupports).mock.calls[0]).toEqual([ CAPS_II.id, null ]);
    expect(api.getPsyMatrixSupport).not.toHaveBeenCalled();
    // O cache da lista guarda só os campos da linha.
    const cached = client.getQueryCache().findAll({ queryKey: [ "psyMatrix", CAPS_II.id ] })[0].state.data as { pages: { items: object[] }[] };
    expect(Object.keys(cached.pages[0].items[0])).not.toContain("topic");
    expect(Object.keys(cached.pages[0].items[0])).not.toContain("shared_text");

    fireEvent.click(screen.getByRole("button", { name: "Abrir matriciamento de 03/11/2026" }));
    expect(await screen.findByText(SHARED)).not.toBeNull();
    expect(screen.getByText("Casos de risco do território")).not.toBeNull();
    expect(screen.getByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByText(MATRIX_READ_NOTE)).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Matriciamento de 03/11/2026");
    expect(vi.mocked(api.getPsyMatrixSupport).mock.calls[0][0]).toBe("ms1");
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY, CAPS_II.id, "matrix", "ms1" ] }).length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText(SHARED)).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY ] }).length).toBe(0);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Abrir matriciamento de 03/11/2026");
  });

  it("sem registro: a frase; a lista pagina por Carregar mais, sem repetir linha", async () => {
    vi.mocked(api.listPsyMatrixSupports).mockResolvedValueOnce({ items: [], next_before: null });
    mount();
    expect(await screen.findByText(NO_MATRIX_SUPPORTS)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    cleanup();

    vi.mocked(api.listPsyMatrixSupports)
      .mockResolvedValueOnce({ items: [ matrixSupportRow() ], next_before: "cursor-1" })
      .mockResolvedValueOnce({ items: [ matrixSupportRow(), matrixSupportRow({ id: "ms0", held_on: "2026-10-20" }) ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("button", { name: "Abrir matriciamento de 20/10/2026" })).not.toBeNull();
    expect(vi.mocked(api.listPsyMatrixSupports).mock.calls.at(-1)).toEqual([ CAPS_II.id, "cursor-1" ]);
    expect(screen.getAllByRole("button", { name: "Abrir matriciamento de 03/11/2026" }).length).toBe(1);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("cancelado: a situação na lista e no detalhe, sem Adicionar caso", async () => {
    vi.mocked(api.listPsyMatrixSupports).mockResolvedValue({ items: [ matrixSupportRow({ action_cancelled_at: "2026-11-04T08:00:00-03:00" }) ], next_before: null });
    vi.mocked(api.getPsyMatrixSupport).mockResolvedValue(matrixSupport({ action_cancelled_at: "2026-11-04T08:00:00-03:00" }));
    mount();
    expect(await screen.findByText("cancelado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir matriciamento de 03/11/2026" }));
    expect(await screen.findByText(MATRIX_CANCELLED_NOTE)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar caso" })).toBeNull();
  });

  it("detalhe que sumiu (404): a frase, o detalhe fecha e a lista é relida", async () => {
    vi.mocked(api.getPsyMatrixSupport).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir matriciamento de 03/11/2026" }));
    expect(await screen.findByText(PSY_ERRORS.not_found)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar caso" })).toBeNull();
    await waitFor(() => expect(api.listPsyMatrixSupports).toHaveBeenCalledTimes(2));
  });

  it("registrar: confere tudo de uma vez; completo, envia o corpo e relê a lista", async () => {
    mount();
    await openForm();
    expect(screen.getByText(MATRIX_BPAC_NOTE)).not.toBeNull();
    expect(screen.getByRole("option", { name: "Escolha a equipe" })).not.toBeNull();
    expect(screen.getByRole("option", { name: TEAM_UNIT })).not.toBeNull();
    // O procedimento BPA-C já vem escolhido; a data, hoje.
    expect((screen.getByLabelText("Procedimento") as HTMLSelectElement).value).toBe("0301080305");
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe(TODAY31);
    save();
    expect(screen.getByText(MATRIX_TEAM_TEXT)).not.toBeNull();
    expect(screen.getByText(MATRIX_TOPIC_TEXT)).not.toBeNull();
    expect(screen.getByText(MATRIX_PARTICIPANTS_TEXT)).not.toBeNull();
    expect(api.createPsyMatrixSupport).not.toHaveBeenCalled();
    // O foco vai ao primeiro campo inválido.
    expect(document.activeElement).toBe(screen.getByLabelText("Equipe da UBS"));
    await fillForm();
    save();
    await waitFor(() => expect(api.createPsyMatrixSupport).toHaveBeenCalledTimes(1));
    expect(sentCreate()).toEqual({ health_unit_id: CAPS_II.id, health_team_id: "ht1", held_on: TODAY31, topic: "Casos de uso de álcool",
      participants_user_ids: [ "u-1" ], sigtap_code: "0301080305" });
    const ok = await screen.findByText(MATRIX_SAVED);
    expect(ok.textContent).not.toContain(CAPS_II.name);
    expect(document.activeElement).toBe(ok);
    expect(screen.queryByLabelText("Equipe da UBS")).toBeNull();
    await waitFor(() => expect(api.listPsyMatrixSupports).toHaveBeenCalledTimes(2));
  });

  it("data futura não envia; tema só de espaços não envia; mais de 20 profissionais não envia", async () => {
    const team = Array.from({ length: 21 }, (_, i) => ({ user_id: `p${i}`, name: `Profissional ${i}`, cbo_code: "251510" }));
    mount({ options: { ...OPTIONS, team } });
    await openForm();
    fireEvent.change(screen.getByLabelText("Equipe da UBS"), { target: { value: "ht1" } });
    fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-05" } });
    for (const p of team) fireEvent.click(screen.getByRole("checkbox", { name: p.name }));
    save();
    expect(screen.getByText(FUTURE_DATE_TEXT)).not.toBeNull();
    expect(screen.getByText(MATRIX_TOPIC_TEXT)).not.toBeNull();
    expect(screen.getByText(MATRIX_PARTICIPANTS_MAX_TEXT)).not.toBeNull();
    expect(api.createPsyMatrixSupport).not.toHaveBeenCalled();
  });

  it("só o procedimento BPA-C sem BPA-I serve; sem nenhum, a frase e nada é enviado", async () => {
    const proc = (code: string, name: string, instrument_codes: string[]) =>
      ({ code, name, instrument_codes, family_care: false, collective: false, max_quantity: null, requires_authorization: false });
    mount({ options: { ...OPTIONS, procedures: [ proc("0301080305", "MATRICIAMENTO DE EQUIPES", [ "01" ]), proc("0301080999", "OUTRO COM BPA-I", [ "01", "02" ]),
      proc("0301080208", "INDIVIDUAL", [ "09" ]) ] } });
    await openForm();
    expect(screen.getByRole("option", { name: "0301080305 · MATRICIAMENTO DE EQUIPES" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: /OUTRO COM BPA-I/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /INDIVIDUAL/ })).toBeNull();
    cleanup();

    mount({ options: { ...OPTIONS, procedures: [ proc("0301080208", "INDIVIDUAL", [ "09" ]) ] } });
    await openForm();
    expect(screen.getByText(NO_MATRIX_PROCEDURES)).not.toBeNull();
    await fillForm();
    save();
    expect(screen.getByText(MATRIX_PROCEDURE_TEXT)).not.toBeNull();
    expect(api.createPsyMatrixSupport).not.toHaveBeenCalled();
  });

  it("a crítica do api chega toda de uma vez nos campos, com o formulário intacto", async () => {
    vi.mocked(api.createPsyMatrixSupport).mockRejectedValueOnce(new ApiError(422, { error: "action_rejected", problems: [
      { error: "cbo_incompatible", path: "sigtap_code" }, { error: "performed_in_future", path: "held_on" },
      // Path de ação que o matriciamento não tem: vai ao procedimento.
      { error: "quantity_exceeded", path: "quantity" }, { error: "performed_in_future", path: "performed_at" }
    ] }, "recusa"));
    mount();
    await openForm();
    await fillForm();
    save();
    expect((await screen.findAllByText(PSY_ERRORS.cbo_incompatible)).length).toBe(1);
    expect(screen.getByText(PSY_ERRORS.quantity_exceeded)).not.toBeNull();
    expect(screen.getAllByText(FUTURE_DATE_TEXT).length).toBe(1);
    expect(screen.getByLabelText("Procedimento").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Data").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Casos de uso de álcool");
    expect((screen.getByRole("checkbox", { name: ME_PSY.name }) as HTMLInputElement).checked).toBe(true);
    // Corrigir o campo tira a marca dele só.
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-03" } });
    expect(screen.queryByText(FUTURE_DATE_TEXT)).toBeNull();
    expect(screen.getByText(PSY_ERRORS.cbo_incompatible)).not.toBeNull();
  });

  it("instrument_mismatch fica no procedimento e profissional fora da equipe vai ao grupo de caixas", async () => {
    vi.mocked(api.createPsyMatrixSupport).mockRejectedValueOnce(new ApiError(422, { error: "instrument_mismatch", path: "sigtap_code", problems: [
      { error: "instrument_mismatch", path: "sigtap_code" }, { error: "invalid_request", path: "participants_user_ids[0]" } ] }, "recusa"));
    mount();
    await openForm();
    await fillForm();
    save();
    expect(await screen.findByText(PSY_ERRORS.instrument_mismatch)).not.toBeNull();
    expect(screen.getByText("escolha de 1 a 20 participantes lotados neste CAPS")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Profissionais do CAPS" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("duplo clique em Salvar envia uma vez; a resposta fecha o formulário", async () => {
    const d = deferred<api.PsyMatrixSupport>();
    vi.mocked(api.createPsyMatrixSupport).mockReturnValueOnce(d.promise);
    mount();
    await openForm();
    await fillForm();
    const button = screen.getByRole("button", { name: "Salvar matriciamento" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(api.createPsyMatrixSupport).toHaveBeenCalledTimes(1);
    d.resolve({ ...matrixSupport(), id: "ms9", cases: [] });
    expect(await screen.findByText(MATRIX_SAVED)).not.toBeNull();
  });

  it("o formulário confere a data no relógio de hoje, não no da abertura", async () => {
    mount({ realClock: true });
    await openForm();
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: future } });
    save();
    expect(screen.getByText(FUTURE_DATE_TEXT)).not.toBeNull();
  });

  it("caso: a pessoa pela busca, texto de 10 a 2000; só então envia e relê o detalhe e a lista", async () => {
    await openSupport();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    expect(screen.getByText(CASE_NOT_ENROLLED_NOTE)).not.toBeNull();
    // Sem a pessoa não há texto nem botão de salvar.
    expect(screen.queryByRole("button", { name: "Salvar caso" })).toBeNull();
    await pickPerson();
    expect(screen.getByText(MATRIX_NO_CLINICAL_NOTE)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Texto compartilhado com a equipe"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar caso" }));
    expect(screen.getByText(CASE_TEXT)).not.toBeNull();
    expect(api.addPsyMatrixCase).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Texto compartilhado com a equipe"), { target: { value: "  Combinar visita domiciliar com a ACS.  " } });
    expect(screen.getByText("37 de 2000 caracteres")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar caso" }));
    await waitFor(() => expect(api.addPsyMatrixCase).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.addPsyMatrixCase).mock.calls[0]).toEqual([ "ms1", { patient_id: "pt1", shared_text: "Combinar visita domiciliar com a ACS." } ]);
    const ok = await screen.findByText(CASE_SAVED);
    expect(ok.textContent).not.toContain(CAPS_II.name);
    // O caso devolvido (201) entra no detalhe aberto sem reler o detalhe (nenhuma trilha nova); a lista é relida.
    expect(await screen.findByText("Combinar visita domiciliar com a ACS.")).not.toBeNull();
    await waitFor(() => expect(api.listPsyMatrixSupports).toHaveBeenCalledTimes(2));
    expect(api.getPsyMatrixSupport).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Texto compartilhado com a equipe")).toBeNull();
  });

  it("Abrir na linha já aberta não esvazia o detalhe; o caso novo aparece", async () => {
    await openSupport();
    fireEvent.click(screen.getByRole("button", { name: "Abrir matriciamento de 03/11/2026" }));
    expect(screen.getByText(SHARED)).not.toBeNull();
    expect(api.getPsyMatrixSupport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    await pickPerson();
    fireEvent.change(screen.getByLabelText("Texto compartilhado com a equipe"), { target: { value: "Combinar visita domiciliar com a ACS." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar caso" }));
    expect(await screen.findByText("Combinar visita domiciliar com a ACS.")).not.toBeNull();
    expect(screen.getByText(SHARED)).not.toBeNull();
  });

  it("Cancelar devolve o foco ao botão que abriu o formulário", async () => {
    mount();
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Registrar matriciamento" }));
    cleanup();

    await openSupport();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Adicionar caso" }));
    // Também na busca da pessoa e depois de escolhê-la.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    await pickPerson();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Adicionar caso" }));
  });

  it("lista que mudou ao rolar (invalid_cursor): a frase e a lista relida do começo", async () => {
    vi.mocked(api.listPsyMatrixSupports)
      .mockResolvedValueOnce({ items: [ matrixSupportRow() ], next_before: "cursor-1" })
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor", path: "before" }, "x"))
      .mockResolvedValueOnce({ items: [ matrixSupportRow() ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(PSY_ERRORS.invalid_cursor)).not.toBeNull();
    await waitFor(() => expect(api.listPsyMatrixSupports).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.listPsyMatrixSupports).mock.calls[2]).toEqual([ CAPS_II.id, null ]);
    expect(screen.getByRole("button", { name: "Abrir matriciamento de 03/11/2026" })).not.toBeNull();
  });

  it("trocar a pessoa guarda o texto; texto acima de 2000 não envia", async () => {
    await openSupport();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    await pickPerson();
    fireEvent.change(screen.getByLabelText("Texto compartilhado com a equipe"), { target: { value: "a".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar caso" }));
    expect(screen.getByText(CASE_TEXT)).not.toBeNull();
    expect(api.addPsyMatrixCase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Trocar a pessoa" }));
    expect(screen.getByLabelText("CPF")).not.toBeNull();
    await pickPerson();
    expect((screen.getByLabelText("Texto compartilhado com a equipe") as HTMLTextAreaElement).value.length).toBe(2001);
  });

  it("matriciamento cancelado no meio: 409 already_cancelled fecha o formulário, relê e tira o botão", async () => {
    await openSupport();
    vi.mocked(api.addPsyMatrixCase).mockRejectedValueOnce(new ApiError(409, { error: "already_cancelled" }, "x"));
    vi.mocked(api.getPsyMatrixSupport).mockResolvedValue(matrixSupport({ action_cancelled_at: "2026-11-04T10:00:00-03:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    await pickPerson();
    fireEvent.change(screen.getByLabelText("Texto compartilhado com a equipe"), { target: { value: "Combinar visita domiciliar com a ACS." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar caso" }));
    expect(await screen.findByText(MATRIX_CANCELLED_NOTE)).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Adicionar caso" })).toBeNull());
    expect(screen.queryByLabelText("Texto compartilhado com a equipe")).toBeNull();
    expect(screen.getByText("cancelado")).not.toBeNull();
    // A frase aparece uma vez só, também depois de o detalhe reler.
    expect(screen.getAllByText(MATRIX_CANCELLED_NOTE).length).toBe(1);
  });

  it("recusa do texto no api aparece no campo, com o texto digitado intacto", async () => {
    await openSupport();
    vi.mocked(api.addPsyMatrixCase).mockRejectedValueOnce(new ApiError(422, { error: "too_long", path: "shared_text",
      problems: [ { error: "too_long", path: "shared_text" } ] }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar caso" }));
    await pickPerson();
    fireEvent.change(screen.getByLabelText("Texto compartilhado com a equipe"), { target: { value: "Combinar visita domiciliar com a ACS." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar caso" }));
    expect(await screen.findByText("o texto compartilhado tem de 10 a 2000 caracteres")).not.toBeNull();
    expect(screen.getByLabelText("Texto compartilhado com a equipe").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Texto compartilhado com a equipe") as HTMLTextAreaElement).value).toBe("Combinar visita domiciliar com a ACS.");
  });
});

describe("regras do matriciamento", () => {
  const procs = matrixProcedures(OPTIONS);
  it("o padrão é o procedimento de nome MATRICIAMENTO, ou o único; senão a pessoa escolhe", () => {
    expect(defaultMatrixProcedure(procs)).toBe("0301080305");
    const mk = (code: string, name: string) => ({ ...procs[0], code, name });
    expect(defaultMatrixProcedure([ mk("1", "VISITA") ])).toBe("1");
    expect(defaultMatrixProcedure([ mk("1", "VISITA"), mk("2", "APOIO") ])).toBe("");
    expect(defaultMatrixProcedure([])).toBe("");
  });
  it("matrixProblems: tudo de uma vez, com os paths do api", () => {
    expect(matrixProblems(emptyMatrixDraft(TODAY31, []), TODAY31).map((p) => p.path)).toEqual([ "health_team_id", "topic", "participants_user_ids", "sigtap_code" ]);
    expect(matrixProblems({ ...emptyMatrixDraft(TODAY31, procs), teamId: "ht1", topic: "x", userIds: [ "u-1" ], heldOn: "2026-02-30" }, TODAY31).map((p) => p.path))
      .toEqual([ "held_on" ]);
    expect(matrixProblems({ ...emptyMatrixDraft(TODAY31, procs), teamId: "ht1", topic: "x".repeat(201), userIds: [ "u-1" ] }, TODAY31).map((p) => p.path)).toEqual([ "topic" ]);
    expect(matrixProblems({ ...emptyMatrixDraft(TODAY31, procs), teamId: "ht1", topic: "x", userIds: [ "u-1" ] }, TODAY31)).toEqual([]);
  });
  it("matrixRefusal: performed_at é held_on; o resto da ação é do procedimento; índice vai ao grupo", () => {
    expect(matrixRefusal({ code: "performed_in_future", path: "performed_at", text: "x" })).toEqual({ path: "held_on", text: FUTURE_DATE_TEXT });
    expect(matrixRefusal({ code: "quantity_exceeded", path: "quantity", text: "x" }).path).toBe("sigtap_code");
    expect(matrixRefusal({ code: "invalid_request", path: "participants_user_ids[3]", text: "x" }).path).toBe("participants_user_ids");
    expect(matrixRefusal({ code: "x", path: "", text: "topo" })).toEqual({ path: "", text: "topo" });
    expect(matrixRefusal({ code: "invalid_request", path: "topic", text: "t" })).toEqual({ path: "topic", text: "t" });
  });
  it("matrixTeamLabel: equipe e unidade; equipe fora da lista só pelo nome", () => {
    expect(matrixTeamLabel({ id: "ht1", name: "ESF Vila Verde" }, OPTIONS.health_teams)).toBe(TEAM_UNIT);
    expect(matrixTeamLabel({ id: "ht9", name: "ESF Antiga" }, OPTIONS.health_teams)).toBe("ESF Antiga");
  });
});
