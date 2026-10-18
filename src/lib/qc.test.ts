// src/lib/qc.test.ts
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import {
  EMPTY_EQA_ITEM, EMPTY_EQA_ROUND, EMPTY_INSTRUMENT, EMPTY_TARGET, QC_DISABLED, adequacyRate, analyteName, decimalProblem, eqaBody, eqaProblem,
  fmtDecimal, fmtZ, instrumentBody, instrumentDraft, instrumentProblem, ljBands, ljModel, lotBody, lotProblem, materialBody, materialDraft,
  materialProblem, parseLevels, qcError, qcValueProblem, reasonProblem, refreshQc, ruleLabel, rulesProblem, rulesText, sdLabel, suggestAdequacy,
  targetBody, targetProblem, turnedOff
} from "./qc";
import { DOT_IN_NUMBER } from "./lab";
import { CHOL_EXAM, GLU_EXAM, instrument, qcChart, qcMaterial } from "../test/qcFixtures";

const ALL_ON = { "1_2s": true, "1_3s": true, "2_2s": true, "R_4s": true, "4_1s": true, "10x": true } as const;
const err = (status: number, body: Record<string, unknown>) => new ApiError(status, body, "x");

describe("rótulos", () => {
  it("regras de Westgard com o aviso marcado; desconhecida sai crua", () => {
    expect(ruleLabel("1_2s")).toBe("1-2s (aviso)");
    expect(ruleLabel("R_4s")).toBe("R-4s");
    expect(rulesText([ "2_2s", "10x", "9_9s" ])).toBe("2-2s, 10x, 9_9s");
  });

  it("nome do analito vem do exame; sem exame, a chave", () => {
    expect(analyteName([ GLU_EXAM, CHOL_EXAM ], "le2", "hdl")).toBe("HDL (Colesterol total e frações)");
    expect(analyteName([ GLU_EXAM ], "le9", "tsh")).toBe("tsh");
  });
});

describe("números com vírgula", () => {
  it("decimal: vírgula aceita, ponto recusado, negativo só quando permitido, dp > 0", () => {
    expect(decimalProblem("98,5", "a média")).toBeNull();
    expect(decimalProblem("98.5", "a média")).toBe(DOT_IN_NUMBER);
    expect(decimalProblem("", "a média")).toBe("informe a média");
    expect(decimalProblem("abc", "a média")).toBe("a média: use dígitos e vírgula");
    expect(decimalProblem("-1,2", "a média")).toBe("a média não pode ser negativa");
    expect(decimalProblem("-1,2", "a média", { allowNegative: true })).toBeNull();
    expect(decimalProblem("0", "o desvio-padrão", { positive: true })).toBe("o desvio-padrão precisa ser maior que zero");
    expect(qcValueProblem("-0,3")).toBeNull();
    expect(qcValueProblem("2.5")).toBe(DOT_IN_NUMBER);
  });

  it("até 9 dígitos inteiros e 4 casas, como o api (C-E9)", () => {
    expect(decimalProblem("123456789,1234", "o valor")).toBeNull();
    expect(decimalProblem("1234567890", "o valor")).toBe("o valor: no máximo 9 dígitos antes da vírgula e 4 depois");
    expect(decimalProblem("1,23456", "o valor")).toBe("o valor: no máximo 9 dígitos antes da vírgula e 4 depois");
    expect(qcValueProblem("1,23456")).toBe("o valor: no máximo 9 dígitos antes da vírgula e 4 depois");
  });

  it("texto livre: mínimo de 10 e máximo de 1000 (ou o limite dado)", () => {
    expect(reasonProblem("curto", "o motivo")).toBe("escreva o motivo (ao menos 10 caracteres)");
    expect(reasonProblem("a".repeat(1000), "o motivo")).toBeNull();
    expect(reasonProblem("a".repeat(1001), "o motivo")).toBe("o motivo: no máximo 1000 caracteres");
    expect(reasonProblem("a".repeat(501), "a ação", 500)).toBe("a ação: no máximo 500 caracteres");
  });

  it("formatos de tela (decimais do api não têm zero à direita)", () => {
    expect(fmtDecimal("98.5")).toBe("98,5");
    expect(fmtDecimal("98")).toBe("98");
    expect(fmtDecimal(2.5)).toBe("2,5");
    expect(fmtZ(2.34)).toBe("+2,3");
    expect(fmtZ(-0.5)).toBe("-0,5");
    expect(fmtZ(0)).toBe("0,0");
    expect(fmtZ(null)).toBe("—");
  });
});

