// Acolhimento do CAPS (F-31.2): fila de encaminhamentos sem motivo, detalhe só no clique, demanda espontânea por CPF, CNS ou
// duplicados (POST), e o acolhimento com ou sem matrícula numa chamada só.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_II, NOW31, OPTIONS, TODAY31, psyUser, referralRow } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import {
  CHOOSE_PROCEDURE_OPTION, CID_REPEATED_TEXT, DISCARD_RECEPTION_TEXT, ESF_CNES_MISSING, NO_CLINICAL_IN_LIST, NO_RECEPTION_PROCEDURE, NO_REGISTRATION_TEXT, PSY_DETAIL_KEY,
  PSY_ERRORS, RECEPTION_BEFORE_START, RECEPTION_DONE, RECEPTION_ENROLLED, RECEPTION_PROCEDURE_TEXT, TRAIL_NOTE, emptyReceptionDraft, enrollmentFloor,
  priorityLabel, psyError, psyRefusals, receptionProblems
} from "../lib/psychosocial";
import { EnrollmentFields } from "./psychosocial/EnrollmentFields";
import { CapsReception } from "./CapsReception";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyOptions: vi.fn(),
  listPsyReferrals: vi.fn(), getPsyReferral: vi.fn(), recordPsyReception: vi.fn(), getPsyPrefill: vi.fn(), lookupPsyPerson: vi.fn(),
  lookupPsyPersonByCns: vi.fn(), findPsyDuplicates: vi.fn(), searchTerminology: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const PREFILL = { esf_covered: true, esf_cnes: "2384299", usf: { id: "ubs1", name: "UBS Vila Verde" }, team: { id: "ht1", name: "ESF Vila Verde" } };

