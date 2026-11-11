import { describe, expect, it } from "vitest";
import {
  ADMIN_STATUSES, CHECK_AHEAD_MINUTES, FREQUENCY_KINDS, MAX_ITEMS, adminStatusLabel, administrationBody, administrationProblems,
  alertText, alertTone, bedLabelProblem, canCheck, emptyItemDraft, endKindLabel, frequencyText, hoursText, itemDraftFrom,
  keptFirstDoseAt, parseDecimal, prescriptionBody, prescriptionProblems, reasonProblem, shortfallCauseLabel, slotState,
  type AdministrationDraft, type ItemDraft
} from "./urgencyObservation";
import type { ObservationAlert } from "./api";
import { NOW32B, administration, prescriptionItem } from "../test/urgencyObservationFixtures";

const okDraft = (o: Partial<ItemDraft> = {}): ItemDraft => ({
  ...emptyItemDraft(), item: { catalog_item_id: "cat-dipirona", name: "Dipirona" }, dose: "1", doseUnit: "g", route: "intravenous",
  kind: "once", ...o
});
const at = (iso: string, done = false) => ({ scheduled_at: iso, administration: done ? administration() : null });

describe("alertas e horas", () => {
  it("sempre com texto", () => {
    expect(alertText(null)).toBeNull();
    expect(alertText("near_limit")).toBe("perto de 24 h em observação");
    expect(alertText("over_limit")).toBe("mais de 24 h em observação");
    expect(alertTone("over_limit")).toBe("down");
    expect(alertTone("near_limit")).toBe("warn");
    expect(alertTone(null)).toBe("neutral");
    expect(alertText("weird" as ObservationAlert)).toBe("weird");
    expect(hoursText(1)).toBe("1 h em observação");
    expect(hoursText(21)).toBe("21 h em observação");
  });
  it("rótulos de código; código novo aparece cru", () => {
    expect(adminStatusLabel("refused")).toBe("recusado pelo paciente");
    expect(adminStatusLabel("novo")).toBe("novo");
    expect(ADMIN_STATUSES.map((s) => s.value)).toEqual([ "administered", "not_administered", "refused" ]);
    expect(shortfallCauseLabel("insufficient_balance")).toBe("saldo insuficiente");
    expect(shortfallCauseLabel("x")).toBe("x");
    expect(endKindLabel("bed_change")).toBe("troca de leito");
    expect(endKindLabel("x")).toBe("x");
    expect(FREQUENCY_KINDS.map((k) => k.value)).toEqual([ "once", "interval", "if_needed" ]);
  });
  it("frequência por extenso", () => {
    expect(frequencyText({ kind: "once" })).toBe("dose única");
    expect(frequencyText({ kind: "interval", interval_hours: 6 })).toBe("de 6 em 6 h");
    expect(frequencyText({ kind: "if_needed", max_per_day: 4 })).toBe("se necessário, até 4 por dia");
  });
});

describe("janela da checagem", () => {
  it("até 60 min à frente; checado é done; passado sem checagem é late", () => {
    expect(CHECK_AHEAD_MINUTES).toBe(60);
    expect(slotState(at("2026-11-10T08:00:00-03:00", true), NOW32B)).toBe("done");
    expect(slotState(at("2026-11-10T12:00:00-03:00"), NOW32B)).toBe("late");
    expect(slotState(at("2026-11-10T14:00:00-03:00"), NOW32B)).toBe("due");
    expect(slotState(at("2026-11-10T14:50:00-03:00"), NOW32B)).toBe("due");
    expect(slotState(at("2026-11-10T15:00:00-03:00"), NOW32B)).toBe("due");
    expect(slotState(at("2026-11-10T15:01:00-03:00"), NOW32B)).toBe("future");
    expect(canCheck(at("2026-11-10T15:01:00-03:00"), NOW32B)).toBe(false);
    expect(canCheck(at("2026-11-10T15:00:00-03:00"), NOW32B)).toBe(true);
    expect(canCheck(at("2026-11-10T12:00:00-03:00"), NOW32B)).toBe(true);
    expect(canCheck(at("2026-11-10T08:00:00-03:00", true), NOW32B)).toBe(false);
  });
});

