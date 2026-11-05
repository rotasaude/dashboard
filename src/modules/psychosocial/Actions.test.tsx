// Ações da matrícula no CAPS (F-31.4): lista sem evolução e com "Carregar mais", detalhe só no clique (com o id do CAPS na chave),
// crítica local do que o api já vai recusar, recusas do api todas de uma vez (a do participante na linha dele), envio único e
// cancelamento com motivo de 10 a 2000. As frases vêm da lib (ruling: nada de literal repetido).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CAPS_AD_III, CAPS_II, NOW31, OPTIONS, TODAY31, action, actionRow, enrollment, enrollmentRow, psyUser } from "../../test/psychosocialFixtures";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import {
  ACTION_CANCELLED, ACTION_SAVED, AUTHORIZATION_TEXT, CANCEL_LEAD_NOTE, LONG_REASON_TEXT, NO_ACTIONS, PARTICIPANT_NOT_ENROLLED, PSY_ACTIONS_KEY,
  PSY_DETAIL_KEY, PSY_ERRORS, maxQuantityHint, psyError, psychosocialRoles
} from "../../lib/psychosocial";
import { ActionsPanel } from "./ActionsPanel";
import { CapsEnrollments } from "../CapsEnrollments";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyActions: vi.fn(),
  getPsyAction: vi.fn(), createPsyAction: vi.fn(), cancelPsyAction: vi.fn(), listPsyEnrollments: vi.fn(), listPsyUnits: vi.fn(),
  getPsyOptions: vi.fn(), listPsyCarePlansDue: vi.fn(), getPsyEnrollment: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const JOSE = { patient_id: "pt2", name: "José Pereira", cns_masked: null };
const OPEN_LABEL = `Abrir ação de ${fmtDateTime("2026-11-04T09:00:00-03:00")}`;

beforeEach(() => {
  // Se o api mandar evolução ou CID na lista por engano, nada aparece nem fica no cache.
  vi.mocked(api.listPsyActions).mockResolvedValue({ items: [ { ...actionRow(), notes: "NÃO NA LISTA", cid_main: "F322" } as never ], next_before: null });
  vi.mocked(api.getPsyAction).mockResolvedValue(action());
  vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow(), enrollmentRow({ id: "en2", patient: JOSE, started_on: "2026-10-01" }) ]);
});

function mount(o: { roles?: string[]; enrollment?: api.PsyEnrollment } = {}) {
  const user = psyUser(o.roles);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(
    <ActionsPanel enrollment={o.enrollment ?? enrollment()} unit={CAPS_II} options={OPTIONS} roles={psychosocialRoles(user)} now={NOW31} />
  );
}
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const sent = (n = 0) => vi.mocked(api.createPsyAction).mock.calls[n][0];
const actionForm = () => screen.getByRole("form", { name: "Registrar ação" });
const rejected = (problems: { error: string; path: string; participant_index?: number }[]) =>
  new ApiError(422, { error: "action_rejected", problems }, "x");

async function openForm(o: Parameters<typeof mount>[0] = {}) {
  const r = mount(o);
  fireEvent.click(await screen.findByRole("button", { name: "Registrar ação" }));
  return r;
}

