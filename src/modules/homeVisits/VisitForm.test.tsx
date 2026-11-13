// src/modules/homeVisits/VisitForm.test.tsx
// Nova visita na "Folha do dia" (módulo 24b, Task 7; F-24.10): lugar, pessoa, desfecho, motivos, medidas, observação e o envio
// idempotente. Rótulos dos domínios (Q39), nunca escritos à mão.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listHomeVisitDays: vi.fn(), getHomeVisitDay: vi.fn(),
    closeHomeVisitDay: vi.fn(), withdrawHomeVisit: vi.fn(), recordHomeVisit: vi.fn(), listVisitHouseholds: vi.fn(), getVisitHousehold: vi.fn(),
    lookupVisitPerson: vi.fn(), findVisitDuplicates: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import {
  DISCARD_UNCERTAIN_VISIT, FAMILY_NOTICE, FAMILY_REASON_TEXT, HOME_VISIT_ERRORS, HOME_VISITS_DISABLED, MALE_REASON_TEXT, NETWORK_RETRY, NO_FAMILY_NOTICE,
  REPLAYED_VISIT, TYPED_NOT_REGISTERED, UNCERTAIN_VISIT_REREAD, WRITE_RUNNING
} from "../../lib/homeVisits";
import { DUPLICATE_SUSPECTED_TEXT } from "../../lib/territoryRegistry";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import {
  NOW24B, VISIT_DOMAINS, acsTeam, candidate, context, day, household, householdDetail, hvUser, tacsTeam, visit
} from "../../test/homeVisitFixtures";
import { HomeVisitDay } from "../HomeVisitDay";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getHomeVisitContext, api.listHomeVisitDays, api.getHomeVisitDay, api.closeHomeVisitDay,
  api.withdrawHomeVisit, api.recordHomeVisit, api.listVisitHouseholds, api.getVisitHousehold, api.lookupVisitPerson, api.findVisitDuplicates ];
afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getHomeVisitContext).mockResolvedValue(context());
  mocked(api.listHomeVisitDays).mockResolvedValue({ items: [ day({ visits: undefined }) ], next_before: null });
  mocked(api.getHomeVisitDay).mockResolvedValue(day());
  mocked(api.listVisitHouseholds).mockResolvedValue({ items: [ household() ], next_before: null });
  mocked(api.getVisitHousehold).mockResolvedValue(householdDetail());
});

const body = (n = 0) => mocked(api.recordHomeVisit).mock.calls[n][0] as api.HomeVisitInput;
const uuids = () => mocked(api.recordHomeVisit).mock.calls.map((c) => (c[0] as api.HomeVisitInput).client_uuid);
const mount = () => renderWithProviders(<HomeVisitDay now={NOW24B} />);
const openForm = async () => { mount(); fireEvent.click(await screen.findByRole("button", { name: "Nova visita" })); };
const pickHousehold = async () => {
  fireEvent.click(screen.getByLabelText("Domicílio cadastrado"));
  fireEvent.click(await screen.findByRole("button", { name: "Rua das Flores, 120" }));
};
const noHousehold = (type: string) => {
  fireEvent.click(screen.getByLabelText("Imóvel sem cadastro"));
  fireEvent.change(screen.getByLabelText("Tipo de imóvel"), { target: { value: type } });
  fireEvent.change(screen.getByLabelText("Microárea"), { target: { value: "ma1" } });
};
const send = () => fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
const disabledAttr = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;