describe("prescrição", () => {
  it("todos os problemas de uma vez, com o path do api", () => {
    const d: ItemDraft = { ...emptyItemDraft(), item: null, dose: "0", doseUnit: "", kind: "interval", intervalHours: "25" };
    expect(prescriptionProblems([ d ]).map((p) => p.path)).toEqual([
      "items.0.catalog_item_id", "items.0.dose", "items.0.dose_unit", "items.0.frequency.interval_hours" ]);
    expect(prescriptionProblems([]).map((p) => p.path)).toEqual([ "items" ]);
    expect(MAX_ITEMS).toBe(20);
    expect(prescriptionProblems(Array.from({ length: 21 }, () => okDraft())).map((p) => p.path)).toEqual([ "items" ]);
    expect(prescriptionProblems([ okDraft(), okDraft() ])).toEqual([]);
  });
  it("limites: dose 5+3, unidade e via fechadas, orientação, quantidade 5+2, primeira dose na janela", () => {
    const paths = (o: Partial<ItemDraft>) => prescriptionProblems([ okDraft(o) ], NOW32B).map((p) => p.path);
    expect(paths({ dose: "123456" })).toEqual([ "items.0.dose" ]);
    expect(paths({ dose: "1,2345" })).toEqual([ "items.0.dose" ]);
    expect(paths({ dose: "0,5" })).toEqual([]);
    expect(paths({ doseUnit: "kg" as never })).toEqual([ "items.0.dose_unit" ]);
    expect(paths({ route: "" as never })).toEqual([ "items.0.route" ]);
    expect(paths({ kind: "if_needed", maxPerDay: "" })).toEqual([ "items.0.frequency.max_per_day" ]);
    expect(paths({ kind: "if_needed", maxPerDay: "25" })).toEqual([ "items.0.frequency.max_per_day" ]);
    expect(paths({ kind: "interval", intervalHours: "0" })).toEqual([ "items.0.frequency.interval_hours" ]);
    expect(paths({ kind: "interval", intervalHours: "6" })).toEqual([]);
    expect(paths({ instructions: "x".repeat(501) })).toEqual([ "items.0.instructions" ]);
    expect(paths({ quantityPerDose: "0" })).toEqual([ "items.0.stock_quantity_per_dose" ]);
    expect(paths({ quantityPerDose: "1,234" })).toEqual([ "items.0.stock_quantity_per_dose" ]);
    expect(paths({ quantityPerDose: "2,5" })).toEqual([]);
    // api: de agora − 1 h até agora + 24 h (agora = 14h).
    expect(paths({ firstDoseAt: "2026-11-10T12:59" })).toEqual([ "items.0.first_dose_at" ]);
    expect(paths({ firstDoseAt: "2026-11-10T13:00" })).toEqual([ "items.0.first_dose_at" ]);
    // Piso com margem = 13:01 (inclusive).
    expect(paths({ firstDoseAt: "2026-11-10T13:01" })).toEqual([]);
    expect(paths({ firstDoseAt: "2026-11-11T14:00" })).toEqual([]);
    expect(paths({ firstDoseAt: "2026-11-11T14:01" })).toEqual([ "items.0.first_dose_at" ]);
    expect(paths({ firstDoseAt: "lixo" })).toEqual([ "items.0.first_dose_at" ]);
  });
  it("corpo: dose como texto com ponto, campos só do tipo, nunca null", () => {
    const body = prescriptionBody([ { ...okDraft(), dose: "0,5", kind: "if_needed", maxPerDay: "4", intervalHours: "6", firstDoseAt: "" } ]);
    expect(body[0]).toEqual({
      catalog_item_id: "cat-dipirona", dose: "0.5", dose_unit: "g", route: "intravenous", frequency: { kind: "if_needed", max_per_day: 4 }
    });
    const interval = prescriptionBody([ okDraft({ kind: "interval", intervalHours: "8", maxPerDay: "3", instructions: "  lento  ",
      quantityPerDose: "2,5", firstDoseAt: "2026-11-10T15:00" }) ])[0];
    expect(interval).toEqual({
      catalog_item_id: "cat-dipirona", dose: "1", dose_unit: "g", route: "intravenous", frequency: { kind: "interval", interval_hours: 8 },
      instructions: "lento", stock_quantity_per_dose: "2.5", first_dose_at: "2026-11-10T15:00"
    });
    // Quantidade 1 (padrão) e orientação vazia não vão.
    const plain = prescriptionBody([ okDraft({ quantityPerDose: "1,00", instructions: "  " }) ])[0];
    expect(plain).toEqual({ catalog_item_id: "cat-dipirona", dose: "1", dose_unit: "g", route: "intravenous", frequency: { kind: "once" } });
    for (const v of Object.values(interval)) expect(v).not.toBeNull();
  });
  it("itemDraftFrom carrega o item e a primeira dose original", () => {
    const d = itemDraftFrom(prescriptionItem({ instructions: "lento", stock_quantity_per_dose: "2.50" }));
    expect(d).toMatchObject({
      item: { catalog_item_id: "cat-dipirona" }, dose: "1", doseUnit: "g", route: "intravenous", kind: "interval", intervalHours: "6",
      maxPerDay: "", instructions: "lento", quantityPerDose: "2.5", firstDoseAt: "2026-11-10T08:00:00-03:00"
    });
    expect(prescriptionBody([ itemDraftFrom(prescriptionItem()) ])[0].first_dose_at).toBe("2026-11-10T08:00:00-03:00");
    expect(itemDraftFrom(prescriptionItem({ catalog_item: null })).item).toBeNull();
  });
});

