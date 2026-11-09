// Atendimento médico na UPA e desfecho da urgência (F-32.4; contrato §7, §14 Q10/Q13/Q19/Q25/Q30): a consulta do 19a com
// `kind: "urgency"` (sem o desfecho do 13 nem os procedimentos do 22), a finalização com `{}`, e o desfecho com os tipos que cada
// papel registra. Depois do desfecho, o painel fecha, a fila relê e o aviso não traz texto clínico.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  fetchCurrentSession: vi.fn(), getUrgencyQueue: vi.fn(), listCallLocations: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(),
  getUrgencyEncounter: vi.fn(), recordUrgencyOutcome: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
  startConsultation: vi.fn(), saveConsultationDraft: vi.fn(), finalizeConsultation: vi.fn(), getConsultation: vi.fn(),
  getConsultationProblems: vi.fn()
}));
vi.mock("../consultation/PatientPanel", () => ({ PatientPanel: () => <span>prontuário (dublê)</span> }));
vi.mock("../consultation/ConsultationView", () => ({
  ConsultationView: () => <span>consulta finalizada (dublê)</span>, ConsultationLoader: () => null
}));
vi.mock("../billing/ProceduresPanel", () => ({ ProceduresPanel: () => <section aria-label="Procedimentos realizados">procedimentos</section> }));

import * as api from "../../lib/api";
import { ApiError, type UrgencyEncounter, type UrgencyInCareRow } from "../../lib/api";
import { renderWithProviders } from "../../test/campaignFixtures";
import { consultation as consultationFixture, finalized, options as optionsFixture, problem, record as recordFixture } from "../../test/consultationFixtures";
import {
  DOCTOR_LINK, NURSE_LINK, UPA, classification, encounter, inCareRow, queue, unidentifiedRef, urgencyUser
} from "../../test/urgencyFixtures";
import { OutcomeForm } from "./OutcomeForm";
import { UrgencyDesk } from "./UrgencyDesk";

const FEATURES = [ "urgency_care", "clinical_record", "procedure_billing", "exam_tracking" ];
const mocks = [ api.fetchCurrentSession, api.getUrgencyQueue, api.listCallLocations, api.callAttendance, api.callNext,
  api.getUrgencyEncounter, api.recordUrgencyOutcome, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation,
  api.saveConsultationDraft, api.finalizeConsultation, api.getConsultation, api.getConsultationProblems ];

afterEach(cleanup);
beforeEach(() => {
  for (const fn of mocks) vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
  vi.mocked(api.getAttendanceRecord).mockResolvedValue(recordFixture());
  vi.mocked(api.getConsultationOptions).mockResolvedValue({ ...optionsFixture(), kinds: [ "urgency" ] });
  vi.mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
});

// O encontro em atendimento: laranja, chamado pelo médico.
const careEncounter = (o: Partial<UrgencyEncounter> = {}) => encounter({
  id: "en3", attendance_id: "at3", state: "in_care", ticket: "U-038", color: "orange", max_wait_minutes: 10,
  first_classified_at: "2026-11-05T09:30:00-03:00", classifications: [ classification({ color: "orange", suggested_color: "orange",
    suggested: { color: "orange", criterion: "Dor intensa (8 a 10)" }, criterion: "Dor intensa (8 a 10)", max_wait_minutes: 10 }) ], ...o
});
// Um rascunho de urgência pronto para finalizar (problema, conduta e A/P), sem tipo de atendimento.
const readyDraft = () => finalized({ id: "co1", attendance_id: "at3", status: "draft", finalized_at: null, kind: "urgency", care_type: null, exam_requests: [] });