describe("Nova visita", () => {
  it("domicílio → morador → realizada com motivo e pressão: corpo do contrato; o cartão mostra o que o api gravou", async () => {
    mocked(api.recordHomeVisit).mockResolvedValue({
      visit: visit({ id: "v2", subject: "family_responsible", patient: { id: "pa2", display_name: "José Lima", has_cpf: true, cns_masked: null } }),
      day: day({ visits_count: 2, visits: undefined }), replayed: false });
    await openForm();
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "09:15" } });
    expect(within(screen.getByRole("form", { name: "Nova visita" })).getByText("Manhã")).not.toBeNull();
    await pickHousehold();
    fireEvent.click(await screen.findByLabelText("Maria Lima"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Visita periódica"));
    // Q43: Maria é de uma família ativa deste domicílio; com 29, a visita vai para a família.
    expect(screen.getByText(FAMILY_NOTICE)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Pressão sistólica"), { target: { value: "130" } });
    fireEvent.change(screen.getByLabelText("Pressão diastólica"), { target: { value: "85" } });
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ team_id: "t1", occurred_at: "2026-11-12T09:15:00-03:00", household_id: "h1", subject: "resident", patient_id: "pa1",
      outcome: 1, reasons: [ 29 ], shared: false, measurements: { systolic: 130, diastolic: 85 } });
    expect(body()).not.toHaveProperty("property_type");
    expect(body()).not.toHaveProperty("micro_area_id");
    expect(body()).not.toHaveProperty("shift");
    expect(body().client_uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Sem reler a folha: o cartão novo entra no cache da folha aberta.
    expect(await screen.findByText("família — responsável José Lima")).not.toBeNull();
    expect(screen.getByText("Visita registrada.")).not.toBeNull();
    expect(api.getHomeVisitDay).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Registrar visita" })).toBeNull();
  });

  it("não residencial: sem pessoa, sem medida, só os motivos do domínio", async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText("Imóvel sem cadastro"));
    fireEvent.change(screen.getByLabelText("Tipo de imóvel"), { target: { value: "4" } });
    expect(screen.getByText("imóvel não residencial: sem dados de pessoa")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Quem foi visitado" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    expect(screen.queryByLabelText("Pressão sistólica")).toBeNull();
    expect(screen.queryByLabelText("Pessoa com hipertensão")).toBeNull();
    expect(screen.getByLabelText("Imóvel com foco")).not.toBeNull();
    const codes = VISIT_DOMAINS.non_residential_reasons.length;
    expect(screen.getAllByRole("checkbox").filter((c) => c.closest("fieldset[data-reasons]")).length).toBe(codes);
  });

  it("trocar para não residencial limpa pessoa e motivo fora do domínio, e diz o que limpou", async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText("Imóvel sem cadastro"));
    fireEvent.change(screen.getByLabelText("Tipo de imóvel"), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Pessoa com hipertensão"));
    fireEvent.click(screen.getByLabelText("Imóvel com foco"));
    fireEvent.change(screen.getByLabelText("Tipo de imóvel"), { target: { value: "4" } });
    expect(screen.getByText("Retirado por não valer para esta visita: Pessoa com hipertensão.")).not.toBeNull();
    expect((screen.getByLabelText("Imóvel com foco") as HTMLInputElement).checked).toBe(true);
  });

  it("recusada: motivos e medidas somem e não vão", async () => {
    mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit({ outcome: 2, reasons: [], measurements: null }), day: day(), replayed: false });
    await openForm();
    await pickHousehold();
    fireEvent.click(await screen.findByLabelText("Maria Lima"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Pessoa com hipertensão"));
    fireEvent.change(screen.getByLabelText("Temperatura (°C)"), { target: { value: "36,5" } });
    fireEvent.click(screen.getByLabelText("Visita recusada"));
    expect(screen.queryByLabelText("Pessoa com hipertensão")).toBeNull();
    expect(screen.queryByLabelText("Temperatura (°C)")).toBeNull();
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalled());
    expect(body()).toMatchObject({ outcome: 2, reasons: [] });
    expect(body()).not.toHaveProperty("measurements");
  });

  it("ausente não oferece motivo nem medida", async () => {
    await openForm();
    noHousehold("1");
    fireEvent.click(screen.getByLabelText("Ausente"));
    expect(screen.queryByRole("group", { name: "Motivos da visita" })).toBeNull();
    expect(screen.queryByLabelText("Pressão sistólica")).toBeNull();
  });

  it("morador do sexo masculino: Gestante e Puérpera indisponíveis", async () => {
    await openForm();
    await pickHousehold();
    fireEvent.click(await screen.findByLabelText("José Lima"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    expect((screen.getByLabelText("Gestante") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Puérpera") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(MALE_REASON_TEXT).length).toBe(2);
  });

  it("família: o corpo leva family_id e subject family_responsible, sem patient_id; responsável que saiu fica indisponível", async () => {
    mocked(api.getVisitHousehold).mockResolvedValue(householdDetail({ families: [ ...household().families,
      { id: "f2", responsible: { patient_id: "pa3", display_name: "Rui Lima", sex: "male" }, moved_out: false, responsible_exited: true } ] }));
    mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit({ subject: "family_responsible" }), day: day(), replayed: false });
    await openForm();
    await pickHousehold();
    expect((await screen.findByLabelText("Família — responsável Rui Lima") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("responsável saiu — troque no Cadastro territorial")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Família — responsável José Lima"));
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalled());
    expect(body()).toMatchObject({ subject: "family_responsible", family_id: "f1", outcome: 3 });
    expect(body()).not.toHaveProperty("patient_id");
  });

  it("imóvel sem pessoa (Q34/Q44): com família ativa, 29 indisponível; peso some e o que limpou aparece", async () => {
    await openForm();
    await pickHousehold();
    fireEvent.click(await screen.findByLabelText("Maria Lima"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.change(screen.getByLabelText("Peso (kg)"), { target: { value: "70" } });
    fireEvent.click(screen.getByLabelText("Imóvel sem pessoa"));
    expect(screen.getByText("Retirado por não valer para esta visita: peso (kg).")).not.toBeNull();
    expect(screen.queryByLabelText("Peso (kg)")).toBeNull();
    expect(screen.getByLabelText("Pressão sistólica")).not.toBeNull();
    expect((screen.getByLabelText("Visita periódica") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(FAMILY_REASON_TEXT).length).toBeGreaterThan(0);
  });

  it("Q51: domicílio sem família ativa + 29 avisa que a visita vai ao imóvel", async () => {
    const moved = { ...household().families[0], moved_out: true };
    mocked(api.listVisitHouseholds).mockResolvedValue({ items: [ household({ families: [ moved ], has_active_family: false }) ], next_before: null });
    mocked(api.getVisitHousehold).mockResolvedValue(householdDetail({ families: [ moved ], has_active_family: false }));
    await openForm();
    await pickHousehold();
    fireEvent.click(await screen.findByLabelText("Maria Lima"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Visita periódica"));
    expect(screen.getByText(NO_FAMILY_NOTICE)).not.toBeNull();
  });

  it("Q51: pessoa digitada + 29 avisa que ela não será cadastrada", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue(null);
    await openForm();
    noHousehold("1");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pessoa" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.change(await screen.findByLabelText("Nome completo"), { target: { value: "Ana Prado" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-04-02" } });
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "female" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar esta pessoa" }));
    expect((screen.getByLabelText("Ana Prado") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Visita periódica"));
    expect(screen.getByText(`${NO_FAMILY_NOTICE}. ${TYPED_NOT_REGISTERED}`)).not.toBeNull();
  });

  it("Q36: os motivos param em reasons_max (o 37º fica indisponível)", async () => {
    // Responsável sem sexo conhecido: nenhum motivo fica indisponível e todos os do domínio (mais que 36) são oferecidos.
    const families = [ { ...household().families[0], responsible: { patient_id: "pa2", display_name: "José Lima", sex: null } } ];
    mocked(api.getVisitHousehold).mockResolvedValue(householdDetail({ families,
      residents: [ { patient_id: "pa1", display_name: "Maria Lima", sex: "female", family_id: "f1", unidentified: false } ] }));
    await openForm();
    await pickHousehold();
    fireEvent.click(await screen.findByLabelText("Maria Lima"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    const boxes = () => screen.getAllByRole("checkbox").filter((c) => c.closest("fieldset[data-reasons]")) as HTMLInputElement[];
    const total = VISIT_DOMAINS.motivo_visita.length;
    expect(total).toBeGreaterThan(VISIT_DOMAINS.reasons_max);
    expect(boxes().filter((b) => !b.disabled).length).toBe(total);
    for (const b of boxes().slice(0, 36)) fireEvent.click(b);
    expect(boxes().filter((b) => b.checked).length).toBe(36);
    const left = boxes().filter((b) => !b.checked);
    expect(left.length).toBe(total - 36);
    expect(left.every((b) => b.disabled)).toBe(true);
    expect(screen.getByText("no máximo 36 motivos — desmarque um para escolher outro")).not.toBeNull();
    fireEvent.click(left[0]);
    expect(boxes().filter((b) => b.checked).length).toBe(36);
  });

  it("client_uuid: mesmo na falha de rede, novo depois de gravar; duplo clique envia uma vez; 200 = já estava gravada", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ visit: visit(), day: day({ visits: undefined }), replayed: true });
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    const button = screen.getByRole("button", { name: "Registrar visita" });
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText(NETWORK_RETRY)).not.toBeNull();
    expect(api.recordHomeVisit).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Tipo de imóvel") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Ausente") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Descartar" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText(REPLAYED_VISIT)).not.toBeNull();
    const [ first, second ] = uuids();
    expect(second).toBe(first);
    expect(body(1)).toEqual(body(0));
  });

  it("seletor de pessoa aberto: na falha de rede ele some e não se troca a pessoa antes do reenvio", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ visit: visit(), day: day({ visits: undefined }), replayed: false });
    await openForm();
    noHousehold("1");
    fireEvent.click(screen.getByLabelText("Imóvel sem pessoa"));
    fireEvent.click(screen.getByLabelText("Ausente"));
    fireEvent.click(screen.getByRole("button", { name: "Buscar pessoa" }));
    expect(screen.getByLabelText("CPF ou CNS")).not.toBeNull();
    send();
    expect(await screen.findByText(NETWORK_RETRY)).not.toBeNull();
    expect(screen.queryByLabelText("CPF ou CNS")).toBeNull();
    expect(screen.queryByRole("button", { name: "Buscar" })).toBeNull();
    expect((screen.getByRole("button", { name: "Buscar pessoa" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual(body(0));
    expect(body(1)).toMatchObject({ subject: "none" });
  });

  it("buscar pessoa dentro do formulário não envia a visita (o submit da busca não sobe ao da visita)", async () => {
    mocked(api.lookupVisitPerson).mockResolvedValue({ patient_id: "pa9", display_name: "Ana Prado", birth_date: "1990-04-02", has_cpf: true, cns_masked: null, sex: "female" });
    mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    await openForm();
    noHousehold("1");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pessoa" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Ana Prado" }));
    fireEvent.click(screen.getByLabelText("Ausente"));
    // Rascunho válido; agora outra busca.
    fireEvent.click(screen.getByRole("button", { name: "Buscar pessoa" }));
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(api.lookupVisitPerson).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Registrar visita" })).not.toBeNull();
  });

  it("5xx trava; 'Descartar' avisa que pode ter gravado e relê a lista de hoje e a folha uma vez, sem reenviar", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(503, {}, "x"));
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText(NETWORK_RETRY)).not.toBeNull();
    const lists = mocked(api.listHomeVisitDays).mock.calls.length;
    const sheets = mocked(api.getHomeVisitDay).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    const ask = screen.getByRole("group", { name: DISCARD_UNCERTAIN_VISIT });
    expect(api.listHomeVisitDays).toHaveBeenCalledTimes(lists);
    fireEvent.click(within(ask).getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(UNCERTAIN_VISIT_REREAD)).not.toBeNull();
    await waitFor(() => expect(api.listHomeVisitDays).toHaveBeenCalledTimes(lists + 1));
    await waitFor(() => expect(api.getHomeVisitDay).toHaveBeenCalledTimes(sheets + 1));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.listHomeVisitDays).toHaveBeenCalledTimes(lists + 1);
    expect(api.getHomeVisitDay).toHaveBeenCalledTimes(sheets + 1);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Nova visita" })).not.toBeNull();
    expect(api.recordHomeVisit).toHaveBeenCalledTimes(1);
  });

  it("o cartão gravado entra na folha na ordem do api (occurred_at, depois id), sem reler", async () => {
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ visits_count: 2, visits: [ visit({ id: "v1", occurred_at: "2026-11-12T09:15:00-03:00" }),
      visit({ id: "v3", occurred_at: "2026-11-12T09:40:00-03:00" }) ] }));
    mocked(api.recordHomeVisit).mockResolvedValue({
      visit: visit({ id: "v2", occurred_at: "2026-11-12T08:00:00-03:00" }), day: day({ visits_count: 3, visits: undefined }), replayed: false });
    await openForm();
    await screen.findByRole("button", { name: "Retirar visita das 09:40" });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "08:00" } });
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByRole("button", { name: "Retirar visita das 08:00" })).not.toBeNull();
    const order = screen.getAllByRole("button", { name: /^Retirar visita das/ }).map((b) => b.textContent);
    expect(order).toEqual([ "Retirar visita das 08:00", "Retirar visita das 09:15", "Retirar visita das 09:40" ]);
    expect(api.getHomeVisitDay).toHaveBeenCalledTimes(1);
  });

  it("'Cancelar' sem envio pendurado fecha sem pergunta e sem reler", async () => {
    await openForm();
    await screen.findByText("Maria Lima");
    const lists = mocked(api.listHomeVisitDays).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Nova visita" })).not.toBeNull();
    expect(screen.queryByText(UNCERTAIN_VISIT_REREAD)).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.listHomeVisitDays).toHaveBeenCalledTimes(lists);
  });

  it("duas equipes: o seletor 'Equipe' trava enquanto a visita envia e enquanto o envio está pendurado", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ acsTeam(), acsTeam({ id: "t2", name: "ESF Jardim" }) ] }));
    let finish: (v: unknown) => void = () => {};
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(503, {}, "x"))
      .mockReturnValueOnce(new Promise((r) => { finish = r; }));
    await openForm();
    const team = () => screen.getByLabelText("Equipe") as HTMLSelectElement;
    expect(team().disabled).toBe(false);
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText(NETWORK_RETRY)).not.toBeNull();
    expect(team().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
    expect(team().disabled).toBe(true);
    finish({ visit: visit({ id: "v9" }), day: day({ visits: undefined }), replayed: true });
    expect(await screen.findByText(REPLAYED_VISIT)).not.toBeNull();
    await waitFor(() => expect(team().disabled).toBe(false));
  });

  it("motivo marcado antes dos moradores e que deixa de valer (5 para morador masculino) sai quando eles chegam", async () => {
    let arrive: (v: unknown) => void = () => {};
    mocked(api.getVisitHousehold).mockReturnValue(new Promise((r) => { arrive = r; }));
    renderWithProviders(<HomeVisitDay now={NOW24B} start={{ teamId: "t1", microAreaId: "ma1", householdId: "h1", familyId: "f1", patientId: "pa2", displayName: "José Lima" }} />);
    fireEvent.click(await screen.findByLabelText("Visita realizada"));
    const gestante = () => screen.getByLabelText("Gestante") as HTMLInputElement;
    fireEvent.click(gestante());
    expect(gestante().checked).toBe(true);
    arrive(householdDetail());
    await waitFor(() => expect(gestante().checked).toBe(false));
    expect(gestante().disabled).toBe(true);
    expect(screen.getByText("Retirado por não valer para esta visita: Gestante.")).not.toBeNull();
  });

  it("recusa do api com path cai no campo; o uuid é trocado", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(422, { error: "visit_date_out_of_range", path: "occurred_at" }, "x"))
      .mockResolvedValueOnce({ visit: visit(), day: day(), replayed: false });
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.visit_date_out_of_range)).not.toBeNull();
    expect(screen.getByLabelText("Data").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText("Tipo de imóvel") as HTMLSelectElement).disabled).toBe(false);
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
    const [ a, b ] = uuids();
    expect(b).not.toBe(a);
  });

  it("paths do api: reasons[i] no motivo, measurements.systolic na pressão", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(422, { error: "reason_not_allowed", path: "reasons[1]" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "measurements_forbidden", path: "measurements.systolic" }, "x"));
    await openForm();
    noHousehold("1");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pessoa" }));
    mocked(api.lookupVisitPerson).mockResolvedValue({ patient_id: "pa9", display_name: "Ana Prado", birth_date: "1990-04-02", has_cpf: true, cns_masked: null, sex: "female" });
    fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Escolher Ana Prado" }));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Pessoa com hipertensão"));
    fireEvent.click(screen.getByLabelText("Pessoa com diabetes"));
    fireEvent.change(screen.getByLabelText("Pressão sistólica"), { target: { value: "130" } });
    fireEvent.change(screen.getByLabelText("Pressão diastólica"), { target: { value: "85" } });
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.reason_not_allowed)).not.toBeNull();
    expect(screen.getByLabelText("Pessoa com diabetes").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Pessoa com hipertensão").getAttribute("aria-invalid")).not.toBe("true");
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.measurements_forbidden)).not.toBeNull();
    expect(screen.getByLabelText("Pressão sistólica").getAttribute("aria-invalid")).toBe("true");
  });

  it("todas as recusas de uma vez; medida fora da faixa e pressão sem par não vão", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-30" } });
    send();
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Data").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("escolha o desfecho")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-12" } });
    noHousehold("1");
    fireEvent.click(screen.getByLabelText("Imóvel sem pessoa"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.change(screen.getByLabelText("Pressão sistólica"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Temperatura (°C)"), { target: { value: "36,55" } });
    send();
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Pressão sistólica").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Pressão diastólica").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("temperatura (°C): até 1 casa decimal")).not.toBeNull();
  });

  it("visita de ontem entra em outra folha e a tela diz qual", async () => {
    mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day({ id: "d0", day: "2026-11-11", sequence: 2, visits: undefined }), replayed: false });
    await openForm();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-11" } });
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText("Visita registrada na folha de 11/11/2026 (complementar 2)")).not.toBeNull();
    await waitFor(() => expect(api.listHomeVisitDays).toHaveBeenCalledTimes(2));
  });

  it("nenhuma folha hoje: 'Nova visita' também está lá, e a folha nova aparece relida", async () => {
    mocked(api.listHomeVisitDays).mockResolvedValueOnce({ items: [], next_before: null });
    mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day({ visits: undefined }), replayed: false });
    mount();
    expect(await screen.findByText("nenhuma folha hoje — a primeira visita abre a folha")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova visita" }));
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText("Visita registrada na folha de 12/11/2026")).not.toBeNull();
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
  });

  it("atalho do Quem visitar: domicílio e pessoa já escolhidos", async () => {
    renderWithProviders(<HomeVisitDay now={NOW24B} start={{ teamId: "t1", microAreaId: "ma1", householdId: "h1", familyId: "f1", patientId: "pa1", displayName: "Maria Lima" }} />);
    // Antes dos moradores, a pessoa do atalho já aparece escolhida; depois, é o morador marcado.
    expect(((await screen.findByLabelText("Maria Lima")) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(screen.getByRole("group", { name: "Onde" }).textContent).toContain("Rua das Flores, 120"));
    expect((screen.getByLabelText("Maria Lima") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("José Lima")).not.toBeNull();
    expect(api.getVisitHousehold).toHaveBeenCalledWith("h1");
    expect(api.listVisitHouseholds).not.toHaveBeenCalled();
  });

  it("observação: aviso congelado e recusa acima de 500 code points (depois do trim)", async () => {
    mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    const note = screen.getByLabelText("Observação (interna)");
    expectFrozenNotice(note);
    expect(screen.getByText(/não vai ao e-SUS nem ao cidadão/)).not.toBeNull();
    fireEvent.change(note, { target: { value: "😀".repeat(501) } });
    send();
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: `  ${"😀".repeat(500)}  ` } });
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body().note).toBe("😀".repeat(500));
  });

  it("429: frase, campos livres e o mesmo uuid no reenvio (nada foi gravado)", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(429, { error: "too_many_requests" }, "x"))
      .mockResolvedValueOnce({ visit: visit(), day: day(), replayed: false });
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.too_many_requests)).not.toBeNull();
    expect((screen.getByLabelText("Tipo de imóvel") as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
    const [ a, b ] = uuids();
    expect(b).toBe(a);
  });

  it("409 client_uuid_conflict: frase e uuid novo", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(409, { error: "client_uuid_conflict", path: "client_uuid" }, "x"))
      .mockResolvedValueOnce({ visit: visit(), day: day(), replayed: false });
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText(HOME_VISIT_ERRORS.client_uuid_conflict)).not.toBeNull();
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
    const [ a, b ] = uuids();
    expect(b).not.toBe(a);
  });

  it("403 feature_disabled mostra a frase do interruptor", async () => {
    mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(403, { error: "feature_disabled", feature: "home_visits" }, "x"));
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
  });

  describe("pessoa digitada recusada pelo api", () => {
    const typePerson = async () => {
      mocked(api.lookupVisitPerson).mockResolvedValue(null);
      await openForm();
      noHousehold("1");
      fireEvent.click(screen.getByRole("button", { name: "Buscar pessoa" }));
      fireEvent.change(screen.getByLabelText("CPF ou CNS"), { target: { value: "52998224725" } });
      fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
      fireEvent.change(await screen.findByLabelText("Nome completo"), { target: { value: "Ana Prado" } });
      fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-04-02" } });
      fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "female" } });
      fireEvent.click(screen.getByRole("button", { name: "Usar esta pessoa" }));
      fireEvent.click(screen.getByLabelText("Ausente"));
    };

    it("new_patient.cpf (cpf_taken) cai no CPF do registro rápido, com 'Buscar pelo documento'", async () => {
      mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(409, { error: "cpf_taken", path: "new_patient.cpf" }, "x"));
      await typePerson();
      send();
      expect(await screen.findByText(HOME_VISIT_ERRORS.cpf_taken)).not.toBeNull();
      expect(screen.getByLabelText("CPF").getAttribute("aria-invalid")).toBe("true");
      expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("Ana Prado");
      expect((screen.getByLabelText("Sexo") as HTMLSelectElement).value).toBe("female");
      fireEvent.click(screen.getByRole("button", { name: "Buscar pelo documento" }));
      expect(screen.getByLabelText("CPF ou CNS")).not.toBeNull();
    });

    it("Q71: cpf_or_reason_required marca o motivo de não ter CPF", async () => {
      mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(422, { error: "cpf_or_reason_required", path: "new_patient.no_cpf_reason" }, "x"));
      await typePerson();
      send();
      expect(await screen.findByText(HOME_VISIT_ERRORS.cpf_or_reason_required)).not.toBeNull();
      expect(screen.getByLabelText("Motivo de não ter CPF").getAttribute("aria-invalid")).toBe("true");
    });

    it("409 duplicate_suspected reabre a busca com os candidatos do 409, sem nova busca; escolher manda patient_id", async () => {
      mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(409, { error: "duplicate_suspected", path: "new_patient", candidates: [ candidate() ] }, "x"))
        .mockResolvedValueOnce({ visit: visit(), day: day(), replayed: false });
      await typePerson();
      send();
      expect(await screen.findByText(DUPLICATE_SUSPECTED_TEXT)).not.toBeNull();
      expect(api.findVisitDuplicates).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Escolher Ana Prado" }));
      send();
      await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
      expect(body(1)).toMatchObject({ subject: "resident", patient_id: "pa8" });
      expect(body(1)).not.toHaveProperty("new_patient");
    });
  });

  it("morador provisório da urgência (Q41) não é escolhível", async () => {
    mocked(api.getVisitHousehold).mockResolvedValue(householdDetail({ residents: [
      { patient_id: "pa5", display_name: "Paciente sem identificação", sex: null, family_id: null, unidentified: true } ] }));
    await openForm();
    await pickHousehold();
    expect((await screen.findByLabelText("Paciente sem identificação") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(HOME_VISIT_ERRORS.patient_unidentified)).not.toBeNull();
  });

  it("Carregar mais domicílios pelo cursor", async () => {
    mocked(api.listVisitHouseholds).mockResolvedValueOnce({ items: [ household() ], next_before: "c1" })
      .mockResolvedValueOnce({ items: [ household({ id: "h2", address_short: "Rua B, 5" }) ], next_before: null });
    await openForm();
    fireEvent.click(screen.getByLabelText("Domicílio cadastrado"));
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("button", { name: "Rua B, 5" })).not.toBeNull();
    expect(mocked(api.listVisitHouseholds).mock.calls[1]).toEqual([ "ma1", "c1" ]);
  });

  it("TACS sem microárea atribuída: a frase no lugar do seletor", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ tacsTeam({ micro_areas: [] }) ] }));
    await openForm();
    expect(screen.getByText("nenhuma microárea atribuída a você nesta equipe — o enfermeiro da equipe atribui")).not.toBeNull();
    expect(screen.queryByLabelText("Microárea")).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar visita" })).toBeNull();
  });
});

