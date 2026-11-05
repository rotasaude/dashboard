// Usuários do CAPS (F-31.2, F-31.3): lista sem dado clínico, filtro por nome local, detalhe só no clique (com o id do CAPS na
// chave), edição só do que mudou, encerramento com destino e PTS com versões. As frases vêm da lib.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_AD_III, CAPS_II, NOW31, OPTIONS, TODAY31, carePlan, enrollment, enrollmentRow, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { addDays } from "../lib/campaigns";
import {
  CARE_PLAN_OVERDUE_TAG, CARE_PLAN_SAVED, CLOSE_NOTE, DEFAULT_CARE_PLAN_REVIEW_DAYS, DUE_LEAD_NOTE, DUE_STAFF_NOTE, ENROLLMENT_CLOSED, ENROLLMENT_OTHER_CAPS,
  ENROLLMENT_UPDATED, NOTHING_CHANGED, NO_CARE_PLAN, NO_CARE_PLAN_DUE, NO_CLINICAL_IN_LIST, PSY_DETAIL_KEY, PSY_ERRORS, RESPONSIBLE_OUT, TRAIL_NOTE, carePlanProblems, closeProblems,
  enrollmentProblems, emptyEnrollmentDraft, psyError
} from "../lib/psychosocial";
import { CapsEnrollments } from "./CapsEnrollments";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyOptions: vi.fn(),
  listPsyEnrollments: vi.fn(), listPsyCarePlansDue: vi.fn(), getPsyEnrollment: vi.fn(), updatePsyEnrollment: vi.fn(), closePsyEnrollment: vi.fn(),
  listPsyCarePlans: vi.fn(), createPsyCarePlan: vi.fn(), getPsySettings: vi.fn(), getPsyPrefill: vi.fn(), searchTerminology: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const JOSE = { patient_id: "pt2", name: "José Pereira", cns_masked: null };

// Padrões de cada teste; o teste troca antes de montar.
beforeEach(() => {
  // O api não manda dado clínico na lista; se mandar por engano, a tela não mostra.
  vi.mocked(api.listPsyEnrollments).mockResolvedValue([ { ...enrollmentRow(), cid_main: "F322", substances: [ "01" ], notes: "segredo" } as never ]);
  vi.mocked(api.listPsyCarePlansDue).mockResolvedValue([]);
  vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment());
  vi.mocked(api.listPsyCarePlans).mockResolvedValue([ carePlan() ]);
});

function mount(o: {
  roles?: string[]; units?: api.PsyUnit[]; initialEnrollment?: { enrollmentId: string; unitId: string } | null; strict?: boolean; options?: api.PsyOptions;
} = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser(o.roles));
  vi.mocked(api.listPsyUnits).mockResolvedValue(o.units ?? [ CAPS_II, CAPS_AD_III ]);
  vi.mocked(api.getPsyOptions).mockResolvedValue(o.options ?? OPTIONS);
  const ui = <CapsEnrollments today={TODAY31} now={NOW31} initialEnrollment={o.initialEnrollment} />;
  return renderWithProviders(o.strict ? <StrictMode>{ui}</StrictMode> : ui);
}

async function openDetail(o: Parameters<typeof mount>[0] = {}) {
  const r = mount(o);
  fireEvent.click(await screen.findByRole("button", { name: "Abrir Maria da Silva" }));
  await screen.findByRole("button", { name: "Fechar" });
  await waitFor(() => expect(screen.queryByText(/F32\.2/)).not.toBeNull());
  return r;
}
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const textOf = (list: { path: string; text: string }[], path: string) => list.find((p) => p.path === path)?.text as string;

