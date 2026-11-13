import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, adminRevokeFieldDevice, closeHomeVisitDay, countHomeVisits, countWhoToVisit, createFieldAssignment, endFieldAssignment,
  findVisitDuplicates, getCollectiveActivity, getCollectiveOptions, getHomeVisit, getHomeVisitContext, getHomeVisitDay, getVisitHousehold,
  listAdminFieldDevices, listCollectiveActivities, listFieldAssignments, listFieldDevices, listHomeVisitDays, listHomeVisits,
  listVisitHouseholds, listWhoToVisit, lookupVisitPerson, markCollectiveMistaken, recordCollectiveActivity, recordHomeVisit,
  registerFieldDevice, revokeFieldDevice, withdrawHomeVisit
} from "./api";
import {
  TODAY24B, activity, assignment, candidate, context, day, device, listActivity, options, visit, whoItem
} from "../test/homeVisitFixtures";
import { household as household24a, registration } from "../test/territoryFixtures";

const calls: { url: string; init: RequestInit }[] = [];
function stub(body: unknown, status = 200, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }));
}
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
const last = () => calls[calls.length - 1];
const bodyOf = () => JSON.parse(String(last().init.body));

// O que nunca pode ir na URL: nome, CPF, CNS, nascimento, motivo, medida, observação, motivo da retirada e o token.
const SECRET_IN_URL = /52998224725|529\.982|898000|Maria|Ana|1990-04|pressão|losartana|rsf_|retirad|engano/i;

