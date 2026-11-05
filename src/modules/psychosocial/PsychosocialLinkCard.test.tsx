// Cartão do vínculo com o CAPS na tela do paciente da UBS e "Encaminhar ao CAPS" (F-31.7, F-31.2; §4, §7, P10, P44, P46, P48, R19).
// O vínculo é genérico: nunca o nome nem a modalidade do CAPS, mesmo que o api mande; fora do contexto, sem papel ou com o
// interruptor desligado, o cartão some sem frase. O nome do CAPS aparece só no seletor do encaminhamento; a frase de sucesso é
// genérica e o motivo sai da tela. As frases vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { ME_PSY, psyLink, psyUser } from "../../test/psychosocialFixtures";
import { options, opening, record } from "../../test/consultationFixtures";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import {
  LINK_CASES_TITLE, LINK_TITLE, NO_ACTIVE_CAPS, PSY_DISABLED, PSY_ERRORS, REFERRAL_CAPS_TEXT, REFERRAL_NOTE, REFERRAL_REASON_TEXT, REFERRAL_SENT,
  PSY_DETAIL_KEY, REFER_BUTTON, canSeePsychosocialLink, linkHidden, linkReferenceText, linkSinceText
} from "../../lib/psychosocial";
import { PatientPanel } from "../consultation/PatientPanel";
import { ConsultationWorkspace } from "../consultation/ConsultationWorkspace";
import { JustifiedRecord } from "../clinicalRecord/JustifiedRecord";
import { PsychosocialLinkCard, capsPhoneText } from "./PsychosocialLinkCard";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getPsyLink: vi.fn(),
  createPsyReferral: vi.fn(), listActiveUnits: vi.fn(), getJustifiedRecord: vi.fn(), getAttendanceRecord: vi.fn(),
  getConsultationOptions: vi.fn(), getConsultationProblems: vi.fn(), startConsultation: vi.fn(), getConsultation: vi.fn() }));
