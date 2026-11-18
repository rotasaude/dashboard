// src/lib/vectorInspection.test.ts
import { describe, expect, it } from "vitest";
import type { DepositCounts, DepositGroup } from "./api";
import {
  DERIVED_REASONS, ENDEMIC_AGENT_CBO, IE_PROPERTIES, PE_PROPERTY, checkInspection, derivedReasons, emptyInspectionDraft, inspectionInput as draftInput,
  measureQuantity, outcomeForSituation, pruneInspection, sampleLabel, type InspectionCtx, type InspectionDraft
} from "./vectorInspection";
import { INACTIVE_PRODUCT, TODAY35, VC_DOMAINS, domainProduct, inspectionInput } from "../test/vectorControlFixtures";

const ZERO_DEPOSIT: DepositCounts = { group: "A1", existing: 0, with_water: 0, with_larvae: 0, eliminated: 0, treated: 0 };
const GROUPS: DepositGroup[] = [ "A1", "A2", "B", "C", "D1", "D2", "E" ];
const PRODUCTS: InspectionCtx["products"] = [ ...VC_DOMAINS.products, { ...domainProduct(INACTIVE_PRODUCT), active: false } ];
// Visita realizada às 10:00 de TODAY35, imóvel "1" no bairro nb1, perfil com cb1, agente, gate ligado.
const ctx = (o: Partial<InspectionCtx> = {}): InspectionCtx => ({
  visit: { outcome: 1, occurred_at: "2026-11-16T10:00:00-03:00", reasons: [] },
  household: { id: "h1", property_type: "1", neighborhood_id: "nb1" },
  profile: { city_block_id: "cb1" }, agent: true, gateUsable: true, products: PRODUCTS, limits: VC_DOMAINS.limits, ...o
});
const base = ctx();
const issues = (i: Parameters<typeof checkInspection>[0], c: Partial<InspectionCtx> = {}) => checkInspection(i, ctx(c));
// O rascunho do boletim completo (o mesmo de inspectionInput() das fixtures).
const fullDraft = (): InspectionDraft => ({
  ...emptyInspectionDraft(), activity: "li_t", situation: "worked", educationalAction: true, enteredAt: "09:40", leftAt: "10:20",
  deposits: [ { group: "A2", existing: "3", with_water: "2", with_larvae: "1", eliminated: "1", treated: "1" } ],
  measures: [ { method: "focal", productId: "pr1", charges: "2" } ], samples: [ { group: "A2", larvae: "8" } ]
});

describe("vectorInspection — constantes", () => {
  it("CBO, motivos derivados e tipos de imóvel do Catalog do api", () => {
    expect(ENDEMIC_AGENT_CBO).toBe("515140");
    expect([ ...DERIVED_REASONS ]).toEqual([ 34, 35, 36, 37 ]);
    expect(PE_PROPERTY).toBe("4");
    expect([ ...IE_PROPERTIES ]).toEqual([ "5", "6", "7", "8", "9", "10", "11", "12", "13" ]);
  });
});

