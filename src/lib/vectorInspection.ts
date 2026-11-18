// Regras puras do boletim do agente de endemias na visita (módulo 35a; contrato §3, Q7, Q9, Q10, Q13). Porte de
// apps/api/app/services/vector_control/inspection_rules.rb: mesmos códigos, mesmos `path` (a tabela da Task 2 do
// plano) e a mesma ordem. O api devolve só o primeiro erro; `checkInspection` devolve todos, e o primeiro da lista é
// o que o api daria (Q13(10)). Nenhuma tela importada aqui; nenhuma leitura de rede.
import type {
  DepositCounts, DepositGroup, MeasureMethod, RiskClass, VectorActivity, VectorControlDomains, VectorInspectionInput,
  VectorSituation, VectorWorkType, VisitOutcome
} from "./api";
import { cityIsoDate, cityLocalIso } from "./format";
import type { VectorErrorCode } from "./vectorErrors";

export const ENDEMIC_AGENT_CBO = "515140";
export const DERIVED_REASONS = [ 34, 35, 36, 37 ] as const;
export const PE_PROPERTY = "4";
export const IE_PROPERTIES = [ "5", "6", "7", "8", "9", "10", "11", "12", "13" ] as const;

const ROOT = "vector_inspection";
const ACTIVITIES: readonly VectorActivity[] = [ "li", "li_t", "pe", "ie", "transmission_block", "liraa" ];
const WORK_TYPES: readonly VectorWorkType[] = [ "routine", "pending" ];
const SITUATIONS: readonly VectorSituation[] = [ "worked", "closed", "refused", "vacant" ];
const DEPOSIT_GROUPS_MAX = 7;   // um item por grupo (Catalog::DEPOSIT_GROUPS.size)
const DEPOSIT_FIELDS = [ "existing", "with_water", "with_larvae", "eliminated", "treated" ] as const;
// §3.5, na ordem dos campos: campo ≤ teto.
const DEPOSIT_CEILINGS = [ [ "with_water", "existing" ], [ "with_larvae", "with_water" ], [ "eliminated", "existing" ], [ "treated", "with_water" ] ] as const;
const LINKS = { liraa: "liraa_draw_item_id", transmission_block: "transmission_block_id" } as const;
const SITUATION_OUTCOME: Record<VectorSituation, VisitOutcome> = { worked: 1, refused: 2, closed: 3, vacant: 3 };
const INSPECTION_MAX_MS = 12 * 60 * 60 * 1000;
// HomeVisits::Record::INSTANT.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export type InspectionIssue = { error: VectorErrorCode; path: string };

// Os fatos que o api lê do banco. `household.property_type` é o tipo da versão atual do domicílio (o api não lê o
// tipo do corpo da visita). Listas opcionais ausentes = a regra só confere a presença do vínculo; o api confere o
// resto. Produto ausente da lista (ou `active: false`) não é permitido: os domínios só trazem os ativos.
export type InspectionCtx = {
  visit: { outcome: VisitOutcome; occurred_at: string; reasons: number[] };
  household: { id: string; property_type: string; neighborhood_id: string | null } | null;
  profile: { city_block_id: string | null } | null;
  agent: boolean;
  gateUsable: boolean;
  products: (VectorControlDomains["products"][number] & { active?: boolean })[];
  limits: VectorControlDomains["limits"];
  blocks?: { id: string; neighborhood_id: string; active: boolean }[];
  // `survey_status` ausente = não conferido (o api exige "drawn").
  liraaItems?: { id: string; household_id: string; status: string; survey_status?: string }[];
  transmissionBlocks?: { id: string; status: string; block_ids: string[] }[];
};

