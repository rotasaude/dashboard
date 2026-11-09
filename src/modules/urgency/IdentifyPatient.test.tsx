// Identificação do paciente provisório (F-32.2; contrato §4, §14 Q5, Q17, Q19, Q21, Q23, Q25, Q29). Só a recepção identifica
// (A8). Paciente existente: as duas pessoas lado a lado, a caixa de confirmação e o ConfirmButton (fusão irreversível). Paciente
// novo: o provisório recebe os dados, com a conferência de duplicado do 24a (Q23). Uma vez só: already_identified relê o encontro.
// Na mesa: "Identificar" nas linhas da fila e a lista de provisórios (Q29), lida só quando pedida (cada leitura grava trilha).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  getUrgencyEncounter: vi.fn(), lookupUrgencyPerson: vi.fn(), identifyUrgencyPatient: vi.fn(), getUrgencyQueue: vi.fn(),
  listProvisionalEncounters: vi.fn(), createUrgencyArrival: vi.fn(), listCallLocations: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError, type NewPatient, type UrgencyEncounter } from "../../lib/api";
import { ENCOUNTER_OPEN_ON_IDENTIFY } from "../../lib/urgency";
import {
  NURSE_LINK, UPA, duplicateCandidates, encounter, patientRef, provisionalEncounter, queue, urgencyUser, waitingRow, unidentifiedRef
} from "../../test/urgencyFixtures";
import { IdentifyPatient } from "./IdentifyPatient";
import { UrgencyDesk } from "./UrgencyDesk";

const DESCRIPTION = "homem, cerca de 40 anos, achado na rodoviária";
const provisional = encounter({ patient: patientRef({ patient_id: "prov1", name: "Não identificado", unidentified: true, description: DESCRIPTION }) });
const mergeBox = (name: string) =>
  `Confirmo que é a mesma pessoa. O atendimento, a consulta, os documentos, os exames, as receitas e o faturamento passam para ${name}, e isso não pode ser desfeito.`;
const identified = (name: string, o: Partial<api.UrgencyIdentifyResult> = {}): api.UrgencyIdentifyResult =>
  ({ encounter: encounter({ patient: patientRef({ patient_id: "pa7", name }) }), merged: true, moved: 3, kept_duplicates: 0, ...o });

afterEach(cleanup);
// Com chaves: o retorno do beforeEach vira teardown no vitest.
beforeEach(() => {
  vi.mocked(api.getUrgencyEncounter).mockReset(); vi.mocked(api.lookupUrgencyPerson).mockReset();
  vi.mocked(api.identifyUrgencyPatient).mockReset(); vi.mocked(api.listProvisionalEncounters).mockReset();
  vi.mocked(api.getUrgencyQueue).mockReset().mockResolvedValue(queue({ awaiting_classification: [], by_color: [], in_care: [] }));
  vi.mocked(api.listCallLocations).mockReset().mockResolvedValue({ items: [], location_required: false });
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mount(props: { onIdentified?(e: UrgencyEncounter, notice: string): void; onCancel?(): void } = {}) {
  const onIdentified = vi.fn(props.onIdentified);
  const onCancel = vi.fn(props.onCancel);
  render(<QueryClientProvider client={client()}>
    <IdentifyPatient encounterId="en1" onIdentified={onIdentified} onCancel={onCancel} />
  </QueryClientProvider>);
  return { onIdentified, onCancel };
}

// `scope`: na mesa, o painel da identificação (a recepção também tem o "CPF ou CNS" da chegada).
async function search(doc = "52998224725", scope: HTMLElement = document.body) {
  fireEvent.change(await within(scope).findByLabelText("CPF ou CNS"), { target: { value: doc } });
  fireEvent.click(within(scope).getByRole("button", { name: "Buscar" }));
}

// Escolhe o paciente achado e passa pelos dois passos (caixa + Ligar + Confirmar).
async function pickAndConfirm(name: string, scope: HTMLElement = document.body) {
  await search(undefined, scope);
  fireEvent.click(await screen.findByRole("button", { name: `É ${name}` }));
  fireEvent.click(screen.getByLabelText(mergeBox(name)));
  fireEvent.click(screen.getByRole("button", { name: "Ligar ao paciente existente" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

function fillNewPatient(p: Partial<NewPatient> & { full_name: string; birth_date: string; sex: string }) {
  fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: p.full_name } });
  fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: p.birth_date } });
  fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: p.sex } });
  if (p.cpf) fireEvent.change(screen.getByLabelText("CPF (se tiver)"), { target: { value: p.cpf } });
}

