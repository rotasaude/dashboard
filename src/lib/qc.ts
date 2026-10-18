// src/lib/qc.ts
// Controle de qualidade do laboratório municipal (módulo 21c, ADR 0038;
// contrato 2026-10-18 §1–§4). Regras de tela, puras: rótulos, números com
// vírgula, validação dos formulários, o modelo do Levey-Jennings e as frases
// das recusas. A avaliação de Westgard, o bloqueio e quem é RT são do api.
// Limites e formatos seguem o api (save_instrument, save_material, create_lot,
// record_round, qc/decimal.rb), não o plano: a tela recusa antes do envio, com
// a mesma regra, e nunca corta o que o usuário digitou.
import type { QueryClient } from "@tanstack/react-query";
import {
  errorCode,
  type EqaAdequacy, type EqaRoundInput, type EqaSummaryRow, type LabExamRef, type LabInstrument, type LabInstrumentInput, type QcAnalyteRef,
  type QcChart, type QcLotInput, type QcMaterial, type QcMaterialInput, type QcRule, type QcTargetInput
} from "./api";
import { featureDisabledKey } from "./features";
import { DOT_IN_NUMBER, SECTOR_LABEL, hasDot, labError, normalizeNumber } from "./lab";
import type { Tone } from "../theme/tokens";

export const QC_INSTRUMENTS_KEY = "qcInstruments";
export const QC_MATERIALS_KEY = "qcMaterials";
export const QC_LOTS_KEY = "qcLots";
export const QC_TARGETS_KEY = "qcTargets";
export const QC_SUGGESTIONS_KEY = "qcSuggestions";
export const QC_RUNS_KEY = "qcRuns";
export const QC_CHART_KEY = "qcChart";
export const QC_RULES_KEY = "qcRules";
export const QC_BLOCKS_KEY = "qcBlocks";
export const QC_BLOCK_COUNT_KEY = "qcBlockCount";
export const QC_REVIEWS_KEY = "qcReviews";
export const QC_EXCEPTIONS_KEY = "qcExceptions";
export const QC_EXAMS_KEY = "qcExams";
export const EQA_ROUNDS_KEY = "eqaRounds";
export const EQA_SUMMARY_KEY = "eqaSummary";

// QC_EXAMS_KEY fica de fora: é a lista de exames (catálogo), que nenhuma escrita do CIQ/CEQ altera.
const QC_KEYS = [
  QC_INSTRUMENTS_KEY, QC_MATERIALS_KEY, QC_LOTS_KEY, QC_TARGETS_KEY, QC_SUGGESTIONS_KEY, QC_RUNS_KEY, QC_CHART_KEY, QC_RULES_KEY,
  QC_BLOCKS_KEY, QC_BLOCK_COUNT_KEY, QC_REVIEWS_KEY, QC_EXCEPTIONS_KEY, EQA_ROUNDS_KEY, EQA_SUMMARY_KEY
];

export const QC_DISABLED = "o controle de qualidade do laboratório está desligado nesta cidade";
export const INSTRUMENTS_DISABLED = "o controle de qualidade e o estoque do laboratório estão desligados nesta cidade";
export const QC_LEAD_ONLY = "só o administrador ou o responsável técnico (ou o substituto) cadastra materiais, lotes, referências e regras";
export const RT_ONLY = "só o responsável técnico ou o substituto faz isto";
export const REASON_MIN = 10;
// Texto livre do 21c (motivo, justificativa, nota, ação corretiva): o api recusa acima de 1000; a ação do CEQ, acima de 500.
export const TEXT_MAX = 1000;
export const EQA_ACTION_MAX = 500;

const RULE_LABEL: Record<string, string> = { "1_2s": "1-2s (aviso)", "1_3s": "1-3s", "2_2s": "2-2s", "R_4s": "R-4s", "4_1s": "4-1s", "10x": "10x" };
export function ruleLabel(r: string): string { return RULE_LABEL[r] ?? r; }
export function rulesText(rules: string[]): string { return rules.map(ruleLabel).join(", "); }

const RUN_STATUS: Record<string, string> = { open: "aberta", approved: "aprovada", warning: "aprovada com aviso", rejected: "reprovada" };
const RUN_TONE: Record<string, Tone> = { open: "info", approved: "ok", warning: "warn", rejected: "down" };
export function runStatusLabel(s: string): string { return RUN_STATUS[s] ?? s; }
export function runStatusTone(s: string): Tone | undefined { return RUN_TONE[s]; }