function mountDesk(links = [ DOCTOR_LINK ], features = FEATURES) {
  const user = urgencyUser([ "health_professional" ], features);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<UrgencyDesk unit={UPA} user={user} links={links} />);
}
// `"keep"`: o teste já ligou o detalhe (getUrgencyEncounter) do jeito dele.
async function mountCare(row: UrgencyInCareRow, enc: UrgencyEncounter | "keep" = careEncounter()) {
  vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [ row ] }));
  if (enc !== "keep") vi.mocked(api.getUrgencyEncounter).mockResolvedValue(enc);
  const r = mountDesk();
  fireEvent.click(await screen.findByRole("button", { name: `Atender ${row.ticket}` }));
  return r;
}
function mountOutcome(e: UrgencyEncounter, { doctor }: { doctor: boolean }) {
  const onRecorded = vi.fn();
  render(<OutcomeForm encounter={e} doctor={doctor} onRecorded={onRecorded} />);
  return onRecorded;
}
const queueReads = () => vi.mocked(api.getUrgencyQueue).mock.calls.length;
const radioLabels = () => screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent);

describe("atendimento médico", () => {
  it("da fila: 'Atender' abre a consulta de urgência, sem desfecho do 13 e sem procedimentos do 22", async () => {
    vi.mocked(api.startConsultation).mockResolvedValue(consultationFixture({ id: "co1", attendance_id: "at3", kind: "urgency", status: "draft", care_type: null }));
    await mountCare(inCareRow({ consultation_id: null }));
    const panel = await screen.findByRole("region", { name: "Atendimento — U-038" });
    expect(await within(panel).findByText(/^Cor vigente: laranja/)).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar atendimento de urgência" }));
    await waitFor(() => expect(vi.mocked(api.startConsultation).mock.calls[0]).toEqual([ "at3", { kind: "urgency" } ]));
    expect(screen.queryByRole("button", { name: "Iniciar consulta" })).toBeNull();
    expect(await screen.findByText("O desfecho da urgência vem depois de finalizar.")).not.toBeNull();
    // A consulta de urgência não tem tipo de atendimento (o api recusa `care_type`).
    expect(screen.queryByLabelText("Tipo de atendimento")).toBeNull();
    expect(screen.queryByRole("region", { name: "Procedimentos realizados" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    // O select "Desfecho" do 13 (OutcomeFields) não aparece na finalização.
    expect(within(screen.getByRole("region", { name: "Finalizar consulta" })).queryByLabelText("Desfecho")).toBeNull();
  });

  it("CBO sem urgência: a frase no lugar do botão", async () => {
    vi.mocked(api.getConsultationOptions).mockResolvedValue({ ...optionsFixture(), kinds: [] });
    await mountCare(inCareRow());
    expect(await screen.findByText("seu CBO não atende urgência nesta unidade")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar atendimento de urgência" })).toBeNull();
  });

  it("exame pedido sem prioridade na urgência aparece como urgente (o api faz nascer urgente)", async () => {
    vi.mocked(api.startConsultation).mockResolvedValue(consultationFixture({ id: "co1", attendance_id: "at3", kind: "urgency", care_type: null,
      exam_requests: [ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA" } ] }));
    await mountCare(inCareRow());
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar atendimento de urgência" }));
    expect(((await screen.findByLabelText("Prioridade (0202010503)")) as HTMLSelectElement).value).toBe("urgent");
  });

  it("finalizar manda {} e libera o desfecho; alta com retorno exige prazo e motivo; o painel fecha e a fila relê", async () => {
    let done = false;
    vi.mocked(api.getUrgencyEncounter).mockImplementation(async () =>
      careEncounter(done ? { consultation_id: "co1", consultation_status: "finalized" } : { consultation_id: "co1", consultation_status: "draft" }));
    vi.mocked(api.startConsultation).mockResolvedValue(readyDraft());
    vi.mocked(api.saveConsultationDraft).mockResolvedValue(readyDraft());
    vi.mocked(api.finalizeConsultation).mockImplementation(async () => { done = true; return finalized({ id: "co1", attendance_id: "at3", kind: "urgency", care_type: null }); });
    vi.mocked(api.recordUrgencyOutcome).mockResolvedValue({ encounter: careEncounter({ state: "closed" }),
      attendance: { id: "at3", status: "closed", outcome: "referred" } });
    await mountCare(inCareRow({ consultation_id: "co1", consultation_status: "draft" }), "keep");
    // Antes de finalizar: só os desfechos de balcão; alta e os demais esperam a consulta.
    let form = await screen.findByRole("group", { name: "Desfecho da urgência" });
    expect((within(form).getByRole("radio", { name: "Alta" }) as HTMLInputElement).disabled).toBe(true);
    expect((within(form).getByRole("radio", { name: "Saiu sem atendimento" }) as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar atendimento de urgência" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    await waitFor(() => expect(vi.mocked(api.finalizeConsultation).mock.calls[0]).toEqual([ "co1", null ]));
    expect(await screen.findByText("Consulta finalizada. Registre o desfecho da urgência.")).not.toBeNull();
    form = screen.getByRole("group", { name: "Desfecho da urgência" });
    await waitFor(() => expect((within(form).getByRole("radio", { name: "Alta" }) as HTMLInputElement).disabled).toBe(false));
    // Q30: com a consulta finalizada, nada de "registrado por engano".
    expect(within(form).queryByRole("radio", { name: "Registrado por engano" })).toBeNull();
    fireEvent.click(within(form).getByRole("radio", { name: "Alta com retorno na UBS" }));
    expect(within(form).getByText("O motivo fica para a equipe (linha do tempo profissional). O cidadão e a lista da UBS veem só o prazo.")).not.toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Registrar desfecho" }));
    expect(within(form).getByText("o retorno vai de 1 a 90 dias")).not.toBeNull();
    expect(api.recordUrgencyOutcome).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Procurar a UBS em até (dias)"), { target: { value: "7" } });
    fireEvent.change(within(form).getByLabelText("Motivo do retorno"), { target: { value: "reavaliar a pressão arterial" } });
    const before = queueReads();
    // A primeira tentativa termina antes do clique seguinte (o botão sai do "…").
    fireEvent.click(await within(form).findByRole("button", { name: "Registrar desfecho" }));
    await waitFor(() => expect(vi.mocked(api.recordUrgencyOutcome).mock.calls[0]).toEqual([ "en3",
      { kind: "discharged_to_primary_care", return_guidance: { days: 7, reason: "reavaliar a pressão arterial" } } ]));
    expect(await screen.findByText(
      "Atendimento encerrado: alta com retorno na UBS. A UBS de referência do paciente vê o retorno na lista dela, se o paciente tiver equipe."
    )).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Atendimento — U-038" })).toBeNull();
    // O aviso nunca traz o texto clínico (o motivo do retorno).
    expect(screen.queryByText(/pressão arterial/)).toBeNull();
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
  });

  it("'Chamar próximo' abre o atendimento da linha chamada; a senha vem da fila relida (a resposta não tem senha)", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValueOnce(queue({ awaiting_classification: [], in_care: [] }))
      .mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [ inCareRow() ] }));
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(careEncounter());
    vi.mocked(api.callNext).mockResolvedValue({ attendance: { id: "at3", health_unit_id: "upa1", status: "in_care" } as api.Attendance });
    mountDesk();
    await screen.findByRole("region", { name: "Classificados, por cor" });
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("U-038 chamada para o atendimento")).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Atendimento — U-038" })).not.toBeNull();
  });

  it("'Chamar' na linha abre o atendimento dela", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValueOnce(queue({ awaiting_classification: [], in_care: [] }))
      .mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [ inCareRow({ attendance_id: "at2", encounter_id: "en2", ticket: "U-040" }) ] }));
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(careEncounter({ id: "en2", attendance_id: "at2", ticket: "U-040" }));
    vi.mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "at2" } as api.Attendance });
    mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Chamar U-040" }));
    expect(await screen.findByRole("region", { name: "Atendimento — U-040" })).not.toBeNull();
    await waitFor(() => expect(vi.mocked(api.getUrgencyEncounter).mock.calls[0]).toEqual([ "en2" ]));
  });

  it("A14: 'Chamar próximo' que chama um atendimento de antes da urgência aponta o painel dele", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [] }));
    vi.mocked(api.callNext).mockResolvedValue({ attendance: { id: "a13" } as api.Attendance });
    const { client } = mountDesk();
    client.setQueryData([ "unitQueue", "upa1" ], { in_care: [], waiting: [ { id: "a13", ticket: "U-001", source: "triage" } ] });
    await screen.findByRole("region", { name: "Em atendimento" });
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText(
      "U-001 chamada para o atendimento — é um atendimento de antes da urgência: abra “Atendimentos de antes da urgência”, abaixo."
    )).not.toBeNull();
    expect(screen.queryByRole("region", { name: /^Atendimento — / })).toBeNull();
    expect(api.getUrgencyEncounter).not.toHaveBeenCalled();
  });
});