describe("checkInspection", () => {
  it("boletim completo do agente: nada a recusar", () => expect(issues(inspectionInput())).toEqual([]));

  it("1. outro CBO ou gate desligado param tudo", () => {
    expect(issues(inspectionInput(), { agent: false })).toEqual([ { error: "cbo_not_allowed", path: "vector_inspection" } ]);
    expect(issues(inspectionInput(), { gateUsable: false })).toEqual([ { error: "feature_disabled", path: "vector_inspection" } ]);
    // O api confere o gate antes do CBO.
    expect(issues(inspectionInput(), { gateUsable: false, agent: false })).toEqual([ { error: "feature_disabled", path: "vector_inspection" } ]);
  });

  it("sem domicílio: vector_inspection_invalid em household_id, e mais nada (Q10)", () => {
    expect(issues(inspectionInput(), { household: null })).toEqual([ { error: "vector_inspection_invalid", path: "household_id" } ]);
  });

  it("forma: atividade e situação sem escolha recusam no campo, como o api", () => {
    const d: InspectionDraft = { ...fullDraft(), activity: null, situation: null };
    const found = checkInspection(draftInput(d, TODAY35), base);
    expect(found[0]).toEqual({ error: "vector_inspection_invalid", path: "vector_inspection.activity" });
    expect(found).toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.situation" });
    expect(issues(inspectionInput({ entered_at: "2026-11-16T09:40", left_at: "2026-11-16T10:20:00-03:00" })))
      .toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.entered_at" });
  });

  it.each([ [ "worked", 2 ], [ "worked", 3 ], [ "refused", 1 ], [ "closed", 1 ], [ "vacant", 2 ] ] as const)(
    "2. situação %s com desfecho %i → situation_outcome_mismatch", (situation, outcome) => {
      expect(issues(inspectionInput({ situation }), { visit: { ...base.visit, outcome } }))
        .toContainEqual({ error: "situation_outcome_mismatch", path: "vector_inspection.situation" });
    });

  it("2. fechado com depósito, medida, amostra e ação educativa: uma recusa por campo", () => {
    expect(issues(inspectionInput({ situation: "closed" }), { visit: { ...base.visit, outcome: 3 } }).filter((p) => p.error === "inspection_not_worked").map((p) => p.path))
      .toEqual([ "vector_inspection.deposits", "vector_inspection.measures", "vector_inspection.samples", "vector_inspection.educational_action" ]);
  });

  it.each([ [ "pe", "1", true ], [ "pe", "4", false ], [ "ie", "4", true ], [ "ie", "5", false ], [ "ie", "13", false ], [ "li", "99", false ], [ "li_t", "4", false ] ] as const)(
    "3. atividade %s em imóvel %s recusa = %s", (activity, property_type, refused) => {
      const found = issues(inspectionInput({ activity }), { household: { id: "h1", property_type, neighborhood_id: "nb1" } });
      const mismatch = { error: "activity_property_mismatch", path: "vector_inspection.activity" };
      if (refused) expect(found).toContainEqual(mismatch);
      else expect(found).not.toContainEqual(mismatch);
    });

  it("4. vínculos: liraa sem item, item de outro imóvel, bloqueio inativo ou fora da área, vínculo em li", () => {
    expect(issues(inspectionInput({ activity: "liraa" }))).toContainEqual({ error: "liraa_item_not_found", path: "vector_inspection.liraa_draw_item_id" });
    expect(issues(inspectionInput({ activity: "liraa", liraa_draw_item_id: "li1" }), { liraaItems: [ { id: "li1", household_id: "h2", status: "pending" } ] }))
      .toContainEqual({ error: "liraa_item_not_found", path: "vector_inspection.liraa_draw_item_id" });
    expect(issues(inspectionInput({ activity: "transmission_block", transmission_block_id: "tb1" }), { transmissionBlocks: [ { id: "tb1", status: "active", block_ids: [ "cb9" ] } ] }))
      .toContainEqual({ error: "transmission_block_not_active", path: "vector_inspection.transmission_block_id" });
    expect(issues(inspectionInput({ activity: "li", liraa_draw_item_id: "li1" }))).toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.liraa_draw_item_id" });
  });

  it("4. vínculos válidos passam; levantamento não sorteado e bloqueio proposto recusam", () => {
    const item = { id: "li1", household_id: "h1", status: "pending" };
    expect(issues(inspectionInput({ activity: "liraa", liraa_draw_item_id: "li1" }), { liraaItems: [ item ] })).toEqual([]);
    expect(issues(inspectionInput({ activity: "liraa", liraa_draw_item_id: "li1" }), { liraaItems: [ { ...item, survey_status: "closed" } ] }))
      .toContainEqual({ error: "liraa_item_not_found", path: "vector_inspection.liraa_draw_item_id" });
    const tb = { id: "tb1", status: "active", block_ids: [ "cb1" ] };
    expect(issues(inspectionInput({ activity: "transmission_block", transmission_block_id: "tb1" }), { transmissionBlocks: [ tb ] })).toEqual([]);
    expect(issues(inspectionInput({ activity: "transmission_block", transmission_block_id: "tb1" }), { transmissionBlocks: [ { ...tb, status: "proposed" } ] }))
      .toContainEqual({ error: "transmission_block_not_active", path: "vector_inspection.transmission_block_id" });
    // Sem a lista no contexto, só a presença do vínculo.
    expect(issues(inspectionInput({ activity: "transmission_block", transmission_block_id: "tb1" }))).toEqual([]);
  });

  it("5. depósitos: grupo repetido e cada desigualdade no próprio campo", () => {
    const bad = inspectionInput({ deposits: [ { group: "A1", existing: 2, with_water: 3, with_larvae: 4, eliminated: 3, treated: 4 }, { group: "A1", existing: 0, with_water: 0, with_larvae: 0, eliminated: 0, treated: 0 } ], samples: [] });
    const found = issues(bad).filter((p) => p.error === "deposit_counts_inconsistent").map((p) => p.path);
    expect(found).toEqual([ "vector_inspection.deposits[0].with_water", "vector_inspection.deposits[0].with_larvae", "vector_inspection.deposits[0].eliminated",
      "vector_inspection.deposits[0].treated", "vector_inspection.deposits[1].group" ]);
    expect(issues(inspectionInput({ deposits: [ { group: "B", existing: 1000, with_water: 0, with_larvae: 0, eliminated: 0, treated: 0 } ], samples: [] })))
      .toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.deposits[0].existing" });
  });

  it("5. a faixa vem antes da desigualdade (a ordem do api)", () => {
    const found = issues(inspectionInput({ deposits: [ { group: "A2", existing: 1, with_water: 1.5, with_larvae: 1, eliminated: 2, treated: 0 } ] }));
    expect(found[0]).toEqual({ error: "vector_inspection_invalid", path: "vector_inspection.deposits[0].with_water" });
  });

  it("6. medidas: mecânico sem produto; inativo; uso errado; cargas 0, 999,01 e 3 casas", () => {
    expect(issues(inspectionInput({ measures: [ { method: "mechanical", vector_product_id: "pr1", charges: 1 } ] })).map((p) => p.path))
      .toEqual(expect.arrayContaining([ "vector_inspection.measures[0].vector_product_id", "vector_inspection.measures[0].charges" ]));
    expect(issues(inspectionInput({ measures: [ { method: "spatial", vector_product_id: "pr1", charges: 1 } ] })))
      .toContainEqual({ error: "product_not_allowed", path: "vector_inspection.measures[0].vector_product_id" });
    expect(issues(inspectionInput({ measures: [ { method: "focal", vector_product_id: INACTIVE_PRODUCT.id, charges: 1 } ] })))
      .toContainEqual({ error: "product_not_allowed", path: "vector_inspection.measures[0].vector_product_id" });
    for (const charges of [ 0, 999.01, 1.005 ]) expect(issues(inspectionInput({ measures: [ { method: "focal", vector_product_id: "pr1", charges } ] })))
      .toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.measures[0].charges" });
    expect(issues(inspectionInput({ measures: [ { method: "focal", vector_product_id: "pr1", charges: 999 } ] }))).toEqual([]);
  });

  it("6. medida repetida (método, produto) recusa a segunda", () => {
    const m = { method: "focal" as const, vector_product_id: "pr1", charges: 1 };
    expect(issues(inspectionInput({ measures: [ m, m ] }))).toEqual([ { error: "vector_inspection_invalid", path: "vector_inspection.measures[1]" } ]);
    expect(issues(inspectionInput({ measures: [ m, { method: "mechanical" }, { method: "mechanical" } ] })))
      .toEqual([ { error: "vector_inspection_invalid", path: "vector_inspection.measures[2]" } ]);
  });

  it("7. amostras: buraco na numeração, grupo sem larva, mais tubitos que depósitos com larva", () => {
    const one = { number: 1, deposit_group: "A2" as const, larvae_collected: 8 };
    expect(issues(inspectionInput({ samples: [ { ...one, number: 2 } ] }))).toContainEqual({ error: "samples_exceed_larvae", path: "vector_inspection.samples[0]" });
    expect(issues(inspectionInput({ samples: [ { ...one, deposit_group: "B" } ] }))).toContainEqual({ error: "samples_exceed_larvae", path: "vector_inspection.samples[0]" });
    expect(issues(inspectionInput({ samples: [ one, { ...one, number: 2 } ] }))).toContainEqual({ error: "samples_exceed_larvae", path: "vector_inspection.samples[1]" });
    expect(issues(inspectionInput({ samples: [ { ...one, larvae_collected: 11 } ] }))).toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.samples[0].larvae_collected" });
  });

  it("8. horários: um sem o outro; entrada depois da visita; 12 h 01; outro dia; os dois omitidos valem", () => {
    const t = (entered_at?: string, left_at?: string) => issues({ ...inspectionInput(), entered_at, left_at });
    const bad = { error: "inspection_times_invalid", path: "vector_inspection.entered_at" };
    expect(t("2026-11-16T09:40:00-03:00", undefined)).toContainEqual(bad);
    expect(t(undefined, "2026-11-16T10:20:00-03:00")).toContainEqual(bad);
    expect(t("2026-11-16T10:05:00-03:00", "2026-11-16T10:20:00-03:00")).toContainEqual(bad);
    expect(t("2026-11-16T00:00:00-03:00", "2026-11-16T12:01:00-03:00")).toContainEqual(bad);
    expect(t("2026-11-15T23:50:00-03:00", "2026-11-16T10:20:00-03:00")).toContainEqual(bad);
    expect(t(undefined, undefined)).toEqual([]);
    expect(t("2026-11-16T00:00:00-03:00", "2026-11-16T12:00:00-03:00")).toEqual([]);
  });

  it("9. 34–37 no corpo com boletim → reason_derived; derivados em ordem crescente", () => {
    expect(issues(inspectionInput(), { visit: { ...base.visit, reasons: [ 1, 35 ] } })).toContainEqual({ error: "reason_derived", path: "reasons" });
    expect(derivedReasons(inspectionInput())).toEqual([ 34, 35, 36, 37 ]);
    expect(derivedReasons(inspectionInput({ educational_action: false, deposits: [], samples: [], measures: [ { method: "mechanical" } ] }))).toEqual([ 36 ]);
    expect(derivedReasons(inspectionInput({ situation: "closed", educational_action: false, deposits: [], measures: [], samples: [] }))).toEqual([]);
  });

  it("10. quarteirão: perfil já tem → block_already_set; domicílio sem bairro; quarteirão de outro bairro", () => {
    const p = { error: "block_already_set", path: "vector_inspection.city_block_id" };
    expect(issues(inspectionInput({ city_block_id: "cb2" }))).toContainEqual(p);
    const noBlock = { profile: { city_block_id: null }, blocks: [ { id: "cb2", neighborhood_id: "nb2", active: true } ] };
    expect(issues(inspectionInput({ city_block_id: "cb2" }), noBlock)).toContainEqual({ error: "block_not_in_household_neighborhood", path: "vector_inspection.city_block_id" });
    expect(issues(inspectionInput({ city_block_id: "cb2" }), { ...noBlock, household: { id: "h1", property_type: "1", neighborhood_id: null } }))
      .toContainEqual({ error: "household_without_neighborhood", path: "vector_inspection.city_block_id" });
    // Quarteirão inativo ou desconhecido: vector_inspection_invalid no campo (o api confere antes do bairro).
    expect(issues(inspectionInput({ city_block_id: "cb3" }), noBlock)).toEqual([ { error: "vector_inspection_invalid", path: "vector_inspection.city_block_id" } ]);
    expect(issues(inspectionInput({ city_block_id: "cb2" }), { ...noBlock, blocks: [ { id: "cb2", neighborhood_id: "nb1", active: true } ] })).toEqual([]);
  });

  it("primeiro erro = o do api (Q13(10)): situação errada e depósito incoerente → situation_outcome_mismatch primeiro", () => {
    const two = issues(inspectionInput({ deposits: [ { group: "A2", existing: 1, with_water: 2, with_larvae: 1, eliminated: 0, treated: 0 } ] }), { visit: { ...base.visit, outcome: 2 } });
    expect(two[0]).toEqual({ error: "situation_outcome_mismatch", path: "vector_inspection.situation" });
  });

  it("limites da Q7(3): oito grupos, 21 medidas e 100 amostras recusam a lista", () => {
    expect(issues(inspectionInput({ deposits: Array.from({ length: 8 }, (_, i) => ({ ...ZERO_DEPOSIT, group: GROUPS[i % 7] })), samples: [] })))
      .toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.deposits" });
    expect(issues(inspectionInput({ measures: Array.from({ length: 21 }, () => ({ method: "mechanical" as const })) })))
      .toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.measures" });
    expect(issues(inspectionInput({ samples: Array.from({ length: 100 }, (_, i) => ({ number: i + 1, deposit_group: "A2" as const, larvae_collected: 1 })) })))
      .toContainEqual({ error: "vector_inspection_invalid", path: "vector_inspection.samples" });
  });
});

