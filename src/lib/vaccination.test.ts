import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { itemKey, locationKindLabel } from "./pharmacy";
import {
  OVERRIDABLE, VACCINATION_DISABLED, cardItemStatusLabel, doseSavedText, maternalRequired, canUseVaccination, cardGroups, doseBody, doseProblems, effectiveStatus, locationAbilities, lotsForDose, monthProblem, newDoseDraft,
  newTranscriptionLine, outOfRange, parseCelsius, readingBody, readingProblems, reasonProblem, rndsStatusLabel, blockReasonLabel, splitRefusals,
  termName, transcriptionProblems, vaccinationRefusals, vialRemaining, vialsForDose
} from "./vaccination";
import {
  BCG, CATALOG29, COLD_CENTRAL, LEAD_ROOM, NOW29, PENTA, PENTA_ITEM, ROOM, TERMS, TODAY29, card, cardItem, vacLotBalance, vacPosition, vacUser, vial
} from "../test/vaccinationFixtures";
import { AMOXI } from "../test/pharmacyFixtures";

const refusal = (problems: { path: string; error: string; overridable?: boolean }[]) => new ApiError(422, { error: problems[0].error, problems }, "422");

describe("portão, papéis e rótulos", () => {
  it("interruptor e operador", () => {
    expect(canUseVaccination(vacUser())).toBe(true);
    expect(canUseVaccination(vacUser([ "health_professional" ], { features: [ "clinical_record" ] }))).toBe(false);
    expect(canUseVaccination(vacUser([], { operator: true }))).toBe(false);
  });
  it("papel por local", () => {
    expect(locationAbilities(ROOM)).toEqual({ vaccinate: true, lead: false, keeper: false });
    expect(locationAbilities(LEAD_ROOM)).toEqual({ vaccinate: true, lead: true, keeper: false });
    expect(locationAbilities(COLD_CENTRAL)).toEqual({ vaccinate: false, lead: false, keeper: true });
  });
  it("rótulos e código cru", () => {
    expect(locationKindLabel("vaccine_room")).toBe("Sala de vacina");
    expect(locationKindLabel("cold_chain_central")).toBe("Rede de frio municipal");
    expect(rndsStatusLabel("accepted")).toBe("enviada ao Ministério");
    expect(rndsStatusLabel("not_sent")).toBe("envio desligado — na fila");
    expect(rndsStatusLabel("nova_situacao")).toBe("nova_situacao");
    expect(blockReasonLabel("professional_cns_not_in_cnes")).toBe("o CNS de quem vacinou não está no CNES importado da cidade");
    expect(termName(TERMS.route, "IM")).toBe("Intramuscular");
    expect(termName(TERMS.route, "XX")).toBe("XX");
    expect(itemKey(PENTA_ITEM)).toBe("imm:42");
    expect(itemKey(AMOXI)).toBe("ci1");
  });
});

describe("caderneta", () => {
  it("effectiveStatus: overdue sem conferência vira unchecked", () => {
    expect(effectiveStatus(cardItem({ status: "overdue" }), null)).toBe("unchecked");
    expect(effectiveStatus(cardItem({ status: "overdue" }), { mode: "confirmed_complete", at: "2026-10-01T10:00:00-03:00", by_name: "Ana" })).toBe("overdue");
    expect(effectiveStatus(cardItem({ status: "due" }), null)).toBe("due");
  });
  it("grupos: hoje, atraso, próximas, feitas; não se aplica some", () => {
    const g = cardGroups(card({ items: [ cardItem(), cardItem({ status: "overdue" }), cardItem({ status: "upcoming" }), cardItem({ status: "complete" }),
      cardItem({ status: "not_applicable" }) ] }));
    expect([ g.today.length, g.overdue.length, g.upcoming.length, g.done.length, g.unchecked.length ]).toEqual([ 1, 1, 1, 1, 0 ]);
    expect(cardGroups(card({ checked: null, items: [ cardItem({ status: "overdue" }) ] })).overdue).toEqual([]);
  });
});