describe("aparelho", () => {
  const ok = { ...EMPTY_INSTRUMENT, name: "BS-200", sector: "biochemistry", hl7EquipmentId: "BS200-01" };
  it("valida nome, setor, identificador HL7 (OBX-18, até 50) e tamanhos (recusa, não corta)", () => {
    expect(instrumentProblem(ok)).toBeNull();
    expect(instrumentProblem({ ...ok, name: " " })).toBe("informe o nome do aparelho");
    expect(instrumentProblem({ ...ok, name: "x".repeat(81) })).toBe("nome com até 80 caracteres");
    expect(instrumentProblem({ ...ok, manufacturer: "x".repeat(81) })).toBe("fabricante com até 80 caracteres");
    expect(instrumentProblem({ ...ok, model: "x".repeat(81) })).toBe("modelo com até 80 caracteres");
    expect(instrumentProblem({ ...ok, sector: "" })).toBe("escolha o setor");
    expect(instrumentProblem({ ...ok, hl7EquipmentId: "BS 200" })).toBe("identificador HL7 (OBX-18) com até 50 letras, números, ponto, hífen ou _");
    expect(instrumentProblem({ ...ok, hl7EquipmentId: "A".repeat(50) })).toBeNull();
    expect(instrumentProblem({ ...ok, hl7EquipmentId: "A".repeat(51) })).toBe("identificador HL7 (OBX-18) com até 50 letras, números, ponto, hífen ou _");
    expect(instrumentProblem({ ...ok, serialNumber: "x".repeat(60) })).toBeNull();
    expect(instrumentProblem({ ...ok, serialNumber: "x".repeat(61) })).toBe("número de série com até 60 caracteres");
  });
  it("corpo: HL7 vazio vira null", () => {
    expect(instrumentBody({ ...ok, hl7EquipmentId: " " }, "pv9")).toEqual({
      provider_id: "pv9", name: "BS-200", manufacturer: "", model: "", serial_number: "", sector: "biochemistry", hl7_equipment_id: null, active: true
    });
  });
  it("rascunho aguenta os null do api", () => {
    const d = instrumentDraft(instrument({ manufacturer: null, model: null, serial_number: null, hl7_equipment_id: null }));
    expect(d).toMatchObject({ manufacturer: "", model: "", serialNumber: "", hl7EquipmentId: "" });
    expect(instrumentProblem(d)).toBeNull();
  });
});

