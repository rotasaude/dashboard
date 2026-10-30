import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  archLoc, canAddPlanItems, canUseDental, chartRows, compositionLabel, dentalApiProblems, dentalError, dentalFieldsFrom, dentalFinalizeProblems,
  dentalPayload, dentalProblemText, dentalRole, endoProblems, faceLayout, goalKeyLabel, labNameProblem, linkPlanItem, locationLabel, MOUTH, monthOf,
  nextStages, offeredKinds, percentLabel, perioProblems, planItemPathIndex, planItemsAfter, pregnantFor, quantityProblems, ratioLabel, reasonProblem,
  screeningProblems, sextantLoc, situationAbbr, situationLabel, situationsFor, situationTone, suggestCompleted, toggleSurveillance, toothAriaLabel,
  toothSextant, withFinding, withoutPlanChange, withPlanCancel
} from "./dental";
import type { DentalCheckCtx } from "./dental";
import { CEO_UNIT, DENTURE, FLUOR, RESIN, SCALING, SITUATIONS, UBS, dentalDraft, fields, plan, planItem, toothLoc } from "../test/dentalFixtures";

const ctx: DentalCheckCtx = { role: "dentist", baseline: false, sex: "female", problemsCount: 1 };
const codes = (f = fields(), c = ctx) => dentalFinalizeProblems(f, c).map((p) => p.code);

describe("portão e papel", () => {
  it("dental_care exige clinical_record; operador nunca", () => {
    expect(canUseDental({ operator: false, features: [ "dental_care", "clinical_record" ] })).toBe(true);
    expect(canUseDental({ operator: false, features: [ "dental_care" ] })).toBe(false);
    expect(canUseDental({ operator: true, features: [ "dental_care", "clinical_record" ] })).toBe(false);
  });
  it("papel pelo CBO; tipos oferecidos pelo options e pelo interruptor", () => {
    expect([ "223208", "223293", "322405", "322425", "322415", "322430", "322410", "225142", null ].map(dentalRole))
      .toEqual([ "dentist", "dentist", "auxiliary", "auxiliary", "auxiliary", "auxiliary", null, null, null ]);
    expect(offeredKinds(undefined, true)).toEqual([ "general" ]);
    expect(offeredKinds({ care_types: [], conducts: [], cid10_allowed_for_cbo: true, kinds: [ "general", "dental" ] }, false)).toEqual([ "general" ]);
    expect(offeredKinds({ care_types: [], conducts: [], cid10_allowed_for_cbo: true, kinds: [ "dental" ] }, true)).toEqual([ "dental" ]);
  });
});

