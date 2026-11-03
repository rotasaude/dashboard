// Regras de tela do módulo 29 (sala de vacina; contrato 2026-11-02 §1–§11) sem React. Calendário, atraso, aprazamento, saldo, validade do frasco, envio à RNDS e trilha são do api; a tela só não envia o que já sabe que será recusado.
import {
  ApiError,
  type CardCheck, type CardItem, type CodeName, type ColdChainEquipment, type ImmunizationInput, type Immunobiological, type LotBalance,
  type ReadingInput, type StockPosition, type TranscriptionInput, type VaccinationCard, type VaccinationCatalog, type VaccineLocation, type Vial
} from "./api";
import { NOMINAL_QUERY, STATIC_QUERY } from "./careLines";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { fmtDay } from "./exams";
import { cityDateFormat, cityIsoDate, parseCityLocal } from "./format";
import { cents, pharmacyRefusals, type Problem, type Refusal } from "./pharmacy";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const VACCINATION_DISABLED = "a sala de vacina está desligada nesta cidade";
export const VACCINATION_NO_ROLE = "seu papel não permite usar a sala de vacina";
export const NO_VACCINE_LOCATION = "você não está na equipe de nenhuma sala de vacina nem da rede de frio — peça ao administrador da cidade";
// Sem a palavra "atraso": a tela inteira não a usa enquanto não há conferência.
export const UNCHECKED_NOTICE = "Caderneta não conferida: transcreva as doses de fora ou confirme que está completa para ver as vacinas pendentes.";
export const DOSE_SAVED = "Dose registrada.";
export const DOSE_CANCELLED = "Dose cancelada.";
export const DOSE_REPLACED = "Dose cancelada e substituída.";
export const TRANSCRIPTION_SAVED = "Transcrição registrada.";
export const LOT_REREAD = "o lote mudou — a lista de lotes foi relida; escolha de novo";
const MATERNAL_REQUIRED = "informe a condição maternal (nenhuma, gestante ou puérpera)";
export const VIAL_REREAD = "o frasco mudou — a lista de frascos foi relida; abra outro frasco ou escolha outro";

export const VAC_LOCATIONS_KEY = "vaccinationLocations";
export const VAC_CATALOG_KEY = "vaccinationCatalog";
export const VAC_PENDING_KEY = "vaccinationPending";
export const VAC_VIALS_KEY = "vaccinationVials";
export const VAC_SUMMARY_KEY = "vaccinationSummary";
export const VAC_COLD_KEY = "vaccinationColdChain";
export const VAC_EQUIPMENTS_KEY = "vaccinationEquipments";
export const VAC_DASHBOARD_KEY = "vaccinationDashboard";
export const VAC_ADMIN_KEY = "vaccinationAdmin";
export const VAC_SETTINGS_KEY = "vaccinationSettings";

// ─── Portão e papéis ────────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// Interruptor `vaccination` na sessão e nunca o operador da plataforma.
export function canUseVaccination(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "vaccination");
}

export function vaccinationRoles(user: SessionLike): { professional: boolean; keeper: boolean; admin: boolean; analyst: boolean } {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return {
    professional: roles.includes("health_professional"), keeper: roles.includes("stock_keeper"),
    admin: roles.includes("municipal_admin"), analyst: roles.includes("analyst")
  };
}

// O papel da pessoa NAQUELE local. `vaccinate` = vacinador ou responsável pela sala.
export function locationAbilities(loc: VaccineLocation): { vaccinate: boolean; lead: boolean; keeper: boolean } {
  const roles = loc.roles ?? [];
  return {
    vaccinate: roles.includes("vaccinator") || roles.includes("room_lead"), lead: roles.includes("room_lead"), keeper: roles.includes("stock_keeper")
  };
}

// ─── Rótulos. Código novo do api aparece cru. ───────────────────────────────
const pick = (map: Record<string, string>) => (code: string): string => map[code] ?? code;

