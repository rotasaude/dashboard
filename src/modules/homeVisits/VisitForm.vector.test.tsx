// src/modules/homeVisits/VisitForm.vector.test.tsx
// Boletim do agente de endemias dentro da nova visita (módulo 35a, Task 5; F-35.2, F-35.3, F-35.8): desfecho da situação,
// motivos 34–37 derivados (nunca enviados), poda ao trocar a situação, etiquetas provisórias × definitivas, recusas do api
// no campo do boletim, quarteirão pelo perfil, e o boletim só para o agente com o gate e com domicílio do cadastro.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getVisitHousehold: vi.fn(), getHouseholdVectorProfile: vi.fn(), listCityBlocks: vi.fn(),
    recordHomeVisit: vi.fn(), listVisitHouseholds: vi.fn(), getHomeVisitContext: vi.fn(), listHomeVisitDays: vi.fn(), getHomeVisitDay: vi.fn(),
    getVectorDomains: vi.fn(), listDue: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError, type HomeVisitDomains, type HomeVisitInput, type HomeVisitTeam, type VectorControlDomains } from "../../lib/api";
import { FAMILY_NOTICE, FAMILY_REASON_TEXT, REASONS_MAX_TEXT, VISIT_SAVED } from "../../lib/homeVisits";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import type { VectorStart } from "../../lib/vectorInspection";
import { renderWithProviders } from "../../test/campaignFixtures";
import { VISIT_DOMAINS, acsTeam, day, householdDetail, visit } from "../../test/homeVisitFixtures";
import {
  NOW35, VC_DOMAINS, agentTeam, cityBlock, householdProfile, householdVector, inspection, vcContext, vcUser
} from "../../test/vectorControlFixtures";
import { HomeVisitDay } from "../HomeVisitDay";
import { VC_PROFILE_KEY } from "../../lib/vectorControl";
import { BULLETIN_NEEDS_HOUSEHOLD, tubeLabelsText } from "./InspectionSection";
import { VisitForm } from "./VisitForm";
import type { VisitStart } from "./useVisitHandoff";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getVisitHousehold, api.getHouseholdVectorProfile, api.listCityBlocks, api.recordHomeVisit,
  api.listVisitHouseholds, api.getHomeVisitContext, api.listHomeVisitDays, api.getHomeVisitDay, api.getVectorDomains, api.listDue ];
const SAMPLE = inspection().samples[0];

afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser());
  mocked(api.getVisitHousehold).mockResolvedValue(householdDetail());
  mocked(api.getHouseholdVectorProfile).mockResolvedValue(householdProfile());
  mocked(api.listCityBlocks).mockResolvedValue([ cityBlock() ]);
  mocked(api.listVisitHouseholds).mockResolvedValue({ items: [], next_before: null });
});

const body = (n = 0) => mocked(api.recordHomeVisit).mock.calls[n][0] as HomeVisitInput;
const send = () => fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
const START: VisitStart = { teamId: "t1", microAreaId: "ma1", householdId: "h1", familyId: "f1", patientId: null, displayName: null };

