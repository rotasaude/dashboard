// Acolhimento do CAPS (F-31.2): fila de encaminhamentos sem motivo, detalhe só no clique, demanda espontânea por CPF, CNS ou
// duplicados (POST), e o acolhimento com ou sem matrícula numa chamada só.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_II, NOW31, OPTIONS, TODAY31, psyUser, referralRow } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import {
  ESF_CNES_MISSING, NO_REGISTRATION_TEXT, PSY_DETAIL_KEY, PSY_ERRORS, RECEPTION_DONE, RECEPTION_ENROLLED, TRAIL_NOTE, psyError, psyRefusals
} from "../lib/psychosocial";
import { CapsReception } from "./CapsReception";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyOptions: vi.fn(),
  listPsyReferrals: vi.fn(), getPsyReferral: vi.fn(), recordPsyReception: vi.fn(), getPsyPrefill: vi.fn(), lookupPsyPerson: vi.fn(),
  lookupPsyPersonByCns: vi.fn(), findPsyDuplicates: vi.fn(), searchTerminology: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const PREFILL = { esf_covered: true, esf_cnes: "2384299", usf: { id: "ubs1", name: "UBS Vila Verde" }, team: { id: "ht1", name: "ESF Vila Verde" } };

function mount(o: { onOpenEnrollment?: (id: string) => void; prefill?: api.PsyPrefill } = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
  vi.mocked(api.getPsyOptions).mockResolvedValue(OPTIONS);
  vi.mocked(api.listPsyReferrals).mockResolvedValue({ items: [ referralRow({ reason: "NÃO DEVE APARECER" } as never) ], next_before: null });
  vi.mocked(api.getPsyPrefill).mockResolvedValue(o.prefill ?? PREFILL);
  vi.mocked(api.searchTerminology).mockResolvedValue([ { code: "F32.2", label: "Episódio depressivo grave" } ]);
  vi.mocked(api.recordPsyReception).mockResolvedValue({ reception_id: "re9", enrollment_id: null });
  return renderWithProviders(<CapsReception today={TODAY31} now={NOW31} onOpenEnrollment={o.onOpenEnrollment} />);
}
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
    expect(screen.getByText("prioritário")).not.toBeNull();
    expect(screen.getByText("UBS Vila Verde")).not.toBeNull();
    expect(screen.queryByText("NÃO DEVE APARECER")).toBeNull();
    expect(api.getPsyReferral).not.toHaveBeenCalled();
    expect(vi.mocked(api.listPsyReferrals).mock.calls[0]).toEqual([ "caps2", { before: null } ]);
    vi.mocked(api.getPsyReferral).mockResolvedValue({ ...referralRow(), reason: "Ideação suicida relatada", received_at: null,
      referred_by: { user_id: "u-9", name: "Dra. Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir encaminhamento de Maria da Silva" }));
    expect(await screen.findByText("Ideação suicida relatada")).not.toBeNull();
    expect(screen.getByText("Dra. Ana")).not.toBeNull();
    expect(screen.getByText(TRAIL_NOTE)).not.toBeNull();
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

  it("acolher com matrícula: valida o bloco inteiro antes de enviar e manda numa chamada só", async () => {
    const onOpenEnrollment = vi.fn();
    mount({ onOpenEnrollment });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "enrolled" } });
    // O prefill da ESF marca a cobertura e o CNES da USF, com a equipe como dica.
    await waitFor(() => expect((screen.getByLabelText("CNES da USF") as HTMLInputElement).value).toBe("2384299"));
    expect((screen.getByLabelText("Coberto por ESF") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("ESF Vila Verde · UBS Vila Verde")).not.toBeNull();
    expect(vi.mocked(api.getPsyPrefill).mock.calls[0]).toEqual([ "caps2", "pt1" ]);
    submit();
    expect(screen.getByText("informe o CID principal")).not.toBeNull();
    expect(screen.getByText("escolha a origem do usuário")).not.toBeNull();
    expect(screen.getByText("marque as substâncias ou nenhuma")).not.toBeNull();
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
    expect(onOpenEnrollment).toHaveBeenCalledWith("en9");
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

  it("acolhimento sem matrícula: frase de sucesso, sem o botão da matrícula", async () => {
    mount({ onOpenEnrollment: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "Acolher Maria da Silva" }));
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
});