export const rndsStatusLabel = pick({
  not_sent: "envio desligado — na fila", pending: "na fila de envio", sending: "enviando", accepted: "enviada ao Ministério",
  rejected: "recusada pela RNDS", failed: "falha no envio", blocked: "parada: cadastro a corrigir"
});
const RNDS_TONE: Record<string, string> = {
  accepted: "ok", pending: "info", sending: "info", not_sent: "info", rejected: "down", failed: "down", blocked: "down"
};
export const rndsStatusTone = (code: string): string => RNDS_TONE[code] ?? "neutral";

export const blockReasonLabel = pick({
  professional_cns_not_in_cnes: "o CNS de quem vacinou não está no CNES importado da cidade",
  patient_identity_unverified: "o CPF/CNS do cidadão não foi conferido no CADSUS",
  patient_without_cns_or_cpf: "o cidadão não tem CPF nem CNS no cadastro"
});

export const cardStatusLabel = pick({
  due: "devida hoje", overdue: "em atraso", upcoming: "próxima", complete: "aplicada", not_applicable: "não se aplica", unchecked: "não conferida"
});
const CARD_TONE: Record<string, string> = { due: "info", overdue: "down", upcoming: "neutral", complete: "ok", unchecked: "warn" };
export const cardStatusTone = (code: string): string => CARD_TONE[code] ?? "neutral";

// Rótulo do item na caderneta: `due` com data passada (o api mantém `due` na janela) não é "devida hoje".
export function cardItemStatusLabel(item: CardItem, status: string, today: string): string {
  if (status === "due" && item.due_on && item.due_on < today) return `já pode tomar desde ${fmtDay(item.due_on)}`;
  return cardStatusLabel(status);
}

export const checkModeLabel = pick({
  transcribed: "conferida por transcrição", confirmed_complete: "conferida: caderneta completa",
  born_after_go_live: "nasceu depois do início — conferida desde o nascimento"
});
export const vialStatusLabel = pick({ open: "aberto", expired: "vencido", closed_out: "descartado" });
export const equipmentKindLabel = pick({ refrigerator: "geladeira", chamber: "câmara", freezer: "freezer" });

// Nome do termo (via, local, dose...) pelo código; código ausente "—", desconhecido cru.
export function termName(list: CodeName[], code: string | null): string {
  if (code === null || code === "") return "—";
  return list.find((t) => t.code === code)?.name ?? code;
}

// ─── Caderneta ──────────────────────────────────────────────────────────────
// Sem conferência o atraso não existe: o item `overdue` do api aparece como "não conferida".
export function effectiveStatus(item: CardItem, checked: CardCheck | null): string {
  return item.status === "overdue" && !checked ? "unchecked" : item.status;
}

export function cardGroups(card: VaccinationCard): { today: CardItem[]; overdue: CardItem[]; upcoming: CardItem[]; done: CardItem[]; unchecked: CardItem[] } {
  const g = { today: [] as CardItem[], overdue: [] as CardItem[], upcoming: [] as CardItem[], done: [] as CardItem[], unchecked: [] as CardItem[] };
  for (const item of card.items) {
    const status = effectiveStatus(item, card.checked);
    if (status === "due") g.today.push(item);
    else if (status === "overdue") g.overdue.push(item);
    else if (status === "complete") g.done.push(item);
    else if (status === "unchecked") g.unchecked.push(item);
    else if (status !== "not_applicable") g.upcoming.push(item); // `upcoming` e situação nova: nunca some
  }
  return g;
}

// ─── Dose ───────────────────────────────────────────────────────────────────
export interface DoseDraft {
  immunobiologicalCode: string; doseCode: string; strategy: string; careGroup: string; route: string; site: string; maternalCondition: string;
  appliedAt: string; lotId: string; vialId: string; campaignId: string; overrideReason: string;
}

// "2026-11-02T10:00" na hora de parede da cidade (valor de <input type="datetime-local">).
export function cityLocalInput(at: Date): string {
  const p = Object.fromEntries(
    cityDateFormat({ hourCycle: "h23", hour: "2-digit", minute: "2-digit" }, "en-US").formatToParts(at).map((x) => [ x.type, x.value ])
  );
  return `${cityIsoDate(at)}T${String(+p.hour % 24).padStart(2, "0")}:${p.minute}`;
}