type Mount = {
  domains?: HomeVisitDomains; team?: HomeVisitTeam; vectorDomains?: VectorControlDomains | null; start?: Partial<VisitStart> | null;
  vector?: VectorStart; onGoToTerritory?(): void; onSaved?(): void;
};
function mountForm(o: Mount = {}) {
  const start = o.start === null ? null : { ...START, ...o.start, ...(o.vector ? { vector: o.vector } : {}) };
  return renderWithProviders(
    <VisitForm team={o.team ?? agentTeam()} context={vcContext(o.domains ? { domains: o.domains } : {})} start={start}
      vectorDomains={o.vectorDomains === undefined ? VC_DOMAINS : o.vectorDomains} now={NOW35} onSaved={o.onSaved ?? vi.fn()} onClose={vi.fn()}
      onGoToTerritory={o.onGoToTerritory} />
  );
}
// O domicílio do atalho (h1, família f1) com os moradores e o perfil vetorial já lidos.
async function mountWithHousehold(o: Mount = {}) {
  const r = mountForm(o);
  await screen.findByLabelText("Família — responsável José Lima");
  await waitFor(() => expect(api.getHouseholdVectorProfile).toHaveBeenCalledWith("h1"));
  await waitFor(() => expect(screen.queryByText("Carregando o perfil do imóvel…")).toBeNull());
  return r;
}
const groupCard = (g: string) => within(screen.getByRole("group", { name: new RegExp(`^${g} —`) }));
function fillCompleteInspection() {
  fireEvent.change(screen.getByLabelText("Atividade"), { target: { value: "li_t" } });
  fireEvent.click(screen.getByLabelText("Trabalhado"));
  fireEvent.change(screen.getByLabelText("Grupo do depósito"), { target: { value: "A2" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar grupo" }));
  const g = groupCard("A2");
  for (const [ label, v ] of [ [ "Existentes", "3" ], [ "Com água", "2" ], [ "Com larva", "1" ], [ "Eliminados", "1" ], [ "Tratados", "1" ] ]) {
    fireEvent.change(g.getByLabelText(label), { target: { value: v } });
  }
  fireEvent.change(screen.getByLabelText("Método da medida"), { target: { value: "focal" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar medida" }));
  const m = within(screen.getByRole("group", { name: "Medida 1" }));
  fireEvent.change(m.getByLabelText("Produto"), { target: { value: "pr1" } });
  fireEvent.change(m.getByLabelText("Cargas"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Grupo da amostra"), { target: { value: "A2" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar amostra" }));
  fireEvent.change(within(screen.getByRole("group", { name: "Amostra 1" })).getByLabelText("Larvas coletadas"), { target: { value: "8" } });
  fireEvent.click(screen.getByLabelText("Ação educativa"));
}
const options = (label: string) => [ ...(screen.getByLabelText(label) as HTMLSelectElement).options ].map((x) => x.value).filter(Boolean);

describe("Boletim na nova visita", () => {
  it("boletim completo: corpo com vector_inspection, desfecho da situação, sem 34–37 nos motivos", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit({ vector_inspection: inspection() }), day: day(), replayed: false });
    await mountWithHousehold();
    fillCompleteInspection(); // atividade LI+T, trabalhado, A2 3/2/1/1/1, focal Pyriproxyfen 2, amostra A2 8, ação educativa
    expect(screen.getByText("= 4,00 g")).not.toBeNull();
    expect(screen.getByText(/Desfecho: Visita realizada \(da situação do imóvel\)/)).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Desfecho" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.recordHomeVisit).mock.calls[0][0];
    expect(sent.outcome).toBe(1);
    expect(sent.reasons.some((r) => [ 34, 35, 36, 37 ].includes(r))).toBe(false);
    expect(sent.vector_inspection).toMatchObject({ activity: "li_t", situation: "worked", deposits: [ { group: "A2", with_larvae: 1 } ], samples: [ { number: 1, deposit_group: "A2" } ] });
    expect(sent.vector_inspection).toMatchObject({ educational_action: true, measures: [ { method: "focal", vector_product_id: "pr1", charges: 2 } ] });
    for (const k of [ "city_block_id", "entered_at", "left_at", "risk_class", "liraa_draw_item_id", "transmission_block_id" ]) {
      expect(sent.vector_inspection).not.toHaveProperty(k);
    }
    expect(sent).toMatchObject({ team_id: "t1", household_id: "h1", subject: "family_responsible", family_id: "f1" });
  });

  it("com boletim: 34–37 fora da lista, prévia dos derivados, limite com os derivados e aviso de família", async () => {
    await mountWithHousehold({ domains: { ...VISIT_DOMAINS, reasons_max: 3 } });
    fireEvent.click(screen.getByLabelText("Maria Lima"));
    expect(screen.queryByLabelText("Imóvel com foco")).toBeNull();
    fillCompleteInspection();
    expect(screen.queryByLabelText("Imóvel com foco")).toBeNull();
    expect(screen.queryByLabelText("Tratamento focal")).toBeNull();
    expect(screen.getByText(/O boletim acrescenta: 34 .*35 .*36 .*37/)).not.toBeNull();
    // Q43: a moradora com os motivos derivados vira visita da família.
    expect(screen.getByText(FAMILY_NOTICE)).not.toBeNull();
    // Os 4 derivados já passam do teto 3: as caixas param antes do envio (a linha do teto), e o envio recusa também.
    expect(screen.getAllByText(REASONS_MAX_TEXT(3))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
    await waitFor(() => expect(screen.getAllByText(REASONS_MAX_TEXT(3))).toHaveLength(2));
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
  });

  it("com boletim: as caixas param no teto contando os derivados (34–37 ocupam 4 dos 5)", async () => {
    await mountWithHousehold({ domains: { ...VISIT_DOMAINS, reasons_max: 5 } });
    fireEvent.click(screen.getByLabelText("Maria Lima"));
    fillCompleteInspection();
    expect(screen.getByText(/O boletim acrescenta: 34 .*35 .*36 .*37/)).not.toBeNull();
    expect(screen.queryByText(REASONS_MAX_TEXT(5))).toBeNull();
    const boxes = () => within(screen.getByRole("group", { name: "Motivos da visita" })).getAllByRole("checkbox") as HTMLInputElement[];
    const enabled = boxes().filter((b) => !b.disabled && !b.checked);
    expect(enabled.length).toBeGreaterThan(1);
    fireEvent.click(enabled[0]);
    expect(await screen.findByText(REASONS_MAX_TEXT(5))).not.toBeNull();
    for (const b of boxes().filter((x) => !x.checked)) expect(b.disabled).toBe(true);
  });

  it("fechado depois de trabalhado: poda e diz o quê; desfecho vira ausente", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    await mountWithHousehold(); fillCompleteInspection();
    fireEvent.click(screen.getByLabelText("Fechado"));
    expect(screen.getByRole("status").textContent).toMatch(/depósitos, medidas, amostras, ação educativa/);
    expect(screen.getByText(/Desfecho: Ausente/)).not.toBeNull();
    expect(screen.queryByRole("group", { name: /^A2 —/ })).toBeNull();
    expect((screen.queryByLabelText("Ação educativa") as HTMLInputElement | null)?.checked ?? false).toBe(false);
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body().outcome).toBe(3);
    expect(body().vector_inspection).toMatchObject({ situation: "closed", deposits: [], measures: [], samples: [], educational_action: false });
  });

  it("duplo clique com boletim: um envio só", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    await mountWithHousehold(); fillCompleteInspection();
    send(); send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.recordHomeVisit).toHaveBeenCalledTimes(1);
  });

  it("entrada, saída e risco preenchidos: o instante com o deslocamento da cidade e a classe", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    await mountWithHousehold(); fillCompleteInspection();
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "09:40" } });
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "10:20" } });
    fireEvent.click(screen.getByLabelText("Vermelho (alto)"));
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body().vector_inspection).toMatchObject({ entered_at: "2026-11-16T09:40:00-03:00", left_at: "2026-11-16T10:20:00-03:00", risk_class: "red" });
  });

  it("'Com larva' em branco no envio: recusa no campo, a amostra fica e nada é enviado", async () => {
    await mountWithHousehold(); fillCompleteInspection();
    fireEvent.change(groupCard("A2").getByLabelText("Com larva"), { target: { value: "" } });
    send();
    expect(await groupCard("A2").findByText(VECTOR_ERRORS.vector_inspection_invalid)).not.toBeNull();
    expect(groupCard("A2").getByLabelText("Com larva").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("group", { name: "Amostra 1" })).not.toBeNull();
    expect((within(screen.getByRole("group", { name: "Amostra 1" })).getByLabelText("Larvas coletadas") as HTMLInputElement).value).toBe("8");
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
  });

  it("derivado já escolhido antes de ligar o boletim: sem 'motivo repetido', só a recusa do derivado (M1)", async () => {
    await mountWithHousehold();
    fireEvent.click(screen.getByLabelText("Registrar boletim"));
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    fireEvent.click(screen.getByLabelText("Imóvel com foco"));
    fireEvent.click(screen.getByLabelText("Registrar boletim"));
    fillCompleteInspection();
    // O 35 escolhido continua visível para ser desmarcado.
    expect(screen.getByLabelText("Imóvel com foco")).not.toBeNull();
    send();
    expect(await screen.findByText(VECTOR_ERRORS.reason_derived)).not.toBeNull();
    expect(screen.queryByText("motivo repetido")).toBeNull();
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
  });

  it("etiqueta: prévia provisória; 4xx troca; a definitiva vem da visita gravada", async () => {
    const onSaved = vi.fn();
    await mountWithHousehold({ onSaved }); fillCompleteInspection();
    const first = screen.getByText(/-01 \(provisória até gravar\)/).textContent;
    vi.mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(422, { error: "product_not_allowed", path: "vector_inspection.measures[0].vector_product_id" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
    expect(await screen.findByText(VECTOR_ERRORS.product_not_allowed)).not.toBeNull();
    expect(within(screen.getByRole("group", { name: "Medida 1" })).getByLabelText("Produto").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/-01 \(provisória até gravar\)/).textContent).not.toBe(first);
    vi.mocked(api.recordHomeVisit).mockResolvedValueOnce({ visit: visit({ vector_inspection: inspection({ samples: [ { ...SAMPLE, label: "ABCDEF12-01" } ] }) }), day: day(), replayed: false });
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(tubeLabelsText(onSaved.mock.calls[0][0].visit)).toBe("Etiquete os tubitos: ABCDEF12-01");
    expect(screen.queryByText(/ABCDEF12-01 \(provisória/)).toBeNull();
  });

  it("sample_label_taken: frase na amostra e etiquetas novas na prévia (Q7(1))", async () => {
    await mountWithHousehold(); fillCompleteInspection();
    const first = screen.getByText(/-01 \(provisória até gravar\)/).textContent;
    vi.mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(422, { error: "sample_label_taken", path: "vector_inspection.samples[0]" }, "x"));
    send();
    const card = within(screen.getByRole("group", { name: "Amostra 1" }));
    expect(await card.findByText(VECTOR_ERRORS.sample_label_taken)).not.toBeNull();
    expect(card.getByText(/-01 \(provisória até gravar\)/).textContent).not.toBe(first);
    // A etiqueta nova nasce do client_uuid novo do próximo envio.
    vi.mocked(api.recordHomeVisit).mockResolvedValueOnce({ visit: visit(), day: day(), replayed: false });
    const shown = card.getByText(/-01 \(provisória até gravar\)/).textContent!.slice(0, 8);
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(2));
    expect(body(1).client_uuid.slice(0, 8).toUpperCase()).toBe(shown);
    expect(body(1).client_uuid).not.toBe(body(0).client_uuid);
  });

  it("imóvel sem cadastro: sem boletim, com a frase do domicílio (Q10) e o atalho para cadastrar o não residencial (Q13(1))", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    const onGoToTerritory = vi.fn();
    mountForm({ start: null, onGoToTerritory });
    fireEvent.click(screen.getByLabelText("Imóvel sem cadastro"));
    expect(screen.getByText(BULLETIN_NEEDS_HOUSEHOLD)).not.toBeNull();
    expect(screen.queryByLabelText("Atividade")).toBeNull();
    expect(screen.queryByRole("region", { name: "Boletim do agente de endemias" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tipo de imóvel"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body()).not.toHaveProperty("vector_inspection");
    expect(body()).toMatchObject({ property_type: "4", micro_area_id: "ma1", outcome: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar o imóvel no território" }));
    expect(onGoToTerritory).toHaveBeenCalledTimes(1);
  });

  it("recusa do api no campo do boletim (path vector_inspection.deposits[0].treated)", async () => {
    await mountWithHousehold(); fillCompleteInspection();
    vi.mocked(api.recordHomeVisit).mockRejectedValueOnce(new ApiError(422, { error: "deposit_counts_inconsistent", path: "vector_inspection.deposits[0].treated" }, "x"));
    send();
    expect(await groupCard("A2").findByText(VECTOR_ERRORS.deposit_counts_inconsistent)).not.toBeNull();
    expect(groupCard("A2").getByLabelText("Tratados").getAttribute("aria-invalid")).toBe("true");
    expect(groupCard("A2").getByLabelText("Existentes").getAttribute("aria-invalid")).toBeNull();
  });

  it("recusa local: contagem incoerente no grupo e nada é enviado", async () => {
    await mountWithHousehold(); fillCompleteInspection();
    fireEvent.change(groupCard("A2").getByLabelText("Tratados"), { target: { value: "5" } });
    send();
    expect(await groupCard("A2").findByText(VECTOR_ERRORS.deposit_counts_inconsistent)).not.toBeNull();
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
  });

  it("motivo derivado que a regra do 24b recusa: a frase em 'Quem foi visitado', não num motivo escondido (Q10)", async () => {
    await mountWithHousehold();
    fireEvent.click(screen.getByLabelText("Imóvel sem pessoa"));
    fillCompleteInspection();
    send();
    const who = within(screen.getByRole("group", { name: "Quem foi visitado" }));
    expect(await who.findByText(FAMILY_REASON_TEXT)).not.toBeNull();
    expect(api.recordHomeVisit).not.toHaveBeenCalled();
  });

  it("quarteirão só quando o perfil não tem; sem bairro, a frase e nenhum seletor", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    mocked(api.listCityBlocks).mockResolvedValue([ cityBlock(), cityBlock({ id: "cb9", number: "99", active: false }) ]);
    mocked(api.getHouseholdVectorProfile).mockResolvedValue(householdProfile({ vector: householdVector({ city_block_id: null }) }));
    await mountWithHousehold();
    const select = await screen.findByLabelText("Quarteirão");
    await waitFor(() => expect(options("Quarteirão")).toEqual([ "cb1" ]));
    expect(api.listCityBlocks).toHaveBeenCalledWith("nb1");
    fireEvent.change(select, { target: { value: "cb1" } });
    fillCompleteInspection();
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body().vector_inspection).toMatchObject({ city_block_id: "cb1" });
    cleanup();

    mocked(api.getHouseholdVectorProfile).mockResolvedValue(householdProfile({ neighborhood_id: null, vector: null }));
    mocked(api.listCityBlocks).mockClear();
    await mountWithHousehold();
    expect(screen.getByText(VECTOR_ERRORS.household_without_neighborhood)).not.toBeNull();
    expect(screen.queryByLabelText("Quarteirão")).toBeNull();
    expect(api.listCityBlocks).not.toHaveBeenCalled();
  });

  it("quarteirão do perfil: nenhum seletor nem leitura dos quarteirões", async () => {
    await mountWithHousehold();
    expect(screen.queryByLabelText("Quarteirão")).toBeNull();
    expect(api.listCityBlocks).not.toHaveBeenCalled();
  });

  it("ACS (515105), gate desligado ou 'Registrar boletim' desmarcado: sem seção, nada de vector_inspection no corpo", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    for (const o of [ { team: acsTeam() }, { vectorDomains: null } ] as Mount[]) {
      mountForm(o);
      await screen.findByLabelText("Família — responsável José Lima");
      expect(screen.queryByLabelText("Registrar boletim")).toBeNull();
      expect(screen.queryByLabelText("Atividade")).toBeNull();
      expect(screen.getByRole("group", { name: "Desfecho" })).not.toBeNull();
      // Sem boletim, o 24b não muda: 34–37 continuam oferecidos.
      fireEvent.click(screen.getByLabelText("Visita realizada"));
      expect(screen.getByLabelText("Imóvel com foco")).not.toBeNull();
      cleanup();
    }
    expect(api.getHouseholdVectorProfile).not.toHaveBeenCalled();

    await mountWithHousehold();
    const box = screen.getByLabelText("Registrar boletim") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(screen.queryByLabelText("Atividade")).toBeNull();
    fireEvent.click(screen.getByLabelText("Visita realizada"));
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body()).not.toHaveProperty("vector_inspection");
    expect(body().outcome).toBe(1);
  });

  it("LIRAa e bloqueio só com o vínculo do start; PE só em ponto estratégico", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit(), day: day(), replayed: false });
    await mountWithHousehold({ vector: { activity: "liraa", liraaDrawItemId: "li1" } });
    expect((screen.getByLabelText("Atividade") as HTMLSelectElement).value).toBe("liraa");
    expect(options("Atividade")).toEqual([ "li", "li_t", "liraa" ]);
    fireEvent.click(screen.getByLabelText("Trabalhado"));
    send();
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body().vector_inspection).toMatchObject({ activity: "liraa", liraa_draw_item_id: "li1" });
    expect(body().vector_inspection).not.toHaveProperty("transmission_block_id");
    cleanup();

    await mountWithHousehold();
    expect(options("Atividade")).toEqual([ "li", "li_t" ]);
    cleanup();

    await mountWithHousehold({ vector: { activity: "transmission_block", transmissionBlockId: "tb1" } });
    expect(options("Atividade")).toEqual([ "li", "li_t", "transmission_block" ]);
    cleanup();

    mocked(api.getVisitHousehold).mockResolvedValue(householdDetail({ property_type: "4", families: [], has_active_family: false, residents: [] }));
    renderWithProviders(
      <VisitForm team={agentTeam()} context={vcContext()} start={{ ...START, familyId: null }} vectorDomains={VC_DOMAINS} now={NOW35} onSaved={vi.fn()} onClose={vi.fn()} />
    );
    await waitFor(() => expect(options("Atividade")).toEqual([ "li", "li_t", "pe" ]));
  });
});