describe("material e lote", () => {
  const base = { name: "Controle bioquímico", manufacturer: "Controllab", levels: "normal; patológico", analytes: [ "le1:glicose" ], active: true };

  it("níveis: separados por ponto e vírgula, de 1 a 6, sem repetir", () => {
    expect(parseLevels(" normal ; patológico;; ")).toEqual([ "normal", "patológico" ]);
    expect(materialProblem(base)).toBeNull();
    expect(materialProblem({ ...base, levels: "" })).toBe("informe de 1 a 6 níveis separados por ponto e vírgula");
    expect(materialProblem({ ...base, levels: "normal; Normal" })).toBe("níveis repetidos");
    expect(materialProblem({ ...base, analytes: [] })).toBe("escolha ao menos um analito");
    expect(materialBody(base, "pv9")).toEqual({
      provider_id: "pv9", name: "Controle bioquímico", manufacturer: "Controllab", levels: [ "normal", "patológico" ],
      analytes: [ { lab_exam_id: "le1", analyte_key: "glicose" } ], active: true
    });
  });

  it("nome e fabricante até 80; fabricante null do api vira vazio no rascunho", () => {
    expect(materialProblem({ ...base, name: "x".repeat(81) })).toBe("nome com até 80 caracteres");
    expect(materialProblem({ ...base, manufacturer: "x".repeat(81) })).toBe("fabricante com até 80 caracteres");
    const d = materialDraft(qcMaterial({ manufacturer: null }));
    expect(d.manufacturer).toBe("");
    expect(materialProblem(d)).toBeNull();
  });

  it("a mesma chave de analito em dois exames é recusada (C-E12)", () => {
    expect(materialProblem({ ...base, analytes: [ "le1:glicose", "le2:glicose" ] })).toBe("a mesma chave de analito não pode entrar em dois exames");
    expect(materialProblem({ ...base, analytes: [ "le1:glicose", "le2:hdl" ] })).toBeNull();
  });

  it("com lote, os níveis ficam travados e nenhum analito sai", () => {
    const original = qcMaterial({ has_lots: true, analytes: [ { lab_exam_id: "le1", analyte_key: "glicose" } ] });
    expect(materialProblem(base, original)).toBeNull();
    expect(materialProblem({ ...base, analytes: [ "le1:glicose", "le2:hdl" ] }, original)).toBeNull();
    expect(materialProblem({ ...base, levels: "normal" }, original)).toBe("o material já tem lote: os níveis não mudam");
    expect(materialProblem({ ...base, analytes: [ "le2:hdl" ] }, original)).toBe("o material já tem lote: nenhum analito pode sair");
    expect(materialProblem({ ...base, levels: "normal" }, { ...original, has_lots: false })).toBeNull();
  });

  it("lote: validade, um código por nível e códigos distintos", () => {
    const levels = [ "normal", "patológico" ];
    const d = { materialId: "qm1", lotNumber: "L2026A", expiresOn: "2027-03-31", barcodes: { normal: "QC-N1", "patológico": "QC-P1" } };
    expect(lotProblem(d, levels, "2026-10-18")).toBeNull();
    expect(lotProblem({ ...d, expiresOn: "2026-10-17" }, levels, "2026-10-18")).toBe("lote vencido — confira a validade");
    expect(lotProblem({ ...d, barcodes: { normal: "QC-N1" } }, levels, "2026-10-18")).toBe("informe o código de barras do nível patológico");
    expect(lotProblem({ ...d, barcodes: { normal: "QC-N1", "patológico": "qc-n1" } }, levels, "2026-10-18")).toBe("cada nível precisa de um código de barras diferente");
    expect(lotProblem({ ...d, lotNumber: "x".repeat(41) }, levels, "2026-10-18")).toBe("número do lote com até 40 caracteres");
    expect(lotBody({ ...d, barcodes: { ...d.barcodes, antigo: "QC-X" } }, levels)).toEqual({
      material_id: "qm1", lot_number: "L2026A", expires_on: "2027-03-31", level_barcodes: { normal: "QC-N1", "patológico": "QC-P1" }
    });
  });

  it("código de barras do controle: 3 a 30 com ponto, hífen ou _; só 10 dígitos é das amostras", () => {
    const levels = [ "normal" ];
    const d = { materialId: "qm1", lotNumber: "L1", expiresOn: "2027-03-31", barcodes: { normal: "QC.N_1-a" } };
    const phrase = "código do nível normal: 3 a 30 letras, números, ponto, hífen ou _";
    expect(lotProblem(d, levels, "2026-10-18")).toBeNull();
    expect(lotProblem({ ...d, barcodes: { normal: "AB1" } }, levels, "2026-10-18")).toBeNull();
    expect(lotProblem({ ...d, barcodes: { normal: "AB" } }, levels, "2026-10-18")).toBe(phrase);
    expect(lotProblem({ ...d, barcodes: { normal: "A".repeat(31) } }, levels, "2026-10-18")).toBe(phrase);
    expect(lotProblem({ ...d, barcodes: { normal: "N 1" } }, levels, "2026-10-18")).toBe(phrase);
    expect(lotProblem({ ...d, barcodes: { normal: "1234567890" } }, levels, "2026-10-18"))
      .toBe("código do nível normal: não pode ter só 10 dígitos (esse formato é o das amostras)");
    expect(lotProblem({ ...d, barcodes: { normal: "12345678901" } }, levels, "2026-10-18")).toBeNull();
  });
});