const OUTCOME: Record<string, string> = { ok: "ok", warning: "aviso", reject: "reprovado" };
const OUTCOME_TONE: Record<string, Tone> = { ok: "ok", warning: "warn", reject: "down" };
export function outcomeLabel(s: string): string { return OUTCOME[s] ?? s; }
export function outcomeTone(s: string): Tone | undefined { return OUTCOME_TONE[s]; }

const SOURCE: Record<string, string> = { package_insert: "bula", laboratory: "laboratório" };
export function targetSourceLabel(s: string): string { return SOURCE[s] ?? s; }

const DECISION: Record<string, string> = { pending: "pendente", kept: "mantido", rectify: "a retificar" };
export function reviewDecisionLabel(s: string): string { return DECISION[s] ?? s; }

const ADEQUACY: Record<string, string> = { adequate: "adequado", inadequate: "inadequado" };
export function adequacyLabel(s: string): string { return ADEQUACY[s] ?? s; }
export function adequacyTone(s: string): Tone | undefined { return s === "adequate" ? "ok" : s === "inadequate" ? "down" : undefined; }

const LOT_STATUS: Record<string, string> = { in_use: "em uso", closed: "encerrado" };
export function lotStatusLabel(s: string): string { return LOT_STATUS[s] ?? s; }

export function analyteName(exams: LabExamRef[], examId: string, key: string): string {
  const exam = exams.find((e) => e.id === examId);
  const analyte = exam?.analytes?.find((a) => a.key === key);
  return exam && analyte ? `${analyte.name} (${exam.name})` : key;
}

// ─── números ───
export function fmtDecimal(raw: string | number): string { return String(raw).replace(".", ","); }
export function decimalsOf(raw: string | number): number { return (String(raw).split(".")[1] ?? "").length; }
export function fmtZ(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return "—";
  const t = Math.abs(z).toFixed(1).replace(".", ",");
  return z > 0.04 ? `+${t}` : z < -0.04 ? `-${t}` : t;
}

// C-E9: o api aceita até 9 dígitos inteiros e 4 casas (qc/decimal.rb); a tela recusa o resto antes do envio.
const API_DECIMAL = /^-?\d{1,9}(\.\d{1,4})?$/;

export function decimalProblem(raw: string, label: string, opts: { positive?: boolean; allowNegative?: boolean } = {}): string | null {
  const t = raw.trim();
  if (t === "") return `informe ${label}`;
  if (hasDot(t)) return DOT_IN_NUMBER;
  const n = normalizeNumber(t);
  if (n === null) return `${label}: use dígitos e vírgula`;
  if (!API_DECIMAL.test(n)) return `${label}: no máximo 9 dígitos antes da vírgula e 4 depois`;
  if (!opts.allowNegative && n.startsWith("-")) return `${label} não pode ser negativ${label.startsWith("a ") ? "a" : "o"}`;
  if (opts.positive && Number(n) <= 0) return `${label} precisa ser maior que zero`;
  return null;
}

export function reasonProblem(text: string, what: string, max: number = TEXT_MAX): string | null {
  const t = text.trim();
  if (t.length < REASON_MIN) return `escreva ${what} (ao menos ${REASON_MIN} caracteres)`;
  return t.length > max ? `${what}: no máximo ${max} caracteres` : null;
}

const tooLong = (value: string, max: number, label: string) => (value.trim().length > max ? `${label} com até ${max} caracteres` : null);

// ─── aparelho ───
export interface InstrumentDraft { name: string; manufacturer: string; model: string; serialNumber: string; sector: string; hl7EquipmentId: string; active: boolean }
export const EMPTY_INSTRUMENT: InstrumentDraft = { name: "", manufacturer: "", model: "", serialNumber: "", sector: "", hl7EquipmentId: "", active: true };

// O api manda null em fabricante, modelo, série e HL7 vazios.
export function instrumentDraft(i: LabInstrument): InstrumentDraft {
  return {
    name: i.name, manufacturer: i.manufacturer ?? "", model: i.model ?? "", serialNumber: i.serial_number ?? "", sector: i.sector,
    hl7EquipmentId: i.hl7_equipment_id ?? "", active: i.active
  };
}

