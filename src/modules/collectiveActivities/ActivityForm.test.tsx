// src/modules/collectiveActivities/ActivityForm.test.tsx
// Nova atividade coletiva (módulo 24b, Task 11; F-24.12): o que cada tipo pede vem de `options.domains.rules`; participantes com
// `PersonPick`; envio idempotente (`useIdempotentSubmit`); as recusas do api caem no participante do `path`. Rótulos dos domínios (Q39).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getCollectiveOptions: vi.fn(), recordCollectiveActivity: vi.fn(), lookupVisitPerson: vi.fn(),
    findVisitDuplicates: vi.fn(), listCollectiveActivities: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import {
  ACTIVITY_NETWORK_RETRY, ACTIVITY_SAVED, DISCARD_UNCERTAIN_ACTIVITY, IDENTIFIER_WARNING, NO_TEAM, TYPE_5_6_NOT_GENERATED, UNCERTAIN_ACTIVITY_REREAD
} from "../../lib/collectiveActivities";
import { COLLECTIVE_DISABLED, HOME_VISIT_ERRORS, duplicateParticipantText } from "../../lib/homeVisits";
import { DUPLICATE_SUSPECTED_TEXT } from "../../lib/territoryRegistry";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { COLLECTIVE_DOMAINS, activity, candidate, hvUser, options, person } from "../../test/homeVisitFixtures";
import { CollectiveActivities } from "../CollectiveActivities";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getCollectiveOptions, api.recordCollectiveActivity, api.lookupVisitPerson, api.findVisitDuplicates, api.listCollectiveActivities ];
afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getCollectiveOptions).mockResolvedValue(options());
  // A lista da tela (Task 12) abre junto do formulário; aqui ela não é o assunto.
  mocked(api.listCollectiveActivities).mockResolvedValue({ items: [], next_before: null });
});

const body = (n = 0) => mocked(api.recordCollectiveActivity).mock.calls[n][0] as api.CollectiveActivityInput;
const uuids = () => mocked(api.recordCollectiveActivity).mock.calls.map((c) => (c[0] as api.CollectiveActivityInput).client_uuid);
const openForm = async () => {
  renderWithProviders(<CollectiveActivities />);
  fireEvent.click(await screen.findByRole("button", { name: "Nova atividade" }));
};
const chooseType = (v: string) => fireEvent.change(screen.getByLabelText("Tipo de atividade"), { target: { value: v } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "Registrar atividade" }));
const alertTexts = () => screen.queryAllByRole("alert").map((a) => a.textContent);
const invalid = (el: HTMLElement) => el.getAttribute("aria-invalid");
const isDisabled = (el: HTMLElement) => (el as HTMLInputElement).disabled;

// Tipo 4 com o obrigatório preenchido (sem participante).
async function fillType4() {
  await openForm();
  chooseType("4");
  fireEvent.change(screen.getByLabelText("Turno"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Unidade do local"), { target: { value: "u1" } });
  fireEvent.change(screen.getByLabelText("Número de participantes"), { target: { value: "10" } });
  fireEvent.click(screen.getByLabelText("Pessoa idosa"));
  fireEvent.click(screen.getByLabelText("Autocuidado de pessoas com doenças crônicas"));
}
// Participante digitado: ninguém com o CPF → registro rápido já com o documento.
async function addNewParticipant(name = "Ana Prado", cpf = "52998224725") {
  mocked(api.lookupVisitPerson).mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
  fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: cpf } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  fireEvent.change(await screen.findByLabelText("Nome completo"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-04-02" } });
  fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "female" } });
  fireEvent.click(screen.getByRole("button", { name: "Usar esta pessoa" }));
}
async function fillType4WithNewParticipant() {
  await fillType4();
  await addNewParticipant();
}
// Participante achado na busca por nome (sem documento).
async function addCandidate(c = candidate()) {
  mocked(api.findVisitDuplicates).mockResolvedValueOnce([ c ]);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
  fireEvent.click(screen.getByRole("button", { name: "Não tem o documento" }));
  fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Prado" } });
  fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-04-02" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
  fireEvent.click(await screen.findByRole("button", { name: `Escolher ${c.display_name}` }));
}
async function fillType4WithCandidate() {
  await fillType4();
  await addCandidate(candidate({ has_cns: false }));
}