describe("referência e regras", () => {
  const t = { ...EMPTY_TARGET, level: "normal", analyteKey: "glicose", instrumentId: "in1", mean: "98", sd: "2,5" };
  it("referência da bula: média e dp com vírgula; trocar a vigente pede motivo", () => {
    expect(targetProblem(t, false)).toBeNull();
    expect(targetProblem({ ...t, sd: "0" }, false)).toBe("o desvio-padrão precisa ser maior que zero");
    expect(targetProblem({ ...t, mean: "98,12345" }, false)).toBe("a média: no máximo 9 dígitos antes da vírgula e 4 depois");
    expect(targetProblem(t, true)).toBe("escreva o motivo da troca da referência (ao menos 10 caracteres)");
    expect(targetProblem({ ...t, reason: "a".repeat(1001) }, true)).toBe("o motivo da troca da referência: no máximo 1000 caracteres");
    expect(targetBody({ ...t, reason: "bula do lote novo" }, "ql1", true)).toEqual({
      lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1", mean: "98", sd: "2.5", reason: "bula do lote novo"
    });
    expect(targetBody(t, "ql1", false)).not.toHaveProperty("reason");
  });

  it("regras: desligar pede justificativa; ligar não", () => {
    const off = { ...ALL_ON, "4_1s": false };
    expect(turnedOff(ALL_ON, off)).toEqual([ "4_1s" ]);
    expect(rulesProblem(ALL_ON, off, "curto")).toBe("escreva a justificativa para desligar 4-1s (ao menos 10 caracteres)");
    expect(rulesProblem(ALL_ON, off, "aparelho em validação, 4-1s gera falso alarme")).toBeNull();
    expect(rulesProblem(ALL_ON, off, "a".repeat(1001))).toBe("a justificativa para desligar 4-1s: no máximo 1000 caracteres");
    expect(rulesProblem(off, ALL_ON, "")).toBeNull();
  });
});

describe("Levey-Jennings", () => {
  it("troca de versão vira marca na série e aviso de versões misturadas", () => {
    const m = ljModel(qcChart());
    expect(m.rows.map((r) => r.n)).toEqual([ 1, 2, 3, 4, 5, 6 ]);
    expect(m.rows[2]).toMatchObject({ z: 2.4, outcome: "reject", rules: [ "2_2s" ], version: 1 });
    expect(m.versionChanges).toEqual([ { n: 5, version: 2 } ]);
    expect(m.mixedVersions).toBe(true);
    expect(m.flagged.map((r) => r.n)).toEqual([ 2, 3 ]);
    expect(m.domain).toEqual([ -4, 4 ]);
  });

  it("ponto além de 4 dp abre o eixo; uma versão só não avisa", () => {
    const one = qcChart({ points: [ { at: "2026-10-18T07:00:00-03:00", value: "112", z_score: -5.6, outcome: "reject", rules_fired: [ "1_3s" ], target_version: 2 } ] });
    const m = ljModel(one);
    expect(m.domain).toEqual([ -7, 7 ]);
    expect(m.mixedVersions).toBe(false);
    expect(m.versionChanges).toEqual([]);
  });

  it("sem referência vigente (target null) e sem pontos não quebra", () => {
    const m = ljModel(qcChart({ target: null, points: [] }));
    expect(m.rows).toEqual([]);
    expect(m.domain).toEqual([ -4, 4 ]);
    expect(m.mixedVersions).toBe(false);
  });

  it("faixas em unidades do analito, com as casas da referência", () => {
    expect(ljBands({ mean: "98", sd: "2.5" }).map((b) => `${b.label}=${b.value}`)).toEqual([
      "+3 dp=105,5", "+2 dp=103,0", "+1 dp=100,5", "média=98,0", "-1 dp=95,5", "-2 dp=93,0", "-3 dp=90,5"
    ]);
    expect(ljBands({ mean: "98", sd: "2" }).map((b) => b.value)).toEqual([ "104", "102", "100", "98", "96", "94", "92" ]);
    expect(sdLabel(-2)).toBe("-2 dp");
  });
});