describe("dose", () => {
  const lots = [ vacLotBalance() ];
  const ctx = { catalog: CATALOG29, lots, vials: [], now: NOW29 };
  const ok = { ...newDoseDraft(PENTA, "D2", NOW29), strategy: "1", careGroup: "1", lotId: "lot9" };

  it("rascunho com via e local padrão e hora de agora", () => {
    expect(newDoseDraft(PENTA, "D2", NOW29)).toMatchObject({ immunobiologicalCode: "42", doseCode: "D2", route: "IM", site: "VLD", appliedAt: "2026-11-02T10:00" });
  });
  it("lotes oferecidos: só da vacina, com saldo, válido e não bloqueado", () => {
    const pos = [ vacPosition({ lots: [ vacLotBalance(), vacLotBalance({ lot: { ...vacLotBalance().lot, id: "b" }, blocked: true }),
      vacLotBalance({ lot: { ...vacLotBalance().lot, id: "e", expires_on: "2026-11-01" }, expired: true }), vacLotBalance({ lot: { ...vacLotBalance().lot, id: "z" }, balance: "0" }) ] }) ];
    expect(lotsForDose(pos, "42", TODAY29).map((b) => b.lot.id)).toEqual([ "lot9" ]);
    expect(lotsForDose(pos, "15", TODAY29)).toEqual([]);
  });
  it("frascos oferecidos: abertos, do lote, não vencidos e com sobra", () => {
    const list = [ vial(), vial({ id: "v2", expires_at: "2026-11-02T09:59:00-03:00" }), vial({ id: "v3", doses_left: 0 }), vial({ id: "v4", lot: { ...vial().lot, id: "x" } }) ];
    expect(vialsForDose(list, [ "lot15" ], NOW29).map((v) => v.id)).toEqual([ "v1" ]);
  });
  it("recusas de uma vez; o que não recusa", () => {
    expect(doseProblems(ok, ctx)).toEqual([]);
    const bad = doseProblems({ ...ok, strategy: "", lotId: "", appliedAt: "2026-11-02T10:01" }, ctx).map((p) => p.path);
    expect(bad).toEqual([ "strategy", "applied_at", "lot_id" ]);
    const bcg = { ...newDoseDraft(BCG, "D1", NOW29), strategy: "1", careGroup: "1", lotId: "lot15" };
    const bcgLots = [ vacLotBalance({ lot: { ...vacLotBalance().lot, id: "lot15" } }) ];
    expect(doseProblems(bcg, { ...ctx, lots: bcgLots }).map((p) => p.text)).toContain("BCG é multidose: escolha o frasco aberto ou abra um frasco");
    expect(doseProblems({ ...bcg, vialId: "v2" }, { ...ctx, lots: bcgLots, vials: [ vial({ id: "v2", expires_at: "2026-11-02T09:00:00-03:00" }) ] })
      .map((p) => p.path)).toEqual([ "vial_id" ]);
  });
  it("corpo: sem opcionais vazios; motivo só quando há", () => {
    expect(doseBody(ok, "pa1")).toEqual({ patient_id: "pa1", immunobiological_code: "42", dose_code: "D2", strategy: "1", care_group: "1", route: "IM",
      site: "VLD", applied_at: "2026-11-02T13:00:00.000Z", lot_id: "lot9" });
    expect(doseBody({ ...ok, overrideReason: "  intervalo menor por viagem  ", maternalCondition: "G" }, "pa1"))
      .toMatchObject({ override_reason: "intervalo menor por viagem", maternal_condition: "G" });
  });
  it("avisos e recusas duras separados", () => {
    const list = vaccinationRefusals(refusal([ { path: "applied_at", error: "interval_too_short" }, { path: "vial_id", error: "vial_expired" } ]));
    expect(OVERRIDABLE).toEqual([ "interval_too_short", "age_out_of_range" ]);
    const { warnings, blocking } = splitRefusals(list);
    expect(warnings.map((r) => r.code)).toEqual([ "interval_too_short" ]);
    expect(blocking.map((r) => r.text)).toEqual([ "o frasco venceu — descarte e abra outro" ]);
    expect(reasonProblem("curto", "o motivo")).toBe("o motivo precisa ter de 10 a 500 caracteres");
    expect(reasonProblem("aplicado antes por viagem", "o motivo")).toBeNull();
  });
});