describe("IdentifyPatient (F-32.2)", () => {
  it("paciente existente: lado a lado, caixa obrigatória e confirmação em dois passos", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockResolvedValue(identified("Carlos Dias"));
    const { onIdentified } = mount();
    expect(await screen.findByText(DESCRIPTION)).not.toBeNull();
    await search();
    fireEvent.click(await screen.findByRole("button", { name: "É Carlos Dias" }));
    const compare = screen.getByRole("group", { name: "Confira antes de ligar" });
    expect(within(compare).getByText("Carlos Dias")).not.toBeNull();
    expect(within(compare).getByText("*** **** **** 1234")).not.toBeNull();
    expect(within(compare).getByText(DESCRIPTION)).not.toBeNull();
    expect(within(compare).getByText("U-042")).not.toBeNull();
    const confirm = screen.getByRole("button", { name: "Ligar ao paciente existente" });
    // ActionButton bloqueia por aria-disabled (o foco não se perde, spec 6a §3.3): sem a caixa, o clique não pergunta.
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("marque a confirmação")).not.toBeNull();
    fireEvent.click(confirm);
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.click(screen.getByLabelText(mergeBox("Carlos Dias")));
    fireEvent.click(screen.getByRole("button", { name: "Ligar ao paciente existente" }));
    expect(api.identifyUrgencyPatient).not.toHaveBeenCalled();
    expect(screen.getByText("Ligar agora? Não dá para desfazer.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.identifyUrgencyPatient).mock.calls[0]).toEqual([ "en1", { patient_id: "pa7" } ]));
    expect(await screen.findByText("Identificado: Carlos Dias.")).not.toBeNull();
    expect(onIdentified.mock.calls[0][1]).toBe("Identificado: Carlos Dias.");
  });

  it("desmarcar a caixa ou escolher outro paciente volta a bloquear a ligação", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    mount();
    await search();
    fireEvent.click(await screen.findByRole("button", { name: "É Carlos Dias" }));
    fireEvent.click(screen.getByLabelText(mergeBox("Carlos Dias")));
    fireEvent.click(screen.getByRole("button", { name: "Escolher outro" }));
    fireEvent.click(await screen.findByRole("button", { name: "É Carlos Dias" }));
    expect((screen.getByLabelText(mergeBox("Carlos Dias")) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Ligar ao paciente existente" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("paciente novo: o provisório recebe os dados, sem fusão nem caixa", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: null, candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockResolvedValue({
      encounter: encounter({ patient: patientRef({ patient_id: "prov1", name: "Carlos Dias" }) }), merged: false, moved: 0, kept_duplicates: 0
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar como paciente novo" }));
    fillNewPatient({ full_name: "Carlos Dias", birth_date: "1986-03-02", sex: "male", cpf: "52998224725" });
    fireEvent.click(screen.getByRole("button", { name: "Identificar" }));
    await waitFor(() => expect(vi.mocked(api.identifyUrgencyPatient).mock.calls[0][1]).toEqual({
      new_patient: { full_name: "Carlos Dias", birth_date: "1986-03-02", sex: "male", cpf: "52998224725" }
    }));
    expect(screen.queryByText(/não pode ser desfeito/)).toBeNull();
    expect(await screen.findByText("Identificado: Carlos Dias.")).not.toBeNull();
  });

  it("paciente novo inválido não envia (a mesma conferência do 24a)", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar como paciente novo" }));
    fillNewPatient({ full_name: "Carlos Dias", birth_date: "1986-03-02", sex: "male" });
    fireEvent.click(screen.getByRole("button", { name: "Identificar" }));
    expect(await screen.findByText("sem CPF, informe o motivo")).not.toBeNull();
    expect(api.identifyUrgencyPatient).not.toHaveBeenCalled();
  });

  it("already_identified: a frase, relê o encontro e mostra quem é; sem segunda tentativa", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValueOnce(provisional)
      .mockResolvedValueOnce(encounter({ patient: patientRef({ patient_id: "pa8", name: "Pedro Alves" }) }));
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockRejectedValue(new ApiError(409, { error: "already_identified" }, "x"));
    mount();
    await pickAndConfirm("Carlos Dias");
    expect(await screen.findByText("este paciente já foi identificado por outra pessoa")).not.toBeNull();
    expect(await screen.findByText("Agora é: Pedro Alves.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ligar ao paciente existente" })).toBeNull();
    expect(screen.queryByLabelText("CPF ou CNS")).toBeNull();
    expect(api.identifyUrgencyPatient).toHaveBeenCalledTimes(1);
    expect(api.getUrgencyEncounter).toHaveBeenCalledTimes(2);
  });

  it("encontro já identificado ao abrir: só 'Agora é', sem busca", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(encounter({ patient: patientRef({ name: "Pedro Alves" }) }));
    mount();
    expect(await screen.findByText("Agora é: Pedro Alves.")).not.toBeNull();
    expect(screen.queryByLabelText("CPF ou CNS")).toBeNull();
  });

  it("Q17: itens repetidos que ficaram no provisório entram no aviso", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockResolvedValue(identified("Carlos Dias", { kept_duplicates: 2 }));
    const { onIdentified } = mount();
    await pickAndConfirm("Carlos Dias");
    const notice = "Identificado: Carlos Dias. 2 itens repetidos ficaram no registro provisório (já existiam no paciente).";
    expect(await screen.findByText(notice)).not.toBeNull();
    expect(onIdentified.mock.calls[0][1]).toBe(notice);
  });

  it("Q25: encounter_open na identificação pede encerrar um dos dois; outras recusas pela frase", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient)
      .mockRejectedValueOnce(new ApiError(409, { error: "encounter_open" }, "x"))
      .mockRejectedValueOnce(new ApiError(409, { error: "merge_blocked" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "patient_id" }, "x"));
    mount();
    await pickAndConfirm("Carlos Dias");
    expect(await screen.findByText(ENCOUNTER_OPEN_ON_IDENTIFY)).not.toBeNull();
    // A ligação continua à vista, com a caixa desmarcada de novo.
    expect((screen.getByLabelText(mergeBox("Carlos Dias")) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(mergeBox("Carlos Dias")));
    fireEvent.click(screen.getByRole("button", { name: "Ligar ao paciente existente" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("não foi possível ligar os registros agora — avise o suporte")).not.toBeNull();
    fireEvent.click(screen.getByLabelText(mergeBox("Carlos Dias")));
    fireEvent.click(screen.getByRole("button", { name: "Ligar ao paciente existente" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/este cadastro é provisório/)).not.toBeNull();
  });

  it("Q23: duplicado suspeito mostra os candidatos; escolher um leva à confirmação da fusão; 'Nenhum destes' reenvia conferido", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.identifyUrgencyPatient)
      .mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected", path: "new_patient", candidates: duplicateCandidates() }, "x"))
      .mockResolvedValueOnce(identified("Maria Lima"))
      .mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected", path: "new_patient", candidates: duplicateCandidates() }, "x"))
      .mockResolvedValueOnce({ encounter: encounter({ patient: patientRef({ name: "Maria Lima" }) }), merged: false, moved: 0, kept_duplicates: 0 });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar como paciente novo" }));
    fillNewPatient({ full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female", cpf: "52998224725" });
    fireEvent.click(screen.getByRole("button", { name: "Identificar" }));
    expect(await screen.findByText("há cadastro parecido — confira os candidatos antes de criar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "É Maria Lima" }));
    const compare = screen.getByRole("group", { name: "Confira antes de ligar" });
    expect(within(compare).getByText("nasc. 02/03/1980")).not.toBeNull();
    fireEvent.click(screen.getByLabelText(mergeBox("Maria Lima")));
    fireEvent.click(screen.getByRole("button", { name: "Ligar ao paciente existente" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(vi.mocked(api.identifyUrgencyPatient).mock.calls[1]).toEqual([ "en1", { patient_id: "pa5" } ]));
    expect(await screen.findByText("Identificado: Maria Lima.")).not.toBeNull();
    cleanup();

    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar como paciente novo" }));
    fillNewPatient({ full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female", cpf: "52998224725" });
    fireEvent.click(screen.getByRole("button", { name: "Identificar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Nenhum destes — cadastrar como novo" }));
    await waitFor(() => expect(vi.mocked(api.identifyUrgencyPatient).mock.calls[3][1]).toEqual({
      new_patient: { full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female", cpf: "52998224725" }, duplicates_reviewed: true
    }));
  });

  it("cpf_taken vai no campo CPF; a busca recusada mostra a frase", async () => {
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockRejectedValue(new ApiError(429, { error: "too_many_requests" }, "x"));
    vi.mocked(api.identifyUrgencyPatient).mockRejectedValue(new ApiError(409, { error: "cpf_taken", path: "new_patient.cpf" }, "x"));
    mount();
    await search();
    expect(await screen.findByText("muitas tentativas — aguarde um minuto")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar como paciente novo" }));
    fillNewPatient({ full_name: "Carlos Dias", birth_date: "1986-03-02", sex: "male", cpf: "52998224725" });
    fireEvent.click(screen.getByRole("button", { name: "Identificar" }));
    expect(await screen.findByText("já existe paciente com este CPF — busque por ele e ligue ao existente")).not.toBeNull();
    expect(screen.getByLabelText("CPF (se tiver)").getAttribute("aria-invalid")).toBe("true");
  });

  it("Q25: encontro já encerrado (óbito) também pode ser identificado; sem nada no console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue({
      ...provisional, state: "closed",
      outcome: { kind: "death", return_guidance: null, recorded_at: "2026-11-05T03:40:00-03:00", by: { name: "Dr. Caio", cbo_code: "225125" } }
    } as UrgencyEncounter);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockResolvedValue(identified("Carlos Dias"));
    mount();
    expect(await screen.findByText(/encerrado · Óbito/)).not.toBeNull();
    await pickAndConfirm("Carlos Dias");
    expect(await screen.findByText("Identificado: Carlos Dias.")).not.toBeNull();
    const printed = [ ...log.mock.calls, ...warn.mock.calls, ...error.mock.calls ].flat().map(String).join(" ");
    expect(printed).not.toMatch(/Carlos|rodoviária|52998224725/);
    log.mockRestore(); warn.mockRestore(); error.mockRestore();
  });
});

describe("Mesa da UPA: identificar (F-32.2)", () => {
  function mountDesk(roles = [ "citizen_verifier" ], links: api.ProfessionalLink[] = []) {
    render(<QueryClientProvider client={client()}>
      <UrgencyDesk unit={UPA} user={urgencyUser(roles)} links={links} />
    </QueryClientProvider>);
  }
  const provisionalRow = waitingRow({ encounter_id: "en1", attendance_id: "at1", ticket: "U-044", patient: unidentifiedRef() });

  it("'Identificar' na linha abre o painel; o sucesso fecha, avisa sem a descrição e relê a fila", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [ provisionalRow ], by_color: [], in_care: [] }));
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockResolvedValue(identified("Carlos Dias"));
    mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Identificar U-044" }));
    const panel = await screen.findByRole("region", { name: "Identificar paciente — U-044" });
    expect(vi.mocked(api.getUrgencyEncounter).mock.calls[0][0]).toBe("en1");
    expect(await within(panel).findByText(DESCRIPTION)).not.toBeNull();
    const reads = vi.mocked(api.getUrgencyQueue).mock.calls.length;
    await pickAndConfirm("Carlos Dias", panel);
    const notice = await screen.findByRole("status");
    await waitFor(() => expect(notice.textContent).toBe("Identificado: Carlos Dias."));
    expect(screen.queryByRole("region", { name: "Identificar paciente — U-044" })).toBeNull();
    expect(screen.queryByText(DESCRIPTION)).toBeNull();
    await waitFor(() => expect(vi.mocked(api.getUrgencyQueue).mock.calls.length).toBeGreaterThan(reads));
  });

  it("'Cancelar' fecha o painel sem identificar", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [ provisionalRow ], by_color: [], in_care: [] }));
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue(provisional);
    mountDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Identificar U-044" }));
    const panel = await screen.findByRole("region", { name: "Identificar paciente — U-044" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("region", { name: "Identificar paciente — U-044" })).toBeNull();
    expect(api.identifyUrgencyPatient).not.toHaveBeenCalled();
  });

  it("Q29: a lista de não identificados só é lida quando pedida, sem releitura no foco; identificar relê a lista", async () => {
    vi.mocked(api.listProvisionalEncounters).mockResolvedValueOnce([ provisionalEncounter() ]).mockResolvedValueOnce([]);
    vi.mocked(api.getUrgencyEncounter).mockResolvedValue({ ...provisional, id: "en9", state: "closed" });
    vi.mocked(api.lookupUrgencyPerson).mockResolvedValue({ patient: patientRef({ patient_id: "pa7", name: "Carlos Dias" }), candidates: [] });
    vi.mocked(api.identifyUrgencyPatient).mockResolvedValue(identified("Carlos Dias"));
    mountDesk();
    const list = await screen.findByRole("region", { name: "Pacientes não identificados" });
    await screen.findByText("ninguém aguardando classificação");
    expect(api.listProvisionalEncounters).not.toHaveBeenCalled();
    fireEvent.click(within(list).getByRole("button", { name: "Mostrar a lista" }));
    expect(await within(list).findByText(DESCRIPTION)).not.toBeNull();
    expect(within(list).getByText(/^encerrado 05\/11\/2026/)).not.toBeNull();
    expect(within(list).getByText(/Óbito/)).not.toBeNull();
    expect(vi.mocked(api.listProvisionalEncounters).mock.calls).toEqual([ [ "upa1" ] ]);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    fireEvent.click(within(list).getByRole("button", { name: /^Identificar/ }));
    const panel = await screen.findByRole("region", { name: /^Identificar paciente — chegada/ });
    expect(vi.mocked(api.getUrgencyEncounter).mock.calls[0][0]).toBe("en9");
    expect(api.listProvisionalEncounters).toHaveBeenCalledTimes(1);
    await pickAndConfirm("Carlos Dias", panel);
    await waitFor(() => expect(vi.mocked(api.identifyUrgencyPatient).mock.calls[0]).toEqual([ "en9", { patient_id: "pa7" } ]));
    await waitFor(() => expect(api.listProvisionalEncounters).toHaveBeenCalledTimes(2));
    expect(await within(list).findByText("nenhum paciente sem identificação nos últimos 7 dias")).not.toBeNull();
    expect(panel.isConnected).toBe(false);
  });

  it("'Ocultar' tira a lista da tela; sem pedir, ela não é lida", async () => {
    vi.mocked(api.listProvisionalEncounters).mockResolvedValue([ provisionalEncounter() ]);
    mountDesk();
    const list = await screen.findByRole("region", { name: "Pacientes não identificados" });
    fireEvent.click(within(list).getByRole("button", { name: "Mostrar a lista" }));
    expect(await within(list).findByText(DESCRIPTION)).not.toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Ocultar" }));
    expect(within(list).queryByText(DESCRIPTION)).toBeNull();
    expect(api.listProvisionalEncounters).toHaveBeenCalledTimes(1);
  });

  it("A8: a enfermagem não vê a lista nem 'Identificar'", async () => {
    vi.mocked(api.getUrgencyQueue).mockResolvedValue(queue({ awaiting_classification: [ provisionalRow ], by_color: [], in_care: [] }));
    mountDesk([ "health_professional" ], [ NURSE_LINK ]);
    await screen.findByText("U-044");
    expect(screen.queryByRole("region", { name: "Pacientes não identificados" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Identificar/ })).toBeNull();
    expect(api.listProvisionalEncounters).not.toHaveBeenCalled();
  });
});