describe("Nova atividade coletiva — regras do dado", () => {
  it("tipo 1: só temas de reunião; público e práticas não aparecem", async () => {
    await openForm();
    chooseType("1");
    expect(screen.getByRole("group", { name: "Temas para reunião (obrigatório)" })).not.toBeNull();
    expect(screen.queryByRole("group", { name: /Público-alvo/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /Temas para saúde/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /Práticas em saúde/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Educação permanente"));
    expect(screen.getByRole("group", { name: "Temas para saúde" })).not.toBeNull();
  });

  it("a regra vem do dado: a fixture troca e a tela segue", async () => {
    const d = COLLECTIVE_DOMAINS;
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ domains: { ...d, rules: { ...d.rules,
      by_type: { ...d.rules.by_type, "4": { ...d.rules.by_type["4"], participants: "required" } } } } }));
    await openForm();
    chooseType("4");
    expect(screen.getByRole("group", { name: "Participantes (obrigatório)" })).not.toBeNull();
    chooseType("7");
    expect(screen.getByRole("group", { name: "Participantes" })).not.toBeNull();
  });

  it("list_max do dado: chegou ao limite, as outras caixas ficam indisponíveis (Q36)", async () => {
    const d = COLLECTIVE_DOMAINS;
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ domains: { ...d, rules: { ...d.rules, list_max: { ...d.rules.list_max, target_audience: 1 } } } }));
    await openForm();
    chooseType("4");
    fireEvent.click(screen.getByLabelText("Pessoa idosa"));
    expect(isDisabled(screen.getByLabelText("Gestante"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Pessoa idosa"))).toBe(false);
    fireEvent.click(screen.getByLabelText("Pessoa idosa"));
    expect(isDisabled(screen.getByLabelText("Gestante"))).toBe(false);
  });

  it("trocar para um tipo que proíbe a lista tira o que estava marcado", async () => {
    mocked(api.recordCollectiveActivity).mockResolvedValue({ activity: activity(), replayed: false });
    await fillType4();
    chooseType("1");
    fireEvent.click(screen.getByLabelText("Processo de trabalho"));
    chooseType("4");
    expect((screen.getByLabelText("Pessoa idosa") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Pessoa idosa"));
    fireEvent.click(screen.getByLabelText("Autocuidado de pessoas com doenças crônicas"));
    send();
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ meeting_topics: [], target_audience: [ 10 ], health_topics: [ 4 ] });
  });

  it("tipo 5 sem participante não sai; prática 30 pede o procedimento; todas as recusas de uma vez, cada uma no seu campo", async () => {
    await openForm();
    chooseType("5");
    expect(screen.queryByLabelText("Procedimento (SIGTAP)")).toBeNull();
    fireEvent.click(screen.getByLabelText("Outro procedimento coletivo"));
    expect(screen.getByLabelText("Procedimento (SIGTAP)")).not.toBeNull();
    send();
    expect(api.recordCollectiveActivity).not.toHaveBeenCalled();
    expect(alertTexts().sort()).toEqual([
      "escolha o turno", "escolha a unidade ou escreva o local", "informe o número de participantes, de 1 a 999",
      "público-alvo: escolha ao menos um", "temas para saúde: escolha ao menos um", "escolha o procedimento da lista", "inclua ao menos um participante"
    ].sort());
    expect(invalid(screen.getByLabelText("Turno"))).toBe("true");
    expect(invalid(screen.getByLabelText("Unidade do local"))).toBe("true");
    expect(invalid(screen.getByLabelText("Número de participantes"))).toBe("true");
    expect(invalid(screen.getByLabelText("Procedimento (SIGTAP)"))).toBe("true");
    expect(invalid(screen.getByRole("group", { name: "Público-alvo (obrigatório)" }))).toBe("true");
    expect(invalid(screen.getByRole("group", { name: "Participantes (obrigatório)" }))).toBe("true");
  });

  it("tipo 5 com participante: corpo do contrato, avaliações alteradas calculadas e sem altered_count (Q38)", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(person({ patient_id: "pa1", display_name: "Maria Lima" }));
    mocked(api.recordCollectiveActivity).mockResolvedValue({ activity: activity(), replayed: false });
    await openForm();
    chooseType("5");
    fireEvent.change(screen.getByLabelText("Turno"), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("Unidade"));
    fireEvent.change(screen.getByLabelText("Unidade do local"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Número de participantes"), { target: { value: "12" } });
    fireEvent.click(screen.getByLabelText("Pessoa idosa"));
    fireEvent.click(screen.getByLabelText("Autocuidado de pessoas com doenças crônicas"));
    fireEvent.click(screen.getByLabelText("Outro procedimento coletivo"));
    fireEvent.change(screen.getByLabelText("Procedimento (SIGTAP)"), { target: { value: "0101050046" } });
    fireEvent.click(screen.getByLabelText("Joana ACS"));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Maria Lima" }));
    expect(screen.queryByLabelText(/Avaliações alteradas/)).toBeNull();
    expect(screen.getByText("Avaliações alteradas (calculado pela lista): 0")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Avaliação alterada — Maria Lima"));
    expect(screen.getByText("Avaliações alteradas (calculado pela lista): 1")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Peso (kg) — Maria Lima"), { target: { value: "72,5" } });
    const button = screen.getByRole("button", { name: "Registrar atividade" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ team_id: "t1", held_on: "2026-11-12", shift: 1, activity_type: 5, place_health_unit_id: "u1",
      participants_count: 12, meeting_topics: [], target_audience: [ 10 ], health_topics: [ 4 ], health_practices: [ 30 ], procedure_code: "0101050046",
      professionals: [ { professional_id: "p-acs" } ],
      participants: [ { patient_id: "pa1", altered_evaluation: true, measurements: { weight_kg: 72.5 } } ] });
    expect(body()).not.toHaveProperty("altered_count");
    expect(body().client_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(ACTIVITY_SAVED)).not.toBeNull();
  });

  it("tabagismo só nas práticas da regra", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(person({ patient_id: "pa1", display_name: "Maria Lima" }));
    await openForm();
    chooseType("5");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Maria Lima" }));
    expect(screen.queryByLabelText("Cessou o hábito de fumar — Maria Lima")).toBeNull();
    fireEvent.click(screen.getByLabelText("Programa Nacional de Controle do Tabagismo 1"));
    fireEvent.click(screen.getByLabelText("Cessou o hábito de fumar — Maria Lima"));
    expect((screen.getByLabelText("Cessou o hábito de fumar — Maria Lima") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Programa Nacional de Controle do Tabagismo 1"));
    expect(screen.queryByLabelText("Cessou o hábito de fumar — Maria Lima")).toBeNull();
  });

  it("peso com casas demais é recusado na tela (Q72)", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(person({ patient_id: "pa1", display_name: "Maria Lima" }));
    await fillType4();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Maria Lima" }));
    fireEvent.change(screen.getByLabelText("Peso (kg) — Maria Lima"), { target: { value: "72,12345" } });
    send();
    expect(api.recordCollectiveActivity).not.toHaveBeenCalled();
    expect(invalid(screen.getByLabelText("Peso (kg) — Maria Lima"))).toBe("true");
    expect(alertTexts()).toEqual([ "peso (kg): até 3 casas decimais" ]);
  });

  it("tema 18 nunca é oferecido; unidade sem CNES e profissional sem CNS indisponíveis", async () => {
    const d = COLLECTIVE_DOMAINS;
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ domains: { ...d, health_topics: [ ...d.health_topics, { code: 18, label: "Semana saúde na escola" } ] } }));
    await openForm();
    chooseType("4");
    expect(screen.queryByLabelText("Semana saúde na escola")).toBeNull();
    expect((screen.getByRole("option", { name: "Posto Novo (sem CNES)" }) as HTMLOptionElement).disabled).toBe(true);
    expect(isDisabled(screen.getByLabelText("Caio Sem CNS"))).toBe(true);
    expect(screen.getByText("sem CNS no cadastro")).not.toBeNull();
  });

  it("profissionais: os da equipe escolhida, da equipe primeiro; trocar a equipe limpa a escolha (Q57c)", async () => {
    const base = options();
    const t2 = { ...base.teams[0], id: "t2", ine: "0007654321", name: "ESF Jardim Sul",
      professionals: [ { id: "p-x", name: "Rui de Fora", cbo: "225125", has_cns: true, in_team: false }, { id: "p-y", name: "Eva da Equipe", cbo: "515105", has_cns: true, in_team: true } ] };
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ teams: [ base.teams[0], t2 ] }));
    mocked(api.recordCollectiveActivity).mockResolvedValue({ activity: activity(), replayed: false });
    await openForm();
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "t1" } });
    fireEvent.click(screen.getByLabelText("Joana ACS"));
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "t2" } });
    expect(screen.queryByLabelText("Joana ACS")).toBeNull();
    const group = screen.getByRole("group", { name: "Profissionais participantes" });
    expect(within(group).getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual([ "Eva da Equipe", "Rui de Fora" ]);
    expect(within(group).getAllByRole("checkbox").every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    chooseType("4");
    fireEvent.change(screen.getByLabelText("Turno"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Unidade do local"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Número de participantes"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("Pessoa idosa"));
    fireEvent.click(screen.getByLabelText("Autocuidado de pessoas com doenças crônicas"));
    send();
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ team_id: "t2", professionals: [] });
  });

  it("sem equipe: a frase e nenhum formulário (Q57b)", async () => {
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ teams: [] }));
    renderWithProviders(<CollectiveActivities />);
    expect(await screen.findByText(NO_TEAM)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
  });

  it("outro local: texto com o aviso congelado", async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText("Outro local"));
    expect(screen.queryByLabelText("Unidade do local")).toBeNull();
    expectFrozenNotice(screen.getByLabelText("Descrição do local"));
  });

  it("a busca de pessoa dentro do formulário não envia a atividade", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(person({ patient_id: "pa1", display_name: "Maria Lima" }));
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByRole("button", { name: "Escolher Maria Lima" })).not.toBeNull();
    expect(alertTexts()).toEqual([]);
  });

  it("fechar: vazio fecha direto; preenchido pergunta antes de descartar", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", { name: "Nova atividade coletiva" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova atividade" }));
    chooseType("4");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("form", { name: "Nova atividade coletiva" })).not.toBeNull();
    const ask = screen.getByRole("group", { name: "Descartar a atividade?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Nova atividade coletiva" })).toBeNull());
    // Nada foi enviado: fechar não relê a lista nem diz que pode ter gravado.
    expect(api.listCollectiveActivities).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UNCERTAIN_ACTIVITY_REREAD)).toBeNull();
  });
});