describe("transcrição", () => {
  const line = { ...newTranscriptionLine("k1"), immunobiologicalCode: "15", doseCode: "D1", appliedOn: "2026-07-02" };
  it("data entre o nascimento e hoje; tamanhos; ao menos uma linha", () => {
    const ctx = { today: TODAY29, birthDate: "2026-07-01", closeCheck: true, catalog: CATALOG29 };
    expect(transcriptionProblems([ line ], ctx)).toEqual([]);
    expect(transcriptionProblems([ { ...line, appliedOn: "2026-11-03" } ], ctx).map((p) => p.text)).toEqual([ "BCG: a data não pode ser futura" ]);
    expect(transcriptionProblems([ { ...line, appliedOn: "2026-06-30" } ], ctx).map((p) => p.text)).toEqual([ "BCG: a data é antes do nascimento" ]);
    expect(transcriptionProblems([ { ...line, lotNumber: "x".repeat(41) } ], ctx).map((p) => p.text)).toEqual([ "BCG: o lote tem até 40 caracteres" ]);
    expect(transcriptionProblems([], ctx).map((p) => p.text)).toEqual([ "acrescente ao menos uma dose ou use “Confirmar caderneta completa”" ]);
  });
});

describe("temperatura", () => {
  it("parseCelsius e readingProblems", () => {
    expect([ parseCelsius("8,5"), parseCelsius("-1"), parseCelsius(" 4 "), parseCelsius("8,55"), parseCelsius("abc"), parseCelsius("51") ])
      .toEqual([ 8.5, -1, 4, null, null, null ]);
    const d = { readAt: "2026-11-02T08:00", current: "8,5", min: "3", max: "9" };
    expect(readingProblems(d, NOW29)).toEqual([]);
    expect(readingBody(d)).toEqual({ read_at: "2026-11-02T11:00:00.000Z", current_c: 8.5, min_c: 3, max_c: 9 });
    expect(readingProblems({ ...d, min: "9", max: "10" }, NOW29).map((p) => p.text)).toEqual([ "a mínima não pode ser maior que a atual" ]);
    expect(readingProblems({ ...d, readAt: "2026-11-02T10:30" }, NOW29).map((p) => p.text)).toEqual([ "a hora da leitura não pode ser futura" ]);
    expect(outOfRange(readingBody(d), { min_c: 2, max_c: 8 })).toBe(true);
    expect(outOfRange({ ...readingBody(d), current_c: 5, max_c: 8 }, { min_c: 2, max_c: 8 })).toBe(false);
  });
  it("frasco e mês", () => {
    expect(vialRemaining(vial(), NOW29)).toBe("vence em 4 h 0 min");
    expect(vialRemaining(vial({ expires_at: "2026-11-02T09:00:00-03:00" }), NOW29)).toBe("vencido");
    expect([ monthProblem("2026-11", TODAY29), monthProblem("2026-12", TODAY29), monthProblem("2026-13", TODAY29) ])
      .toEqual([ null, "o mês não pode ser futuro", "informe o mês (AAAA-MM)" ]);
  });
});