describe("CEQ", () => {
  const item = { ...EMPTY_EQA_ITEM, token: "le1:glicose", submitted: "101", target: "100", low: "94", high: "106", adequacy: "adequate" as const };
  const round = { ...EMPTY_EQA_ROUND, program: "PNCQ" as const, roundCode: "2026-03", roundDate: "2026-09-20", items: [ item ] };

  it("sugere a adequação pelos limites aceitáveis", () => {
    expect(suggestAdequacy(item)).toBe("adequate");
    expect(suggestAdequacy({ ...item, submitted: "107" })).toBe("inadequate");
    expect(suggestAdequacy({ ...item, low: "" })).toBe("");
  });

  it("inadequado sem ação, data no futuro e programa 'outro' sem nome são recusados", () => {
    expect(eqaProblem(round, "2026-10-18")).toBeNull();
    expect(eqaProblem({ ...round, items: [ { ...item, adequacy: "inadequate" } ] }, "2026-10-18")).toBe("item 1: escreva a ação para o resultado inadequado (ao menos 10 caracteres)");
    expect(eqaProblem({ ...round, roundDate: "2026-10-19" }, "2026-10-18")).toBe("a data da rodada não pode ser no futuro");
    expect(eqaProblem({ ...round, program: "outro", programOther: "" }, "2026-10-18")).toBe("informe o nome do programa");
    expect(eqaProblem({ ...round, items: [ { ...item, low: "106", high: "94" } ] }, "2026-10-18")).toBe("item 1: o limite inferior é maior que o superior");
  });

  it("limites do api: ação até 500, programa até 60, código até 40, analito sem repetir", () => {
    expect(eqaProblem({ ...round, items: [ { ...item, adequacy: "inadequate", action: "a".repeat(500) } ] }, "2026-10-18")).toBeNull();
    expect(eqaProblem({ ...round, items: [ { ...item, adequacy: "inadequate", action: "a".repeat(501) } ] }, "2026-10-18"))
      .toBe("item 1: a ação para o resultado inadequado: no máximo 500 caracteres");
    expect(eqaProblem({ ...round, program: "outro", programOther: "p".repeat(61) }, "2026-10-18")).toBe("nome do programa com até 60 caracteres");
    expect(eqaProblem({ ...round, roundCode: "c".repeat(41) }, "2026-10-18")).toBe("código da rodada com até 40 caracteres");
    expect(eqaProblem({ ...round, items: [ item, item ] }, "2026-10-18")).toBe("item 2: este analito já está na rodada");
    expect(eqaProblem({ ...round, items: [ { ...item, submitted: "1,23456" } ] }, "2026-10-18"))
      .toBe("item 1: o valor enviado: no máximo 9 dígitos antes da vírgula e 4 depois");
  });

  it("corpo com decimais em ponto, programa escolhido e sem relatório anual (C-E24)", () => {
    const body = eqaBody(round, "pv9");
    expect(body).toEqual({
      provider_id: "pv9", program: "PNCQ", round_code: "2026-03", round_date: "2026-09-20",
      items: [ { lab_exam_id: "le1", analyte_key: "glicose", submitted: "101", target: "100", acceptable_low: "94", acceptable_high: "106", adequacy: "adequate", action: null } ]
    });
    expect(body).not.toHaveProperty("annual_report_upload_id");
    expect(eqaBody({ ...round, items: [ { ...item, submitted: "101,5", low: "", high: "" } ] }, "pv9").items[0])
      .toMatchObject({ submitted: "101.5", acceptable_low: null, acceptable_high: null });
    expect(eqaBody({ ...round, program: "outro", programOther: "Programa estadual" }, "pv9").program).toBe("Programa estadual");
  });

  it("taxa de adequação com uma casa e vírgula", () => {
    expect(adequacyRate({ analyte_key: "glicose", lab_exam_id: "le1", rounds: 3, adequate: 2, inadequate: 1 })).toBe("66,7%");
    expect(adequacyRate({ analyte_key: "glicose", lab_exam_id: "le1", rounds: 0, adequate: 0, inadequate: 0 })).toBe("—");
  });
});