describe("dentes, faces e locais", () => {
  it("linhas por dentição, na ordem da tela", () => {
    expect(chartRows("permanent").map((r) => [ r[0], r[7], r[8], r[15] ])).toEqual([ [ "18", "11", "21", "28" ], [ "48", "41", "31", "38" ] ]);
    expect(chartRows("deciduous")).toEqual([ [ "55", "54", "53", "52", "51", "61", "62", "63", "64", "65" ], [ "85", "84", "83", "82", "81", "71", "72", "73", "74", "75" ] ]);
    expect(chartRows("mixed").map((r) => r.length)).toEqual([ 16, 10, 10, 16 ]);
  });
  it("faces por quadrante: mesial sempre para o meio", () => {
    expect(faceLayout("16")).toEqual({ top: "V", bottom: "L", left: "D", right: "M" });
    expect(faceLayout("26")).toEqual({ top: "V", bottom: "L", left: "M", right: "D" });
    expect(faceLayout("36")).toEqual({ top: "L", bottom: "V", left: "M", right: "D" });
    expect(faceLayout("46")).toEqual({ top: "L", bottom: "V", left: "D", right: "M" });
    expect(faceLayout("84")).toEqual({ top: "L", bottom: "V", left: "D", right: "M" });
  });
  it("sextantes e rótulos de local", () => {
    expect([ "17", "13", "23", "24", "37", "33", "43", "44", "55", "63", "75", "84" ].map(toothSextant))
      .toEqual([ "S1", "S2", "S2", "S3", "S4", "S5", "S5", "S6", "S1", "S2", "S4", "S6" ]);
    expect([ toothLoc("16"), toothLoc("16", "O"), sextantLoc("S1"), archLoc("upper"), MOUTH ].map(locationLabel))
      .toEqual([ "dente 16", "dente 16, face oclusal/incisal", "sextante S1", "arcada superior", "boca toda" ]);
  });
  it("situações vêm do vocabulário; desconhecida aparece crua", () => {
    expect(situationLabel("caries", SITUATIONS, "face")).toBe("Cariado");
    expect(situationLabel("complete_denture", SITUATIONS)).toBe("Prótese total");
    expect(situationLabel("novo_codigo", SITUATIONS)).toBe("novo_codigo");
    expect(situationLabel("caries")).toBe("caries");
    expect([ situationAbbr("caries", SITUATIONS), situationAbbr("novo_codigo", SITUATIONS) ]).toEqual([ "CAR", "NOVO" ]);
    expect([ "caries", "extraction_indicated", "restored", "sound", "missing", "x" ].map(situationTone)).toEqual([ "down", "warn", "info", "ok", "neutral", "neutral" ]);
  });
  it("decíduo não recebe coroa de prótese; furca só em posteriores; face só o subconjunto", () => {
    const codesOf = (l: { code: string }[]) => l.map((o) => o.code);
    expect(codesOf(situationsFor("crown", SITUATIONS, "16"))).toContain("crown");
    for (const c of [ "crown", "abutment", "removable_partial_denture", "crown_unit_prosthesis", "temporary_prosthesis" ]) {
      expect(codesOf(situationsFor("crown", SITUATIONS, "55"))).not.toContain(c);
    }
    expect(codesOf(situationsFor("crown", SITUATIONS, "55"))).toContain("caries");
    expect(codesOf(situationsFor("root", SITUATIONS, "16"))).toContain("furcation_lesion");
    expect(codesOf(situationsFor("root", SITUATIONS, "13"))).not.toContain("furcation_lesion");
    expect(codesOf(situationsFor("root", SITUATIONS, "55"))).not.toContain("furcation_lesion");
    expect(codesOf(situationsFor("face", SITUATIONS, "16"))).not.toContain("sound");
    expect(codesOf(situationsFor("arch", SITUATIONS))).toEqual([ "complete_denture" ]);
  });
  it("rótulo do dente diz situação, raiz, faces e o que está marcado hoje", () => {
    expect(toothAriaLabel({ tooth: "16", situation: "sound", root: null, faces: { O: "caries", M: null }, last_event_at: null, notes_count: 0 }, "16", SITUATIONS, 1))
      .toBe("Dente 16: hígido; face oclusal/incisal: cariado; 1 marcação nesta consulta");
    expect(toothAriaLabel({ tooth: "26", situation: "sound", root: "endodontics", faces: {}, last_event_at: null, notes_count: 0 }, "26", SITUATIONS, 2))
      .toBe("Dente 26: hígido; raiz: endodontia; 2 marcações nesta consulta");
    expect(toothAriaLabel({ tooth: "36", situation: "implant_x", root: "none", faces: {}, last_event_at: null, notes_count: 0 }, "36", SITUATIONS)).toBe("Dente 36: implant_x");
    expect(toothAriaLabel(undefined, "55", SITUATIONS)).toBe("Dente 55: sem registro");
  });
  it("achado do mesmo dente, parte e face substitui o anterior; raiz e coroa convivem", () => {
    const f = withFinding(withFinding(fields(), { tooth: "16", face: "O", part: "crown", situation: "caries" }), { tooth: "16", face: "O", part: "crown", situation: "restored" });
    expect(f.findings).toEqual([ { tooth: "16", face: "O", part: "crown", situation: "restored" } ]);
    expect(withFinding(f, { tooth: "16", face: null, part: "root", situation: "endodontics" }).findings).toHaveLength(2);
  });
});