describe("D18a: primeira dose do item mantido ao alterar a prescrição (api: agora − 1 h .. agora + 24 h)", () => {
  const item = (kind: "once" | "interval" | "if_needed", first: string, hours: number | null = null) =>
    prescriptionItem({ first_dose_at: first, frequency: { kind, interval_hours: hours, max_per_day: kind === "if_needed" ? 4 : null } });
  // agora 14:00 -03:00 → limite inferior 13:00.
  it.each([
    [ "interval ainda na janela: mantém", item("interval", "2026-11-10T13:30:00-03:00", 6), "2026-11-10T13:30:00-03:00" ],
    [ "interval no piso do api (13:00:00): dentro da margem, vai à próxima da grade", item("interval", "2026-11-10T13:00:00-03:00", 6), "2026-11-10T19:00:00-03:00" ],
    [ "interval piso + 30 s: ainda dentro da margem", item("interval", "2026-11-10T13:00:30-03:00", 6), "2026-11-10T19:00:30-03:00" ],
    [ "interval piso + 61 s: mantém", item("interval", "2026-11-10T13:01:01-03:00", 6), "2026-11-10T13:01:01-03:00" ],
    [ "once no piso: omite", item("once", "2026-11-10T13:00:00-03:00"), null ],
    [ "once piso + 30 s: omite", item("once", "2026-11-10T13:00:30-03:00"), null ],
    [ "once piso + 61 s: mantém", item("once", "2026-11-10T13:01:01-03:00"), "2026-11-10T13:01:01-03:00" ],
    [ "interval 8h/6h: próximo da grade é 14h", item("interval", "2026-11-10T08:00:00-03:00", 6), "2026-11-10T14:00:00-03:00" ],
    [ "interval 8h/4h: 12h cai fora, 16h entra", item("interval", "2026-11-10T08:00:00-03:00", 4), "2026-11-10T16:00:00-03:00" ],
    [ "interval 1h: 13h cai na margem, 14h", item("interval", "2026-11-09T20:00:00-03:00", 1), "2026-11-10T14:00:00-03:00" ],
    [ "interval dias atrás, 24h: mesmo horário de hoje", item("interval", "2026-11-07T15:00:00-03:00", 24), "2026-11-10T15:00:00-03:00" ],
    [ "once na janela: mantém", item("once", "2026-11-10T13:10:00-03:00"), "2026-11-10T13:10:00-03:00" ],
    [ "once já vencido: não reagenda", item("once", "2026-11-10T08:00:00-03:00"), null ],
    [ "if_needed na janela: mantém", item("if_needed", "2026-11-10T13:10:00-03:00"), "2026-11-10T13:10:00-03:00" ],
    [ "if_needed antigo: omite", item("if_needed", "2026-11-10T08:00:00-03:00"), null ]
  ])("%s", (_name, it_, expected) => {
    expect(keptFirstDoseAt(it_, NOW32B)).toBe(expected);
  });
  it("once já administrado nunca é reagendado, mesmo na janela", () => {
    expect(keptFirstDoseAt(item("once", "2026-11-10T13:10:00-03:00"), NOW32B, { given: true })).toBeNull();
  });
  it("mantém o fuso do original e passa na validação do corpo", () => {
    // Agora = 17h UTC; piso 16h UTC; grade 8h, 14h, 20h UTC.
    const out = keptFirstDoseAt(item("interval", "2026-11-10T08:00:00Z", 6), NOW32B);
    expect(out).toBe("2026-11-10T20:00:00Z");
    const d = { ...itemDraftFrom(item("interval", "2026-11-10T08:00:00-03:00", 6)), firstDoseAt: keptFirstDoseAt(item("interval", "2026-11-10T08:00:00-03:00", 6), NOW32B)! };
    expect(prescriptionProblems([ d ], NOW32B)).toEqual([]);
  });
});