// Via e local padrão vêm do catálogo; a hora é agora.
export function newDoseDraft(imm: Immunobiological | null, doseCode: string, now: Date): DoseDraft {
  return {
    immunobiologicalCode: imm?.code ?? "", doseCode, strategy: "", careGroup: "", route: imm?.default_route ?? "", site: imm?.default_site ?? "",
    maternalCondition: "", appliedAt: cityLocalInput(now), lotId: "", vialId: "", campaignId: "", overrideReason: ""
  };
}

// Saldo > 0, não vencido, não bloqueado, do imunobiológico; o que vence primeiro no começo. Abrir frasco debita o saldo: o lote com
// frasco aberto (não vencido e com sobra) continua oferecido mesmo com saldo 0 (o api só confere saldo da unidose).
export function lotsForDose(positions: StockPosition[], code: string, today: string, vials: Vial[] = [], now: Date = new Date()): LotBalance[] {
  return positions.flatMap((p) => p.lots)
    .filter((b) => b.lot.item.immunobiological_code === code && !b.expired && !b.blocked && b.lot.expires_on >= today
      && (cents(b.balance) > 0 || vialsForDose(vials, [ b.lot.id ], now).length > 0))
    .sort((a, b) => a.lot.expires_on.localeCompare(b.lot.expires_on) || a.lot.lot_number.localeCompare(b.lot.lot_number));
}

// Abertos (situação do api), dos lotes dados, não vencidos agora e com sobra.
export function vialsForDose(vials: Vial[], lotIds: string[], now: Date): Vial[] {
  return vials.filter((v) => v.status === "open" && lotIds.includes(v.lot.id) && v.doses_left > 0 && new Date(v.expires_at).getTime() > now.getTime());
}

export function reasonProblem(text: string, label: string): string | null {
  const n = text.trim().length;
  return n >= 10 && n <= 500 ? null : `${label} precisa ter de 10 a 500 caracteres`;
}