describe("limites por local", () => {
  const line = (ref: typeof RESIN, location = toothLoc("16"), quantity = 1) => ({ sigtap: ref.sigtap, name: ref.name, location, quantity, plan_item_id: null });
  it("limites por local: recusa sem cortar; dente e face somam juntos", () => {
    const seven = [ "S1", "S2", "S3", "S4", "S5", "S6", "S1" ].map((s) => line(SCALING, sextantLoc(s as "S1")));
    expect(quantityProblems(seven)).toEqual([ "RASPAGEM SUPRAGENGIVAL (POR SEXTANTE): no máximo 6 por sextante nesta consulta" ]);
    expect(quantityProblems([ line(DENTURE, archLoc("upper")), line(DENTURE, archLoc("lower")), line(DENTURE, archLoc("upper")) ]))
      .toEqual([ "PRÓTESE TOTAL MAXILAR: no máximo 2 por arcada nesta consulta" ]);
    expect(quantityProblems([ line(FLUOR, MOUTH), line(FLUOR, MOUTH) ])).toEqual([ "APLICAÇÃO TÓPICA DE FLÚOR (INDIVIDUAL POR SESSÃO): no máximo 1 por boca toda nesta consulta" ]);
    expect(quantityProblems([ line(RESIN, toothLoc("16"), 30), line(RESIN, toothLoc("26", "O"), 3) ]))
      .toEqual([ `${RESIN.name}: no máximo 32 por dente nesta consulta` ]);
    expect(quantityProblems([ line(RESIN, toothLoc("16"), 0), line(RESIN, toothLoc("17"), 1.5) ]))
      .toEqual([ `${RESIN.name}: a quantidade é um número inteiro a partir de 1` ]);
    expect(quantityProblems([ ...[ "S1", "S2", "S3", "S4", "S5", "S6" ].map((s) => line(SCALING, sextantLoc(s as "S1"))), line(RESIN, toothLoc("16", "O")) ])).toEqual([]);
  });
});