export function instrumentProblem(d: InstrumentDraft): string | null {
  if (!d.name.trim()) return "informe o nome do aparelho";
  const long = tooLong(d.name, 80, "nome") ?? tooLong(d.manufacturer, 80, "fabricante") ?? tooLong(d.model, 80, "modelo")
    ?? tooLong(d.serialNumber, 60, "número de série");
  if (long) return long;
  if (!(d.sector in SECTOR_LABEL)) return "escolha o setor";
  const hl7 = d.hl7EquipmentId.trim();
  if (hl7 && !/^[A-Za-z0-9._-]{1,50}$/.test(hl7)) return "identificador HL7 (OBX-18) com até 50 letras, números, ponto, hífen ou _";
  return null;
}

export function instrumentBody(d: InstrumentDraft, providerId: string): LabInstrumentInput {
  return {
    provider_id: providerId, name: d.name.trim(), manufacturer: d.manufacturer.trim(), model: d.model.trim(), serial_number: d.serialNumber.trim(),
    sector: d.sector, hl7_equipment_id: d.hl7EquipmentId.trim() || null, active: d.active
  };
}

// ─── material e lote ───
export interface MaterialDraft { name: string; manufacturer: string; levels: string; analytes: string[]; active: boolean }
export const EMPTY_MATERIAL: MaterialDraft = { name: "", manufacturer: "", levels: "", analytes: [], active: true };
export const analyteToken = (a: QcAnalyteRef) => `${a.lab_exam_id}:${a.analyte_key}`;
export function tokenToAnalyte(token: string): QcAnalyteRef {
  const i = token.indexOf(":");
  return { lab_exam_id: token.slice(0, i), analyte_key: token.slice(i + 1) };
}

export function materialDraft(m: QcMaterial): MaterialDraft {
  return { name: m.name, manufacturer: m.manufacturer ?? "", levels: m.levels.join("; "), analytes: m.analytes.map(analyteToken), active: m.active };
}

export function parseLevels(raw: string): string[] {
  return raw.split(";").map((l) => l.trim()).filter((l) => l !== "");
}

// `original`: o material já gravado. Com lote (`has_lots`), os níveis não mudam e nenhum analito sai (save_material.rb).
export function materialProblem(d: MaterialDraft, original?: QcMaterial): string | null {
  if (!d.name.trim()) return "informe o nome do material";
  const long = tooLong(d.name, 80, "nome") ?? tooLong(d.manufacturer, 80, "fabricante");
  if (long) return long;
  const levels = parseLevels(d.levels);
  if (levels.length < 1 || levels.length > 6) return "informe de 1 a 6 níveis separados por ponto e vírgula";
  if (new Set(levels.map((l) => l.toLowerCase())).size !== levels.length) return "níveis repetidos";
  if (levels.some((l) => l.length > 40)) return "cada nível com até 40 caracteres";
  if (d.analytes.length === 0) return "escolha ao menos um analito";
  if (d.analytes.length > 60) return "no máximo 60 analitos por material";
  const keys = d.analytes.map((t) => tokenToAnalyte(t).analyte_key);
  if (new Set(keys).size !== keys.length) return "a mesma chave de analito não pode entrar em dois exames";
  if (original?.has_lots) {
    if (levels.length !== original.levels.length || levels.some((l, i) => l !== original.levels[i])) return "o material já tem lote: os níveis não mudam";
    const kept = new Set(d.analytes);
    if (original.analytes.some((a) => !kept.has(analyteToken(a)))) return "o material já tem lote: nenhum analito pode sair";
  }
  return null;
}

export function materialBody(d: MaterialDraft, providerId: string): QcMaterialInput {
  return {
    provider_id: providerId, name: d.name.trim(), manufacturer: d.manufacturer.trim(), levels: parseLevels(d.levels),
    analytes: d.analytes.map(tokenToAnalyte), active: d.active
  };
}

export interface LotDraft { materialId: string; lotNumber: string; expiresOn: string; barcodes: Record<string, string> }

// Código de barras do controle (lab_qc_lot_barcode.rb): 3 a 30; só 10 dígitos é o espaço das amostras.
export function lotProblem(d: LotDraft, levels: string[], today: string): string | null {
  if (!d.materialId) return "escolha o material";
  if (!d.lotNumber.trim()) return "informe o número do lote";
  const long = tooLong(d.lotNumber, 40, "número do lote");
  if (long) return long;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.expiresOn)) return "informe a validade";
  if (d.expiresOn < today) return "lote vencido — confira a validade";
  const seen = new Set<string>();
  for (const level of levels) {
    const code = (d.barcodes[level] ?? "").trim();
    if (!code) return `informe o código de barras do nível ${level}`;
    if (/^\d{10}$/.test(code)) return `código do nível ${level}: não pode ter só 10 dígitos (esse formato é o das amostras)`;
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(code)) return `código do nível ${level}: 3 a 30 letras, números, ponto, hífen ou _`;
    if (seen.has(code.toUpperCase())) return "cada nível precisa de um código de barras diferente";
    seen.add(code.toUpperCase());
  }
  return null;
}

