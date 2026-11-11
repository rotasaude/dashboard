// Observação no atendimento da UPA (módulo 32b, F-32.7; contrato §4–§5, Q8/Q13): o bloco da observação no painel, a evolução pelo
// adendo (a consulta abre pelo id, nunca por startConsultation) e o aviso de que o desfecho encerra a estadia e a prescrição.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  fetchCurrentSession: vi.fn(), getUrgencyQueue: vi.fn(), getUrgencyObservation: vi.fn(), listCallLocations: vi.fn(),
  getUrgencyEncounter: vi.fn(), recordUrgencyOutcome: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
  startConsultation: vi.fn(), getConsultation: vi.fn(), getConsultationProblems: vi.fn()
}));
vi.mock("../consultation/PatientPanel", () => ({ PatientPanel: () => <span>prontuário (dublê)</span> }));
// O dublê do carregador (a leitura real é do ConsultationLoader, testada no 19a) mostra o que o painel entrega: o id da consulta,
// a licença de adendo e os dois retornos que o painel escuta (adendo registrado; recusa 403 not_author/out_of_context do adendo).
vi.mock("../consultation/ConsultationView", () => ({
  ConsultationView: () => <span>consulta finalizada (dublê)</span>,
  ConsultationLoader: (p: { id: string; evolve?: boolean; onAddendumAdded?(a: unknown): void; onEvolveRefused?(): void }) => (
    <section aria-label="Adendo" data-consultation={p.id}>
      <span>{p.evolve ? "adendo liberado" : "somente leitura"}</span>
      <button type="button" onClick={() => p.onAddendumAdded?.({})}>dublê: adendo registrado</button>
      <button type="button" onClick={() => p.onEvolveRefused?.()}>dublê: adendo recusado</button>
    </section>
  )
}));
vi.mock("../billing/ProceduresPanel", () => ({ ProceduresPanel: () => null }));

import * as api from "../../lib/api";
import type { UrgencyEncounter, UrgencyInCareRow } from "../../lib/api";
import { NOW32B, detailAdministration, observationBlock, observedEncounter, prescription, stay } from "../../test/urgencyObservationFixtures";
import { renderWithProviders } from "../../test/campaignFixtures";
import { options as optionsFixture, problem, record as recordFixture } from "../../test/consultationFixtures";
import { DOCTOR_LINK, UPA, inCareRow, queue, receptionEncounter, urgencyUser } from "../../test/urgencyFixtures";
import { OutcomeForm } from "./OutcomeForm";
import { UrgencyDesk } from "./UrgencyDesk";

const FEATURES = [ "urgency_care", "clinical_record" ];
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  // Só o relógio: "hoje" é segunda 2026-11-10 (as horas de outro dia levam a data).
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(NOW32B);
  for (const fn of [ api.fetchCurrentSession, api.getUrgencyQueue, api.listCallLocations, api.getUrgencyEncounter, api.recordUrgencyOutcome,
    api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation, api.getConsultation, api.getConsultationProblems ]) {
    vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  }
  sessionStorage.clear();
  vi.mocked(api.getUrgencyObservation).mockResolvedValue({ beds: [], waiting_bed: [] });
  vi.mocked(api.getAttendanceRecord).mockResolvedValue(recordFixture());
  vi.mocked(api.getConsultationOptions).mockResolvedValue({ ...optionsFixture(), kinds: [ "urgency" ] });
  vi.mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
  vi.mocked(api.listCallLocations).mockResolvedValue({ items: [], location_required: false });
});

async function mountCare(enc: UrgencyEncounter, row: UrgencyInCareRow = inCareRow({ consultation_id: "co1", consultation_status: "finalized" })) {
  const user = urgencyUser([ "health_professional" ], FEATURES);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [ row ] }));
  vi.mocked(api.getUrgencyEncounter).mockResolvedValue(enc);
  const r = renderWithProviders(<UrgencyDesk unit={UPA} user={user} links={[ DOCTOR_LINK ]} />);
  fireEvent.click(await screen.findByRole("button", { name: `Atender ${row.ticket}` }));
  return r;
}