// Aniversário de `years` anos (aritmética de calendário; 29/02 cai em 28/02 em ano comum, como o `advance` do api).
function birthdayAt(birth: string, years: number): string {
  const [ y, m, d ] = birth.split("-").map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// V27: condição maternal obrigatória só para o sexo feminino de 10 a 49 anos completos no dia da aplicação (do aniversário de 10
// até a véspera dos 50). Sem nascimento conhecido, continua exigida (como o api).
export function maternalRequired(sex: string | undefined, birthDate: string | null | undefined, appliedOn: string): boolean {
  if (sex !== "female") return false;
  if (!birthDate || !DATE.test(birthDate)) return true;
  return appliedOn >= birthdayAt(birthDate, 10) && appliedOn < birthdayAt(birthDate, 50);
}

// `sex`/`birthDate`: condição maternal (V27; maternal_condition_required; a terminologia tem "Nenhuma").
export function doseProblems(
  d: DoseDraft, ctx: { catalog: VaccinationCatalog; lots: LotBalance[]; vials: Vial[]; now: Date; sex?: string; birthDate?: string | null }
): Problem[] {
  const out: Problem[] = [];
  const add = (path: string, text: string) => out.push({ path, text });
  const imm = ctx.catalog.immunobiologicals.find((i) => i.code === d.immunobiologicalCode);
  if (!imm) add("immunobiological_code", "escolha a vacina");
  if (d.doseCode === "") add("dose_code", "escolha a dose");
  if (d.strategy === "") add("strategy", "informe a estratégia");
  if (d.careGroup === "") add("care_group", "informe o grupo de atendimento");
  if (d.route === "") add("route", "informe a via");
  if (d.site === "") add("site", "informe o local de aplicação");
  const at = d.appliedAt === "" ? null : parseCityLocal(d.appliedAt);
  if (d.maternalCondition === "" && maternalRequired(ctx.sex, ctx.birthDate, cityIsoDate(at ?? ctx.now))) add("maternal_condition", MATERNAL_REQUIRED);
  if (!at) add("applied_at", "informe data e hora da aplicação");
  else if (at.getTime() > ctx.now.getTime()) add("applied_at", "a hora da aplicação não pode ser futura");
  if (d.lotId === "") add("lot_id", "escolha o lote do estoque da sala");
  else if (!ctx.lots.some((b) => b.lot.id === d.lotId)) add("lot_id", LOT_REREAD);
  if (imm && !imm.multidose) {
    // unidose não tem frasco: o resíduo de um rascunho que trocou de vacina não é recusa (doseBody não o envia)
  } else if (d.vialId === "") {
    if (imm?.multidose) add("vial_id", `${imm.name} é multidose: escolha o frasco aberto ou abra um frasco`);
  } else {
    const known = ctx.vials.find((v) => v.id === d.vialId);
    if (known && d.lotId !== "" && known.lot.id !== d.lotId) add("vial_id", "o frasco é de outro lote");
    else if (!vialsForDose(ctx.vials, [ d.lotId ], ctx.now).some((v) => v.id === d.vialId)) add("vial_id", VIAL_REREAD);
  }
  if (d.overrideReason.trim() !== "") {
    const reason = reasonProblem(d.overrideReason, "o motivo");
    if (reason) add("override_reason", reason);
  }
  return out;
}

export function doseBody(d: DoseDraft, patientId: string, catalog?: VaccinationCatalog): ImmunizationInput {
  const unidose = catalog?.immunobiologicals.find((i) => i.code === d.immunobiologicalCode)?.multidose === false;
  const body: ImmunizationInput = {
    patient_id: patientId, immunobiological_code: d.immunobiologicalCode, dose_code: d.doseCode, strategy: d.strategy, care_group: d.careGroup,
    route: d.route, site: d.site, applied_at: (parseCityLocal(d.appliedAt) ?? new Date(NaN)).toISOString(), lot_id: d.lotId
  };
  const maternal = d.maternalCondition.trim();
  const reason = d.overrideReason.trim();
  if (maternal !== "") body.maternal_condition = maternal;
  if (d.vialId !== "" && !unidose) body.vial_id = d.vialId;
  if (d.campaignId !== "") body.campaign_id = d.campaignId;
  if (reason !== "") body.override_reason = reason;
  return body;
}

// Aprazamento depois do registro, lido da caderneta RELIDA (o api calcula): o primeiro item ainda a fazer do mesmo imunobiológico.
// `overdue` entra também (dose de recuperação já devida), sem a palavra "atraso"; nenhum → esquema completo.
export function doseSavedText(card: VaccinationCard, immunobiologicalCode: string, catalog?: VaccinationCatalog): string {
  const next = card.items.find((i) => i.immunobiological.code === immunobiologicalCode && [ "upcoming", "due", "overdue" ].includes(i.status));
  if (!next) return `${DOSE_SAVED} Esquema desta vacina completo no calendário.`;
  const name = next.immunobiological.name ?? catalog?.immunobiologicals.find((m) => m.code === immunobiologicalCode)?.name ?? immunobiologicalCode;
  const when = next.due_on ? ` em ${fmtDay(next.due_on)}` : "";
  return `${DOSE_SAVED} Próxima dose: ${name} ${next.dose.name ?? next.dose.code}${when}`;
}

// ─── Avisos (recusa que um motivo libera) ───────────────────────────────────
// Reserva: o api marca `overridable: true` no problema (V5) e é essa marca que vale; estes dois códigos só valem se a marca faltar.
export const OVERRIDABLE = [ "interval_too_short", "age_out_of_range" ];

export type VaccinationRefusal = Refusal & { overridable?: boolean };

export function splitRefusals(list: VaccinationRefusal[]): { warnings: VaccinationRefusal[]; blocking: VaccinationRefusal[] } {
  const warnings: VaccinationRefusal[] = [];
  const blocking: VaccinationRefusal[] = [];
  for (const r of list) (r.overridable ?? OVERRIDABLE.includes(r.code) ? warnings : blocking).push(r);
  return { warnings, blocking };
}

// ─── Transcrição ────────────────────────────────────────────────────────────
export interface TranscriptionLine {
  key: string; immunobiologicalCode: string; doseCode: string; appliedOn: string; lotNumber: string; manufacturerName: string; place: string;
}

export const newTranscriptionLine = (key: string): TranscriptionLine =>
  ({ key, immunobiologicalCode: "", doseCode: "", appliedOn: "", lotNumber: "", manufacturerName: "", place: "" });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Teto do api (Vaccination::Catalog::MAX_TRANSCRIPTION_ITEMS).
export const MAX_TRANSCRIPTION_ITEMS = 40;

// Uma recusa por linha (a primeira), todas as linhas de uma vez. O nome da vacina vem do catálogo, quando a tela o passa; sem ele, o código.
export function transcriptionProblems(
  lines: TranscriptionLine[], ctx: { today: string; birthDate: string; closeCheck: boolean; catalog?: VaccinationCatalog }
): Problem[] {
  if (lines.length === 0) return [ { path: "items", text: "acrescente ao menos uma dose ou use “Confirmar caderneta completa”" } ];
  if (lines.length > MAX_TRANSCRIPTION_ITEMS) return [ { path: "items", text: `no máximo ${MAX_TRANSCRIPTION_ITEMS} doses por transcrição` } ];
  const out: Problem[] = [];
  lines.forEach((l, i) => {
    const name = ctx.catalog?.immunobiologicals.find((m) => m.code === l.immunobiologicalCode)?.name ?? (l.immunobiologicalCode || "dose");
    let text: string | null = null;
    if (l.immunobiologicalCode === "") text = "escolha a vacina";
    else if (l.doseCode === "") text = "escolha a dose";
    else if (!DATE.test(l.appliedOn)) text = "informe a data da aplicação";
    else if (l.appliedOn > ctx.today) text = "a data não pode ser futura";
    else if (l.appliedOn < ctx.birthDate) text = "a data é antes do nascimento";
    else if (l.lotNumber.trim().length > 40) text = "o lote tem até 40 caracteres";
    else if (l.manufacturerName.trim().length > 120) text = "o fabricante tem até 120 caracteres";
    else if (l.place.trim().length > 120) text = "o local tem até 120 caracteres";
    if (text !== null) out.push({ path: `items[${i}]`, text: `${name}: ${text}` });
  });
  return out;
}

export function transcriptionBody(lines: TranscriptionLine[], patientId: string, closeCheck: boolean): TranscriptionInput {
  return {
    patient_id: patientId, close_check: closeCheck,
    items: lines.map((l) => {
      const lot = l.lotNumber.trim();
      const maker = l.manufacturerName.trim();
      const place = l.place.trim();
      return {
        immunobiological_code: l.immunobiologicalCode, dose_code: l.doseCode, applied_on: l.appliedOn,
        ...(lot !== "" ? { lot_number: lot } : {}), ...(maker !== "" ? { manufacturer_name: maker } : {}), ...(place !== "" ? { place } : {})
      };
    })
  };
}

// ─── Temperatura ────────────────────────────────────────────────────────────
// "8,5", "-1", "4": até 2 dígitos e 1 casa, vírgula ou ponto, de −50 a 50. "8,55" e texto: null.
export function parseCelsius(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?\d{1,2}([.,]\d)?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n >= -50 && n <= 50 ? n + 0 : null;
}

export interface ReadingDraft { readAt: string; current: string; min: string; max: string }

export function readingProblems(d: ReadingDraft, now: Date): Problem[] {
  const out: Problem[] = [];
  const at = d.readAt === "" ? null : parseCityLocal(d.readAt);
  if (!at) out.push({ path: "read_at", text: "informe a hora da leitura" });
  else if (at.getTime() > now.getTime()) out.push({ path: "read_at", text: "a hora da leitura não pode ser futura" });
  const cur = parseCelsius(d.current);
  const min = parseCelsius(d.min);
  const max = parseCelsius(d.max);
  if (cur === null) out.push({ path: "current_c", text: "informe a temperatura atual (ex.: 4,5)" });
  if (min === null) out.push({ path: "min_c", text: "informe a temperatura mínima (ex.: 4,5)" });
  if (max === null) out.push({ path: "max_c", text: "informe a temperatura máxima (ex.: 4,5)" });
  if (cur !== null && min !== null && min > cur) out.push({ path: "min_c", text: "a mínima não pode ser maior que a atual" });
  if (cur !== null && max !== null && cur > max) out.push({ path: "max_c", text: "a máxima não pode ser menor que a atual" });
  return out;
}

// Só depois de readingProblems == [].
export function readingBody(d: ReadingDraft): ReadingInput {
  return {
    read_at: (parseCityLocal(d.readAt) ?? new Date(NaN)).toISOString(),
    current_c: parseCelsius(d.current) ?? NaN, min_c: parseCelsius(d.min) ?? NaN, max_c: parseCelsius(d.max) ?? NaN
  };
}

// Qualquer das três leituras fora de [min_c, max_c] do equipamento: os lotes do local ficam bloqueados.
export function outOfRange(r: ReadingInput, eq: Pick<ColdChainEquipment, "min_c" | "max_c">): boolean {
  return [ r.current_c, r.min_c, r.max_c ].some((c) => c < eq.min_c || c > eq.max_c);
}

export const fmtCelsius = (n: number): string => `${String(n).replace(".", ",")} °C`;

// ─── Frasco e mês ───────────────────────────────────────────────────────────
export function vialRemaining(v: Vial, now: Date): string {
  const ms = new Date(v.expires_at).getTime() - now.getTime();
  if (!(ms > 0)) return "vencido";
  const min = Math.floor(ms / 60000);
  return `vence em ${Math.floor(min / 60)} h ${min % 60} min`;
}

export function monthProblem(m: string, today: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return "informe o mês (AAAA-MM)";
  return m > today.slice(0, 7) ? "o mês não pode ser futuro" : null;
}

export const currentMonth = (today: string): string => today.slice(0, 7);

// ─── Recusas do api (frase, nunca o corpo nem o valor enviado) ──────────────
// Vale sobre as frases da farmácia: o vocabulário do 29 (frasco descartado ≠ vencido, lote de outra vacina...). O que não está aqui e
// a farmácia conhece (saldo, motivo, CPF...) usa a frase dela; código que nenhuma conhece vira "recusado pelo servidor (<código>)".
const ERRORS: Record<string, string> = {
  lot_not_in_room: "o lote não está no estoque desta sala",
  lot_expired: "o lote venceu — escolha outro",
  lot_blocked: "o lote está bloqueado por temperatura fora da faixa até a conduta",
  lot_product_mismatch: "o lote é de outra vacina — escolha o lote da vacina da dose",
  vial_expired: "o frasco venceu — descarte e abra outro",
  vial_closed_out: "o frasco foi descartado — abra outro",
  vial_empty: "o frasco não tem mais doses — abra outro",
  vial_lot_mismatch: "o frasco é de outro lote",
  vial_required: "vacina multidose: escolha o frasco aberto ou abra um frasco",
  applied_at_in_future: "a hora da aplicação não pode ser futura",
  applied_on_in_future: "a data da aplicação não pode ser futura",
  applied_before_birth: "a data da aplicação é antes do nascimento",
  // O api só recusa na estratégia de rotina ("1"); as outras aceitam qualquer dose da terminologia.
  dose_not_in_calendar: "esta dose não está no calendário de rotina desta vacina — fora da rotina, troque a estratégia",
  interval_too_short: "intervalo menor que o mínimo desde a dose anterior",
  age_out_of_range: "idade fora da faixa do calendário para esta dose",
  sex_not_allowed: "esta vacina não é indicada para o sexo do cadastro",
  maternal_condition_required: MATERNAL_REQUIRED,
  cancel_not_allowed: "só quem registrou ou o responsável pela sala cancela",
  already_cancelled: "esta dose já foi cancelada — abra a caderneta de novo",
  immunization_cancelled: "esta dose foi cancelada — não tem notificação de ESAVI",
  missing_role: "você não está na equipe desta sala",
  cbo_not_allowed: "o CBO desta pessoa não permite vacinar",
  room_lead_requires_nurse: "o responsável pela sala precisa ser enfermeiro (CBO 2235)",
  professional_link_missing: "a pessoa precisa de vínculo profissional na unidade da sala",
  already_exists: "a rede de frio da cidade já existe",
  unit_taken: "esta unidade já tem uma sala de vacina",
  location_has_stock: "a sala ainda tem saldo de vacinas — transfira ou ajuste antes de desativar",
  already_linked: "esta pessoa já está na equipe com este papel",
  out_of_range: "a data precisa estar entre dois anos atrás e um ano à frente",
  already_notified: "esta dose já tem notificação de ESAVI aberta",
  disease_unavailable: "a lista nacional de doenças ainda não traz o ESAVI — tente depois",
  excursion_closed: "a conduta desta excursão já foi decidida — recarregue",
  lot_not_in_excursion: "este lote não está bloqueado por esta excursão — recarregue",
  lots_missing: "decida todos os lotes bloqueados da excursão",
  equipment_inactive: "este equipamento está inativo",
  read_at_in_future: "a hora da leitura não pode ser futura",
  already_closed: "este frasco já foi encerrado — a lista foi relida",
  not_multidose: "esta vacina não é multidose: não tem frasco para abrir",
  room_lead_required: "só o responsável pela sala faz isso",
  invalid_range: "a mínima, a atual e a máxima precisam estar em ordem",
  invalid_value: "valor inválido — confira o campo destacado",
  invalid_requester_cnes: "o CNES do solicitante é inválido — confira os 7 dígitos",
  invalid_certificate: "o certificado não abriu — confira o arquivo e a senha",
  certificate_expired: "o certificado está vencido",
  invalid_credential: "confira o certificado, a senha e o CNES"
};

// `adjustment_pending` muda de sentido pelo campo: na conduta da excursão é o descarte que espera aprovação.
function adjustmentPendingText(path: string): string | null {
  return /^lots\[/.test(path) ? "o descarte deste lote já aguarda aprovação" : null;
}

const UNKNOWN = /^não foi possível concluir \(([^)]*)\)/;

export function vaccinationError(err: unknown): string {
  return vaccinationRefusals(err)[0].text;
}

// Todas as recusas de `problems[]`, traduzidas, com a marca `overridable` do api; sem `problems`, a do topo.
export function vaccinationRefusals(err: unknown): VaccinationRefusal[] {
  const feature = featureDisabledKey(err);
  if (feature !== null) {
    const text = feature === "" || feature === "vaccination" ? VACCINATION_DISABLED : `${featureLabel(feature)} está desligado nesta cidade`;
    return [ { path: "", code: "feature_disabled", text } ];
  }
  const raw = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as Record<string, unknown>).problems : undefined;
  const rows = Array.isArray(raw) ? raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : [];
  return pharmacyRefusals(err).map((r, i) => {
    const overridable = rows.length > 0 && rows[i]?.overridable === true ? true : undefined;
    const mine = r.code === "adjustment_pending" ? adjustmentPendingText(r.path) : Object.prototype.hasOwnProperty.call(ERRORS, r.code) ? ERRORS[r.code] : null;
    if (mine) return { ...r, text: mine, ...(overridable ? { overridable } : {}) };
    const unknown = UNKNOWN.exec(r.text);
    const text = unknown && r.code !== "" ? `recusado pelo servidor (${r.code})` : r.text;
    return { ...r, text, ...(overridable ? { overridable } : {}) };
  });
}