export function lotBody(d: LotDraft, levels: string[]): QcLotInput {
  return {
    material_id: d.materialId, lot_number: d.lotNumber.trim(), expires_on: d.expiresOn,
    level_barcodes: Object.fromEntries(levels.map((l) => [ l, (d.barcodes[l] ?? "").trim() ]))
  };
}

// ─── referência, regras e valor ───
export interface TargetDraft { level: string; analyteKey: string; instrumentId: string; mean: string; sd: string; reason: string }
export const EMPTY_TARGET: TargetDraft = { level: "", analyteKey: "", instrumentId: "", mean: "", sd: "", reason: "" };

export function targetProblem(d: TargetDraft, replacing: boolean): string | null {
  if (!d.level) return "escolha o nível";
  if (!d.analyteKey) return "escolha o analito";
  if (!d.instrumentId) return "escolha o aparelho";
  const problem = decimalProblem(d.mean, "a média", { allowNegative: true }) ?? decimalProblem(d.sd, "o desvio-padrão", { positive: true });
  if (problem) return problem;
  return replacing ? reasonProblem(d.reason, "o motivo da troca da referência") : null;
}

export function targetBody(d: TargetDraft, lotId: string, replacing: boolean): QcTargetInput {
  return {
    lot_id: lotId, level: d.level, analyte_key: d.analyteKey, instrument_id: d.instrumentId,
    mean: normalizeNumber(d.mean) as string, sd: normalizeNumber(d.sd) as string,
    ...(replacing ? { reason: d.reason.trim() } : {})
  };
}

export function turnedOff(before: Record<QcRule, boolean>, after: Record<QcRule, boolean>): QcRule[] {
  return (Object.keys(before) as QcRule[]).filter((r) => before[r] && !after[r]);
}

export function rulesProblem(before: Record<QcRule, boolean>, after: Record<QcRule, boolean>, justification: string): string | null {
  const off = turnedOff(before, after);
  // O api recusa texto acima de 1000 sempre; em branco só quando desliga uma regra (C-E2).
  if (justification.trim().length > TEXT_MAX) return `a justificativa: no máximo ${TEXT_MAX} caracteres`;
  return off.length > 0 ? reasonProblem(justification, `a justificativa para desligar ${rulesText(off)}`) : null;
}

export function qcValueProblem(raw: string): string | null {
  return decimalProblem(raw, "o valor", { allowNegative: true });
}

// ─── Levey-Jennings ───
// O eixo é em desvios-padrão: cada ponto chega com o z da referência da sua
// versão (o api avaliou na gravação). Reprojetar valores antigos na média nova
// mostraria um gráfico que não foi o avaliado.
export interface LjRow { n: number; z: number; at: string; value: string; outcome: string; rules: string[]; version: number }
export interface LjModel { rows: LjRow[]; versionChanges: { n: number; version: number }[]; domain: [ number, number ]; flagged: LjRow[]; mixedVersions: boolean }
export const SD_LINES = [ -3, -2, -1, 0, 1, 2, 3 ];

export function ljModel(chart: QcChart): LjModel {
  const rows: LjRow[] = chart.points.map((p, i) => ({
    n: i + 1, z: p.z_score, at: p.at, value: p.value, outcome: p.outcome, rules: p.rules_fired, version: p.target_version
  }));
  const versionChanges = rows.filter((r, i) => i > 0 && r.version !== rows[i - 1].version).map((r) => ({ n: r.n, version: r.version }));
  const peak = rows.reduce((m, r) => Math.max(m, Math.abs(r.z)), 0);
  const edge = Math.max(4, Math.ceil(peak + 0.5));
  const current = chart.target?.version;
  return {
    rows, versionChanges, domain: [ -edge, edge ], flagged: rows.filter((r) => r.outcome !== "ok"),
    mixedVersions: versionChanges.length > 0 || (current !== undefined && rows.some((r) => r.version !== current))
  };
}