describe("observação no atendimento", () => {
  it("mostra o leito, as horas, o alerta, as estadias anteriores e as checagens das últimas 48 h", async () => {
    await mountCare(observedEncounter({ observation: observationBlock({ hours: 21, alert: "near_limit",
      stays: [ stay({ stay_id: "st0", bed_id: "b2", bed_label: "Obs 2", ended_at: "2026-11-10T10:00:00-03:00", end_kind: "bed_change" }), stay() ] }) }));
    const block = await screen.findByRole("region", { name: "Observação do paciente" });
    expect(within(block).getByText("Obs 1 · 21 h em observação")).not.toBeNull();
    expect(within(block).getByText("perto de 24 h em observação")).not.toBeNull();
    expect(within(block).getByText("Obs 2 · 08:00–10:00 · troca de leito")).not.toBeNull();
    expect(within(block).getByText(/administrado por Ana Souza/)).not.toBeNull();
  });

  it("sem estadia aberta: diz a hora em que saiu e não mostra alerta", async () => {
    await mountCare(observedEncounter({ observation: observationBlock({ current: null, hours: 5, alert: null,
      stays: [ stay({ ended_at: "2026-11-10T13:00:00-03:00", end_kind: "observation_ended" }) ] }) }));
    const block = await screen.findByRole("region", { name: "Observação do paciente" });
    expect(within(block).getByText("Saiu da observação às 13:00 · 5 h em observação")).not.toBeNull();
    expect(within(block).getByText("Obs 1 · 08:00–13:00 · observação encerrada")).not.toBeNull();
    expect(within(block).queryByText(/perto de 24 h|mais de 24 h/)).toBeNull();
  });

  it("horas de outro dia levam a data (dd/mm hh:mm); as de hoje, só a hora", async () => {
    await mountCare(observedEncounter({ observation: observationBlock({ current: stay({ started_at: "2026-11-09T22:00:00-03:00" }),
      stays: [ stay({ stay_id: "st0", bed_id: "b2", bed_label: "Obs 2", started_at: "2026-11-09T20:00:00-03:00", ended_at: "2026-11-09T22:00:00-03:00", end_kind: "bed_change" }),
        stay({ stay_id: "st00", bed_id: "b3", bed_label: "Obs 3", started_at: "2026-11-09T23:00:00-03:00", ended_at: "2026-11-10T01:00:00-03:00", end_kind: "bed_change" }) ] }),
      administrations: [ detailAdministration({ administered_at: "2026-11-09T23:30:00-03:00" }) ] }));
    const block = await screen.findByRole("region", { name: "Observação do paciente" });
    expect(within(block).getByText("Obs 2 · 09/11 20:00–09/11 22:00 · troca de leito")).not.toBeNull();
    expect(within(block).getByText("Obs 3 · 09/11 23:00–01:00 · troca de leito")).not.toBeNull();
    expect(within(block).getByText(/^09\/11 23:30 · /)).not.toBeNull();
  });

  it("o motivo de uma checagem não feita aparece só aqui, com a quebra de linha preservada; nome nulo cai no fallback", async () => {
    await mountCare(observedEncounter({ administrations: [ detailAdministration({ status: "refused", administered_at: null, reason: "recusou\nvia oral", by: { name: null, cbo_code: "223505" } }) ] }));
    const block = await screen.findByRole("region", { name: "Observação do paciente" });
    const reason = within(block).getByText(/recusou/);
    expect(reason.textContent).toBe("recusou\nvia oral");
    expect((reason as HTMLElement).style.whiteSpace).toBe("pre-wrap");
    expect(within(block).getByText(/recusado pelo paciente por sem nome/)).not.toBeNull();
  });

  it("encontro sem os blocos do 32b: nada de região Observação nem de evolução", async () => {
    await mountCare(receptionEncounter({ id: "en3", attendance_id: "at3", state: "in_care" }));
    await screen.findByRole("region", { name: "Consulta do atendimento" });
    expect(screen.queryByRole("region", { name: "Observação do paciente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar evolução (adendo)" })).toBeNull();
  });
});