describe("Nova atividade coletiva — participante sem CPF e sem CNS", () => {
  it("tipo 4: aviso, e a gravação sai com o participante", async () => {
    mocked(api.recordCollectiveActivity).mockResolvedValue({ activity: activity(), replayed: false });
    await fillType4WithCandidate();
    expect(screen.getByText(IDENTIFIER_WARNING)).not.toBeNull();
    expect(screen.queryByText(TYPE_5_6_NOT_GENERATED)).toBeNull();
    send();
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(1));
    expect(body().participants).toEqual([ { patient_id: "pa8" } ]);
  });

  it("tipo 5: o aviso de ficha não gerada, sem bloquear (Q74)", async () => {
    mocked(api.recordCollectiveActivity).mockResolvedValue({ activity: activity(), replayed: false });
    await fillType4WithCandidate();
    chooseType("5");
    expect(screen.getByText(IDENTIFIER_WARNING)).not.toBeNull();
    expect(screen.getByText(TYPE_5_6_NOT_GENERATED)).not.toBeNull();
    send();
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ activity_type: 5, participants: [ { patient_id: "pa8" } ] });
  });
});

describe("Nova atividade coletiva — recusas do api", () => {
  it("409 duplicate_suspected de um participante reabre a busca dele, com os candidatos; escolher troca o participante", async () => {
    mocked(api.recordCollectiveActivity)
      .mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected", path: "participants[0].new_patient", candidates: [ candidate() ] }, "x"))
      .mockResolvedValueOnce({ activity: activity(), replayed: false });
    await fillType4WithNewParticipant();
    send();
    expect(await screen.findByText(DUPLICATE_SUSPECTED_TEXT)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Escolher Ana Prado" }));
    send();
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(2));
    expect(body(0).participants[0]).toHaveProperty("new_patient");
    expect(body(1).participants).toEqual([ { patient_id: "pa8" } ]);
    const [ a, b ] = uuids();
    expect(b).not.toBe(a);
  });

  it("409 duplicate_suspected sem path: a frase no topo", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected" }, "x"));
    await fillType4WithNewParticipant();
    send();
    expect(await screen.findByText(DUPLICATE_SUSPECTED_TEXT)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Escolher Ana Prado" })).toBeNull();
  });

  it("422 duplicate_participant confirmável: 'É outra pessoa' no participante e reenvio com duplicates_reviewed e uuid novo (Q54)", async () => {
    mocked(api.recordCollectiveActivity)
      .mockRejectedValueOnce(new ApiError(422, { error: "duplicate_participant", path: "participants[1]", confirmable: true }, "x"))
      .mockResolvedValueOnce({ activity: activity(), replayed: false });
    await fillType4WithNewParticipant();
    await addNewParticipant("Ana Prada", "11144477735");
    send();
    expect(await screen.findByText(duplicateParticipantText(true))).not.toBeNull();
    const card = screen.getByRole("group", { name: "Participante 2 — Ana Prada" });
    fireEvent.click(within(card).getByRole("button", { name: "É outra pessoa" }));
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(2));
    expect(body(1).participants[1]).toMatchObject({ duplicates_reviewed: true, new_patient: { full_name: "Ana Prada" } });
    expect(body(1).participants[0]).not.toHaveProperty("duplicates_reviewed");
    const [ a, b ] = uuids();
    expect(b).not.toBe(a);
  });

  it("a lista esvaziada pela regra leva junto a marca confirmável: participantes novos não herdam 'É outra pessoa'", async () => {
    const d = COLLECTIVE_DOMAINS;
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ domains: { ...d, rules: { ...d.rules,
      by_type: { ...d.rules.by_type, "1": { ...d.rules.by_type["1"], participants: "forbidden" } } } } }));
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new ApiError(422, { error: "duplicate_participant", path: "participants[1]", confirmable: true }, "x"));
    await fillType4WithNewParticipant();
    await addNewParticipant("Ana Prada", "11144477735");
    send();
    expect(await screen.findByRole("button", { name: "É outra pessoa" })).not.toBeNull();
    chooseType("1");
    expect(screen.queryByRole("group", { name: /Participantes/ })).toBeNull();
    chooseType("4");
    await addNewParticipant("Beto Souza", "52998224725");
    await addNewParticipant("Caio Lima", "11144477735");
    expect(screen.getByRole("group", { name: "Participante 2 — Caio Lima" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "É outra pessoa" })).toBeNull();
    expect(screen.queryByText(duplicateParticipantText(true))).toBeNull();
  });

  it("422 duplicate_participant não confirmável: a frase, sem o botão", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new ApiError(422, { error: "duplicate_participant", path: "participants[1]", confirmable: false }, "x"));
    await fillType4WithNewParticipant();
    await addNewParticipant("Ana Prada", "11144477735");
    send();
    expect(await screen.findByText(duplicateParticipantText(false))).not.toBeNull();
    expect(screen.queryByRole("button", { name: "É outra pessoa" })).toBeNull();
  });

  it("422 cpf_or_reason_required no participante cai no motivo de não ter CPF dele (Q71)", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(
      new ApiError(422, { error: "cpf_or_reason_required", path: "participants[0].new_patient.no_cpf_reason" }, "x"));
    await fillType4WithNewParticipant();
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.cpf_or_reason_required)).not.toBeNull();
    expect(invalid(screen.getByLabelText("Motivo de não ter CPF"))).toBe("true");
    expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("Ana Prado");
  });

  it("422 invalid_patient no campo do participante digitado", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(
      new ApiError(422, { error: "invalid_patient", path: "participants[0].new_patient.birth_date" }, "x"));
    await fillType4WithNewParticipant();
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.invalid_patient)).not.toBeNull();
    expect(invalid(screen.getByLabelText("Data de nascimento"))).toBe("true");
  });

  it("422 patient_unidentified no participante escolhido reabre a busca dele com a frase (Q41)", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(
      new ApiError(422, { error: "patient_unidentified", path: "participants[0].patient_id" }, "x"));
    await fillType4WithCandidate();
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.patient_unidentified)).not.toBeNull();
    expect(screen.getByLabelText("CPF ou CNS")).not.toBeNull();
  });

  it("429: frase, formulário mantido e o mesmo uuid no reenvio (Q68)", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new ApiError(429, { error: "too_many_requests" }, "x"))
      .mockResolvedValueOnce({ activity: activity(), replayed: false });
    await fillType4WithNewParticipant();
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.too_many_requests)).not.toBeNull();
    expect(isDisabled(screen.getByLabelText("Turno"))).toBe(false);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(screen.getByText("Ana Prado")).not.toBeNull();
    send();
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(2));
    const [ a, b ] = uuids();
    expect(b).toBe(a);
  });

  it("403 feature_disabled mostra a frase do interruptor", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new ApiError(403, { error: "feature_disabled", feature: "collective_activities" }, "x"));
    await fillType4();
    send();
    expect(await screen.findByText(COLLECTIVE_DISABLED)).not.toBeNull();
  });

  it("rede: trava os campos e o participante, e o reenvio leva o mesmo corpo e o mesmo uuid", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ activity: activity(), replayed: true });
    await fillType4WithNewParticipant();
    send();
    expect(await screen.findByText(ACTIVITY_NETWORK_RETRY)).not.toBeNull();
    for (const label of [ "Turno", "Tipo de atividade", "Unidade do local", "Número de participantes", "Pessoa idosa", "Avaliação alterada — Ana Prado", "Joana ACS" ]) {
      expect(isDisabled(screen.getByLabelText(label))).toBe(true);
    }
    expect(isDisabled(screen.getByRole("button", { name: "Adicionar participante" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Retirar — Ana Prado" }))).toBe(true);
    expect(screen.queryByLabelText("CPF ou CNS")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual(body(0));
    expect(await screen.findByText("Esta atividade já estava gravada.")).not.toBeNull();
  });

  it("rede: 'Descartar' avisa que a atividade pode ter sido gravada e relê a lista uma vez, sem reenviar", async () => {
    mocked(api.recordCollectiveActivity).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await fillType4();
    send();
    expect(await screen.findByText(ACTIVITY_NETWORK_RETRY)).not.toBeNull();
    const lists = mocked(api.listCollectiveActivities).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    const ask = screen.getByRole("group", { name: DISCARD_UNCERTAIN_ACTIVITY });
    expect(api.listCollectiveActivities).toHaveBeenCalledTimes(lists);
    fireEvent.click(within(ask).getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(UNCERTAIN_ACTIVITY_REREAD)).not.toBeNull();
    await waitFor(() => expect(api.listCollectiveActivities).toHaveBeenCalledTimes(lists + 1));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.listCollectiveActivities).toHaveBeenCalledTimes(lists + 1);
    expect(screen.queryByRole("form", { name: "Nova atividade coletiva" })).toBeNull();
    expect(api.recordCollectiveActivity).toHaveBeenCalledTimes(1);
  });
});