describe("cliente da visita domiciliar e da atividade coletiva (módulo 24b)", () => {
  it("folha e visitas: só ids, datas, filtros com [] e cursor na URL", async () => {
    stub({ items: [ day() ], next_before: "c2" });
    const p = await listHomeVisitDays({ team_id: "t1", from: "2026-11-01", to: TODAY24B, state: [ "open", "closed" ], before: "c1" });
    expect(last().url).toBe("/home_visits/days?team_id=t1&from=2026-11-01&to=2026-11-12&state%5B%5D=open&state%5B%5D=closed&before=c1");
    expect(p.next_before).toBe("c2");
    stub({ items: [], next_before: null });
    await listHomeVisits({ team_id: "t1", micro_area_id: "ma1", outcome: [ 2, 3 ] });
    expect(last().url).toBe("/home_visits?team_id=t1&micro_area_id=ma1&outcome%5B%5D=2&outcome%5B%5D=3");
    stub({ done: 3, refused: 1, absent: 0, withdrawn: 1 });
    await countHomeVisits({ team_id: "t1", micro_area_id: "ma1" });
    expect(last().url).toBe("/home_visits/count?team_id=t1&micro_area_id=ma1");
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("limite opcional (1–100) e profissional entram na URL na ordem do contrato; vazio e nulo nunca", async () => {
    stub({ items: [], next_before: null });
    await listHomeVisitDays({ team_id: "t1", professional_id: "p-acs", state: [], before: null, limit: 50 });
    expect(last().url).toBe("/home_visits/days?team_id=t1&professional_id=p-acs&limit=50");
    await listHomeVisits({ team_id: "t1", professional_id: "p-acs", from: "2026-11-01", to: TODAY24B, limit: 20 });
    expect(last().url).toBe("/home_visits?team_id=t1&professional_id=p-acs&from=2026-11-01&to=2026-11-12&limit=20");
    await listCollectiveActivities({ team_id: "t1", from: "2026-11-01", to: TODAY24B, limit: 10 });
    expect(last().url).toBe("/collective_activities?team_id=t1&from=2026-11-01&to=2026-11-12&limit=10");
  });

  it("listas ausentes viram vazio e o cursor ausente vira null", async () => {
    stub({});
    expect(await listHomeVisitDays({ team_id: "t1" })).toEqual({ items: [], next_before: null });
    expect(await listHomeVisits({ team_id: "t1" })).toEqual({ items: [], next_before: null });
    expect(await listCollectiveActivities({ team_id: "t1" })).toEqual({ items: [], next_before: null });
    expect(await listWhoToVisit({ micro_area_id: "ma1" })).toEqual({ items: [], next_before: null });
    expect(await listFieldAssignments("t1")).toEqual({ items: [], candidates: [] });
    expect(await listFieldDevices()).toEqual([]);
    expect(await listAdminFieldDevices()).toEqual([]);
  });

  it("leituras por id e contexto: GET sem corpo", async () => {
    stub(context());
    await getHomeVisitContext();
    expect(last().url).toBe("/home_visits/context");
    stub(day());
    await getHomeVisitDay("d1");
    expect(last().url).toBe("/home_visits/days/d1");
    stub(visit());
    await getHomeVisit("v1");
    expect(last().url).toBe("/home_visits/v1");
    stub(activity());
    await getCollectiveActivity("ca1");
    expect(last().url).toBe("/collective_activities/ca1");
    for (const c of calls) expect(c.init.method).toBeUndefined();
  });

  it("registrar: corpo inteiro no POST; 201 → replayed false; 200 → replayed true", async () => {
    stub({ visit: visit(), day: day() }, 201);
    const input = { client_uuid: "u-1", team_id: "t1", occurred_at: "2026-11-12T09:15:00-03:00", household_id: "h1", subject: "resident" as const,
      patient_id: "pa1", outcome: 1 as const, reasons: [ 29 ], shared: false, measurements: { systolic: 130, diastolic: 85 }, note: "Pediu retorno." };
    const out = await recordHomeVisit(input);
    expect(out.replayed).toBe(false);
    expect(out.visit.id).toBe("v1");
    expect(last()).toMatchObject({ url: "/home_visits", init: { method: "POST" } });
    expect(bodyOf()).toEqual(input);
    stub({ visit: visit(), day: day() }, 200);
    expect((await recordHomeVisit(input)).replayed).toBe(true);
  });

  it("fechar, retirar e engano levam expected_state no corpo", async () => {
    stub(day({ state: "closed" }));
    await closeHomeVisitDay("d1");
    expect(last().url).toBe("/home_visits/days/d1/close");
    expect(bodyOf()).toEqual({ expected_state: "open" });
    stub(visit({ state: "withdrawn" }));
    await withdrawHomeVisit("v1", "Registrei na casa errada.");
    expect(last().url).toBe("/home_visits/v1/withdraw");
    expect(bodyOf()).toEqual({ expected_state: "recorded", reason: "Registrei na casa errada." });
    stub(activity({ state: "mistaken" }));
    await markCollectiveMistaken("ca1", "Atividade lançada em duplicidade.");
    expect(last().url).toBe("/collective_activities/ca1/mark_mistaken");
    expect(bodyOf()).toEqual({ expected_state: "recorded", reason: "Atividade lançada em duplicidade." });
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("pessoa: busca e duplicados por POST, no escopo de quem chama; 404 person_not_found = ninguém", async () => {
    stub({ error: "person_not_found" }, 404);
    expect(await lookupVisitPerson("home_visits", { cpf: "52998224725" })).toBeNull();
    expect(last()).toMatchObject({ url: "/home_visits/people/lookup", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ cpf: "52998224725" });
    stub({ patient_id: "pa9", display_name: "Ana Prado", birth_date: "1990-04-02", has_cpf: true, cns_masked: null, sex: "female" });
    expect((await lookupVisitPerson("collective_activities", { cns: "898000000000000" }))?.patient_id).toBe("pa9");
    expect(last().url).toBe("/collective_activities/people/lookup");
    stub({ candidates: [ candidate() ] });
    expect(await findVisitDuplicates("collective_activities", { full_name: "Ana Prado", birth_date: "1990-04-02" })).toEqual([ candidate() ]);
    expect(last().url).toBe("/collective_activities/people/duplicates");
    expect(bodyOf()).toEqual({ full_name: "Ana Prado", birth_date: "1990-04-02" });
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("pessoa: 409 citizen_not_verified sobe como erro (Q8) e sem candidatos vira lista vazia", async () => {
    stub({ error: "citizen_not_verified" }, 409);
    const err = await lookupVisitPerson("home_visits", { cpf: "52998224725" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    stub({});
    expect(await findVisitDuplicates("home_visits", { full_name: "X", birth_date: "2000-01-01" })).toEqual([]);
  });

  it("quem visitar: microárea, motivos com [] e limite; contagem sem pessoa", async () => {
    stub({ items: [ whoItem() ], next_before: null });
    await listWhoToVisit({ micro_area_id: "ma1", reason: [ "care_line" ], limit: 50 });
    expect(last().url).toBe("/home_visits/who_to_visit?micro_area_id=ma1&reason%5B%5D=care_line&limit=50");
    stub({ care_line: 1, registration_due: 2, never_visited: 3, people: 5 });
    await countWhoToVisit("ma1");
    expect(last().url).toBe("/home_visits/who_to_visit/count?micro_area_id=ma1");
  });

  it("atribuição e aparelhos pelos caminhos do §6 e §9.1; o token volta só na resposta; revogar devolve o aparelho", async () => {
    stub({ items: [ assignment() ], candidates: [ { professional_id: "p-tacs", name: "Rui TACS", cbo: "322255" } ] });
    expect((await listFieldAssignments("t1")).candidates).toHaveLength(1);
    expect(last().url).toBe("/home_visits/assignments?team_id=t1");
    stub(assignment(), 201);
    expect((await createFieldAssignment({ micro_area_id: "ma2", professional_id: "p-tacs" })).id).toBe("as1");
    expect(last()).toMatchObject({ url: "/home_visits/assignments", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ micro_area_id: "ma2", professional_id: "p-tacs" });
    stub(assignment({ ended_at: "2026-11-12T09:00:00-03:00" }));
    expect((await endFieldAssignment("as1")).ended_at).toBe("2026-11-12T09:00:00-03:00");
    expect(last()).toMatchObject({ url: "/home_visits/assignments/as1/end", init: { method: "POST", body: "{}" } });
    stub({ device: device(), token: "rsf_abc", qr_payload: "rotasaude-field:v1:eyJ9" }, 201);
    const created = await registerFieldDevice("Celular da Joana");
    expect(created.token).toBe("rsf_abc");
    expect(last()).toMatchObject({ url: "/field_devices", init: { method: "POST" } });
    expect(bodyOf()).toEqual({ name: "Celular da Joana" });
    stub({ device: device({ status: "revoked", revoked_reason: "user" }) });
    expect(await revokeFieldDevice("fd1")).toEqual(device({ status: "revoked", revoked_reason: "user" }));
    expect(last()).toMatchObject({ url: "/field_devices/fd1/revoke", init: { method: "POST", body: "{}" } });
    stub({ items: [] });
    await listAdminFieldDevices("u-7");
    expect(last().url).toBe("/field_devices/admin?user_id=u-7");
    const adm = { ...device({ status: "revoked", revoked_reason: "admin" }), user: { id: "u-7", name: "Joana ACS" } };
    stub({ device: adm });
    expect(await adminRevokeFieldDevice("fd1")).toEqual(adm);
    expect(last()).toMatchObject({ url: "/field_devices/admin/fd1/revoke", init: { method: "POST", body: "{}" } });
    stub({ items: [ device() ] });
    expect(await listFieldDevices()).toEqual([ device() ]);
    expect(last().url).toBe("/field_devices");
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });

  it("domicílios da visita pelas rotas de leitura do 24a (Q11), sem rota nova", async () => {
    stub({ households: [ household24a() ], next_before: "c9" });
    const page = await listVisitHouseholds("ma2", "c1");
    expect(last().url).toMatch(/^\/territory\/households\?micro_area_id=ma2&before=c1/);
    expect(page.next_before).toBe("c9");
    expect(page.items[0]).toMatchObject({ id: "hh1", address_short: "Rua das Flores, 120", property_type: "1", status: "active", has_active_family: true,
      micro_area: { id: "ma1", code: "01" } });
    expect(page.items[0].families[0]).toEqual({ id: "fa1", responsible: { patient_id: "pa1", display_name: "Maria das Dores", sex: null },
      moved_out: false, responsible_exited: false });
  });

  it("detalhe do domicílio: moradores = cadastros ativos, com o sexo do paciente e o responsável vindo deles (Q35, Q41)", async () => {
    const resident = registration({ id: "rg2", patient: { ...registration().patient, id: "pa7", display_name: "Sem Nome", sex: "male", no_cpf_reason: "unidentified" },
      family_id: "fa1", is_responsible: false });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = url.startsWith("/territory/registrations") ? { registrations: [ registration(), resident ] } : household24a();
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const d = await getVisitHousehold("hh1");
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("/territory/households/hh1");
    expect(urls).toContain("/territory/registrations?household_id=hh1");
    expect(urls.some((u) => u.startsWith("/home_visits/households"))).toBe(false);
    expect(d.residents).toEqual([
      { patient_id: "pa1", display_name: "Maria das Dores", sex: "female", family_id: "fa1", unidentified: false },
      { patient_id: "pa7", display_name: "Sem Nome", sex: "male", family_id: "fa1", unidentified: true }
    ]);
    expect(d.families[0].responsible.sex).toBe("female");
    expect(d.has_active_family).toBe(true);
  });

  it("domicílio sem endereço e só com família que mudou: sem família ativa", async () => {
    stub({ households: [ household24a({ address: {}, families: [ { ...household24a().families[0], moved_out: true } ] }) ], next_before: null });
    const [ h ] = (await listVisitHouseholds("ma1")).items;
    expect(h.address_short).toBe("domicílio sem endereço");
    expect(h.has_active_family).toBe(false);
  });

  it("atividade: opções, lista com filtros e gravação idempotente (sem altered_count no corpo)", async () => {
    stub(options());
    expect((await getCollectiveOptions()).teams[0].professionals).toHaveLength(3);
    expect(last().url).toBe("/collective_activities/options");
    stub({ items: [ listActivity() ], next_before: null });
    await listCollectiveActivities({ team_id: "t1", activity_type: [ 5 ], state: [ "mistaken" ] });
    expect(last().url).toBe("/collective_activities?team_id=t1&activity_type%5B%5D=5&state%5B%5D=mistaken");
    const input = { client_uuid: "u-2", team_id: "t1", held_on: TODAY24B, shift: 1 as const, activity_type: 5, place_health_unit_id: "u1",
      participants_count: 12, meeting_topics: [], target_audience: [ 10 ], health_topics: [ 4 ], health_practices: [ 20 ],
      professionals: [ { professional_id: "p-acs" } ], participants: [ { patient_id: "pa1", altered_evaluation: true } ] };
    stub(activity(), 201);
    expect((await recordCollectiveActivity(input)).replayed).toBe(false);
    expect(last()).toMatchObject({ url: "/collective_activities", init: { method: "POST" } });
    expect(bodyOf()).toEqual(input);
    expect(bodyOf()).not.toHaveProperty("altered_count");
    stub(activity(), 200);
    const again = await recordCollectiveActivity(input);
    expect(again.replayed).toBe(true);
    expect(again.activity.id).toBe("ca1");
  });

  it("a lista de atividades não traz as chaves de detalhe (Q57a)", () => {
    const item = listActivity();
    for (const key of [ "meeting_topics", "target_audience", "health_topics", "health_practices", "procedure_code", "participants" ]) expect(item).not.toHaveProperty(key);
    expect(item.altered_count).toBe(1);
  });

  it("nada sensível na URL em nenhuma chamada", async () => {
    stub({ items: [], next_before: null });
    await listHomeVisits({ team_id: "t1", micro_area_id: "ma1", outcome: [ 1 ], before: "c1" });
    await listWhoToVisit({ micro_area_id: "ma1" });
    stub({ candidates: [] });
    await findVisitDuplicates("home_visits", { full_name: "Maria Lima", birth_date: "1990-04-02", mother_name: "Ana" });
    stub({ visit: visit(), day: day() }, 201);
    await recordHomeVisit({ client_uuid: "u", team_id: "t1", occurred_at: "2026-11-12T09:00:00-03:00", subject: "none", outcome: 1, reasons: [ 11 ],
      shared: false, note: "pressão alta, losartana" });
    stub(visit({ state: "withdrawn" }));
    await withdrawHomeVisit("v1", "retirada por engano");
    stub({ device: device(), token: "rsf_abc", qr_payload: "x" }, 201);
    await registerFieldDevice("Celular da Maria");
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) expect(c.url).not.toMatch(SECRET_IN_URL);
  });
});