describe("recusas", () => {
  it("interruptor do CIQ, códigos do 21c e o resto pelo 21b", () => {
    expect(qcError(err(403, { error: "feature_disabled", feature: "lab_quality_control" }))).toBe(QC_DISABLED);
    expect(qcError(err(422, { error: "no_target" }))).toBe("este nível e analito ainda não têm referência neste aparelho — cadastre a da bula em Controles e referências");
    expect(qcError(err(422, { error: "barcode_taken" }))).toBe("este código de barras já está em outro lote de controle ou numa amostra");
    expect(qcError(err(409, { error: "invalid_transition" }))).toBe("a situação mudou — a tela foi atualizada");
  });

  it("corrective_action_required é aviso (notice), não recusa: não tem frase de erro", () => {
    expect(qcError(err(422, { error: "corrective_action_required" }))).toBe("não foi possível concluir (422: corrective_action_required) — tente de novo");
  });

  it("códigos novos têm frase própria, sem cair na de 'etiqueta ou requisição'", () => {
    const codes = [
      "not_found", "duplicate_name", "invalid_instrument", "invalid_period", "invalid_date", "filter_required", "invalid_year", "already_recorded",
      "invalid_file", "duplicate_round", "duplicate_lot", "invalid_version", "conflict", "mfa_required", "invalid_barcode", "duplicate_analyte_key",
      "invalid_analytes", "invalid_reason", "invalid_note", "invalid_text", "invalid_items", "invalid_program", "invalid_round_code", "invalid_round_date"
    ];
    const phrases = codes.map((c) => qcError(err(422, { error: c })));
    for (const [ i, p ] of phrases.entries()) {
      expect(p, codes[i]).not.toMatch(/^não foi possível concluir/);
      expect(p, codes[i]).not.toContain("etiqueta ou requisição");
    }
    expect(qcError(err(404, { error: "not_found" }))).toBe("não encontrado neste laboratório — a tela foi atualizada");
    expect(qcError(err(409, { error: "already_recorded" }))).toBe("este programa já tem relatório anual neste ano");
    expect(qcError(err(422, { error: "invalid_items" }))).toContain("numéric");
    expect(qcError(err(422, { error: "invalid_analytes" }))).toContain("numéric");
    expect(qcError(err(422, { error: "invalid_year" }))).toContain("ano");
  });

  it("refreshQc invalida todas as chaves do CIQ e do CEQ", async () => {
    const client = { invalidateQueries: vi.fn((_arg: { queryKey: string[] }) => Promise.resolve()) };
    await refreshQc(client as never);
    const keys = client.invalidateQueries.mock.calls.map(([ arg ]) => arg.queryKey[0]);
    expect(keys).toContain("qcRuns");
    expect(keys).toContain("qcBlockCount");
    expect(keys).toContain("eqaRounds");
  });
});