function mount(o: { onOpenEnrollment?: (h: { enrollmentId: string; unitId: string }) => void; prefill?: api.PsyPrefill; realClock?: boolean } = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
  vi.mocked(api.getPsyOptions).mockResolvedValue(OPTIONS);
  vi.mocked(api.listPsyReferrals).mockResolvedValue({ items: [ referralRow({ reason: "NÃO DEVE APARECER" } as never) ], next_before: null });
  vi.mocked(api.getPsyPrefill).mockResolvedValue(o.prefill ?? PREFILL);
  vi.mocked(api.searchTerminology).mockResolvedValue([ { code: "F32.2", label: "Episódio depressivo grave" } ]);
  vi.mocked(api.recordPsyReception).mockResolvedValue({ reception_id: "re9", enrollment_id: null });
  return renderWithProviders(o.realClock ? <CapsReception today={TODAY31} onOpenEnrollment={o.onOpenEnrollment} />
    : <CapsReception today={TODAY31} now={NOW31} onOpenEnrollment={o.onOpenEnrollment} />);
}
// As frases do bloco de matrícula vazio, vindas da lib (nunca repetidas aqui).
const EMPTY_ENROLLMENT = receptionProblems({ ...emptyReceptionDraft(NOW31, TODAY31, "u-1"), sigtapCode: "x", outcome: "enrolled" }, TODAY31, NOW31);
const textAt = (path: string) => EMPTY_ENROLLMENT.find((p) => p.path === path)?.text as string;
const startedOnText = () => receptionProblems({ ...emptyReceptionDraft(NOW31, TODAY31, "u-1"), sigtapCode: "x", outcome: "enrolled",
  enrollment: { ...emptyReceptionDraft(NOW31, TODAY31, "u-1").enrollment, startedOn: "2025-10-31" } }, TODAY31, NOW31)
  .find((p) => p.path === "enrollment.started_on")?.text as string;
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const pickProcedure = () => fireEvent.change(screen.getByLabelText("Procedimento do acolhimento"), { target: { value: "0301080232" } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Registrar acolhimento" }));
const sent = (i = 0) => vi.mocked(api.recordPsyReception).mock.calls[i][0];

async function fillEnrollment() {
  fireEvent.change(screen.getByLabelText("Origem"), { target: { value: "02" } });
  fireEvent.change(screen.getByLabelText("CID principal"), { target: { value: "depress" } });
  fireEvent.click(await screen.findByRole("button", { name: "F32.2 — Episódio depressivo grave" }));
  fireEvent.click(screen.getByLabelText("Nenhuma"));
  fireEvent.change(screen.getByLabelText("Técnico de referência"), { target: { value: "u-1" } });
}

describe("acolhimento do CAPS", () => {
  it("fila sem motivo; motivo só ao abrir, e sai do cache ao fechar", async () => {
    const { client } = mount();
    expect(await screen.findByText("Maria da Silva")).not.toBeNull();
    expect(screen.getByText(priorityLabel("priority"))).not.toBeNull();
    expect(screen.getByText("UBS Vila Verde")).not.toBeNull();
    expect(screen.queryByText("NÃO DEVE APARECER")).toBeNull();
    // A fila avisa que não traz o motivo e que abrir grava a leitura; nada foi lido ainda.
    expect(screen.getByText(NO_CLINICAL_IN_LIST)).not.toBeNull();
    expect(screen.getByText(TRAIL_NOTE)).not.toBeNull();
    expect(api.getPsyReferral).not.toHaveBeenCalled();
    expect(vi.mocked(api.listPsyReferrals).mock.calls[0]).toEqual([ "caps2", { before: null } ]);
    vi.mocked(api.getPsyReferral).mockResolvedValue({ ...referralRow(), reason: "Ideação suicida relatada", received_at: null,
      referred_by: { user_id: "u-9", name: "Dra. Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir encaminhamento de Maria da Silva" }));
    expect(await screen.findByText("Ideação suicida relatada")).not.toBeNull();
    expect(screen.getByText("Dra. Ana")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Maria da Silva");
    expect(vi.mocked(api.getPsyReferral).mock.calls[0][0]).toBe("rf1");
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY, "caps2", "referral", "rf1" ] }).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("Ideação suicida relatada")).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_DETAIL_KEY ] }).length).toBe(0);
  });

  it("encaminhamento que sumiu (404) fecha o detalhe e relê a fila", async () => {
    mount();
    vi.mocked(api.getPsyReferral).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir encaminhamento de Maria da Silva" }));
    expect(await screen.findByText(PSY_ERRORS.not_found)).not.toBeNull();
    await waitFor(() => expect(api.listPsyReferrals).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
    expect(document.activeElement?.textContent).toBe(PSY_ERRORS.not_found);
  });

  it("404 no POST do acolhimento (encaminhamento anonimizado): fecha o formulário, frase com foco e relê a fila", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred_elsewhere" } });
    vi.mocked(api.recordPsyReception).mockRejectedValueOnce(new ApiError(404, { error: "not_found" }, "x"));
    submit();
    expect(await screen.findByText(PSY_ERRORS.not_found)).not.toBeNull();
    await waitFor(() => expect(api.listPsyReferrals).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Registrar acolhimento" })).toBeNull();
    expect(document.activeElement?.textContent).toBe(PSY_ERRORS.not_found);
  });

  it("sem procedimento de acolhimento para o CBO: a frase, e o envio é recusado na tela", async () => {
    mount();
    vi.mocked(api.getPsyOptions).mockResolvedValue({ ...OPTIONS, procedures: OPTIONS.procedures.filter((p) => !/ACOLHIMENTO/.test(p.name)) });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    expect(await screen.findByText(NO_RECEPTION_PROCEDURE)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
    submit();
    expect(screen.getByText(RECEPTION_PROCEDURE_TEXT)).not.toBeNull();
    expect(api.recordPsyReception).not.toHaveBeenCalled();
  });

  it("o procedimento do acolhimento abre sem escolha; enviar sem escolher mostra a frase no campo e não chama o api", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    const select = screen.getByLabelText("Procedimento do acolhimento") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: CHOOSE_PROCEDURE_OPTION })).not.toBeNull();
    expect(screen.queryByText(RECEPTION_PROCEDURE_TEXT)).toBeNull();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
    submit();
    expect(screen.getByText(RECEPTION_PROCEDURE_TEXT)).not.toBeNull();
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(api.recordPsyReception).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "0301080232" } });
    expect(screen.queryByText(RECEPTION_PROCEDURE_TEXT)).toBeNull();
  });

  describe("procedimento por desfecho (P61)", () => {
    // 0301080194 (RAAS-PSI) e 0301080020 (noturno, RAAS-PSI) só valem com matrícula; 0301080232 também é BPA-I.
    const NIGHT = { ...OPTIONS.procedures[1], code: "0301080020", name: "ACOLHIMENTO NOTURNO DE PACIENTES COM TRANSTORNOS MENTAIS", instrument_codes: [ "09" ] };
    const THIRD = { ...OPTIONS.procedures[1], code: "0301080194", name: "ACOLHIMENTO EM TERCEIRO TURNO DE PACIENTE EM CAPS", instrument_codes: [ "09" ] };
    const codes = () => Array.from((screen.getByLabelText("Procedimento do acolhimento") as HTMLSelectElement).options).map((o) => o.value).filter(Boolean);
    async function open() {
      mount();
      vi.mocked(api.getPsyOptions).mockResolvedValue({ ...OPTIONS, procedures: [ ...OPTIONS.procedures, NIGHT, THIRD ] });
      fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
      await screen.findByLabelText("Procedimento do acolhimento");
    }

    it("sem matrícula: só os de BPA-I; com matrícula: todos os de acolhimento", async () => {
      await open();
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred_elsewhere" } });
      expect(codes()).toEqual([ "0301080232" ]);
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
      expect(codes()).toEqual([ "0301080232" ]);
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
      expect(codes()).toEqual([ "0301080232", "0301080020", "0301080194" ]);
    });

    it("desfecho ainda vazio: só os de BPA-I", async () => {
      await open();
      expect(codes()).toEqual([ "0301080232" ]);
    });

    it("trocar de matricular para sem seguimento limpa o procedimento que deixou de valer", async () => {
      await open();
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
      fireEvent.change(screen.getByLabelText("Procedimento do acolhimento"), { target: { value: "0301080194" } });
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
      expect((screen.getByLabelText("Procedimento do acolhimento") as HTMLSelectElement).value).toBe("");
      // O que continua valendo fica.
      fireEvent.change(screen.getByLabelText("Procedimento do acolhimento"), { target: { value: "0301080232" } });
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
      expect((screen.getByLabelText("Procedimento do acolhimento") as HTMLSelectElement).value).toBe("0301080232");
    });
  });

  it("trocar o desfecho limpa a recusa do api que dependia dele (enrollment_open no topo)", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred_elsewhere" } });
    vi.mocked(api.recordPsyReception).mockRejectedValueOnce(new ApiError(409, { error: "enrollment_open" }, "x"));
    submit();
    expect(await screen.findByText(PSY_ERRORS.enrollment_open)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
    expect(screen.queryByText(PSY_ERRORS.enrollment_open)).toBeNull();
  });

  it("Acolher leva o foco ao nome; outra linha com acolhimento aberto pergunta antes de descartar", async () => {
    mount();
    vi.mocked(api.listPsyReferrals).mockResolvedValue({ items: [ referralRow(),
      referralRow({ id: "rf2", patient: { patient_id: "pt2", name: "José Pereira", cns_masked: null } }) ], next_before: null });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Maria da Silva"));
    fireEvent.change(screen.getByLabelText("Anotações do acolhimento"), { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Acolher José Pereira" }));
    expect(screen.getByText(DISCARD_RECEPTION_TEXT)).not.toBeNull();
    expect(document.activeElement?.textContent).toBe(DISCARD_RECEPTION_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Continuar o acolhimento" }));
    expect((screen.getByLabelText("Anotações do acolhimento") as HTMLTextAreaElement).value).toBe("rascunho");
    // Abrir outro encaminhamento não descarta o acolhimento.
    vi.mocked(api.getPsyReferral).mockResolvedValue({ ...referralRow({ id: "rf2" }), reason: "Outro motivo relatado", received_at: null,
      referred_by: { user_id: "u-9", name: "Dra. Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir encaminhamento de José Pereira" }));
    expect(await screen.findByText("Outro motivo relatado")).not.toBeNull();
    expect((screen.getByLabelText("Anotações do acolhimento") as HTMLTextAreaElement).value).toBe("rascunho");
    fireEvent.click(screen.getByRole("button", { name: "Acolher José Pereira" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar e acolher José Pereira" }));
    expect(screen.queryByText(DISCARD_RECEPTION_TEXT)).toBeNull();
    expect((screen.getByLabelText("Anotações do acolhimento") as HTMLTextAreaElement).value).toBe("");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("José Pereira"));
  });

  it("Carregar mais pede a página seguinte pelo cursor", async () => {
    mount();
    vi.mocked(api.listPsyReferrals).mockResolvedValueOnce({ items: [ referralRow() ], next_before: "c1" })
      .mockResolvedValueOnce({ items: [ referralRow({ id: "rf2", patient: { patient_id: "pt2", name: "José Pereira", cns_masked: null }, priority: "routine" }) ],
        next_before: null });
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("José Pereira")).not.toBeNull();
    expect(vi.mocked(api.listPsyReferrals).mock.calls[1]).toEqual([ "caps2", { before: "c1" } ]);
    expect(screen.getByText("rotina")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("lista que mudou ao rolar (invalid_cursor): a frase e a fila relida do começo, com cursor nulo", async () => {
    mount();
    vi.mocked(api.listPsyReferrals)
      .mockResolvedValueOnce({ items: [ referralRow() ], next_before: "c1" })
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor", path: "before" }, "x"))
      .mockResolvedValueOnce({ items: [ referralRow() ], next_before: null });
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(PSY_ERRORS.invalid_cursor)).not.toBeNull();
    await waitFor(() => expect(api.listPsyReferrals).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.listPsyReferrals).mock.calls[2]).toEqual([ "caps2", { before: null } ]);
    expect(screen.getByRole("button", { name: "Acolher Maria da Silva" })).not.toBeNull();
  });

  it("erro de rede na página seguinte: as linhas da primeira continuam na tela, com o alerta", async () => {
    mount();
    vi.mocked(api.listPsyReferrals)
      .mockResolvedValueOnce({ items: [ referralRow() ], next_before: "c1" })
      .mockRejectedValueOnce(new ApiError(500, { error: "server_error" }, "x"));
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(api.listPsyReferrals).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Acolher Maria da Silva" })).not.toBeNull();
    expect(screen.getByText("Maria da Silva")).not.toBeNull();
  });

  it("acolher com matrícula: valida o bloco inteiro antes de enviar e manda numa chamada só", async () => {
    const onOpenEnrollment = vi.fn();
    mount({ onOpenEnrollment });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    // O prefill da ESF marca a cobertura e o CNES da USF, com a equipe como dica.
    await waitFor(() => expect((screen.getByLabelText("CNES da USF") as HTMLInputElement).value).toBe("2384299"));
    expect((screen.getByLabelText("Coberto por ESF") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("ESF Vila Verde · UBS Vila Verde")).not.toBeNull();
    expect(vi.mocked(api.getPsyPrefill).mock.calls[0]).toEqual([ "caps2", "pt1" ]);
    submit();
    expect(screen.getByText(textAt("enrollment.cid_main"))).not.toBeNull();
    expect(screen.getByText(textAt("enrollment.origin"))).not.toBeNull();
    expect(screen.getByText(textAt("enrollment.substances"))).not.toBeNull();
    expect(api.recordPsyReception).not.toHaveBeenCalled();
    await fillEnrollment();
    vi.mocked(api.recordPsyReception).mockResolvedValue({ reception_id: "re9", enrollment_id: "en9" });
    submit();
    submit();
    await waitFor(() => expect(api.recordPsyReception).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ health_unit_id: "caps2", patient_id: "pt1", referral_id: "rf1", outcome: "enrolled", sigtap_code: "0301080232",
      at: "2026-11-04T10:00:00-03:00" });
    expect("notes" in sent()).toBe(false);
    expect(sent().enrollment).toEqual({ started_on: TODAY31, origin: "02", cid_main: "F32.2", substances: [ "99" ], esf_covered: true,
      esf_cnes: "2384299", reference_user_id: "u-1" });
    expect((await screen.findByRole("status")).textContent).toContain(RECEPTION_ENROLLED);
    await waitFor(() => expect(api.listPsyReferrals).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Registrar acolhimento" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir matrícula" }));
    expect(onOpenEnrollment).toHaveBeenCalledWith({ enrollmentId: "en9", unitId: "caps2" });
  });

  it("substância: nenhuma desmarca as outras, e outra desmarca nenhuma", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    const box = (l: string) => screen.getByLabelText(l) as HTMLInputElement;
    fireEvent.click(box("Álcool"));
    fireEvent.click(box("Crack"));
    expect([ box("Álcool").checked, box("Crack").checked, box("Nenhuma").checked ]).toEqual([ true, true, false ]);
    fireEvent.click(box("Nenhuma"));
    expect([ box("Álcool").checked, box("Crack").checked, box("Nenhuma").checked ]).toEqual([ false, false, true ]);
    fireEvent.click(box("Álcool"));
    expect([ box("Álcool").checked, box("Nenhuma").checked ]).toEqual([ true, false ]);
  });

  it("eSF sem CNES: cobertura marcada, CNES em branco e o aviso", async () => {
    mount({ prefill: { esf_covered: true, esf_cnes: null, usf: null, team: { id: "ht1", name: "ESF Vila Verde" } } });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    expect(await screen.findByText(ESF_CNES_MISSING)).not.toBeNull();
    expect((screen.getByLabelText("Coberto por ESF") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("CNES da USF") as HTMLInputElement).value).toBe("");
    await fillEnrollment();
    submit();
    expect(screen.getByText(PSY_ERRORS.esf_cnes_required)).not.toBeNull();
    expect(api.recordPsyReception).not.toHaveBeenCalled();
  });

  it("recusas do api todas de uma vez, nos campos (prefixo enrollment. tirado); o formulário fica", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    await waitFor(() => expect((screen.getByLabelText("CNES da USF") as HTMLInputElement).value).toBe("2384299"));
    await fillEnrollment();
    const err = new ApiError(422, { error: "action_rejected", problems: [
      { error: "cbo_incompatible", path: "sigtap_code" }, { error: "performed_in_future", path: "at" },
      { error: "month_closed", path: "enrollment.started_on" }
    ] }, "x");
    vi.mocked(api.recordPsyReception).mockRejectedValueOnce(err);
    submit();
    for (const r of psyRefusals(err)) expect(await screen.findByText(r.text)).not.toBeNull();
    expect(screen.getByLabelText("Procedimento do acolhimento").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Data e hora").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Início da matrícula").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Registrar acolhimento" })).not.toBeNull();
    expect((screen.getByLabelText("Origem") as HTMLSelectElement).value).toBe("02");
  });

  it("sem matrícula não manda o bloco; enrollment_open e referral_not_pending viram frase e relêem a fila", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred_elsewhere" } });
    vi.mocked(api.recordPsyReception).mockRejectedValueOnce(new ApiError(409, { error: "enrollment_open" }, "x"));
    submit();
    expect(await screen.findByText(PSY_ERRORS.enrollment_open)).not.toBeNull();
    expect(api.listPsyReferrals).toHaveBeenCalledTimes(1);
    vi.mocked(api.recordPsyReception).mockRejectedValueOnce(new ApiError(409, { error: "referral_not_pending" }, "x"));
    submit();
    expect(await screen.findByText(psyError(new ApiError(409, { error: "referral_not_pending" }, "x")))).not.toBeNull();
    expect(sent().enrollment).toBeUndefined();
    expect("enrollment" in sent()).toBe(false);
    await waitFor(() => expect(api.listPsyReferrals).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Registrar acolhimento" })).toBeNull();
  });

  it("relógio que anda: o acolhimento feito depois de abrir a tela não é data futura (sem now por prop)", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    try {
      vi.setSystemTime(NOW31);
      mount({ realClock: true });
      vi.setSystemTime(new Date("2026-11-04T10:20:00-03:00"));
      fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
      expect((screen.getByLabelText("Data e hora") as HTMLInputElement).value).toBe("2026-11-04T10:20");
      fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-04T10:40" } });
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
      vi.setSystemTime(new Date("2026-11-04T11:00:00-03:00"));
      submit();
      expect((await screen.findByRole("status")).textContent).toBe(RECEPTION_DONE);
      expect(sent().at).toBe("2026-11-04T10:40:00-03:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("acolhimento sem matrícula: frase de sucesso, sem o botão da matrícula", async () => {
    mount({ onOpenEnrollment: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
    fireEvent.change(screen.getByLabelText("Anotações do acolhimento"), { target: { value: "  Veio com a irmã.  " } });
    submit();
    expect((await screen.findByRole("status")).textContent).toBe(RECEPTION_DONE);
    expect(sent().notes).toBe("Veio com a irmã.");
    expect(screen.queryByRole("button", { name: "Abrir matrícula" })).toBeNull();
  });

  it("demanda espontânea: busca a pessoa pelo CPF por POST", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher demanda espontânea" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    vi.mocked(api.lookupPsyPerson).mockResolvedValue({ patient_id: "pt7", display_name: "Ana Souza", has_cpf: true, cns_masked: null,
      citizen_id: null, registration_id: null });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    await waitFor(() => expect(api.lookupPsyPerson).toHaveBeenCalledWith("12345678909"));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Ana Souza" }));
    expect(screen.getByText("Ana Souza")).not.toBeNull();
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "no_follow_up" } });
    submit();
    await waitFor(() => expect(api.recordPsyReception).toHaveBeenCalledTimes(1));
    expect(sent().patient_id).toBe("pt7");
    expect("referral_id" in sent()).toBe(false);
  });

  it("demanda espontânea: pessoa nova pede o cadastro no balcão", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher demanda espontânea" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "123.456.789-09" } });
    vi.mocked(api.lookupPsyPerson).mockRejectedValue(new ApiError(404, { error: "person_not_found" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    expect(screen.getByText(NO_REGISTRATION_TEXT)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar acolhimento" })).toBeNull();
  });

  it("demanda espontânea pelo CNS (15 dígitos, POST); CNS inválido nem sai da tela", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher demanda espontânea" }));
    fireEvent.click(screen.getByLabelText("Pelo CNS"));
    fireEvent.change(screen.getByLabelText("CNS"), { target: { value: "8980 0000 0000 001" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CNS" }));
    expect(screen.getByText(PSY_ERRORS.invalid_cns)).not.toBeNull();
    expect(api.lookupPsyPersonByCns).not.toHaveBeenCalled();
    vi.mocked(api.lookupPsyPersonByCns).mockResolvedValue({ patient_id: "pt5", display_name: "João Sem CPF", has_cpf: false,
      cns_masked: "*** **** **** 0002", citizen_id: null, registration_id: null });
    fireEvent.change(screen.getByLabelText("CNS"), { target: { value: "8980 0000 0000 002" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CNS" }));
    await waitFor(() => expect(api.lookupPsyPersonByCns).toHaveBeenCalledWith("898000000000002"));
    expect(api.lookupPsyPerson).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Escolher João Sem CPF" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred_elsewhere" } });
    submit();
    await waitFor(() => expect(sent().patient_id).toBe("pt5"));
  });

  it("CNS não encontrado mostra a frase; duplicados por POST", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher demanda espontânea" }));
    fireEvent.click(screen.getByLabelText("Pelo CNS"));
    vi.mocked(api.lookupPsyPersonByCns).mockRejectedValue(new ApiError(404, { error: "person_not_found" }, "x"));
    fireEvent.change(screen.getByLabelText("CNS"), { target: { value: "898000000000002" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CNS" }));
    expect(await screen.findByText(PSY_ERRORS.person_not_found)).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Pelo CPF ou pelo nome"));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    vi.mocked(api.findPsyDuplicates).mockResolvedValue([]);
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "João da Rua" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1980-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    await waitFor(() => expect(api.findPsyDuplicates).toHaveBeenCalledWith({ full_name: "João da Rua", birth_date: "1980-01-01" }));
  });
  it("Enter na busca do CID (principal ou secundário) não envia o acolhimento", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    for (const label of [ "CID principal", "CID secundário (até 4)" ]) {
      const input = screen.getByLabelText(label);
      fireEvent.change(input, { target: { value: "F3" } });
      // O Enter foi barrado (preventDefault): o <form> não faz a submissão implícita.
      expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    }
    expect(api.recordPsyReception).not.toHaveBeenCalled();
    expect(screen.queryByText(textAt("enrollment.origin"))).toBeNull();
  });

  it("CID secundário repetido ou igual ao principal mostra a frase e não entra", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    await fillEnrollment();
    fireEvent.change(screen.getByLabelText("CID secundário (até 4)"), { target: { value: "depress" } });
    fireEvent.click(await screen.findByRole("button", { name: "F32.2 — Episódio depressivo grave" }));
    expect(screen.getByText(CID_REPEATED_TEXT)).not.toBeNull();
    expect(screen.queryByRole("list", { name: "CIDs secundários" })).toBeNull();
  });

  it("o prefill não passa por cima do que a pessoa já mexeu na cobertura", async () => {
    const late = deferred<api.PsyPrefill>();
    mount();
    vi.mocked(api.getPsyPrefill).mockReturnValue(late.promise);
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    fireEvent.click(screen.getByLabelText("Coberto por ESF"));
    fireEvent.change(screen.getByLabelText("CNES da USF"), { target: { value: "1111111" } });
    late.resolve(PREFILL);
    await screen.findByText("ESF Vila Verde · UBS Vila Verde");
    expect((screen.getByLabelText("CNES da USF") as HTMLInputElement).value).toBe("1111111");
  });

  it("EnrollmentFields sem prefill (edição) não lê a ESF", () => {
    const d = emptyReceptionDraft(NOW31, TODAY31, "u-1").enrollment;
    renderWithProviders(<EnrollmentFields unitId="caps2" patientId="pt1" options={OPTIONS} value={d} onChange={vi.fn()} problems={[]} today={TODAY31} />);
    expect(api.getPsyPrefill).not.toHaveBeenCalled();
  });

  it("EnrollmentFields: duas frases no mesmo campo aparecem todas, com o id no wrapper; uma só fica no próprio <p>", () => {
    const d = emptyReceptionDraft(NOW31, TODAY31, "u-1").enrollment;
    const two = [ { path: "started_on", text: "Primeira frase do início." }, { path: "started_on", text: "Segunda frase do início." },
      { path: "started_on", text: "Primeira frase do início." } ];
    renderWithProviders(<EnrollmentFields unitId="caps2" patientId="pt1" options={OPTIONS} value={d} onChange={vi.fn()} problems={two} today={TODAY31} />);
    const first = screen.getByText("Primeira frase do início.");
    const second = screen.getByText("Segunda frase do início.");
    expect(first.getAttribute("role")).toBe("alert");
    expect(second.getAttribute("role")).toBe("alert");
    const wrapper = first.parentElement as HTMLElement;
    expect(wrapper).toBe(second.parentElement);
    expect(wrapper.getAttribute("role")).toBeNull();
    expect(screen.getByLabelText("Início da matrícula").getAttribute("aria-describedby")).toBe(wrapper.id);
    cleanup();
    renderWithProviders(<EnrollmentFields unitId="caps2" patientId="pt1" options={OPTIONS} value={d} onChange={vi.fn()} problems={[ two[0] ]} today={TODAY31} />);
    const only = screen.getByText("Primeira frase do início.");
    expect(only.tagName).toBe("P");
    expect(screen.getByLabelText("Início da matrícula").getAttribute("aria-describedby")).toBe(only.id);
  });

  it("início antes do piso de 12 meses e acolhimento antes do início: as frases na tela, sem envio", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    await fillEnrollment();
    expect((screen.getByLabelText("Início da matrícula") as HTMLInputElement).min).toBe(enrollmentFloor(TODAY31));
    fireEvent.change(screen.getByLabelText("Início da matrícula"), { target: { value: "2025-10-31" } });
    submit();
    expect(screen.getByText(startedOnText())).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Início da matrícula"));
    fireEvent.change(screen.getByLabelText("Início da matrícula"), { target: { value: TODAY31 } });
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2026-11-03T09:00" } });
    submit();
    expect(screen.getByText(RECEPTION_BEFORE_START)).not.toBeNull();
    expect(api.recordPsyReception).not.toHaveBeenCalled();
  });

  it("grupo de substâncias inválido leva o foco à primeira caixa; Cancelar fica desabilitado durante o envio", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    pickProcedure();
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    await waitFor(() => expect((screen.getByLabelText("CNES da USF") as HTMLInputElement).value).toBe("2384299"));
    fireEvent.change(screen.getByLabelText("Origem"), { target: { value: "02" } });
    fireEvent.change(screen.getByLabelText("CID principal"), { target: { value: "depress" } });
    fireEvent.click(await screen.findByRole("button", { name: "F32.2 — Episódio depressivo grave" }));
    submit();
    expect(screen.getByText(textAt("enrollment.substances"))).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText(OPTIONS.substances[0].label));
    fireEvent.click(screen.getByLabelText("Nenhuma"));
    const slow = deferred<api.PsyReceptionResult>();
    vi.mocked(api.recordPsyReception).mockReturnValue(slow.promise);
    submit();
    await waitFor(() => expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true));
    slow.resolve({ reception_id: "re9", enrollment_id: "en9" });
    expect(await screen.findByText(RECEPTION_ENROLLED)).not.toBeNull();
  });
});