describe("derivações", () => {
  it("etiqueta, desfecho e quantidade", () => {
    expect(sampleLabel("3f2a9c1e-0b4d-4c1a-9e7f-1a2b3c4d5e6f", 1)).toBe("3F2A9C1E-01");
    expect(sampleLabel("3f2a9c1e-0b4d-4c1a-9e7f-1a2b3c4d5e6f", 12)).toBe("3F2A9C1E-12");
    expect([ outcomeForSituation("worked"), outcomeForSituation("refused"), outcomeForSituation("closed"), outcomeForSituation("vacant") ]).toEqual([ 1, 2, 3, 3 ]);
    expect(measureQuantity(2.5, "2.00")).toBe("5.00");
    expect(measureQuantity(1.25, "0.33")).toBe("0.42");   // 0,4125 com teto em 2 casas (Q10)
    expect(measureQuantity(0.01, "0.10")).toBe("0.01");   // mínimo 0,01
    expect(measureQuantity(2, "12.50")).toBe("25.00");
    expect(measureQuantity(999, "999.99")).toBe("998990.01");
  });
});

describe("rascunho", () => {
  it("rascunho: vírgula vira número; horário vazio não vai; vínculo só na atividade dele; poda ao fechar", () => {
    const d: InspectionDraft = { ...emptyInspectionDraft(), activity: "li_t", situation: "worked", enteredAt: "", leftAt: "",
      measures: [ { method: "focal", productId: "pr1", charges: "1,5" } ], liraaDrawItemId: "li1" };
    expect(draftInput(d, TODAY35)).toMatchObject({ measures: [ { method: "focal", vector_product_id: "pr1", charges: 1.5 } ] });
    expect(draftInput(d, TODAY35)).not.toHaveProperty("entered_at");
    expect(draftInput(d, TODAY35)).not.toHaveProperty("liraa_draw_item_id");
    const out = pruneInspection({ ...fullDraft(), situation: "closed" });
    expect(out.draft.deposits).toEqual([]); expect(out.draft.samples).toEqual([]); expect(out.draft.educationalAction).toBe(false);
    expect(out.cleared).toEqual([ "depósitos", "medidas", "amostras", "ação educativa" ]);
  });

  it("o rascunho completo vira o boletim completo das fixtures", () => {
    expect(draftInput(fullDraft(), TODAY35)).toEqual(inspectionInput());
  });

  it("texto que não é número vira NaN e recusa no campo; vínculo da atividade vai", () => {
    const d: InspectionDraft = { ...fullDraft(), deposits: [ { group: "A2", existing: "", with_water: "2", with_larvae: "1", eliminated: "1", treated: "abc" } ] };
    expect(checkInspection(draftInput(d, TODAY35), base).filter((p) => p.error === "vector_inspection_invalid").map((p) => p.path))
      .toEqual([ "vector_inspection.deposits[0].existing", "vector_inspection.deposits[0].treated" ]);
    const linked: InspectionDraft = { ...fullDraft(), activity: "liraa", liraaDrawItemId: "li1", transmissionBlockId: "tb1", cityBlockId: "cb2", riskClass: "red" };
    expect(draftInput(linked, TODAY35)).toMatchObject({ liraa_draw_item_id: "li1", city_block_id: "cb2", risk_class: "red" });
    expect(draftInput(linked, TODAY35)).not.toHaveProperty("transmission_block_id");
  });

  it("poda: grupo sem larva perde as amostras dele; mecânico perde produto e cargas; nada a podar = nada dito", () => {
    const d: InspectionDraft = { ...fullDraft(),
      deposits: [ { group: "A2", existing: "3", with_water: "2", with_larvae: "0", eliminated: "1", treated: "1" } ],
      measures: [ { method: "mechanical", productId: "pr1", charges: "2" } ] };
    const out = pruneInspection(d);
    expect(out.draft.samples).toEqual([]);
    expect(out.draft.measures).toEqual([ { method: "mechanical", productId: null, charges: "" } ]);
    expect(out.cleared).toEqual([ "amostras do grupo A2", "produto e cargas da medida mecânica" ]);
    expect(pruneInspection(fullDraft())).toEqual({ draft: fullDraft(), cleared: [] });
  });

  it("rascunho vazio e o vindo de Imóveis a visitar", () => {
    expect(emptyInspectionDraft()).toEqual({ activity: null, workType: "routine", situation: null, educationalAction: false, enteredAt: "", leftAt: "",
      cityBlockId: null, riskClass: null, liraaDrawItemId: null, transmissionBlockId: null, deposits: [], measures: [], samples: [] });
    expect(emptyInspectionDraft({ activity: "liraa", workType: "pending", liraaDrawItemId: "li1" }))
      .toMatchObject({ activity: "liraa", workType: "pending", liraaDrawItemId: "li1", transmissionBlockId: null });
  });
});