describe("Ações do CAPS", () => {
  it("lista sem evolução; detalhe só no clique, com o id do CAPS na chave; Fechar apaga a chave", async () => {
    const { client } = mount();
    expect(await screen.findByText("ATENDIMENTO INDIVIDUAL DE PACIENTE EM CENTRO DE ATENCAO PSICOSSOCIAL")).not.toBeNull();
    expect(screen.getByText("RAAS-PSI")).not.toBeNull();
    expect(screen.getByText("registrada")).not.toBeNull();
    expect(screen.queryByText("NÃO NA LISTA")).toBeNull();
    expect(screen.queryByText(/F32/)).toBeNull();
    expect(JSON.stringify(client.getQueriesData({ queryKey: [ PSY_ACTIONS_KEY ] }))).not.toMatch(/NÃO NA LISTA|F322/);
    expect(vi.mocked(api.listPsyActions).mock.calls[0]).toEqual([ "en1", null ]);
    expect(api.getPsyAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
    expect(await screen.findByText("Relata melhora do sono.")).not.toBeNull();
    expect(vi.mocked(api.getPsyAction).mock.calls[0][0]).toBe("ac1");
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY, "caps2", "action", "ac1" ] }).length).toBe(1);
    // O título do detalhe recebe o foco.
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
    fireEvent.click(screen.getByRole("button", { name: "Fechar ação" }));
    expect(screen.queryByText("Relata melhora do sono.")).toBeNull();
    expect(client.getQueriesData({ queryKey: [ PSY_DETAIL_KEY ] })).toHaveLength(0);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(OPEN_LABEL);
  });

  it("Carregar mais lê a página seguinte pelo cursor", async () => {
    vi.mocked(api.listPsyActions)
      .mockResolvedValueOnce({ items: [ actionRow() ], next_before: "c1" })
      .mockResolvedValueOnce({ items: [ actionRow({ id: "ac2", performed_at: "2026-10-20T15:00:00-03:00" }) ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("button", { name: `Abrir ação de ${fmtDateTime("2026-10-20T15:00:00-03:00")}` })).not.toBeNull();
    expect(vi.mocked(api.listPsyActions).mock.calls[1]).toEqual([ "en1", "c1" ]);
    expect(screen.getByRole("button", { name: OPEN_LABEL })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("cursor velho no Carregar mais: a frase, e a lista é relida do começo", async () => {
    vi.mocked(api.listPsyActions)
      .mockResolvedValueOnce({ items: [ actionRow() ], next_before: "c1" })
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor", path: "before" }, "x"))
      .mockResolvedValueOnce({ items: [ actionRow() ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(PSY_ERRORS.invalid_cursor)).not.toBeNull();
    await waitFor(() => expect(api.listPsyActions).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.listPsyActions).mock.calls[2]).toEqual([ "en1", null ]);
    expect(await screen.findByRole("button", { name: OPEN_LABEL })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull());
  });

  it("três recusas de uma vez (a do familiar na linha dele); mês fechado; o formulário fica intacto", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080208" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" }));
    fireEvent.change(screen.getByLabelText("Nome do familiar 2"), { target: { value: "Joana Silva" } });
    // Local: familiar fora do atendimento familiar.
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(within(screen.getByTestId("participant-1")).getByText(PSY_ERRORS.family_only_for_family_care)).not.toBeNull();
    expect(api.createPsyAction).not.toHaveBeenCalled();
    // Com o código familiar, o api recusa três coisas.
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080224" } });
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(rejected([
      { error: "cbo_incompatible", path: "sigtap_code" }, { error: "quantity_exceeded", path: "quantity" },
      { error: "family_only_for_family_care", path: "participants[1].family_name", participant_index: 1 } ]));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(await screen.findByText(PSY_ERRORS.cbo_incompatible)).not.toBeNull();
    expect(screen.getByText(PSY_ERRORS.quantity_exceeded)).not.toBeNull();
    expect(within(screen.getByTestId("participant-1")).getByText(PSY_ERRORS.family_only_for_family_care)).not.toBeNull();
    expect((screen.getByLabelText("Nome do familiar 2") as HTMLInputElement).value).toBe("Joana Silva");
    expect((screen.getByLabelText("Procedimento") as HTMLSelectElement).value).toBe("0301080224");
    // Foco no primeiro campo recusado.
    expect(document.activeElement).toBe(screen.getByLabelText("Procedimento"));
    expect(sent()).toEqual({ health_unit_id: "caps2", sigtap_code: "0301080224", performed_at: "2026-11-04T10:00:00-03:00", place: "caps",
      quantity: 1, participants: [ { enrollment_id: "en1" }, { family_name: "Joana Silva" } ] });
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(rejected([ { error: "month_closed", path: "performed_at" } ]));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(await screen.findByText(PSY_ERRORS.month_closed)).not.toBeNull();
    expect(screen.queryByText(PSY_ERRORS.cbo_incompatible)).toBeNull();
    expect((screen.getByLabelText("Nome do familiar 2") as HTMLInputElement).value).toBe("Joana Silva");
  });

  it("crítica local: data futura, autorização exigida, máximo do SIGTAP e matrícula que começa depois — nada é enviado", async () => {
    await openForm();
    // Sem autorização exigida, o campo não aparece.
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080208" } });
    expect(screen.queryByLabelText("Número de autorização")).toBeNull();
    expect(screen.getByText(maxQuantityHint(31))).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-04T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(screen.getByText(PSY_ERRORS.performed_in_future)).not.toBeNull();
    expect(screen.getByText(`${PSY_ERRORS.quantity_exceeded} (máximo 31)`)).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Data e hora"));
    // Digitar limpa a marca do campo sem mover o foco.
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "2" } });
    expect(screen.queryByText(`${PSY_ERRORS.quantity_exceeded} (máximo 31)`)).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Data e hora"));
    // Ação antes do início da matrícula (10/09): na linha do participante. Setembro não é a competência de `options` (202611):
    // máximo e autorização daquela competência não valem, e o api critica.
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-09-02T09:00" } });
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080291" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(within(screen.getByTestId("participant-0")).getByText(PARTICIPANT_NOT_ENROLLED)).not.toBeNull();
    expect(screen.queryByText(PSY_ERRORS.authorization_required)).toBeNull();
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-03T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(screen.getByText(PSY_ERRORS.authorization_required)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Número de autorização"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(screen.getByText(AUTHORIZATION_TEXT)).not.toBeNull();
    expect(api.createPsyAction).not.toHaveBeenCalled();
    vi.mocked(api.createPsyAction).mockResolvedValue(action());
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-03T09:30" } });
    fireEvent.change(screen.getByLabelText("Número de autorização"), { target: { value: "1234567890123" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "territory" } });
    fireEvent.change(screen.getByLabelText("Evolução"), { target: { value: "  Visita domiciliar.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ health_unit_id: "caps2", sigtap_code: "0301080291", performed_at: "2026-11-03T09:30:00-03:00", place: "territory",
      quantity: 2, notes: "Visita domiciliar.", authorization_number: "1234567890123", participants: [ { enrollment_id: "en1" } ] });
  });

  it("usuário matriculado entra pela lista do CAPS; retirar; Enter e duplo clique enviam uma vez; sucesso relê a lista", async () => {
    await openForm();
    expect(api.listPsyEnrollments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar usuário matriculado" }));
    const pick = await screen.findByLabelText("Usuário matriculado");
    expect(vi.mocked(api.listPsyEnrollments).mock.calls[0]).toEqual([ { unitId: "caps2", status: "open" } ]);
    // A matrícula da tela já é participante: não aparece de novo.
    await waitFor(() => expect(within(pick).queryByText("José Pereira")).not.toBeNull());
    expect(within(pick).queryByText("Maria da Silva")).toBeNull();
    fireEvent.change(pick, { target: { value: "en2" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir" }));
    expect(within(screen.getByTestId("participant-1")).getByText("José Pereira")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" }));
    expect(screen.getByLabelText("Nome do familiar 3")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retirar participante 3" }));
    expect(screen.queryByLabelText("Nome do familiar 3")).toBeNull();
    // O matriculado da tela não sai.
    expect(screen.queryByRole("button", { name: "Retirar participante 1" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080216" } });
    const d = deferred<api.PsyAction>();
    vi.mocked(api.createPsyAction).mockReturnValue(d.promise);
    // Enter num campo envia o <form>; o duplo clique logo depois não envia de novo.
    fireEvent.submit(actionForm());
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    fireEvent.submit(actionForm());
    await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Salvar ação" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sent().participants).toEqual([ { enrollment_id: "en1" }, { enrollment_id: "en2" } ]);
    d.resolve(action());
    expect(await screen.findByText(ACTION_SAVED)).not.toBeNull();
    expect(document.activeElement?.textContent).toBe(ACTION_SAVED);
    expect(screen.queryByRole("form", { name: "Registrar ação" })).toBeNull();
    await waitFor(() => expect(api.listPsyActions).toHaveBeenCalledTimes(2));
  });

  it("participante repetido e paciente sem matrícula na data, recusados pelo api, vão para a linha do participante", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar usuário matriculado" }));
    fireEvent.change(await screen.findByLabelText("Usuário matriculado"), { target: { value: "en2" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir" }));
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080216" } });
    const repeated = new ApiError(422,
      { error: "invalid_request", path: "participants[1]", problems: [ { error: "invalid_request", path: "participants[1]" } ] }, "x");
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(repeated);
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(await within(screen.getByTestId("participant-1")).findByText(psyError(repeated))).not.toBeNull();
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(rejected([ { error: "enrollment_required", path: "participants[1]", participant_index: 1 } ]));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(await within(screen.getByTestId("participant-1")).findByText(PARTICIPANT_NOT_ENROLLED)).not.toBeNull();
    // Só o `participant_index` (path sem índice): a frase vai para a linha mesmo assim.
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(rejected([ { error: "enrollment_required", path: "participants", participant_index: 1 } ]));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    // A frase é a do participante, recalculada para o path da linha.
    expect(await within(screen.getByTestId("participant-1")).findByText(PARTICIPANT_NOT_ENROLLED)).not.toBeNull();
    // `participants` sem índice fica no bloco dos participantes.
    vi.mocked(api.createPsyAction).mockRejectedValueOnce(rejected([ { error: "enrollment_required", path: "participants" } ]));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    expect(await screen.findByText(PSY_ERRORS.enrollment_required)).not.toBeNull();
  });

  it("cancelar: motivo de 10 a 2000; a equipe com mês fechado recebe lead_required; depois cancela uma vez e a lista é relida", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: OPEN_LABEL }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar ação" }));
    expect(screen.getByText(CANCEL_LEAD_NOTE)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "errado" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(screen.getByText(LONG_REASON_TEXT)).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Motivo do cancelamento"));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "x".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(screen.getByText(LONG_REASON_TEXT)).not.toBeNull();
    expect(api.cancelPsyAction).not.toHaveBeenCalled();
    vi.mocked(api.cancelPsyAction).mockRejectedValueOnce(new ApiError(403, { error: "lead_required" }, "x"));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "registrada no usuário errado" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText(PSY_ERRORS.lead_required)).not.toBeNull();
    const d = deferred<api.PsyActionRow>();
    vi.mocked(api.cancelPsyAction).mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(api.cancelPsyAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.cancelPsyAction).mock.calls[1]).toEqual([ "ac1", "registrada no usuário errado" ]);
    d.resolve(actionRow({ cancelled: true }));
    expect(await screen.findByText(ACTION_CANCELLED)).not.toBeNull();
    expect(screen.getByText("registrada no usuário errado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar ação" })).toBeNull();
    await waitFor(() => expect(api.listPsyActions).toHaveBeenCalledTimes(2));
  });

  it("a coordenação cancela sem a dica do mês fechado; already_exported e already_cancelled", async () => {
    mount({ roles: [ "psychosocial_lead" ] });
    fireEvent.click(await screen.findByRole("button", { name: OPEN_LABEL }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar ação" }));
    expect(screen.queryByText(CANCEL_LEAD_NOTE)).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "registrada no usuário errado" } });
    vi.mocked(api.cancelPsyAction).mockRejectedValueOnce(new ApiError(409, { error: "already_exported" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText(PSY_ERRORS.already_exported)).not.toBeNull();
    // Outra pessoa cancelou antes: a frase, o detalhe e a lista são relidos.
    vi.mocked(api.getPsyAction).mockResolvedValue(action({ cancelled: true, cancel_reason: "duplicada", cancelled_at: "2026-11-04T09:40:00-03:00" }));
    vi.mocked(api.cancelPsyAction).mockRejectedValueOnce(new ApiError(409, { error: "already_cancelled" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText(PSY_ERRORS.already_cancelled)).not.toBeNull();
    expect(await screen.findByText("duplicada")).not.toBeNull();
    expect(api.getPsyAction).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.listPsyActions).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Cancelar ação" })).toBeNull();
  });

  it("ação cancelada aparece riscada, com o motivo só no detalhe e sem botão de cancelar; familiar no detalhe", async () => {
    vi.mocked(api.listPsyActions).mockResolvedValue({ items: [ actionRow({ cancelled: true }) ], next_before: null });
    vi.mocked(api.getPsyAction).mockResolvedValue(action({ cancelled: true, cancel_reason: "registrada no usuário errado",
      cancelled_at: "2026-11-04T09:40:00-03:00", participants: [ { enrollment_id: "en1", patient: { patient_id: "pt1", name: "Maria da Silva", cns_masked: null } },
        { family_name: "Joana Silva" } ] }));
    mount();
    expect(await screen.findByText("cancelada")).not.toBeNull();
    expect(screen.queryByText("registrada no usuário errado")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
    expect(await screen.findByText("registrada no usuário errado")).not.toBeNull();
    expect(screen.getByText("familiar: Joana Silva")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar ação" })).toBeNull();
  });

  it("matrícula encerrada: lista as ações, sem Registrar ação; nenhuma ação tem frase própria", async () => {
    vi.mocked(api.listPsyActions).mockResolvedValue({ items: [], next_before: null });
    mount({ enrollment: enrollment({ status: "closed", closed_on: "2026-11-01", destination: "01" }) });
    expect(await screen.findByText(NO_ACTIONS)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar ação" })).toBeNull();
  });

  it("dois familiares fora do atendimento familiar: a frase em cada linha, e cada aria-describedby aponta para um id que existe", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080208" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" }));
    fireEvent.change(screen.getByLabelText("Nome do familiar 2"), { target: { value: "Joana Silva" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" }));
    fireEvent.change(screen.getByLabelText("Nome do familiar 3"), { target: { value: "Pedro Silva" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
    for (const [ i, label ] of [ [ 1, "Nome do familiar 2" ], [ 2, "Nome do familiar 3" ] ] as const) {
      expect(within(screen.getByTestId(`participant-${i}`)).getByText(PSY_ERRORS.family_only_for_family_care)).not.toBeNull();
      const described = screen.getByLabelText(label).getAttribute("aria-describedby") as string;
      expect(document.getElementById(described)?.textContent).toBe(PSY_ERRORS.family_only_for_family_care);
    }
    // Trocar o procedimento limpa as marcas dos familiares.
    fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080224" } });
    expect(screen.queryByText(PSY_ERRORS.family_only_for_family_care)).toBeNull();
    expect(api.createPsyAction).not.toHaveBeenCalled();
  });

  it("foco ao acrescentar e retirar participante: o campo novo ou o botão vizinho, nunca o body", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nome do familiar 2")));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nome do familiar 3")));
    // Retirar o último: o foco vai ao Retirar da linha anterior.
    fireEvent.click(screen.getByRole("button", { name: "Retirar participante 3" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retirar participante 2" })));
    // Retirar o único retirável: o foco vai ao botão de acrescentar familiar.
    fireEvent.click(screen.getByRole("button", { name: "Retirar participante 2" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Adicionar familiar sem cadastro" })));
    // Matriculado incluído: o foco vai ao Retirar dele.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar usuário matriculado" }));
    const pick = await screen.findByLabelText("Usuário matriculado");
    await waitFor(() => expect(within(pick).queryByText("José Pereira")).not.toBeNull());
    fireEvent.change(pick, { target: { value: "en2" } });
    fireEvent.click(screen.getByRole("button", { name: "Incluir" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retirar participante 2" })));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("relógio que anda: a ação feita depois de abrir o formulário não é data futura (sem now por prop)", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    try {
      vi.setSystemTime(NOW31);
      vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
      vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
      vi.mocked(api.getPsyOptions).mockResolvedValue(OPTIONS);
      vi.mocked(api.listPsyCarePlansDue).mockResolvedValue([]);
      vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment());
      vi.mocked(api.createPsyAction).mockResolvedValue(action());
      renderWithProviders(<CapsEnrollments today={TODAY31} />);
      fireEvent.click(await screen.findByRole("button", { name: "Abrir Maria da Silva" }));
      fireEvent.click(await screen.findByRole("tab", { name: "Ações" }));
      vi.setSystemTime(new Date("2026-11-04T10:20:00-03:00"));
      fireEvent.click(await screen.findByRole("button", { name: "Registrar ação" }));
      // O padrão e o máximo do campo são a hora em que o formulário abriu.
      expect((screen.getByLabelText("Data e hora") as HTMLInputElement).value).toBe("2026-11-04T10:20");
      fireEvent.change(screen.getByLabelText("Procedimento"), { target: { value: "0301080208" } });
      fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-04T10:40" } });
      vi.setSystemTime(new Date("2026-11-04T11:00:00-03:00"));
      fireEvent.click(screen.getByRole("button", { name: "Salvar ação" }));
      expect(screen.queryByText(PSY_ERRORS.performed_in_future)).toBeNull();
      await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
      expect(sent().performed_at).toBe("2026-11-04T10:40:00-03:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a aba Ações do detalhe da matrícula monta a lista da matrícula", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
    vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II, CAPS_AD_III ]);
    vi.mocked(api.getPsyOptions).mockResolvedValue(OPTIONS);
    vi.mocked(api.listPsyCarePlansDue).mockResolvedValue([]);
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment());
    renderWithProviders(<CapsEnrollments today={TODAY31} now={NOW31} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Maria da Silva" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Ações" }));
    expect(await screen.findByRole("button", { name: OPEN_LABEL })).not.toBeNull();
    expect(vi.mocked(api.listPsyActions).mock.calls[0]).toEqual([ "en1", null ]);
  });
});