export function sdLabel(k: number): string {
  return k === 0 ? "média" : `${k > 0 ? "+" : "-"}${Math.abs(k)} dp`;
}

export function ljBands(target: { mean: string; sd: string }): { k: number; label: string; value: string }[] {
  const places = Math.max(decimalsOf(target.mean), decimalsOf(target.sd));
  const mean = Number(target.mean);
  const sd = Number(target.sd);
  return [ 3, 2, 1, 0, -1, -2, -3 ].map((k) => ({ k, label: sdLabel(k), value: fmtDecimal(((mean + k * sd).toFixed(places)).replace(/^-(0(\.0+)?)$/, "$1")) }));
}

// ─── CEQ ───
export interface EqaItemDraft { token: string; submitted: string; target: string; low: string; high: string; adequacy: EqaAdequacy | ""; action: string }
export const EMPTY_EQA_ITEM: EqaItemDraft = { token: "", submitted: "", target: "", low: "", high: "", adequacy: "", action: "" };
// C-E24: a rodada não carrega o relatório anual (registro próprio por laboratório, programa e ano).
export interface EqaRoundDraft {
  program: "PNCQ" | "Controllab" | "outro" | ""; programOther: string; roundCode: string; roundDate: string; items: EqaItemDraft[];
}
export const EMPTY_EQA_ROUND: EqaRoundDraft = { program: "", programOther: "", roundCode: "", roundDate: "", items: [ EMPTY_EQA_ITEM ] };

const dec = (raw: string) => normalizeNumber(raw);

export function suggestAdequacy(i: EqaItemDraft): EqaAdequacy | "" {
  const v = dec(i.submitted), lo = dec(i.low), hi = dec(i.high);
  if (v === null || lo === null || hi === null) return "";
  return Number(v) >= Number(lo) && Number(v) <= Number(hi) ? "adequate" : "inadequate";
}

export function eqaProblem(d: EqaRoundDraft, today: string): string | null {
  if (!d.program) return "escolha o programa";
  if (d.program === "outro" && !d.programOther.trim()) return "informe o nome do programa";
  if (!d.roundCode.trim()) return "informe o código da rodada";
  const long = tooLong(d.roundCode, 40, "código da rodada") ?? tooLong(d.programOther, 60, "nome do programa");
  if (long) return long;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.roundDate)) return "informe a data da rodada";
  if (d.roundDate > today) return "a data da rodada não pode ser no futuro";
  if (d.items.length === 0) return "inclua ao menos um analito";
  if (d.items.length > 60) return "no máximo 60 analitos por rodada";
  const seen = new Set<string>();
  for (const [ idx, i ] of d.items.entries()) {
    const n = `item ${idx + 1}`;
    if (!i.token) return `${n}: escolha o analito`;
    if (seen.has(i.token)) return `${n}: este analito já está na rodada`;
    seen.add(i.token);
    const num = decimalProblem(i.submitted, "o valor enviado", { allowNegative: true }) ?? decimalProblem(i.target, "o alvo", { allowNegative: true })
      ?? (i.low.trim() ? decimalProblem(i.low, "o limite inferior", { allowNegative: true }) : null)
      ?? (i.high.trim() ? decimalProblem(i.high, "o limite superior", { allowNegative: true }) : null);
    if (num) return `${n}: ${num}`;
    if (i.low.trim() && i.high.trim() && Number(dec(i.low)) > Number(dec(i.high))) return `${n}: o limite inferior é maior que o superior`;
    if (!i.adequacy) return `${n}: diga se foi adequado`;
    if (i.adequacy === "inadequate") {
      const why = reasonProblem(i.action, "a ação para o resultado inadequado", EQA_ACTION_MAX);
      if (why) return `${n}: ${why}`;
    }
  }
  return null;
}

export function eqaBody(d: EqaRoundDraft, providerId: string): EqaRoundInput {
  return {
    provider_id: providerId, program: d.program === "outro" ? d.programOther.trim() : d.program, round_code: d.roundCode.trim(),
    round_date: d.roundDate,
    items: d.items.map((i) => {
      const ref = tokenToAnalyte(i.token);
      return {
        lab_exam_id: ref.lab_exam_id, analyte_key: ref.analyte_key, submitted: dec(i.submitted) as string, target: dec(i.target) as string,
        acceptable_low: i.low.trim() ? dec(i.low) : null, acceptable_high: i.high.trim() ? dec(i.high) : null,
        adequacy: i.adequacy as EqaAdequacy, action: i.adequacy === "inadequate" ? i.action.trim() : null
      };
    })
  };
}