describe("finalização: espelho das recusas do api (contrato §4)", () => {
  const aux = { ...ctx, role: "auxiliary" as const };
  it.each([
    [ "vigilância vazia", fields({ oral_health_surveillance: [] }), ctx, [ "oral_health_surveillance_required" ] ],
    [ "agendada sem tipo", fields({ care_type: "2", dental_consultation_type: null }), ctx, [ "dental_consultation_type_required" ] ],
    [ "escuta com tipo", fields({ care_type: "4", dental_consultation_type: "4" }), ctx, [ "dental_consultation_type_forbidden" ] ],
    [ "no dia sem tipo", fields({ care_type: "5", dental_consultation_type: null }), ctx, [] ],
    [ "urgência e retorno", fields({ care_type: "6", dental_consultation_type: "2" }), ctx, [ "return_forbidden_on_urgency" ] ],
    [ "concluído na manutenção", fields({ dental_consultation_type: "4", dental_outcomes: [ "15" ] }), ctx, [ "completed_requires_first_or_return" ] ],
    [ "concluído no retorno", fields({ dental_consultation_type: "2", dental_outcomes: [ "15" ] }), ctx, [] ],
    [ "alta na primeira", fields({ dental_outcomes: [ "17" ] }), ctx, [ "discharge_forbidden_with_first_or_return" ] ],
    [ "sem desfecho", fields({ dental_outcomes: [] }), ctx, [ "dental_outcome_required" ] ],
    [ "sem tipo de atendimento", fields({ care_type: null, dental_consultation_type: null }), ctx, [ "care_type_required" ] ],
    [ "gestante vazia", fields({ pregnant: null }), ctx, [ "pregnant_required" ] ],
    [ "gestante no masculino", fields({ pregnant: true }), { ...ctx, sex: "male" as const }, [ "pregnant_forbidden_male" ] ],
    [ "sem problema", fields(), { ...ctx, problemsCount: 0 }, [ "problem_required" ] ],
    [ "auxiliar encaminha", fields({ dental_outcomes: [ "3" ] }), aux, [ "auxiliary_cannot_refer" ] ],
    [ "auxiliar planeja", fields({ plan_changes: { add: [ { sigtap: RESIN.sigtap, location: toothLoc("16") } ], cancel: [] } }), aux, [ "auxiliary_cannot_plan" ] ],
    [ "auxiliar cancela item", fields({ plan_changes: { add: [], cancel: [ { item_id: "pi1", reason: "paciente recusou o tratamento" } ] } }), aux, [ "auxiliary_cannot_plan" ] ],
    [ "registro inicial com procedimento", fields({ care_type: null, dental_consultation_type: null, dental_outcomes: [], oral_health_surveillance: [], pregnant: null,
      findings: [ { tooth: "16", face: null, part: "crown", situation: "caries" } ], procedures: [ { sigtap: FLUOR.sigtap, location: MOUTH, quantity: 1, plan_item_id: null } ] }),
      { ...ctx, baseline: true, problemsCount: 0 }, [ "baseline_only_findings" ] ],
    [ "registro inicial vazio", fields({ care_type: null, dental_consultation_type: null, dental_outcomes: [], oral_health_surveillance: [], pregnant: null }),
      { ...ctx, baseline: true, problemsCount: 0 }, [ "baseline_requires_findings" ] ]
  ])("%s", (_name, f, c, expected) => {
    expect(codes(f, c)).toEqual(expected);
  });
  it("todas de uma vez, com frase", () => {
    const out = dentalFinalizeProblems(fields({ care_type: "4", dental_consultation_type: "1", oral_health_surveillance: [], dental_outcomes: [ "15", "3" ], pregnant: null }),
      { ...ctx, role: "auxiliary", problemsCount: 0 });
    expect(out.map((p) => p.code)).toEqual([ "oral_health_surveillance_required", "dental_consultation_type_forbidden", "pregnant_required",
      "problem_required", "auxiliary_cannot_refer" ]);
    expect(out[0].text).toBe("marque a vigilância em saúde bucal (ou \"não identificado\")");
  });
  it("limite de quantidade entra nas recusas, uma por linha", () => {
    const f = fields({ procedures: [ { sigtap: FLUOR.sigtap, name: FLUOR.name, location: MOUTH, quantity: 1, plan_item_id: null },
      { sigtap: FLUOR.sigtap, name: FLUOR.name, location: MOUTH, quantity: 1, plan_item_id: null } ] });
    expect(dentalFinalizeProblems(f, ctx)).toEqual([ { code: "quantity_exceeds_location_limit", text: `${FLUOR.name}: no máximo 1 por boca toda nesta consulta` } ]);
  });
  it("gestante: obrigatória no feminino, nula no masculino", () => {
    expect(pregnantFor(fields({ pregnant: true }), "male")).toBeNull();
    expect(pregnantFor(fields({ pregnant: true }), "female")).toBe(true);
    expect(codes(fields({ pregnant: null }), { ...ctx, sex: "male" })).toEqual([]);
  });
  it("vigilância: 'não identificado' exclui os demais", () => {
    expect(toggleSurveillance([ "3" ], "99")).toEqual([ "99" ]);
    expect(toggleSurveillance([ "99" ], "3")).toEqual([ "3" ]);
    expect(toggleSurveillance([ "3", "6" ], "3")).toEqual([ "6" ]);
  });
});