describe("evolução pelo adendo (Q8/Q13)", () => {
  it("consulta finalizada: abre a consulta pelo id, com o adendo liberado, sem iniciar consulta", async () => {
    await mountCare(observedEncounter());
    fireEvent.click(await screen.findByRole("button", { name: "Registrar evolução (adendo)" }));
    const adendo = await screen.findByRole("region", { name: "Adendo" });
    expect(adendo.getAttribute("data-consultation")).toBe("co1");
    expect(within(adendo).getByText("adendo liberado")).not.toBeNull();
    expect(api.startConsultation).not.toHaveBeenCalled();
  });

  it("consulta em rascunho de quem chamou: não manda o outro médico finalizar", async () => {
    await mountCare(observedEncounter({ consultation_status: "draft" }));
    expect(await screen.findByText("A consulta ainda não foi finalizada: a evolução entra como adendo depois que quem atende a finalizar.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar evolução (adendo)" })).toBeNull();
  });
  it("consulta descartada: frase própria", async () => {
    await mountCare(observedEncounter({ consultation_status: "discarded" }));
    expect(await screen.findByText("A consulta de urgência foi descartada: não há consulta para evoluir.")).not.toBeNull();
  });

  it("adendo registrado: relê o prontuário e o detalhe", async () => {
    await mountCare(observedEncounter());
    fireEvent.click(await screen.findByRole("button", { name: "Registrar evolução (adendo)" }));
    await screen.findByRole("region", { name: "Adendo" });
    const records = vi.mocked(api.getAttendanceRecord).mock.calls.length;
    const details = vi.mocked(api.getUrgencyEncounter).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "dublê: adendo registrado" }));
    await waitFor(() => expect(vi.mocked(api.getAttendanceRecord).mock.calls.length).toBeGreaterThan(records));
    await waitFor(() => expect(vi.mocked(api.getUrgencyEncounter).mock.calls.length).toBeGreaterThan(details));
  });

  it("abrir a evolução depois não relê o prontuário (cada leitura grava trilha)", async () => {
    await mountCare(observedEncounter());
    await waitFor(() => expect(api.getAttendanceRecord).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar evolução (adendo)" }));
    await screen.findByRole("region", { name: "Adendo" });
    expect(api.getAttendanceRecord).toHaveBeenCalledTimes(1);
  });

  it("adendo recusado (403): relê o detalhe e, se o encontro fechou, fecha o painel", async () => {
    await mountCare(observedEncounter());
    fireEvent.click(await screen.findByRole("button", { name: "Registrar evolução (adendo)" }));
    await screen.findByRole("region", { name: "Adendo" });
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(observedEncounter({ state: "closed" }));
    fireEvent.click(screen.getByRole("button", { name: "dublê: adendo recusado" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Adendo" })).toBeNull());
    expect(await screen.findByText(/o encontro foi fechado|encerrad/i)).not.toBeNull();
  });

  it("nada de texto clínico nem do paciente na URL ou no armazenamento", async () => {
    await mountCare(observedEncounter());
    fireEvent.click(await screen.findByRole("button", { name: "Registrar evolução (adendo)" }));
    await screen.findByRole("region", { name: "Adendo" });
    expect(location.href).not.toMatch(/co1|Dipirona|João/);
    expect(JSON.stringify(sessionStorage)).not.toMatch(/Dipirona|recusou/);
  });
});

describe("o desfecho encerra a observação e a prescrição", () => {
  const outcomeEnc = (e: Partial<UrgencyEncounter> = {}) => observedEncounter(e);
  const renderOutcome = (props: { inObservation?: { bedLabel: string } | null; prescriptionActive?: boolean }) =>
    render(<OutcomeForm encounter={outcomeEnc()} doctor onRecorded={vi.fn()} {...props} />);

  it("com estadia aberta e prescrição ativa: a frase completa, antes do botão", () => {
    renderOutcome({ inObservation: { bedLabel: "Obs 1" }, prescriptionActive: true });
    const note = screen.getByText("O desfecho encerra a observação no Obs 1 e a prescrição ativa.");
    const button = screen.getByRole("button", { name: "Registrar desfecho" });
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("só a estadia, ou só a prescrição", () => {
    renderOutcome({ inObservation: { bedLabel: "Obs 2" } });
    expect(screen.getByText("O desfecho encerra a observação no Obs 2.")).not.toBeNull();
    cleanup();
    renderOutcome({ prescriptionActive: true });
    expect(screen.getByText("O desfecho encerra a prescrição ativa.")).not.toBeNull();
  });
  it("saída pela fila (sem o detalhe): a prescrição entra como 'se houver'", () => {
    render(<OutcomeForm encounter={outcomeEnc()} doctor={false} inObservation={{ bedLabel: "Obs 1" }} prescriptionMaybe onRecorded={vi.fn()} />);
    expect(screen.getByText("O desfecho encerra a observação no Obs 1 e a prescrição ativa, se houver.")).not.toBeNull();
  });
  it("sem nenhum dos dois: a tela é a do 32a", () => {
    renderOutcome({});
    expect(screen.queryByText(/O desfecho encerra/)).toBeNull();
  });

  it("no painel: a frase vem do detalhe e, depois do desfecho, a fila e o mapa são relidos", async () => {
    vi.mocked(api.recordUrgencyOutcome).mockResolvedValue({ encounter: observedEncounter({ state: "closed" }), attendance: { id: "at3", status: "closed", outcome: "discharged" } });
    await mountCare(observedEncounter());
    expect(await screen.findByText("O desfecho encerra a observação no Obs 1 e a prescrição ativa.")).not.toBeNull();
    const queueReads = vi.mocked(api.getUrgencyQueue).mock.calls.length;
    const mapReads = vi.mocked(api.getUrgencyObservation).mock.calls.length;
    fireEvent.click(screen.getByLabelText("Alta"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar desfecho" }));
    await waitFor(() => expect(api.recordUrgencyOutcome).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(api.getUrgencyQueue).mock.calls.length).toBeGreaterThan(queueReads));
    await waitFor(() => expect(vi.mocked(api.getUrgencyObservation).mock.calls.length).toBeGreaterThan(mapReads));
  });

  it("prescrição suspensa não entra na frase", async () => {
    await mountCare(observedEncounter({ prescription: prescription({ status: "suspended" }) }));
    expect(await screen.findByText("O desfecho encerra a observação no Obs 1.")).not.toBeNull();
  });
});