describe("Usuários do CAPS", () => {
  it("lista ignora campo clínico; detalhe só no clique; trocar de CAPS limpa", async () => {
    const { client } = mount();
    expect(await screen.findByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByText(NO_CLINICAL_IN_LIST)).not.toBeNull();
    expect(screen.queryByText(/F32/)).toBeNull();
    expect(screen.queryByText("segredo")).toBeNull();
    expect(screen.queryByText("Álcool")).toBeNull();
    expect(vi.mocked(api.listPsyEnrollments).mock.calls[0]).toEqual([ { unitId: "caps2", status: "open" } ]);
    expect(api.getPsyEnrollment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Maria da Silva" }));
    // R5: o CID vem sem ponto ("F322") e aparece com ponto.
    expect(await screen.findByText(/F32\.2/)).not.toBeNull();
    expect(screen.getByText(TRAIL_NOTE)).not.toBeNull();
    expect(vi.mocked(api.getPsyEnrollment).mock.calls[0][0]).toBe("en1");
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H3"));
    expect(document.activeElement?.textContent).toBe("Maria da Silva");
    // O PTS (que grava a trilha) só é lido ao abrir a aba.
    expect(api.listPsyCarePlans).not.toHaveBeenCalled();
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY, "caps2", "enrollment", "en1" ] }).length).toBe(1);
    fireEvent.change(screen.getByLabelText("CAPS"), { target: { value: CAPS_AD_III.id } });
    await waitFor(() => expect(screen.queryByText(/F32\.2/)).toBeNull());
    expect(client.getQueriesData({ queryKey: [ PSY_DETAIL_KEY ] })).toHaveLength(0);
  });

  it("Fechar desmonta o detalhe e apaga a chave nominal", async () => {
    const { client } = await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    await screen.findByText("Versão 1");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText(/F32\.2/)).toBeNull();
    expect(client.getQueriesData({ queryKey: [ PSY_DETAIL_KEY ] })).toHaveLength(0);
  });

  it("busca por nome é local: nenhuma chamada nova, sem acento e sem caixa", async () => {
    vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow(), enrollmentRow({ id: "en2", patient: JOSE }) ]);
    mount();
    await screen.findByText("Maria da Silva");
    fireEvent.change(screen.getByLabelText("Filtrar por nome"), { target: { value: "JOSE" } });
    expect(screen.queryByText("Maria da Silva")).toBeNull();
    expect(screen.getByText("José Pereira")).not.toBeNull();
    expect(api.listPsyEnrollments).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(api.listPsyEnrollments).mock.calls)).not.toMatch(/jos/i);
  });

  it("Encerradas pede status closed; PTS vencido calculado na tela; sem PTS aparece", async () => {
    vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow({ care_plan_review_on: "2026-11-01" }),
      enrollmentRow({ id: "en2", patient: JOSE, care_plan_review_on: null }) ]);
    mount();
    expect(await screen.findByText(CARE_PLAN_OVERDUE_TAG)).not.toBeNull();
    expect(screen.getByText(NO_CARE_PLAN)).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Encerradas" }));
    await waitFor(() => expect(vi.mocked(api.listPsyEnrollments).mock.calls.at(-1)).toEqual([ { unitId: "caps2", status: "closed" } ]));
  });

  it("PTS a revisar: a equipe vê só as suas, a coordenação vê o CAPS; Abrir abre o detalhe", async () => {
    vi.mocked(api.listPsyCarePlansDue).mockResolvedValue([ { enrollment_id: "en9", patient: JOSE, review_on: "2026-10-30" } ]);
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment({ id: "en9", patient: JOSE }));
    mount();
    expect(await screen.findByText(DUE_STAFF_NOTE)).not.toBeNull();
    expect(vi.mocked(api.listPsyCarePlansDue).mock.calls[0][0]).toBe("caps2");
    expect(screen.getByText("revisão vencida em 30/10/2026")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir José Pereira" }));
    await waitFor(() => expect(vi.mocked(api.getPsyEnrollment).mock.calls[0]?.[0]).toBe("en9"));
    cleanup();
    mount({ roles: [ "psychosocial_lead" ] });
    expect(await screen.findByText(DUE_LEAD_NOTE)).not.toBeNull();
  });

  it("matrícula vinda do acolhimento (StrictMode) abre direto no CAPS dela, uma vez; trocar de CAPS não reabre sem clique", async () => {
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment({ health_unit_id: CAPS_AD_III.id }));
    mount({ strict: true, initialEnrollment: { enrollmentId: "en1", unitId: CAPS_AD_III.id } });
    expect(await screen.findByText(/F32\.2/)).not.toBeNull();
    expect((screen.getByLabelText("CAPS") as HTMLSelectElement).value).toBe(CAPS_AD_III.id);
    expect(api.getPsyEnrollment).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.listPsyEnrollments).mock.calls[0]).toEqual([ { unitId: CAPS_AD_III.id, status: "open" } ]);
    fireEvent.change(screen.getByLabelText("CAPS"), { target: { value: CAPS_II.id } });
    await waitFor(() => expect(screen.queryByText(/F32\.2/)).toBeNull());
    fireEvent.change(screen.getByLabelText("CAPS"), { target: { value: CAPS_AD_III.id } });
    await screen.findByText("Maria da Silva");
    expect(screen.queryByText(/F32\.2/)).toBeNull();
    expect(api.getPsyEnrollment).toHaveBeenCalledTimes(1);
  });

  it("matrícula de um CAPS que não é do usuário: a frase, nada é lido (sem trilha)", async () => {
    mount({ initialEnrollment: { enrollmentId: "en1", unitId: "caps-de-fora" } });
    expect(await screen.findByText(ENROLLMENT_OTHER_CAPS)).not.toBeNull();
    await screen.findByText("Maria da Silva");
    expect(api.getPsyEnrollment).not.toHaveBeenCalled();
  });

  it("Fechar devolve o foco ao botão Abrir de origem", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Abrir Maria da Silva"));
  });

  it("sem PTS: prazo do primeiro PTS pelo care_plan_review_days de options (início + dias < hoje)", async () => {
    vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow({ care_plan_review_on: null }) ]);
    mount({ options: { ...OPTIONS, care_plan_review_days: 30 } });
    expect(await screen.findByText(NO_CARE_PLAN_DUE)).not.toBeNull();
    cleanup();
    mount({ options: { ...OPTIONS, care_plan_review_days: 90 } });
    expect(await screen.findByText(NO_CARE_PLAN)).not.toBeNull();
    expect(screen.queryByText(NO_CARE_PLAN_DUE)).toBeNull();
  });

  it("detalhe que sumiu (404) fecha e relê a lista", async () => {
    vi.mocked(api.getPsyEnrollment).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Maria da Silva" }));
    expect(await screen.findByText(PSY_ERRORS.not_found)).not.toBeNull();
    await waitFor(() => expect(api.listPsyEnrollments).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
  });
});