describe("Folha do dia com o boletim", () => {
  beforeEach(() => {
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext());
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [], next_before: null });
    mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
    mocked(api.listDue).mockResolvedValue({ items: [], next_before: null });
  });

  it("agente com o gate: lê os domínios uma vez e o formulário traz o boletim; o atalho de cadastro vai ao território", async () => {
    const onGoToTerritory = vi.fn();
    renderWithProviders(<HomeVisitDay now={NOW35} onGoToTerritory={onGoToTerritory} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova visita" }));
    expect(await screen.findByLabelText("Registrar boletim")).not.toBeNull();
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Imóvel sem cadastro"));
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar o imóvel no território" }));
    expect(onGoToTerritory).toHaveBeenCalledTimes(1);
  });

  it("depois do 201 com amostras: a frase de gravada e as etiquetas da visita gravada", async () => {
    vi.mocked(api.recordHomeVisit).mockResolvedValue({
      visit: visit({ vector_inspection: inspection({ samples: [ { ...SAMPLE, label: "3F2A9C1E-01" }, { ...SAMPLE, id: "vs2", number: 2, label: "3F2A9C1E-02" } ] }) }),
      day: day({ visits: undefined }), replayed: false });
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [ day({ visits: undefined }) ], next_before: null });
    mocked(api.getHomeVisitDay).mockResolvedValue(day());
    const { client } = renderWithProviders(<HomeVisitDay now={NOW35} start={START} />);
    await screen.findByLabelText("Família — responsável José Lima");
    await waitFor(() => expect(screen.queryByText("Carregando o perfil do imóvel…")).toBeNull());
    fillCompleteInspection();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    send();
    expect(await screen.findByText("Etiquete os tubitos: 3F2A9C1E-01, 3F2A9C1E-02")).not.toBeNull();
    expect(screen.getByText(VISIT_SAVED)).not.toBeNull();
    // O boletim mudou o perfil do imóvel: a próxima visita relê (M3).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ VC_PROFILE_KEY, "h1" ] });
  });

  it("ACS ou gate desligado: os domínios do 35a não são lidos", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext({ teams: [ acsTeam() ] }));
    renderWithProviders(<HomeVisitDay now={NOW35} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova visita" }));
    expect(screen.queryByLabelText("Registrar boletim")).toBeNull();
    cleanup();
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext());
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "health_professional" ], [ "clinical_record", "territory_registry", "home_visits" ]));
    renderWithProviders(<HomeVisitDay now={NOW35} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova visita" }));
    expect(screen.queryByLabelText("Registrar boletim")).toBeNull();
    expect(api.getVectorDomains).not.toHaveBeenCalled();
  });
});