describe("recusas do api real", () => {
  const txt = (problems: { path: string; error: string; overridable?: boolean }[]) => vaccinationRefusals(refusal(problems)).map((r) => r.text);
  it("frases novas e código desconhecido cru", () => {
    expect(txt([ { path: "vial_id", error: "vial_closed_out" } ])).toEqual([ "o frasco foi descartado — abra outro" ]);
    expect(txt([ { path: "lot_id", error: "lot_product_mismatch" } ])).toEqual([ "o lote é de outra vacina — escolha o lote da vacina da dose" ]);
    expect(txt([ { path: "items[1].applied_on", error: "applied_on_in_future" }, { path: "items[1].applied_on", error: "applied_before_birth" } ]))
      .toEqual([ "a data da aplicação não pode ser futura", "a data da aplicação é antes do nascimento" ]);
    expect(txt([ { path: "lots[0].lot_id", error: "adjustment_pending" } ])).toEqual([ "o descarte deste lote já aguarda aprovação" ]);
    expect(txt([ { path: "requester_cnes", error: "invalid_requester_cnes" } ])).toEqual([ "o CNES do solicitante é inválido — confira os 7 dígitos" ]);
    expect(txt([ { path: "x", error: "coisa_nova" } ])).toEqual([ "recusado pelo servidor (coisa_nova)" ]);
  });
  it("sem problems vale o topo; feature desligada", () => {
    expect(vaccinationRefusals(new ApiError(409, { error: "excursion_closed" }, "409")).map((r) => r.code)).toEqual([ "excursion_closed" ]);
    expect(vaccinationRefusals(new ApiError(403, { error: "feature_disabled", feature: "vaccination" }, "403"))[0].text).toBe(VACCINATION_DISABLED);
    expect(vaccinationRefusals(new Error("x"))[0].text).toBe("sem conexão com o servidor — tente de novo");
  });
  it("aviso lido da marca overridable; reserva pelo código", () => {
    const list = vaccinationRefusals(refusal([ { path: "dose_code", error: "dose_novo_aviso", overridable: true }, { path: "dose_code", error: "age_out_of_range" },
      { path: "dose_code", error: "vial_empty" } ]));
    expect(splitRefusals(list).warnings.map((r) => r.code)).toEqual([ "dose_novo_aviso", "age_out_of_range" ]);
    expect(splitRefusals(list).blocking.map((r) => r.code)).toEqual([ "vial_empty" ]);
  });
  it("opcionais indefinidos", () => {
    expect(vacUser().features).toBeDefined();
    expect(locationAbilities({ ...ROOM, roles: [] })).toEqual({ vaccinate: false, lead: false, keeper: false });
    expect(effectiveStatus(cardItem({ status: "complete" }), null)).toBe("complete");
  });
});