describe("plano", () => {
  it("sugere concluído só sem item planejado depois do rascunho", () => {
    const p = plan({ items: [ planItem(), planItem({ id: "pi2", status: "done" }), planItem({ id: "pi3", status: "planned" }) ] });
    const linked = fields({ procedures: [ { sigtap: RESIN.sigtap, location: toothLoc("16", "O"), quantity: 1, plan_item_id: "pi1" } ] });
    expect(suggestCompleted(p, linked)).toBe(false);
    expect(suggestCompleted(p, { ...linked, plan_changes: { add: [], cancel: [ { item_id: "pi3", reason: "paciente recusou o tratamento" } ] } })).toBe(true);
    expect(suggestCompleted(p, { ...linked, plan_changes: { add: [ { sigtap: FLUOR.sigtap, location: MOUTH } ], cancel: [ { item_id: "pi3", reason: "paciente recusou o tratamento" } ] } })).toBe(false);
    expect(suggestCompleted(null, linked)).toBe(false);
    expect(suggestCompleted(plan({ items: [] }), fields())).toBe(false);
    expect(suggestCompleted(plan({ status: "completed" }), linked)).toBe(false);
  });
  it("estado de cada item depois do rascunho", () => {
    const p = plan({ items: [ planItem(), planItem({ id: "pi2", status: "done" }), planItem({ id: "pi3" }), planItem({ id: "pi4" }), planItem({ id: "pi5", status: "cancelled" }) ] });
    const f = withPlanCancel(linkPlanItem(fields({ procedures: [ { sigtap: RESIN.sigtap, location: toothLoc("16"), quantity: 1, plan_item_id: null } ] }), 0, "pi1"),
      { item_id: "pi3", reason: "paciente recusou o tratamento" });
    expect(planItemsAfter(p, f).map((x) => x.state)).toEqual([ "done_here", "done", "cancelled_here", "planned", "cancelled" ]);
    expect(withoutPlanChange(f, "cancel", 0).plan_changes.cancel).toEqual([]);
    expect(withPlanCancel(f, { item_id: "pi3", reason: "outro motivo suficiente" }).plan_changes.cancel).toHaveLength(1);
  });
  it("quem acrescenta item: dentista; na UBS sem plano só na primeira consulta; no CEO sempre", () => {
    expect(canAddPlanItems(UBS, plan(), fields({ dental_consultation_type: "2" }), "dentist")).toBe(true);
    expect(canAddPlanItems(UBS, null, fields({ dental_consultation_type: "2" }), "dentist")).toBe(false);
    expect(canAddPlanItems(UBS, null, fields({ dental_consultation_type: "1" }), "dentist")).toBe(true);
    expect(canAddPlanItems(CEO_UNIT, null, fields({ dental_consultation_type: null, care_type: "5" }), "dentist")).toBe(true);
    expect(canAddPlanItems(CEO_UNIT, plan(), fields(), "auxiliary")).toBe(false);
  });
});