vi.mock("../consultation/ConsultationEditor", () => ({ ConsultationEditor: () => <span>editor</span> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const UBS: api.HealthUnit = { id: "ubs1", name: "UBS Vila Verde", kind: "ubs" };
const CAPS2: api.HealthUnit = { id: "caps2", name: "CAPS II Centro", kind: "caps", caps_modality: "caps_ii" };
const CAPS_AD: api.HealthUnit = { id: "capsad3", name: "CAPS AD III Boqueirão", kind: "caps", caps_modality: "caps_ad_iii" };
const REASON = "Ideação suicida relatada na consulta";
const HP_FEATURES = [ "psychosocial_care", "clinical_record" ];
const hp = (features = HP_FEATURES) => sessionWith([ "health_professional" ], { features });

beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(hp());
  vi.mocked(api.listActiveUnits).mockResolvedValue([ UBS, CAPS2 ]);
  vi.mocked(api.createPsyReferral).mockResolvedValue({ id: "rf9", health_unit_id: "caps2", priority: "priority", status: "pending",
    created_at: "2026-11-04T10:00:00-03:00" });
});

const mount = (p: { patientId: string; canRefer: boolean }) => renderWithProviders(<PsychosocialLinkCard {...p} />);
const openForm = async () => { fireEvent.click(await screen.findByRole("button", { name: REFER_BUTTON })); await screen.findByLabelText("Motivo do encaminhamento"); };

describe("cartão do vínculo com o CAPS", () => {
  it("sem matrícula: só o botão de encaminhar", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false });
    mount({ patientId: "pt1", canRefer: true });
    expect(await screen.findByRole("button", { name: REFER_BUTTON })).not.toBeNull();
    expect(screen.getByText(LINK_TITLE)).not.toBeNull();
    expect(screen.queryByText(/em acompanhamento/i)).toBeNull();
    expect(screen.queryByText(LINK_CASES_TITLE)).toBeNull();
    expect(vi.mocked(api.getPsyLink).mock.calls).toEqual([ [ "pt1" ] ]);
  });

  it("com matrícula: vínculo genérico, técnico, telefone e casos da equipe; nunca nome do CAPS, CID nem PTS mesmo que venham", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: true, caps: { id: "caps2", name: "CAPS II Centro", caps_modality: "caps_ii", phone: "4133334444" },
      since: "2026-09-10", reference: { name: ME_PSY.name },
      shared_cases: [ { held_on: "2026-11-03", caps_name: "CAPS II Centro", shared_text: "Combinar visita domiciliar com a ACS." } ],
      cid_main: "F322", care_plan: "segredo", caps_modality: "caps_ad" } as never);
    mount({ patientId: "pt1", canRefer: true });
    expect(await screen.findByText(linkSinceText("2026-09-10"))).not.toBeNull();
    expect(linkSinceText("2026-09-10")).toBe("Em acompanhamento no CAPS desde 10/09/2026");
    // Duas linhas (P48): o telefone é do CAPS, não do técnico.
    expect(screen.getByText(linkReferenceText(ME_PSY.name, null))).not.toBeNull();
    expect(linkReferenceText(ME_PSY.name, null)).toBe("Técnico de referência: Lia Psicóloga");
    expect(screen.getByText(capsPhoneText("4133334444"))).not.toBeNull();
    expect(capsPhoneText("4133334444")).toBe("Telefone do CAPS: (41) 3333-4444");
    expect(screen.queryByText(/Técnico de referência:.*3333/)).toBeNull();
    expect(screen.getByText(LINK_CASES_TITLE)).not.toBeNull();
    expect(screen.getByText("03/11/2026")).not.toBeNull();
    expect(screen.getByText("Combinar visita domiciliar com a ACS.")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/CAPS II|Centro|caps_ii|CAPS AD|caps_ad|F322|F32|segredo/);
    expect(screen.queryByRole("button", { name: REFER_BUTTON })).toBeNull();
  });

  it("com matrícula e sem telefone: só o técnico de referência, sem a linha do telefone", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue(psyLink({ caps: { phone: null }, shared_cases: [] }));
    mount({ patientId: "pt1", canRefer: true });
    expect(await screen.findByText(`Técnico de referência: ${ME_PSY.name}`)).not.toBeNull();
    expect(screen.queryByText(/Telefone do CAPS/)).toBeNull();
    expect(screen.queryByText(LINK_CASES_TITLE)).toBeNull();
  });

  it("com matrícula e sem técnico de referência: só a linha do telefone", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ ...psyLink({ shared_cases: [] }), reference: null } as never);
    mount({ patientId: "pt1", canRefer: true });
    expect(await screen.findByText(capsPhoneText("4133334444"))).not.toBeNull();
    expect(screen.queryByText(/Técnico de referência/)).toBeNull();
  });

  it("sem matrícula e com caso compartilhado (depois da alta): os casos e o botão", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false, shared_cases: [ { held_on: "2026-10-20", shared_text: "Retomar contato com a família." } ] });
    mount({ patientId: "pt1", canRefer: true });
    expect(await screen.findByText("Retomar contato com a família.")).not.toBeNull();
    expect(screen.getByText(LINK_CASES_TITLE)).not.toBeNull();
    expect(screen.queryByText(/em acompanhamento/i)).toBeNull();
    expect(screen.getByRole("button", { name: REFER_BUTTON })).not.toBeNull();
  });

  it("sem permissão de encaminhar: sem botão", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false, shared_cases: [ { held_on: "2026-10-20", shared_text: "Retomar contato com a família." } ] });
    mount({ patientId: "pt1", canRefer: false });
    expect(await screen.findByText("Retomar contato com a família.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: REFER_BUTTON })).toBeNull();
  });

  it.each([
    [ "out_of_context", new ApiError(403, { error: "out_of_context" }, "x") ],
    [ "missing_role", new ApiError(403, { error: "missing_role" }, "x") ],
    [ "feature_disabled", new ApiError(403, { error: "feature_disabled", feature: "psychosocial_care" }, "x") ]
  ])("403 %s: o cartão some, sem frase e sem botão", async (_code, err) => {
    vi.mocked(api.getPsyLink).mockRejectedValue(err);
    const { container, client } = mount({ patientId: "pt1", canRefer: true });
    // Sinal positivo: a leitura terminou em erro (não basta o cartão vazio do carregamento).
    await waitFor(() => expect(client.getQueryState([ PSY_DETAIL_KEY, "link", "pt1" ])?.status).toBe("error"));
    expect(container.textContent).toBe("");
    expect(screen.queryByText(LINK_TITLE)).toBeNull();
    expect(screen.queryByText(PSY_ERRORS.out_of_context)).toBeNull();
    expect(screen.queryByText(PSY_DISABLED)).toBeNull();
    expect(screen.queryByRole("button", { name: REFER_BUTTON })).toBeNull();
  });

  it.each([
    [ "out_of_context", new ApiError(403, { error: "out_of_context" }, "x"), true ],
    [ "missing_role", new ApiError(403, { error: "missing_role" }, "x"), true ],
    [ "feature_disabled", new ApiError(403, { error: "feature_disabled", feature: "psychosocial_care" }, "x"), true ],
    [ "feature_disabled sem chave", new ApiError(403, { error: "feature_disabled" }, "x"), true ],
    [ "not_found", new ApiError(404, { error: "not_found" }, "x"), false ],
    [ "erro do servidor", new ApiError(500, { error: "internal" }, "x"), false ],
    [ "sem rede", new TypeError("failed to fetch"), false ]
  ])("linkHidden(%s) = %s", (_name, err, hidden) => {
    expect(linkHidden(err)).toBe(hidden);
  });

  it("outra recusa: frase discreta, sem botão", async () => {
    vi.mocked(api.getPsyLink).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    mount({ patientId: "pt1", canRefer: true });
    expect(await screen.findByText(PSY_ERRORS.not_found)).not.toBeNull();
    expect(screen.queryByRole("button", { name: REFER_BUTTON })).toBeNull();
  });

  it("encaminhar: CAPS, motivo de 10 a 2000 e prioridade; uma chamada; frase genérica; nome do CAPS e motivo fora da tela depois", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false });
    mount({ patientId: "pt1", canRefer: true });
    await openForm();
    expect(screen.getByText(REFERRAL_NOTE)).not.toBeNull();
    expect(screen.queryByRole("option", { name: /UBS Vila Verde/ })).toBeNull();
    expect(screen.getByRole("option", { name: "CAPS II Centro · CAPS II" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do encaminhamento"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar encaminhamento" }));
    expect(screen.getByText(REFERRAL_REASON_TEXT)).not.toBeNull();
    expect(REFERRAL_REASON_TEXT).toBe("motivo do encaminhamento: de 10 a 2000 caracteres");
    expect(api.createPsyReferral).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo do encaminhamento"), { target: { value: `  ${REASON} ` } });
    fireEvent.change(screen.getByLabelText("Prioridade"), { target: { value: "priority" } });
    const send = screen.getByRole("button", { name: "Enviar encaminhamento" });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(api.createPsyReferral).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createPsyReferral).mock.calls[0][0]).toEqual({ patient_id: "pt1", health_unit_id: "caps2", reason: REASON, priority: "priority" });
    expect(await screen.findByText(REFERRAL_SENT)).not.toBeNull();
    expect(REFERRAL_SENT).toBe("Encaminhamento enviado ao CAPS.");
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.queryByLabelText("Motivo do encaminhamento")).toBeNull();
    expect(document.body.textContent).not.toMatch(/CAPS II Centro/);
    // Abrir de novo começa vazio: o motivo não ficou guardado.
    await openForm();
    expect((screen.getByLabelText("Motivo do encaminhamento") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(REFERRAL_SENT)).toBeNull();
  });

  it("vários CAPS: nenhum vem marcado; a tela pede o CAPS e o motivo de uma vez", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false });
    vi.mocked(api.listActiveUnits).mockResolvedValue([ UBS, CAPS2, CAPS_AD ]);
    mount({ patientId: "pt1", canRefer: true });
    await openForm();
    expect((screen.getByLabelText("CAPS") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Enviar encaminhamento" }));
    expect(screen.getByText(REFERRAL_CAPS_TEXT)).not.toBeNull();
    expect(screen.getByText(REFERRAL_REASON_TEXT)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("CAPS"), { target: { value: "capsad3" } });
    fireEvent.change(screen.getByLabelText("Motivo do encaminhamento"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar encaminhamento" }));
    await waitFor(() => expect(api.createPsyReferral).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createPsyReferral).mock.calls[0][0]).toEqual({ patient_id: "pt1", health_unit_id: "capsad3", reason: REASON, priority: "routine" });
    expect(await screen.findByText(REFERRAL_SENT)).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/Boqueirão|CAPS AD/);
  });

  it("nenhum CAPS ativo: frase e nada a enviar", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false });
    vi.mocked(api.listActiveUnits).mockResolvedValue([ UBS ]);
    mount({ patientId: "pt1", canRefer: true });
    fireEvent.click(await screen.findByRole("button", { name: REFER_BUTTON }));
    expect(await screen.findByText(NO_ACTIVE_CAPS)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar encaminhamento" })).toBeNull();
  });

  it("recusa do api: o motivo no campo e o formulário intacto; fora do contexto no topo", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false });
    vi.mocked(api.createPsyReferral)
      .mockRejectedValueOnce(new ApiError(422, { error: "too_long", path: "reason", problems: [ { error: "too_long", path: "reason" } ] }, "x"))
      .mockRejectedValueOnce(new ApiError(403, { error: "out_of_context" }, "x"));
    mount({ patientId: "pt1", canRefer: true });
    await openForm();
    fireEvent.change(screen.getByLabelText("Motivo do encaminhamento"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar encaminhamento" }));
    expect(await screen.findByText(REFERRAL_REASON_TEXT)).not.toBeNull();
    expect(screen.getByLabelText("Motivo do encaminhamento").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Motivo do encaminhamento") as HTMLTextAreaElement).value).toBe(REASON);
    fireEvent.click(screen.getByRole("button", { name: "Enviar encaminhamento" }));
    expect(await screen.findByText(PSY_ERRORS.out_of_context)).not.toBeNull();
    expect(screen.queryByText(REFERRAL_SENT)).toBeNull();
  });

  it("canSeePsychosocialLink: interruptor, prontuário e health_professional", () => {
    expect(canSeePsychosocialLink(hp())).toBe(true);
    expect(canSeePsychosocialLink(hp([ "clinical_record" ]))).toBe(false);
    expect(canSeePsychosocialLink(hp([ "psychosocial_care" ]))).toBe(false);
    expect(canSeePsychosocialLink(psyUser())).toBe(false);
    expect(canSeePsychosocialLink(sessionWith([ "health_professional" ], { features: HP_FEATURES, operator: true }))).toBe(false);
    expect(canSeePsychosocialLink(null)).toBe(false);
  });
});