describe("fix round 1", () => {
  it("lote com saldo 0 e frasco aberto continua oferecido", () => {
    const bal0 = vacLotBalance({ balance: "0" });
    const pos = [ vacPosition({ lots: [ bal0 ] }) ];
    expect(lotsForDose(pos, "42", TODAY29)).toEqual([]);
    const open = vial({ lot: { id: "lot9", number: "PNT2611", immunobiological_code: "42" } });
    expect(lotsForDose(pos, "42", TODAY29, [ open ], NOW29).map((b) => b.lot.id)).toEqual([ "lot9" ]);
    expect(lotsForDose(pos, "42", TODAY29, [ { ...open, doses_left: 0 } ], NOW29)).toEqual([]);
  });
  it("missing_role e invalid_range com frase da sala; feature alheia com rótulo", () => {
    expect(vaccinationRefusals(new ApiError(403, { error: "missing_role" }, "403"))[0].text).toBe("você não está na equipe desta sala");
    expect(vaccinationRefusals(refusal([ { path: "current_c", error: "invalid_range" } ]))[0].text).toBe("a mínima, a atual e a máxima precisam estar em ordem");
    expect(vaccinationRefusals(refusal([ { path: "lots[0].lot_id", error: "adjustment_pending" } ]))[0].text).toBe("o descarte deste lote já aguarda aprovação");
    expect(vaccinationRefusals(new ApiError(403, { error: "feature_disabled", feature: "surveillance" }, "403"))[0].text).not.toMatch(/^surveillance /);
  });
  it("unidose não manda frasco; due passado não é hoje", () => {
    const d = { ...newDoseDraft(PENTA, "D2", NOW29), strategy: "1", careGroup: "1", lotId: "lot9", vialId: "v-velho" };
    expect(doseBody(d, "pa1", CATALOG29)).not.toHaveProperty("vial_id");
    expect(doseProblems(d, { catalog: CATALOG29, lots: [ vacLotBalance() ], vials: [], now: NOW29 })).toEqual([]);
    expect(cardItemStatusLabel(cardItem({ due_on: "2026-10-20" }), "due", TODAY29)).toBe("já pode tomar desde 20/10/2026");
    expect(cardItemStatusLabel(cardItem({ due_on: TODAY29 }), "due", TODAY29)).toBe("devida hoje");
  });
  it("sexo feminino exige a condição maternal (api: maternal_condition_required); masculino não", () => {
    const d = { ...newDoseDraft(PENTA, "D2", NOW29), strategy: "1", careGroup: "1", lotId: "lot9" };
    const ctx2 = { catalog: CATALOG29, lots: [ vacLotBalance() ], vials: [], now: NOW29 };
    expect(doseProblems(d, { ...ctx2, sex: "female" })).toEqual([ { path: "maternal_condition", text: "informe a condição maternal (nenhuma, gestante ou puérpera)" } ]);
    expect(doseProblems({ ...d, maternalCondition: "N" }, { ...ctx2, sex: "female" })).toEqual([]);
    expect(doseProblems(d, { ...ctx2, sex: "male" })).toEqual([]);
    expect(vaccinationRefusals(refusal([ { path: "maternal_condition", error: "maternal_condition_required" } ]))[0].text)
      .toBe("informe a condição maternal (nenhuma, gestante ou puérpera)");
  });
  it("aprazamento: primeiro item a fazer do mesmo imunobiológico; nenhum → completo", () => {
    expect(doseSavedText(card(), "42")).toBe("Dose registrada. Próxima dose: Penta (DTP/HepB/Hib) 2ª dose em 02/11/2026");
    expect(doseSavedText(card({ items: [ cardItem({ status: "overdue", due_on: "2026-10-01", dose: { code: "D3", name: null } }) ] }), "42"))
      .toBe("Dose registrada. Próxima dose: Penta (DTP/HepB/Hib) D3 em 01/10/2026");
    expect(doseSavedText(card({ items: [ cardItem({ status: "complete" }), cardItem({ immunobiological: { code: "15", name: "BCG" }, status: "upcoming" }) ] }), "42"))
      .toBe("Dose registrada. Esquema desta vacina completo no calendário.");
  });
  it("V27: condição maternal só de 10 a 49 anos completos no dia da aplicação", () => {
    const d = { ...newDoseDraft(PENTA, "D2", NOW29), strategy: "1", careGroup: "1", lotId: "lot9" };
    const ctx3 = { catalog: CATALOG29, lots: [ vacLotBalance() ], vials: [], now: NOW29, sex: "female" };
    expect(doseProblems(d, { ...ctx3, birthDate: "2026-09-02" })).toEqual([]); // 2 meses
    expect(doseProblems(d, { ...ctx3, birthDate: "1996-05-10" }).map((p) => p.path)).toEqual([ "maternal_condition" ]); // 30 anos
    expect(maternalRequired("female", "2016-11-02", "2026-11-02")).toBe(true); // faz 10 hoje
    expect(maternalRequired("female", "2016-11-03", "2026-11-02")).toBe(false); // véspera dos 10
    expect(maternalRequired("female", "1976-11-03", "2026-11-02")).toBe(true); // véspera dos 50
    expect(maternalRequired("female", "1976-11-02", "2026-11-02")).toBe(false); // faz 50 hoje
    expect(maternalRequired("female", "2016-02-29", "2026-02-28")).toBe(true); // 29/02 → 28/02 em ano comum
    expect(maternalRequired("female", null, "2026-11-02")).toBe(true);
    expect(maternalRequired("male", "1996-05-10", "2026-11-02")).toBe(false);
    // a data que vale é a da aplicação, não a de hoje
    expect(doseProblems({ ...d, appliedAt: "2026-11-01T09:00" }, { ...ctx3, birthDate: "2016-11-02" })).toEqual([]);
  });
  it("dose fora do calendário na rotina aponta a estratégia", () => {
    expect(vaccinationRefusals(refusal([ { path: "dose_code", error: "dose_not_in_calendar" } ]))[0].text)
      .toBe("esta dose não está no calendário de rotina desta vacina — fora da rotina, troque a estratégia");
  });
});