export function adequacyRate(row: EqaSummaryRow): string {
  if (row.rounds <= 0) return "—";
  return `${fmtDecimal(Math.round((row.adequate * 1000) / row.rounds) / 10)}%`;
}

// ─── recusas ───
// `corrective_action_required` não é erro: o api manda como `notice` no 201 do valor (C-E3).
const ERRORS: Record<string, string> = {
  invalid_name: "nome inválido — preencha o nome (até 80 caracteres)",
  duplicate_name: "já existe um registro com este nome neste laboratório",
  duplicate_hl7_equipment_id: "este identificador HL7 já está em outro aparelho",
  invalid_instrument: "aparelho inválido — confira os dados; o aparelho precisa estar ativo e ser deste laboratório",
  barcode_taken: "este código de barras já está em outro lote de controle ou numa amostra",
  invalid_barcode: "código de barras do controle inválido — 3 a 30 letras, números, ponto, hífen ou _, e nunca só 10 dígitos",
  invalid_levels: "níveis inválidos — informe de 1 a 6 nomes distintos (com lote, os níveis não mudam)",
  invalid_analytes: "analitos inválidos — escolha só analitos numéricos, não calculados, de exames deste laboratório (com lote, nenhum sai)",
  duplicate_analyte_key: "a mesma chave de analito não pode entrar em dois exames do material",
  invalid_lot_number: "número do lote inválido — use de 1 a 40 caracteres",
  invalid_expires_on: "validade inválida — informe a data",
  duplicate_lot: "este material já tem um lote com este número",
  expired_lot: "lote vencido — não pode ser usado",
  no_target: "este nível e analito ainda não têm referência neste aparelho — cadastre a da bula em Controles e referências",
  lot_closed: "este lote de controle está encerrado",
  invalid_value: "valor inválido — use dígitos e vírgula, com até 9 dígitos antes da vírgula e 4 depois",
  justification_required: "escreva a justificativa",
  reason_required: "escreva o motivo da troca da referência",
  invalid_reason: "texto longo demais — use até 1000 caracteres",
  invalid_note: "nota longa demais — use até 1000 caracteres",
  invalid_text: "escreva a ação corretiva (até 1000 caracteres)",
  invalid_rules: "regras inválidas — confira as seis regras",
  invalid_decision: "decisão inválida — mantenha ou retifique",
  not_blocked: "este exame não está mais bloqueado — libere normalmente",
  action_required: "escreva a ação de cada item inadequado",
  invalid_items: "analitos da rodada inválidos — cada um precisa ser numérico, de um exame do laboratório, sem repetir, e a ação tem até 500 caracteres",
  invalid_program: "programa inválido — use de 1 a 60 caracteres",
  invalid_round_code: "código da rodada inválido — use de 1 a 40 caracteres",
  invalid_round_date: "data da rodada inválida ou no futuro",
  duplicate_round: "este programa já tem uma rodada com este código neste laboratório",
  invalid_year: "ano inválido — use um ano entre 2000 e o ano atual",
  already_recorded: "este programa já tem relatório anual neste ano",
  invalid_file: "arquivo inválido — envie um PDF",
  invalid_date: "data inválida — confira o dia, o mês e o ano",
  invalid_period: "período inválido — a data inicial vem antes da final, com no máximo 366 dias",
  filter_required: "faltou escolher o lote, o nível, o analito ou o aparelho",
  invalid_version: "versão do exame inválida — o aparelho precisa estar ativo; confira os dados e tente de novo",
  not_found: "não encontrado neste laboratório — a tela foi atualizada",
  conflict: "isto já estava registrado — a tela foi atualizada",
  mfa_required: "o código do autenticador não valeu — digite o código atual",
  qc_blocked: "o controle de qualidade reprovou e bloqueou exames desta requisição",
  missing_role: "seu papel não permite esta ação"
};

export function qcError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature === "lab_quality_control") return QC_DISABLED;
  if (feature === "lab_inventory") return "o estoque do laboratório está desligado nesta cidade";
  const code = errorCode(err);
  if (code && ERRORS[code]) return ERRORS[code];
  return labError(err);
}

export async function refreshQc(client: QueryClient): Promise<void> {
  await Promise.all(QC_KEYS.map((key) => client.invalidateQueries({ queryKey: [ key ] })));
}