describe("desfecho", () => {
  it("médico com a consulta finalizada: os 6 tipos na ordem; transferência pede destino; pedido de vaga é opcional", () => {
    mountOutcome(encounter({ state: "in_care", consultation_id: "co1", consultation_status: "finalized" }), { doctor: true });
    expect(radioLabels()).toEqual([
      "Alta", "Alta com retorno na UBS", "Transferência", "Saiu sem atendimento", "Saiu contra orientação médica", "Óbito" ]);
    fireEvent.click(screen.getByRole("radio", { name: "Transferência" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    expect(screen.getByText("informe o destino da transferência")).not.toBeNull();
    expect(screen.getByLabelText("Destino")).not.toBeNull();
    expect(screen.getByLabelText("Pedido de vaga (opcional)")).not.toBeNull();
    expect(api.recordUrgencyOutcome).not.toHaveBeenCalled();
  });

  it("transferência com destino: só os campos dela; pedido de vaga vazio não vai", async () => {
    vi.mocked(api.recordUrgencyOutcome).mockResolvedValue({ encounter: encounter({ state: "closed" }), attendance: { id: "at1", status: "closed", outcome: "referred" } });
    const onRecorded = mountOutcome(encounter({ state: "in_care", consultation_id: "co1", consultation_status: "finalized" }), { doctor: true });
    fireEvent.click(screen.getByRole("radio", { name: "Transferência" }));
    fireEvent.change(screen.getByLabelText("Destino"), { target: { value: "Hospital Municipal" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    await waitFor(() => expect(vi.mocked(api.recordUrgencyOutcome).mock.calls[0]).toEqual([ "en1", { kind: "transferred", destination: "Hospital Municipal" } ]));
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(onRecorded.mock.calls[0][1]).toBe("Atendimento encerrado: transferência.");
  });

  it("médico sem a consulta finalizada: os 7, só os de balcão liberados, os demais com a dica", () => {
    mountOutcome(encounter({ state: "in_care" }), { doctor: true });
    expect(radioLabels()).toEqual([ "Alta", "Alta com retorno na UBS", "Transferência", "Saiu sem atendimento",
      "Saiu contra orientação médica", "Óbito", "Registrado por engano" ]);
    const enabled = screen.getAllByRole("radio").filter((r) => !(r as HTMLInputElement).disabled).map((r) => (r as HTMLInputElement).labels?.[0]?.textContent);
    expect(enabled).toEqual([ "Saiu sem atendimento", "Registrado por engano" ]);
    expect(screen.getByText("Alta, transferência, óbito e saída contra orientação esperam a consulta de urgência finalizada.")).not.toBeNull();
  });

  it("paciente não identificado: alta e transferência bloqueadas com a frase; óbito liberado", () => {
    mountOutcome(encounter({ state: "in_care", consultation_id: "co1", consultation_status: "finalized", patient: unidentifiedRef() }), { doctor: true });
    for (const name of [ "Alta", "Alta com retorno na UBS", "Transferência" ]) {
      expect((screen.getByRole("radio", { name }) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByRole("radio", { name: "Óbito" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText("identifique o paciente antes da alta ou da transferência")).not.toBeNull();
  });

  it("recepção e enfermagem: só 'Saiu sem atendimento' e 'Registrado por engano'", () => {
    mountOutcome(encounter({ state: "classified" }), { doctor: false });
    expect(radioLabels()).toEqual([ "Saiu sem atendimento", "Registrado por engano" ]);
  });

  it("registrado por engano: motivo de 10 a 500 e a confirmação; o aviso sem o motivo", async () => {
    vi.mocked(api.recordUrgencyOutcome).mockResolvedValue({ encounter: encounter({ state: "closed" }), attendance: { id: "at1", status: "closed", outcome: "left" } });
    const onRecorded = mountOutcome(encounter({ state: "classified" }), { doctor: false });
    fireEvent.click(screen.getByRole("radio", { name: "Registrado por engano" }));
    fireEvent.change(screen.getByLabelText("Motivo do registro por engano"), { target: { value: "duplicado" } });
    expect(screen.getByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    expect(screen.queryByText("O desfecho não pode ser alterado. Confirmar?")).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do registro por engano"), { target: { value: "chegada registrada duas vezes" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    expect(screen.getByText("O desfecho não pode ser alterado. Confirmar?")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.recordUrgencyOutcome).mock.calls[0]).toEqual([ "en1",
      { kind: "registered_in_error", reason: "chegada registrada duas vezes" } ]));
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(onRecorded.mock.calls[0][1]).toBe("Atendimento encerrado: registrado por engano.");
  });

  it("óbito pede a confirmação antes de enviar", async () => {
    vi.mocked(api.recordUrgencyOutcome).mockResolvedValue({ encounter: encounter({ state: "closed" }), attendance: { id: "at1", status: "closed", outcome: "discharged" } });
    mountOutcome(encounter({ state: "in_care", consultation_id: "co1", consultation_status: "finalized" }), { doctor: true });
    fireEvent.click(screen.getByRole("radio", { name: "Óbito" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    expect(api.recordUrgencyOutcome).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.recordUrgencyOutcome).mock.calls[0]).toEqual([ "en1", { kind: "death" } ]));
  });

  it("recusas do api: consultation_not_finalized e consultation_in_progress mostram a frase", async () => {
    vi.mocked(api.recordUrgencyOutcome).mockRejectedValueOnce(new ApiError(422, { error: "consultation_not_finalized", path: "kind" }, "x"))
      .mockRejectedValueOnce(new ApiError(409, { error: "consultation_in_progress", path: "kind" }, "x"));
    const onRecorded = mountOutcome(encounter({ state: "in_care", consultation_id: "co1", consultation_status: "finalized" }), { doctor: true });
    fireEvent.click(screen.getByRole("radio", { name: "Alta" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    expect(await screen.findByText("finalize a consulta antes deste desfecho")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Saiu sem atendimento" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    expect(await screen.findByText("há uma consulta em rascunho neste atendimento — finalize-a antes")).not.toBeNull();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it("'Saiu sem atendimento' na fila abre o desfecho de balcão, sem ler o detalhe; o aviso e a fila relida", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ in_care: [] }));
    vi.mocked(api.recordUrgencyOutcome).mockResolvedValue({ encounter: encounter({ id: "en2", state: "closed" }), attendance: { id: "at2", status: "closed", outcome: "left" } });
    mountDesk([ NURSE_LINK ]);
    fireEvent.click(await screen.findByRole("button", { name: "Saiu sem atendimento U-040" }));
    const panel = await screen.findByRole("region", { name: "Saída — U-040" });
    expect(within(panel).getAllByRole("radio").length).toBe(2);
    fireEvent.click(within(panel).getByRole("radio", { name: "Saiu sem atendimento" }));
    const before = queueReads();
    fireEvent.click(within(panel).getByRole("button", { name: "Registrar desfecho" }));
    await waitFor(() => expect(vi.mocked(api.recordUrgencyOutcome).mock.calls[0]).toEqual([ "en2", { kind: "left_without_care" } ]));
    expect(await screen.findByText("Atendimento encerrado: saiu sem atendimento.")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Saída — U-040" })).toBeNull();
    await waitFor(() => expect(queueReads()).toBeGreaterThan(before));
    expect(api.getUrgencyEncounter).not.toHaveBeenCalled();
  });
});