const isCount = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const positive = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const has = (o: object, key: string) => (o as Record<string, unknown>)[key] !== undefined;
// Data que passa pela regex e não existe (mês 13) → null, como o `rescue ArgumentError` → nil do api (l. 352-358).
const instant = (v: unknown): number | null => {
  if (typeof v !== "string" || !INSTANT.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
// (0, max], no máximo duas casas: a mesma conta do BigDecimal(value.to_s) do api.
const chargesOk = (v: unknown, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max && /^\d+(\.\d{1,2})?$/.test(String(v));

export function checkInspection(input: VectorInspectionInput, ctx: InspectionCtx): InspectionIssue[] {
  // 1. Gate antes do CBO; sem domicílio, nada mais (Q10).
  if (!ctx.gateUsable) return [ { error: "feature_disabled", path: ROOT } ];
  if (!ctx.agent) return [ { error: "cbo_not_allowed", path: ROOT } ];
  const household = ctx.household;
  if (!household) return [ { error: "vector_inspection_invalid", path: "household_id" } ];

  const out: InspectionIssue[] = [];
  const push = (error: VectorErrorCode, path: string) => out.push({ error, path });
  const invalid = (path: string) => push("vector_inspection_invalid", path);
  const { limits } = ctx;
  const deposits = input.deposits ?? [];
  const measures = input.measures ?? [];
  const samples = input.samples ?? [];

  // Forma (Q7(7)): o que a tela consegue mandar errado (escolha em branco, horário fora do formato, número não inteiro).
  if (!ACTIVITIES.includes(input.activity)) invalid(`${ROOT}.activity`);
  if (!WORK_TYPES.includes(input.work_type)) invalid(`${ROOT}.work_type`);
  if (!SITUATIONS.includes(input.situation)) invalid(`${ROOT}.situation`);
  if (typeof input.educational_action !== "boolean") invalid(`${ROOT}.educational_action`);
  for (const key of [ "entered_at", "left_at" ] as const) if (has(input, key) && instant(input[key]) === null) invalid(`${ROOT}.${key}`);
  samples.forEach((s, i) => {
    if (!Number.isInteger(s.number)) invalid(`${ROOT}.samples[${i}].number`);
    if (!Number.isInteger(s.larvae_collected)) invalid(`${ROOT}.samples[${i}].larvae_collected`);
  });

  // 2. Situação × desfecho; não trabalhado vai vazio.
  if (SITUATIONS.includes(input.situation)) {
    if (SITUATION_OUTCOME[input.situation] !== ctx.visit.outcome) push("situation_outcome_mismatch", `${ROOT}.situation`);
    if (input.situation !== "worked") {
      for (const key of [ "deposits", "measures", "samples" ] as const) if ((input[key] ?? []).length > 0) push("inspection_not_worked", `${ROOT}.${key}`);
      if (input.educational_action === true) push("inspection_not_worked", `${ROOT}.educational_action`);
    }
  }

  // 3. Atividade × tipo de imóvel.
  const allowed: readonly string[] | null = input.activity === "pe" ? [ PE_PROPERTY ] : input.activity === "ie" ? IE_PROPERTIES : null;
  if (allowed && !allowed.includes(household.property_type)) push("activity_property_mismatch", `${ROOT}.activity`);

  // 4. Vínculos.
  if (input.activity === "liraa") {
    const id = input.liraa_draw_item_id;
    const item = id !== undefined && ctx.liraaItems ? ctx.liraaItems.find((x) => x.id === id) : undefined;
    const ok = id !== undefined && (!ctx.liraaItems ||
      (!!item && item.household_id === household.id && item.status === "pending" && (item.survey_status ?? "drawn") === "drawn"));
    if (!ok) push("liraa_item_not_found", `${ROOT}.liraa_draw_item_id`);
  }
  if (input.activity === "transmission_block") {
    const id = input.transmission_block_id;
    const block = id !== undefined && ctx.transmissionBlocks ? ctx.transmissionBlocks.find((x) => x.id === id) : undefined;
    const blockId = ctx.profile?.city_block_id || input.city_block_id;
    // Sem quarteirão no perfil nem no corpo, o api sempre recusa (inspection_rules.rb:206-208, `block_id && …`),
    // mesmo sem a lista de bloqueios no contexto.
    const ok = id !== undefined && !!blockId && (!ctx.transmissionBlocks ||
      (!!block && block.status === "active" && block.block_ids.includes(blockId)));
    if (!ok) push("transmission_block_not_active", `${ROOT}.transmission_block_id`);
  }
  for (const [ activity, key ] of Object.entries(LINKS)) if (activity !== input.activity && has(input, key)) invalid(`${ROOT}.${key}`);

  // 5. Depósitos: o tamanho da lista antes dos itens; em cada item, a faixa antes das desigualdades.
  if (deposits.length > DEPOSIT_GROUPS_MAX) invalid(`${ROOT}.deposits`);
  else deposits.forEach((d, i) => {
    const path = `${ROOT}.deposits[${i}]`;
    const bad = DEPOSIT_FIELDS.filter((f) => !isCount(d[f], limits.deposit_count_max));
    bad.forEach((f) => invalid(`${path}.${f}`));
    if (bad.length === 0) for (const [ f, ceiling ] of DEPOSIT_CEILINGS) if (d[f] > d[ceiling]) push("deposit_counts_inconsistent", `${path}.${f}`);
    if (deposits.findIndex((o) => o.group === d.group) !== i) push("deposit_counts_inconsistent", `${path}.group`);
  });

  // 6. Medidas.
  if (measures.length > limits.measures_max) invalid(`${ROOT}.measures`);
  else measures.forEach((m, i) => {
    const path = `${ROOT}.measures[${i}]`;
    if (m.method === "mechanical") {
      if (has(m, "vector_product_id")) invalid(`${path}.vector_product_id`);
      if (has(m, "charges")) invalid(`${path}.charges`);
    } else {
      const product = ctx.products.find((p) => p.id === m.vector_product_id);
      if (!product || product.active === false || !(product.uses as string[]).includes(m.method)) push("product_not_allowed", `${path}.vector_product_id`);
      if (!chargesOk(m.charges, limits.charges_max)) invalid(`${path}.charges`);
    }
    if (measures.findIndex((o) => o.method === m.method && o.vector_product_id === m.vector_product_id) !== i) invalid(path);
  });

  // 7. Amostras: de 1 a N sem buraco, no máximo uma por depósito com larva do grupo, larvas na faixa.
  if (samples.length > limits.samples_max) invalid(`${ROOT}.samples`);
  else {
    const larvae = new Map<DepositGroup, number>();
    for (const d of deposits) larvae.set(d.group, Number.isInteger(d.with_larvae) ? d.with_larvae : 0);
    const numbers = samples.map((s) => s.number);
    samples.forEach((s, i) => {
      const path = `${ROOT}.samples[${i}]`;
      const numbered = !Number.isInteger(s.number) || (s.number >= 1 && s.number <= samples.length && numbers.indexOf(s.number) === i);
      const position = samples.slice(0, i + 1).filter((o) => o.deposit_group === s.deposit_group).length;
      if (!numbered || position > (larvae.get(s.deposit_group) ?? 0)) push("samples_exceed_larvae", path);
      if (Number.isInteger(s.larvae_collected) && (s.larvae_collected < 1 || s.larvae_collected > limits.larvae_collected_max)) {
        invalid(`${path}.larvae_collected`);
      }
    });
  }

  // 8. Horários: os dois ou nenhum; entrada ≤ visita ≤ saída, até 12 h, no dia da visita (na cidade).
  if (has(input, "entered_at") || has(input, "left_at")) {
    const occurred = instant(ctx.visit.occurred_at);
    const entered = instant(input.entered_at);
    const left = instant(input.left_at);
    if (!has(input, "entered_at") || !has(input, "left_at")) push("inspection_times_invalid", `${ROOT}.entered_at`);
    else if (occurred !== null && entered !== null && left !== null) {
      const day = cityIsoDate(new Date(occurred));
      const ordered = entered <= occurred && occurred <= left && left - entered <= INSPECTION_MAX_MS;
      const sameDay = cityIsoDate(new Date(entered)) === day && cityIsoDate(new Date(left)) === day;
      if (!ordered || !sameDay) push("inspection_times_invalid", `${ROOT}.entered_at`);
    }
  }

  // 9. Motivos derivados no corpo da visita.
  if (ctx.visit.reasons.some((r) => (DERIVED_REASONS as readonly number[]).includes(r))) push("reason_derived", "reasons");

  // 10. Quarteirão no boletim: só se o perfil não tiver; do bairro do domicílio.
  if (has(input, "city_block_id")) {
    const path = `${ROOT}.city_block_id`;
    if (ctx.profile?.city_block_id) push("block_already_set", path);
    else {
      const block = ctx.blocks?.find((b) => b.id === input.city_block_id);
      if (ctx.blocks && !(block && block.active)) invalid(path);
      if (household.neighborhood_id === null) push("household_without_neighborhood", path);
      else if (block && block.active && block.neighborhood_id !== household.neighborhood_id) push("block_not_in_household_neighborhood", path);
    }
  }
  return out;
}

// Os motivos 34–37 que o boletim acrescenta, crescentes (inspection_rules.rb#derived).
export function derivedReasons(input: VectorInspectionInput): number[] {
  const deposits = input.deposits ?? [];
  const methods = (input.measures ?? []).map((m) => m.method);
  const codes: number[] = [];
  if (input.educational_action === true) codes.push(34);
  if (deposits.some((d) => positive(d.with_larvae))) codes.push(35);
  if (deposits.some((d) => positive(d.eliminated)) || methods.includes("mechanical")) codes.push(36);
  if (methods.includes("focal")) codes.push(37);
  return codes;
}

export const outcomeForSituation = (s: VectorSituation): VisitOutcome => SITUATION_OUTCOME[s];

// §9: os 8 primeiros do client_uuid da visita em maiúsculas, hífen e o número com 2 dígitos.
export const sampleLabel = (clientUuid: string, n: number): string => `${clientUuid.slice(0, 8).toUpperCase()}-${String(n).padStart(2, "0")}`;

// Decimal exato (sem ponto flutuante): "12.50" → [1250n, 2].
function decimal(value: string): [ bigint, number ] {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) {
    // Notação exponencial ("1e-7") passa por toFixed; o resto (negativo, NaN) não tem quantidade.
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n < 1e21 ? decimal(n.toFixed(12)) : [ 0n, 0 ];
  }
  return [ BigInt(m[1] + (m[2] ?? "")), (m[2] ?? "").length ];
}

// Quantidade da baixa (Q10, A-2): cargas × carga do produto, com teto em 2 casas e texto com ponto.
export function measureQuantity(charges: number, chargeSize: string): string {
  const [ a, sa ] = decimal(String(charges));
  const [ b, sb ] = decimal(chargeSize);
  const product = a * b;
  const scale = sa + sb;
  let cents: bigint;
  if (scale <= 2) cents = product * 10n ** BigInt(2 - scale);
  else {
    const div = 10n ** BigInt(scale - 2);
    cents = product / div + (product % div > 0n ? 1n : 0n);
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

// ── Rascunho do formulário (Task 5) ──

type DepositText = Record<"existing" | "with_water" | "with_larvae" | "eliminated" | "treated", string>;
// Números em texto (vírgula aceita), horários "HH:MM"; a numeração das amostras é a posição.
export type InspectionDraft = {
  activity: VectorActivity | null; workType: VectorWorkType; situation: VectorSituation | null; educationalAction: boolean;
  enteredAt: string; leftAt: string; cityBlockId: string | null; riskClass: RiskClass | null;
  liraaDrawItemId: string | null; transmissionBlockId: string | null;
  deposits: ({ group: DepositGroup } & DepositText)[];
  measures: { method: MeasureMethod; productId: string | null; charges: string }[];
  samples: { group: DepositGroup; larvae: string }[];
};
export type VectorStart = { activity?: VectorActivity; workType?: VectorWorkType; liraaDrawItemId?: string | null; transmissionBlockId?: string | null };

export const emptyInspectionDraft = (start: VectorStart = {}): InspectionDraft => ({
  activity: start.activity ?? null, workType: start.workType ?? "routine", situation: null, educationalAction: false, enteredAt: "", leftAt: "",
  cityBlockId: null, riskClass: null, liraaDrawItemId: start.liraaDrawItemId ?? null, transmissionBlockId: start.transmissionBlockId ?? null,
  deposits: [], measures: [], samples: []
});

// Texto → número: vírgula ou ponto decimal; vazio ou outra coisa vira NaN (o campo recusa, nada é cortado).
const num = (s: string): number => (/^\d+([.,]\d+)?$/.test(s.trim()) ? Number(s.trim().replace(",", ".")) : NaN);
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;
// "HH:MM" do dia da visita → instante com o deslocamento da cidade; fora do formato vai cru (a forma recusa).
const at = (day: string, hhmm: string) => (HOUR.test(hhmm) && cityLocalIso(`${day}T${hhmm}`)) || `${day}T${hhmm}`;

// O corpo `vector_inspection`. Atividade e situação em branco vão como vieram (null): `checkInspection` e o api
// recusam no campo. Horário vazio não vai; vínculo só na atividade dele.
export function inspectionInput(draft: InspectionDraft, day: string): VectorInspectionInput {
  const out: VectorInspectionInput = {
    activity: draft.activity as VectorActivity, work_type: draft.workType, situation: draft.situation as VectorSituation,
    educational_action: draft.educationalAction,
    deposits: draft.deposits.map((d): DepositCounts => ({
      group: d.group, existing: num(d.existing), with_water: num(d.with_water), with_larvae: num(d.with_larvae), eliminated: num(d.eliminated), treated: num(d.treated)
    })),
    measures: draft.measures.map((m) => ({
      method: m.method, ...(m.productId !== null ? { vector_product_id: m.productId } : {}), ...(m.charges.trim() !== "" ? { charges: num(m.charges) } : {})
    })),
    samples: draft.samples.map((s, i) => ({ number: i + 1, deposit_group: s.group, larvae_collected: num(s.larvae) }))
  };
  if (draft.enteredAt.trim() !== "") out.entered_at = at(day, draft.enteredAt.trim());
  if (draft.leftAt.trim() !== "") out.left_at = at(day, draft.leftAt.trim());
  if (draft.cityBlockId !== null) out.city_block_id = draft.cityBlockId;
  if (draft.riskClass !== null) out.risk_class = draft.riskClass;
  if (draft.activity === "liraa" && draft.liraaDrawItemId !== null) out.liraa_draw_item_id = draft.liraaDrawItemId;
  if (draft.activity === "transmission_block" && draft.transmissionBlockId !== null) out.transmission_block_id = draft.transmissionBlockId;
  return out;
}

// Tira o que a situação ou o método não aceitam e diz o quê (nada some calado).
export function pruneInspection(draft: InspectionDraft): { draft: InspectionDraft; cleared: string[] } {
  const cleared: string[] = [];
  if (draft.situation !== null && draft.situation !== "worked") {
    if (draft.deposits.length > 0) cleared.push("depósitos");
    if (draft.measures.length > 0) cleared.push("medidas");
    if (draft.samples.length > 0) cleared.push("amostras");
    if (draft.educationalAction) cleared.push("ação educativa");
    return { draft: { ...draft, deposits: [], measures: [], samples: [], educationalAction: false }, cleared };
  }
  const withLarvae = new Set(draft.deposits.filter((d) => num(d.with_larvae) > 0).map((d) => d.group));
  const lost = [ ...new Set(draft.samples.filter((s) => !withLarvae.has(s.group)).map((s) => s.group)) ];
  lost.forEach((g) => cleared.push(`amostras do grupo ${g}`));
  const mechanical = draft.measures.some((m) => m.method === "mechanical" && (m.productId !== null || m.charges !== ""));
  if (mechanical) cleared.push("produto e cargas da medida mecânica");
  if (cleared.length === 0) return { draft, cleared };
  return {
    draft: {
      ...draft,
      samples: draft.samples.filter((s) => withLarvae.has(s.group)),
      measures: draft.measures.map((m) => (m.method === "mechanical" ? { ...m, productId: null, charges: "" } : m))
    },
    cleared
  };
}