describe("checagem", () => {
  const ctx = { stockDeduction: true, defaultLotId: "lot-a", defaultQuantity: "1", now: NOW32B, prescribedAt: "2026-11-10T08:00:00-03:00" };
  const d = (o: Partial<AdministrationDraft> = {}): AdministrationDraft =>
    ({ status: "administered", reason: "", lotId: "lot-a", quantity: "1", administeredAt: "", ...o });
  it("motivo fora de administrado (10 a 500)", () => {
    expect(administrationProblems(d({ status: "refused", reason: "não quis" }), ctx).map((p) => p.path)).toEqual([ "reason" ]);
    expect(administrationProblems(d({ status: "refused", reason: "o paciente não quis tomar" }), ctx)).toEqual([]);
    expect(administrationProblems(d({ status: "not_administered", reason: "" }), ctx).map((p) => p.path)).toEqual([ "reason" ]);
    // Em administrado o motivo não vale (o api recusa): nem é cobrado.
    expect(administrationProblems(d({ reason: "" }), ctx)).toEqual([]);
  });
  it("horário da administração: até agora + 5 min e não antes da versão", () => {
    expect(administrationProblems(d({ administeredAt: "2026-11-10T14:05" }), ctx)).toEqual([]);
    expect(administrationProblems(d({ administeredAt: "2026-11-10T14:06" }), ctx).map((p) => p.path)).toEqual([ "administered_at" ]);
    expect(administrationProblems(d({ administeredAt: "lixo" }), ctx).map((p) => p.path)).toEqual([ "administered_at" ]);
    const withVersion = { ...ctx, prescribedAt: "2026-11-10T10:00:00-03:00" };
    expect(administrationProblems(d({ administeredAt: "2026-11-10T07:59" }), ctx).map((p) => p.path)).toEqual([ "administered_at" ]);
    expect(administrationProblems(d({ administeredAt: "2026-11-10T09:59" }), withVersion).map((p) => p.path)).toEqual([ "administered_at" ]);
  });
  it("once/interval sem horário: problema no scheduled_at e corpo recusado", () => {
    const none = { itemId: "pi1", kind: "interval" as const, slot: null };
    expect(administrationProblems(d(), ctx, none).map((p) => p.path)).toEqual([ "scheduled_at" ]);
    expect(administrationProblems(d(), ctx, { ...none, kind: "if_needed" })).toEqual([]);
    expect(() => administrationBody(d(), ctx, none)).toThrow();
  });
  it("quantidade de estoque: até 2 casas, só com a baixa ligada", () => {
    expect(administrationProblems(d({ quantity: "0" }), ctx).map((p) => p.path)).toEqual([ "stock_quantity" ]);
    expect(administrationProblems(d({ quantity: "1,234" }), ctx).map((p) => p.path)).toEqual([ "stock_quantity" ]);
    expect(administrationProblems(d({ quantity: "lixo" }), { ...ctx, stockDeduction: false })).toEqual([]);
  });
  it("corpo: estoque só com o interruptor e só o que mudou; motivo só fora de administrado", () => {
    const slot = { itemId: "pi1", kind: "interval" as const, slot: "2026-11-10T14:00:00-03:00" };
    const prn = { itemId: "pi1", kind: "if_needed" as const, slot: null };
    expect(administrationBody(d(), ctx, slot)).toEqual({ prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "administered" });
    expect(administrationBody(d({ lotId: "lot-b", quantity: "2" }), ctx, prn))
      .toEqual({ prescription_item_id: "pi1", status: "administered", stock_lot_id: "lot-b", stock_quantity: "2" });
    expect(administrationBody(d({ quantity: "2,5" }), ctx, prn))
      .toEqual({ prescription_item_id: "pi1", status: "administered", stock_quantity: "2.5" });
    expect(administrationBody(d({ lotId: "lot-b", quantity: "2" }), { ...ctx, stockDeduction: false }, prn))
      .toEqual({ prescription_item_id: "pi1", status: "administered" });
    // Recusa: motivo vai, estoque e horário da administração não.
    expect(administrationBody(d({ status: "refused", reason: "  o paciente não quis  ", lotId: "lot-b", quantity: "2", administeredAt: "2026-11-10T14:00" }), ctx, slot))
      .toEqual({ prescription_item_id: "pi1", scheduled_at: "2026-11-10T14:00:00-03:00", status: "refused", reason: "o paciente não quis" });
    expect(administrationBody(d({ administeredAt: "2026-11-10T13:50" }), ctx, slot).administered_at).toBe("2026-11-10T13:50");
  });
});

describe("motivo, rótulo do leito e decimal", () => {
  it("limites do api", () => {
    expect(reasonProblem("curto")).toBe("o motivo tem de 10 a 500 caracteres");
    expect(reasonProblem("  nove abc  ")).toBe("o motivo tem de 10 a 500 caracteres");
    expect(reasonProblem("motivo bem escrito")).toBeNull();
    expect(reasonProblem("x".repeat(501))).not.toBeNull();
    expect(bedLabelProblem("  ")).toBe("o rótulo tem de 1 a 20 caracteres");
    expect(bedLabelProblem("Obs 1")).toBeNull();
    expect(bedLabelProblem("x".repeat(21))).not.toBeNull();
    expect(bedLabelProblem(" " + "x".repeat(20) + " ")).toBeNull();
  });
  it("parseDecimal aceita vírgula e recusa o resto", () => {
    expect(parseDecimal("0,5")).toBe(0.5);
    expect(parseDecimal(" 12.25 ")).toBe(12.25);
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
    expect(parseDecimal("1e3")).toBeNull();
  });
});