describe("PatientPanel e quem o usa", () => {
  it("PatientPanel sem a prop não lê o vínculo", () => {
    render(<PatientPanel record={record()} onOpenConsultation={() => {}} />);
    expect(screen.queryByText(LINK_TITLE)).toBeNull();
    expect(api.getPsyLink).not.toHaveBeenCalled();
  });

  it("PatientPanel com a prop: o cartão no Resumo, depois dos problemas", async () => {
    vi.mocked(api.getPsyLink).mockResolvedValue(psyLink());
    renderWithProviders(<PatientPanel record={record()} onOpenConsultation={() => {}} psychosocial={{ patientId: "pa1", canRefer: true }}
      besideProblems={<span>medicamentos (dublê)</span>} />);
    const card = await screen.findByText(linkSinceText("2026-09-10"));
    const problems = screen.getByText("Problemas ativos");
    const beside = screen.getByText("medicamentos (dublê)");
    expect(problems.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(beside.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vi.mocked(api.getPsyLink).mock.calls).toEqual([ [ "pa1" ] ]);
  });

  it("consulta: o health_professional com o interruptor vê o cartão do paciente; sem o interruptor, nada é lido", async () => {
    vi.mocked(api.getAttendanceRecord).mockResolvedValue(record());
    vi.mocked(api.getConsultationOptions).mockResolvedValue(options());
    vi.mocked(api.getPsyLink).mockResolvedValue({ enrolled: false });
    const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    expect(await screen.findByRole("button", { name: REFER_BUTTON })).not.toBeNull();
    expect(vi.mocked(api.getPsyLink).mock.calls).toEqual([ [ "pa1" ] ]);
    cleanup();
    vi.mocked(api.getPsyLink).mockClear();
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(hp([ "clinical_record" ]));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(LINK_TITLE)).toBeNull();
    expect(api.getPsyLink).not.toHaveBeenCalled();
  });

  it("abertura justificada: o cartão também aparece, com o paciente da abertura", async () => {
    vi.mocked(api.getJustifiedRecord).mockResolvedValue(record({ access: "justified" }));
    vi.mocked(api.getConsultationOptions).mockResolvedValue(options());
    vi.mocked(api.getPsyLink).mockResolvedValue(psyLink({ shared_cases: [] }));
    renderWithProviders(<JustifiedRecord opening={opening({ expires_at: "2099-01-01T00:00:00-03:00" })} onEnd={() => undefined} />);
    expect(await screen.findByText(linkSinceText("2026-09-10"))).not.toBeNull();
    expect(vi.mocked(api.getPsyLink).mock.calls).toEqual([ [ "pa1" ] ]);
  });
});