describe("encerramento", () => {
  it("destino permanência é recusado antes; data futura também; envia uma vez", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar matrícula" }));
    expect(screen.getByText(CLOSE_NOTE)).not.toBeNull();
    expect((screen.getByLabelText("Data de conclusão") as HTMLInputElement).value).toBe(TODAY31);
    fireEvent.change(screen.getByLabelText("Destino do usuário"), { target: { value: "00" } });
    fireEvent.change(screen.getByLabelText("Data de conclusão"), { target: { value: "2026-11-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    expect(screen.getByText(PSY_ERRORS.destination_is_permanence)).not.toBeNull();
    expect(screen.getByText(PSY_ERRORS.closed_on_in_future)).not.toBeNull();
    expect(api.closePsyEnrollment).not.toHaveBeenCalled();
    const d = deferred<api.PsyEnrollment>();
    vi.mocked(api.closePsyEnrollment).mockReturnValue(d.promise);
    fireEvent.change(screen.getByLabelText("Destino do usuário"), { target: { value: "01" } });
    fireEvent.change(screen.getByLabelText("Data de conclusão"), { target: { value: TODAY31 } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(api.closePsyEnrollment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.closePsyEnrollment).mock.calls[0]).toEqual([ "en1", { destination: "01", closed_on: TODAY31 } ]);
    d.resolve(enrollment({ status: "closed", destination: "01", closed_on: TODAY31 }));
    expect(await screen.findByText(ENROLLMENT_CLOSED)).not.toBeNull();
    expect(document.activeElement?.textContent).toBe(ENROLLMENT_CLOSED);
    expect(screen.getByText("Alta")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Encerrar matrícula" })).toBeNull();
    await waitFor(() => expect(api.listPsyEnrollments).toHaveBeenCalledTimes(2));
  });

  it("antes do início também é recusado na tela; sem destino também", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar matrícula" }));
    fireEvent.change(screen.getByLabelText("Data de conclusão"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    const local = closeProblems({ destination: "", closedOn: "2026-09-01" }, TODAY31, "2026-09-10");
    expect(screen.getByText(textOf(local, "destination"))).not.toBeNull();
    expect(screen.getByText(textOf(local, "closed_on"))).not.toBeNull();
    expect(api.closePsyEnrollment).not.toHaveBeenCalled();
  });

  it("permanência no leito aberta (409 night_stay_open) e mês fechado: a frase, o formulário fica", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar matrícula" }));
    fireEvent.change(screen.getByLabelText("Destino do usuário"), { target: { value: "01" } });
    vi.mocked(api.closePsyEnrollment).mockRejectedValueOnce(new ApiError(409, { error: "night_stay_open" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    expect(await screen.findByText(PSY_ERRORS.night_stay_open)).not.toBeNull();
    const closed = new ApiError(422, { error: "month_closed", path: "closed_on" }, "x");
    vi.mocked(api.closePsyEnrollment).mockRejectedValueOnce(closed);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    expect(await screen.findByText(psyError(closed))).not.toBeNull();
    expect((screen.getByLabelText("Destino do usuário") as HTMLSelectElement).value).toBe("01");
  });

  it("já encerrada (409 already_closed): a frase, relê o detalhe e a lista", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar matrícula" }));
    fireEvent.change(screen.getByLabelText("Destino do usuário"), { target: { value: "01" } });
    vi.mocked(api.closePsyEnrollment).mockRejectedValueOnce(new ApiError(409, { error: "already_closed" }, "x"));
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment({ status: "closed", destination: "04", closed_on: "2026-11-03" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    expect(await screen.findByText(PSY_ERRORS.already_closed)).not.toBeNull();
    expect(await screen.findByText("Abandono")).not.toBeNull();
    expect(screen.queryByLabelText("Destino do usuário")).toBeNull();
    await waitFor(() => expect(api.listPsyEnrollments).toHaveBeenCalledTimes(2));
  });
});

describe("edição", () => {
  it("PATCH só com o que mudou; sem mudança não envia; CID com ponto", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Editar matrícula" }));
    expect(screen.getAllByText(/F32\.2/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(screen.getByText(NOTHING_CHANGED)).not.toBeNull();
    expect(api.updatePsyEnrollment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Origem"), { target: { value: "04" } });
    fireEvent.change(screen.getByLabelText("Próximo atendimento"), { target: { value: "2026-11-10T09:00" } });
    const d = deferred<api.PsyEnrollment>();
    vi.mocked(api.updatePsyEnrollment).mockReturnValue(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(api.updatePsyEnrollment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updatePsyEnrollment).mock.calls[0]).toEqual([ "en1", { origin: "04", next_visit_at: "2026-11-10T09:00:00-03:00" } ]);
    d.resolve(enrollment({ origin: "04", next_visit_at: "2026-11-10T09:00:00-03:00" }));
    expect(await screen.findByText(ENROLLMENT_UPDATED)).not.toBeNull();
    expect(document.activeElement?.textContent).toBe(ENROLLMENT_UPDATED);
    expect(screen.getByText("Outro CAPS")).not.toBeNull();
    await waitFor(() => expect(api.listPsyEnrollments).toHaveBeenCalledTimes(2));
  });

  it("origin_locked do api vira frase no campo e trava origem e início", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Editar matrícula" }));
    // R4: nada pré-travado.
    expect((screen.getByLabelText("Origem") as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Origem"), { target: { value: "04" } });
    vi.mocked(api.updatePsyEnrollment).mockRejectedValueOnce(new ApiError(422,
      { error: "origin_locked", path: "origin", problems: [ { error: "origin_locked", path: "origin" } ] }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText(PSY_ERRORS.origin_locked)).not.toBeNull();
    expect((screen.getByLabelText("Origem") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Origem") as HTMLSelectElement).value).toBe("02");
    expect((screen.getByLabelText("Início da matrícula") as HTMLInputElement).disabled).toBe(true);
  });

  it("início: piso de 12 meses na tela; started_after_actions e month_closed do api no campo", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Editar matrícula" }));
    fireEvent.change(screen.getByLabelText("Início da matrícula"), { target: { value: "2025-10-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    const floorText = textOf(enrollmentProblems({ ...emptyEnrollmentDraft(TODAY31, "u-1"), startedOn: "2025-10-31" }, TODAY31), "started_on");
    expect(screen.getByText(floorText)).not.toBeNull();
    expect(api.updatePsyEnrollment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Início da matrícula"), { target: { value: "2026-10-20" } });
    vi.mocked(api.updatePsyEnrollment).mockRejectedValueOnce(new ApiError(422,
      { error: "started_after_actions", path: "started_on", problems: [ { error: "started_after_actions", path: "started_on" } ] }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText(PSY_ERRORS.started_after_actions)).not.toBeNull();
    expect(vi.mocked(api.updatePsyEnrollment).mock.calls[0]).toEqual([ "en1", { started_on: "2026-10-20" } ]);
    const closed = new ApiError(422, { error: "month_closed", path: "started_on", problems: [ { error: "month_closed", path: "started_on" } ] }, "x");
    vi.mocked(api.updatePsyEnrollment).mockRejectedValueOnce(closed);
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText(psyError(closed))).not.toBeNull();
  });

  it("matrícula mais antiga que o piso continua editável: o início igual não vai", async () => {
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment({ started_on: "2025-06-01" }));
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Editar matrícula" }));
    fireEvent.change(screen.getByLabelText("Técnico de referência"), { target: { value: "u-2" } });
    vi.mocked(api.updatePsyEnrollment).mockResolvedValue(enrollment({ started_on: "2025-06-01", reference: { user_id: "u-2", name: "Rui Enfermeiro", cbo_code: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(api.updatePsyEnrollment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updatePsyEnrollment).mock.calls[0]).toEqual([ "en1", { reference_user_id: "u-2" } ]);
  });
});

describe("PTS", () => {
  it("versões em ordem, a vencida com aviso; nova versão pré-preenchida, valida tudo e entra no topo", async () => {
    vi.mocked(api.listPsyCarePlans).mockResolvedValue([ carePlan(), carePlan({ id: "cp2", version: 2, review_on: "2026-11-01",
      goals: [ { text: "Retomar o trabalho", responsible_user_id: "u-77", due_on: "2026-12-15" } ] }) ]);
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    expect(await screen.findByText("Versão 2 · revisão vencida em 01/11/2026")).not.toBeNull();
    expect(screen.getByText("Versão 1")).not.toBeNull();
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).filter((t) => t?.startsWith("Versão"));
    expect(titles).toEqual([ "Versão 2 · revisão vencida em 01/11/2026", "Versão 1" ]);
    expect(screen.getByText(new RegExp(RESPONSIBLE_OUT))).not.toBeNull();
    // Versão gravada não se edita.
    expect(screen.queryByRole("button", { name: /Editar versão/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar PTS (nova versão)" }));
    const needs = screen.getByLabelText("Problemas e necessidades") as HTMLTextAreaElement;
    expect(needs.value).toBe("Isolamento social e insônia.");
    expect((screen.getByLabelText("Próxima revisão") as HTMLInputElement).value).toBe(addDays(TODAY31, DEFAULT_CARE_PLAN_REVIEW_DAYS));
    fireEvent.change(needs, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    const empty = carePlanProblems({ needs: "", goals: [ { text: "x", responsibleUserId: "", dueOn: "" } ], intensity: "", reviewOn: "" }, TODAY31);
    expect(screen.getByText(textOf(empty, "needs"))).not.toBeNull();
    // O responsável de fora da equipe não é reaproveitado: precisa escolher de novo.
    expect(screen.getByText(textOf(empty, "goals[0].responsible_user_id"))).not.toBeNull();
    expect(api.createPsyCarePlan).not.toHaveBeenCalled();
    expect(api.getPsySettings).not.toHaveBeenCalled();
    fireEvent.change(needs, { target: { value: "Isolamento e insônia, melhora parcial." } });
    fireEvent.change(screen.getByLabelText("Responsável pelo objetivo 1"), { target: { value: "u-2" } });
    const d = deferred<api.PsyCarePlan>();
    vi.mocked(api.createPsyCarePlan).mockReturnValue(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    await waitFor(() => expect(api.createPsyCarePlan).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createPsyCarePlan).mock.calls[0]).toEqual([ "en1", {
      needs: "Isolamento e insônia, melhora parcial.", intensity: "semi_intensive", review_on: addDays(TODAY31, DEFAULT_CARE_PLAN_REVIEW_DAYS),
      goals: [ { text: "Retomar o trabalho", responsible_user_id: "u-2", due_on: "2026-12-15" } ]
    } ]);
    d.resolve(carePlan({ id: "cp3", version: 3, review_on: addDays(TODAY31, DEFAULT_CARE_PLAN_REVIEW_DAYS) }));
    expect(await screen.findByText(CARE_PLAN_SAVED)).not.toBeNull();
    const after = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).filter((t) => t?.startsWith("Versão"));
    expect(after[0]).toBe("Versão 3");
    expect(api.listPsyCarePlans).toHaveBeenCalledTimes(1);
  });

  it("revisão sugerida: hoje + care_plan_review_days de options; sem o campo, a reserva da lib", async () => {
    await openDetail({ options: { ...OPTIONS, care_plan_review_days: 60 } });
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revisar PTS (nova versão)" }));
    expect((screen.getByLabelText("Próxima revisão") as HTMLInputElement).value).toBe(addDays(TODAY31, 60));
    cleanup();
    await openDetail({ options: { ...OPTIONS, care_plan_review_days: undefined as unknown as number } });
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revisar PTS (nova versão)" }));
    expect((screen.getByLabelText("Próxima revisão") as HTMLInputElement).value).toBe(addDays(TODAY31, DEFAULT_CARE_PLAN_REVIEW_DAYS));
  });

  it("matrícula encerrada por outra pessoa (409 already_closed) fecha o formulário do PTS", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revisar PTS (nova versão)" }));
    vi.mocked(api.createPsyCarePlan).mockRejectedValueOnce(new ApiError(409, { error: "already_closed" }, "x"));
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment({ status: "closed", destination: "01", closed_on: TODAY31 }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    expect(await screen.findByText(PSY_ERRORS.already_closed)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar nova versão" })).toBeNull();
  });

  it("recusa do api no objetivo vai à linha dele; matrícula encerrada não oferece nova versão", async () => {
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revisar PTS (nova versão)" }));
    const tooLong = new ApiError(422, { error: "invalid_request", problems: [ { error: "too_long", path: "goals[0].text" } ] }, "x");
    vi.mocked(api.createPsyCarePlan).mockRejectedValueOnce(tooLong);
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    expect(await screen.findByText(psyError(tooLong))).not.toBeNull();
    expect((screen.getByLabelText("Objetivo 1") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    cleanup();
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment({ status: "closed", destination: "01", closed_on: TODAY31 }));
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "PTS" }));
    await screen.findByText("Versão 1");
    expect(screen.queryByRole("button", { name: "Revisar PTS (nova versão)" })).toBeNull();
  });
});