describe("Folha do dia: revisão da Task 6", () => {
  it("folha aberta sem visita mostra o texto de vazia", async () => {
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [ day({ visits: undefined, visits_count: 0 }) ], next_before: null });
    mount();
    expect(await screen.findByText("nenhuma visita nesta folha ainda")).not.toBeNull();
    expect(api.getHomeVisitDay).not.toHaveBeenCalled();
  });

  it("uma gravação por vez: fechando o dia, Nova visita e Retirar ficam bloqueados", async () => {
    mocked(api.closeHomeVisitDay).mockReturnValue(new Promise(() => {}));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Fechar o dia" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(disabledAttr(screen.getByRole("button", { name: /^Nova visita/ }))).toBe(true));
    expect(disabledAttr(screen.getByRole("button", { name: /^Retirar visita das 09:15/ }))).toBe(true);
  });

  it("uma gravação por vez: registrando, Fechar o dia e Retirar ficam bloqueados", async () => {
    mocked(api.recordHomeVisit).mockReturnValue(new Promise(() => {}));
    await openForm();
    noHousehold("3");
    fireEvent.click(screen.getByLabelText("Ausente"));
    send();
    await waitFor(() => expect(disabledAttr(screen.getByRole("button", { name: /^Fechar o dia/ }))).toBe(true));
    expect(screen.getByText(WRITE_RUNNING)).not.toBeNull();
    expect(disabledAttr(screen.getByRole("button", { name: /^Retirar visita das 09:15/ }))).toBe(true);
  });

  it("uma gravação por vez: retirando, Nova visita e Fechar o dia ficam bloqueados", async () => {
    mocked(api.withdrawHomeVisit).mockReturnValue(new Promise(() => {}));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retirar visita das 09:15" }));
    fireEvent.change(screen.getByLabelText("Motivo da retirada"), { target: { value: "Registrei na casa errada." } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    await waitFor(() => expect(disabledAttr(screen.getByRole("button", { name: /^Nova visita/ }))).toBe(true));
    expect(disabledAttr(screen.getByRole("button", { name: /^Fechar o dia/ }))).toBe(true);
  });
});