describe("recusas do api, corpo e especialidades", () => {
  const e = (status: number, body: unknown) => new ApiError(status, body, "x");
  it("problems todos de uma vez; código novo cru; caminho do item do plano", () => {
    const err = e(422, { error: "oral_health_surveillance_required", problems: [ { path: "dental.oral_health_surveillance", error: "oral_health_surveillance_required" },
      { path: "dental.procedures[1].plan_item_id", error: "plan_item_not_open" }, { path: null, error: "brand_new_rule" } ] });
    expect(dentalApiProblems(err).map((p) => [ p.code, p.path ])).toEqual([ [ "oral_health_surveillance_required", "dental.oral_health_surveillance" ],
      [ "plan_item_not_open", "dental.procedures[1].plan_item_id" ], [ "brand_new_rule", null ] ]);
    expect(dentalApiProblems(err)[2].text).toBe("brand_new_rule");
    expect(dentalApiProblems(e(422, { error: "pregnant_required" })).map((p) => p.code)).toEqual([ "pregnant_required" ]);
    expect(dentalApiProblems(new Error("x"))).toEqual([]);
    expect(planItemPathIndex("dental.procedures[1].plan_item_id")).toBe(1);
    expect(planItemPathIndex("dental.findings[0]")).toBeNull();
  });
  it("frases do api: início, documento, encaminhamento e prótese", () => {
    expect(dentalError(e(403, { error: "feature_disabled", feature: "dental_care" }))).toBe("a saúde bucal está desligada nesta cidade");
    expect(dentalError(e(403, { error: "cbo_not_allowed" }))).toBe("seu CBO não registra consulta odontológica");
    expect(dentalError(e(422, { error: "baseline_requires_dentist" }))).toBe("só o dentista faz o registro inicial do odontograma");
    expect(dentalError(e(403, { error: "auxiliary_cannot_issue" }))).toBe("TSB e ASB não emitem documento");
    expect(dentalError(e(403, { error: "feature_disabled", feature: "clinical_record" }))).toBe("o prontuário está desligado nesta cidade");
    expect(dentalProblemText("dental_referral_request_required")).toBe("o encaminhamento ao CEO precisa do pedido de regulação da especialidade");
    expect(dentalProblemText("invalid_transition")).toBe("o pedido de prótese mudou de etapa — a lista foi relida");
    for (const code of [ "invalid_location", "invalid_procedure", "invalid_situation", "situation_not_allowed_for_tooth", "prosthesis_order_not_received",
      "prosthesis_order_mismatch", "installation_through_consultation", "reason_required", "unit_not_ceo" ]) {
      expect(dentalProblemText(code)).not.toBe(code);
    }
    expect(dentalProblemText("regulation_request_required")).toBe("regulation_request_required");
  });
  it("corpo sem nome e sem sugestão", () => {
    const f = fields({ procedures: [ { sigtap: RESIN.sigtap, name: RESIN.name, location: toothLoc("16"), quantity: 1, plan_item_id: null } ],
      plan_changes: { add: [ { sigtap: FLUOR.sigtap, name: FLUOR.name, location: MOUTH } ], cancel: [] } });
    expect(dentalPayload(f).procedures[0]).toEqual({ sigtap: RESIN.sigtap, location: toothLoc("16"), quantity: 1, plan_item_id: null });
    expect(dentalPayload(f).plan_changes.add[0]).toEqual({ sigtap: FLUOR.sigtap, location: MOUTH });
    const c = dentalDraft({ dental: { ...fields(), suggest_completed: true } });
    expect("suggest_completed" in dentalFieldsFrom(c)).toBe(false);
    expect(dentalFieldsFrom(dentalDraft({ dental: null })).dental_outcomes).toEqual([]);
  });
  it("periograma: faixa e inteiro, recusa sem cortar", () => {
    const site = (over = {}) => ({ site: "MV" as const, probing_depth_mm: 3, recession_mm: 0, bleeding: false, ...over });
    expect(perioProblems({ teeth: [ { tooth: "16", mobility: 1, furcation: null, sites: [ site(), site({ site: "V", probing_depth_mm: 21 }),
      site({ site: "DV", recession_mm: -11 }), site({ site: "ML", probing_depth_mm: 2.5 }) ] }, { tooth: "26", mobility: 4, furcation: 0, sites: [] } ] }))
      .toEqual([ "dente 16, sítio V: profundidade de sondagem de 0 a 20 mm", "dente 16, sítio DV: recessão de -10 a 20 mm",
        "dente 16, sítio ML: profundidade de sondagem em milímetros inteiros", "dente 26: mobilidade de 0 a 3" ]);
  });
  it("triagem periodontal e endodontia", () => {
    expect(screeningProblems({ sextants: [ { sextant: "S1", code: 4, star: true }, { sextant: "S2", code: null, star: false }, { sextant: "S3", code: 5, star: false } ] }))
      .toEqual([ "sextante S3: o código vai de 0 a 4 (ou marque o sextante como excluído)" ]);
    expect(endoProblems([ { tooth: "16", canals: 3, status: "in_progress" }, { tooth: "26", canals: 6, status: "in_progress" }, { tooth: "16", canals: 1, status: "completed" } ]))
      .toEqual([ "dente 26: canais de 1 a 5", "dente 16: tratamento repetido" ]);
  });
  it("prótese, textos e painéis", () => {
    expect([ "impression", "sent", "received", "installed", "cancelled" ].map(nextStages))
      .toEqual([ [ "sent", "cancelled" ], [ "received", "cancelled" ], [ "cancelled" ], [], [] ]);
    expect([ reasonProblem("curto"), reasonProblem("motivo com tamanho bom"), reasonProblem("x".repeat(501)) ]).toEqual([ "o motivo precisa de 10 a 500 caracteres", null, "o motivo precisa de 10 a 500 caracteres" ]);
    expect([ labNameProblem("ab"), labNameProblem("Lab Sorriso"), labNameProblem("x".repeat(121)) ].map((x) => x === null)).toEqual([ false, true, false ]);
    expect([ ratioLabel(17, 40), ratioLabel(0, 0), ratioLabel(1, 3), ratioLabel(5, null) ]).toEqual([ "42,5%", "—", "33,3%", "—" ]);
    expect([ percentLabel("62.00"), percentLabel("10.00"), percentLabel(null) ]).toEqual([ "62,0%", "10,0%", "—" ]);
    expect([ compositionLabel("three_roots_min_20") === "three_roots_min_20", compositionLabel("restorations_min_50") === "restorations_min_50", compositionLabel("multirooted_min_20") ])
      .toEqual([ false, false, "multirooted_min_20" ]);
    expect([ goalKeyLabel("oral_surgery"), goalKeyLabel("novo") ]).toEqual([ "Cirurgia oral", "novo" ]);
    expect(monthOf("2026-10-30")).toBe("2026-10");
  });
});
