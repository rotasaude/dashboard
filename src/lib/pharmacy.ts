// Regras de tela do módulo 27a (farmácia e almoxarifado; contrato 2026-10-29 §1–§9, §13 H1–H12) sem React.
// O api é a fonte: saldo nunca negativo, travas, validade da receita, intervalo do uso contínuo, quem dispensa
// controlado, aprovação acima do limite e retenção são dele. A tela só não envia o que já sabe que será recusado.
import {
  ApiError, errorCode,
  type AdjustmentInput, type AdjustmentKind, type DispensationInput, type DispensedItem, type ReturnInput, type LotBalance, type PharmacyLocation, type PharmacySettings,
  type PrescriberInput, type PrescriptionItemView, type PrescriptionView, type ReceiptItemInput, type ReceiveInput, type StockItem,
  type StockLot, type StockMovement, type StockPosition, type StockTransfer
} from "./api";
import { NOMINAL_QUERY, STATIC_QUERY } from "./careLines";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { fmtDay } from "./exams";
import { DOT_IN_NUMBER, hasDot } from "./lab";
import { DUPLICATE_SUSPECTED_TEXT } from "./territoryRegistry";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const PHARMACY_DISABLED = "a farmácia e o almoxarifado estão desligados nesta cidade";
export const PHARMACY_NO_ROLE = "seu papel não permite usar a farmácia";
export const NO_LOCATION = "você não está vinculado a nenhum local de estoque — peça ao administrador da cidade";
export const CONTROLLED_PHARMACIST_ONLY = "medicamento controlado: só o farmacêutico dispensa";
export const FREE_TEXT_PHARMACIST_ONLY = "item em texto livre: só o farmacêutico dispensa, escolhendo o item do catálogo";
export const ITEM_COMPLETED = "item já dispensado por completo";
export const RETENTION_REQUIRED = "este medicamento exige a retenção da receita: marque 'Receita retida na farmácia'";
export const NOTHING_TO_DISPENSE = "informe a quantidade de ao menos um item";
export const NO_PATIENT_RECORD =
  "esta pessoa ainda não tem receita no Rota Saúde — se trouxe receita de fora da rede, use Receita externa";
export const NOTIFICATION_REQUIRED = "receita de lista A ou B exige o número da notificação";
export const BALANCE_CHANGED = "o saldo do lote mudou — os lotes foram relidos; confira a quantidade";
export const PRESCRIPTION_CHANGED = "a receita mudou enquanto você dispensava — busque a receita de novo";

// Só os alertas (sem trilha) releem sozinhos; o resto lê ao abrir, filtrar ou depois de uma ação.
export const PHARMACY_ALERTS_REFRESH_MS = 60_000;
export const PH_LOCATIONS_KEY = "pharmacyLocations";
export const PH_ADMIN_KEY = "pharmacyAdmin";
export const PH_SETTINGS_KEY = "pharmacySettings";
export const PH_MINIMUMS_KEY = "pharmacyMinimums";
export const PH_POSITIONS_KEY = "pharmacyPositions";
export const PH_MOVEMENTS_KEY = "pharmacyMovements";
export const PH_TRANSFERS_KEY = "pharmacyTransfers";
export const PH_ADJUSTMENTS_KEY = "pharmacyAdjustments";
export const PH_DISPENSATIONS_KEY = "pharmacyDispensations";
export const PH_ALERTS_KEY = "pharmacyAlerts";
export const PH_ITEMS_KEY = "pharmacyItems";

// ─── Portão e papéis ────────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// Interruptor `pharmacy` na sessão e nunca o operador da plataforma.
export function canUsePharmacy(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "pharmacy");
}

export function pharmacyRoles(user: SessionLike): { pharmacist: boolean; assistant: boolean; keeper: boolean; admin: boolean } {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return {
    pharmacist: roles.includes("pharmacist"), assistant: roles.includes("pharmacy_assistant"),
    keeper: roles.includes("stock_keeper"), admin: roles.includes("municipal_admin")
  };
}

// O papel da pessoa NAQUELE local (`roles` do GET /pharmacy/locations; `[]` nos locais alheios do almoxarife do central).
export function locationRoles(loc: PharmacyLocation): { pharmacist: boolean; assistant: boolean; keeper: boolean } {
  return {
    pharmacist: loc.roles.includes("pharmacist"), assistant: loc.roles.includes("pharmacy_assistant"), keeper: loc.roles.includes("stock_keeper")
  };
}

// ─── Rótulos (contrato §1). Código novo do api aparece cru. ────────────────
const KIND_LABEL: Record<string, string> = { central: "Almoxarifado central", unit: "Farmácia da unidade" };
export const locationKindLabel = (code: string): string => KIND_LABEL[code] ?? code;

const MOVEMENT_LABEL: Record<string, string> = {
  opening: "abertura", receipt: "entrada por nota", donation: "doação", transfer_out: "saída por transferência",
  transfer_in: "entrada por transferência", dispensing: "dispensação", loss: "perda", expiry: "vencimento", adjustment: "ajuste", return: "devolução"
};
export const movementLabel = (code: string): string => MOVEMENT_LABEL[code] ?? code;

// Documento do movimento no extrato: o número quando houver ("NF 1234"); dispensação e transferência, só o tipo (a dispensação
// aparece pelo id no api e nunca por nome de paciente). Tipo novo aparece cru.
const DOCUMENT_LABEL: Record<string, string> = {
  dispensation: "dispensação", transfer: "transferência", invoice: "nota fiscal", receipt: "nota fiscal", donation: "doação",
  adjustment: "ajuste", opening: "abertura", return: "devolução"
};
export function movementDocument(doc: StockMovement["document"] | undefined): string {
  if (!doc) return "—";
  return doc.number ? doc.number : (DOCUMENT_LABEL[doc.type] ?? doc.type);
}

// H10: o api ordena a página por id; a ordem visível (nome do item, depois o local) é da tela. Cópia: não mexe na lista de entrada.
export function sortPositions(list: StockPosition[]): StockPosition[] {
  return [ ...list ].sort((a, b) => a.item.name.localeCompare(b.item.name, "pt-BR") || a.location.name.localeCompare(b.location.name, "pt-BR"));
}

const TRANSFER_LABEL: Record<string, string> = { sent: "Em trânsito", received: "Recebida", received_with_difference: "Recebida com diferença" };
const TRANSFER_TONE: Record<string, string> = { sent: "info", received: "ok", received_with_difference: "warn" };
export const transferStatusLabel = (code: string): string => TRANSFER_LABEL[code] ?? code;
export const transferStatusTone = (code: string): string => TRANSFER_TONE[code] ?? "neutral";

const ADJ_STATUS_LABEL: Record<string, string> = { applied: "Aplicado", pending: "Aguardando aprovação", approved: "Aprovado", rejected: "Rejeitado" };
const ADJ_STATUS_TONE: Record<string, string> = { applied: "ok", pending: "warn", approved: "ok", rejected: "down" };
export const adjustmentStatusLabel = (code: string): string => ADJ_STATUS_LABEL[code] ?? code;
export const adjustmentStatusTone = (code: string): string => ADJ_STATUS_TONE[code] ?? "neutral";

const ADJ_KIND_LABEL: Record<string, string> = { adjustment: "Ajuste de contagem", loss: "Perda", expiry: "Vencimento" };
export const adjustmentKindLabel = (code: string): string => ADJ_KIND_LABEL[code] ?? code;

const ROLE_LABEL: Record<string, string> = { pharmacist: "Farmacêutico", pharmacy_assistant: "Auxiliar de farmácia", stock_keeper: "Almoxarife" };
export const pharmacyRoleLabel = (code: string): string => ROLE_LABEL[code] ?? code;

export const COUNCILS = [ "CRM", "CRO", "COREN" ];
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR",
  "RS", "SC", "SE", "SP", "TO"
];
// Listas que exigem o número da notificação na receita externa.
export const NOTIFICATION_LISTS = [ "A1", "A2", "A3", "B1", "B2" ];

// ─── Quantidade: vírgula, até 2 casas, no máximo 99999,99; recusa, nunca corta ──
// `unbounded`: sem o teto de 99999,99 — só a contagem de inventário (é um SALDO; o teto vale para a diferença, em adjustmentProblem).
export function quantityProblem(raw: string, label = "a quantidade", opts: { allowZero?: boolean; unbounded?: boolean } = {}): string | null {
  const t = raw.trim();
  if (t === "") return `informe ${label}`;
  if (hasDot(t)) return DOT_IN_NUMBER;
  if (!/^\d+(,\d+)?$/.test(t)) return `${label}: use só dígitos e vírgula`;
  const [ int, dec = "" ] = t.split(",");
  if (dec.length > 2) return `${label} tem no máximo 2 casas depois da vírgula`;
  if (!opts.unbounded && int.length > 5) return `${label} pode ser no máximo 99999,99`;
  if (!opts.allowZero && Number(`${int}.${dec || "0"}`) === 0) return `${label} precisa ser maior que zero`;
  return null;
}

// "12,5" → "12.5" (formato do api). Só depois de quantityProblem == null.
export const toApiQuantity = (raw: string): string => raw.trim().replace(",", ".");

export function fmtQuantity(api: string | null | undefined): string {
  if (api === null || api === undefined || api === "") return "—";
  const trimmed = api.includes(".") ? api.replace(/0+$/, "").replace(/\.$/, "") : api;
  return trimmed.replace(".", ",");
}

export function fmtSigned(api: string): string {
  const n = cents(api);
  const plain = api.replace(/^\+/, ""); // adjustmentDelta já devolve "+1": o sinal não pode dobrar
  return n > 0 ? `+${fmtQuantity(plain)}` : fmtQuantity(plain);
}

// Centésimos inteiros: compara saldos sem erro de ponto flutuante.
export const cents = (api: string): number => Math.round(Number(api) * 100);

// Código curto da receita (ClinicalDocuments::Codes): 10 do alfabeto sem 0, 1, I, L e O.
const SHORT_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;
export function normalizeShortCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return SHORT_CODE.test(code) ? code : null;
}

// ─── Lotes ──────────────────────────────────────────────────────────────────
const byExpiry = (a: LotBalance, b: LotBalance) =>
  a.lot.expires_on.localeCompare(b.lot.expires_on) || a.lot.lot_number.localeCompare(b.lot.lot_number);

// Saldo > 0 e não vencido (o lote vence ao fim do dia da validade), o que vence primeiro no começo.
export function availableLots(p: StockPosition | undefined, today: string): LotBalance[] {
  return (p?.lots ?? []).filter((b) => cents(b.balance) > 0 && b.lot.expires_on >= today).sort(byExpiry);
}

export function suggestedLotId(p: StockPosition | undefined, today: string): string {
  return availableLots(p, today)[0]?.lot.id ?? "";
}

// Perda e vencimento escolhem entre os lotes com saldo, vencidos inclusive.
export function lotsWithBalance(p: StockPosition | undefined): LotBalance[] {
  return (p?.lots ?? []).filter((b) => cents(b.balance) > 0).sort(byExpiry);
}

// Contagem de inventário (e tipo ainda não escolhido): TODOS os lotes da posição, inclusive os de saldo zero — o inventário que não acha
// estoque zerado não serve (o api trata saldo zero como acima do limite e pede aprovação). Perda: só lote não vencido e com saldo;
// vencimento: só lote já vencido e com saldo (o api devolve lot_expired / lot_not_expired). Do que vence primeiro ao que vence depois.
export function lotsForKind(p: StockPosition | undefined, kind: AdjustmentKind | "", today: string): LotBalance[] {
  const all = [ ...(p?.lots ?? []) ].sort(byExpiry);
  const stocked = (b: LotBalance) => cents(b.balance) > 0;
  if (kind === "loss") return all.filter((b) => stocked(b) && b.lot.expires_on >= today);
  if (kind === "expiry") return all.filter((b) => stocked(b) && b.lot.expires_on < today);
  return all;
}

export function lotKindProblem(kind: AdjustmentKind | "", lot: StockLot | undefined, today: string): string | null {
  if (!lot) return null;
  if (kind === "loss" && lot.expires_on < today) return "lote vencido — registre como vencimento, não como perda";
  if (kind === "expiry" && lot.expires_on >= today) return "vencimento só de lote já vencido — use perda";
  return null;
}

export function lotOptionLabel(b: LotBalance, suggested: boolean): string {
  const base = `${b.lot.lot_number} · vence ${fmtDay(b.lot.expires_on)} · saldo ${fmtQuantity(b.balance)} ${b.lot.item.dispensing_unit}`;
  return suggested ? `${base} · sugerido (vence primeiro)` : base;
}

// ─── O que impede dispensar ─────────────────────────────────────────────────
export function prescriptionBlock(p: PrescriptionView): string | null {
  if (p.cancelled) return "receita cancelada — não pode ser dispensada";
  if (p.expired) return p.valid_until ? `receita vencida em ${fmtDay(p.valid_until)} — não pode ser dispensada` : "receita vencida — não pode ser dispensada";
  return null;
}

// Na ordem: completo, item vencido (P4), próxima retirada futura, controlado e texto livre sem farmacêutico.
// Antimicrobiano não controlado o auxiliar dispensa (e retém); controlado, só o farmacêutico.
export function itemBlock(i: PrescriptionItemView, ctx: { pharmacist: boolean; today: string }): string | null {
  if (i.completed) return ITEM_COMPLETED;
  if (i.expired) return i.valid_until ? `item vencido em ${fmtDay(i.valid_until)}` : "item vencido";
  if (i.continuous && i.next_allowed_on && i.next_allowed_on > ctx.today) {
    return `uso contínuo: próxima retirada a partir de ${fmtDay(i.next_allowed_on)}`;
  }
  if (i.controlled && !ctx.pharmacist) return CONTROLLED_PHARMACIST_ONLY;
  if (i.catalog_item_id === null && !ctx.pharmacist) return FREE_TEXT_PHARMACIST_ONLY;
  return null;
}

// ─── Dispensação ────────────────────────────────────────────────────────────
export interface DispenseLine { catalogItemId: string | null; lotId: string; quantity: string; complete: boolean }
// Chave: id do item da receita.
export interface DispenseDraft { lines: Record<string, DispenseLine>; retained: boolean }
export const EMPTY_DISPENSE: DispenseDraft = { lines: {}, retained: false };

export type Problem = { path: string; text: string };

// Linha com quantidade digitada (as vazias não vão).
export function filledLines(d: DispenseDraft): [ string, DispenseLine ][] {
  return Object.entries(d.lines).filter(([ , line ]) => line.quantity.trim() !== "");
}

// H12: a retenção vem do `retention_required` do item (antimicrobiano, controlado ou controle especial).
export function needsRetention(d: DispenseDraft, p: PrescriptionView): boolean {
  const filled = new Set(filledLines(d).map(([ id ]) => id));
  return p.items.some((i) => filled.has(i.id) && i.retention_required);
}

export function dispenseProblems(
  d: DispenseDraft, p: PrescriptionView, ctx: { pharmacist: boolean; today: string; balances: Record<string, string> }
): Problem[] {
  const out: Problem[] = [];
  let any = false;
  for (const item of p.items) {
    const line = d.lines[item.id];
    if (!line || line.quantity.trim() === "") continue;
    any = true;
    const text = lineProblem(item, line, ctx);
    if (text) out.push({ path: item.id, text: `${item.printed_description}: ${text}` });
  }
  if (!any) return [ { path: "items", text: NOTHING_TO_DISPENSE } ];
  if (needsRetention(d, p) && !d.retained) out.push({ path: "retention", text: RETENTION_REQUIRED });
  return out;
}

function lineProblem(
  item: PrescriptionItemView, line: DispenseLine, ctx: { pharmacist: boolean; today: string; balances: Record<string, string> }
): string | null {
  const block = itemBlock(item, ctx);
  if (block) return block;
  if (item.catalog_item_id === null && !line.catalogItemId) return "escolha o item do catálogo";
  if (!line.lotId) return "escolha o lote";
  const q = quantityProblem(line.quantity);
  if (q) return q;
  const balance = ctx.balances[line.lotId];
  if (balance !== undefined && cents(toApiQuantity(line.quantity)) > cents(balance)) {
    return `saída maior que o saldo do lote (${fmtQuantity(balance)})`;
  }
  return null;
}

// `catalog_item_id` só para item sem catálogo na receita; `retention: {}` quando algum item preenchido pede
// (o número retido é o do documento, nunca digitado aqui — D14).
export function dispenseBody(d: DispenseDraft, p: PrescriptionView, locationId: string): DispensationInput {
  const items: DispensationInput["items"] = [];
  for (const item of p.items) {
    const line = d.lines[item.id];
    if (!line || line.quantity.trim() === "") continue;
    items.push({
      prescription_item_id: item.id,
      ...(item.catalog_item_id === null && line.catalogItemId ? { catalog_item_id: line.catalogItemId } : {}),
      lot_id: line.lotId, quantity: toApiQuantity(line.quantity), ...(line.complete ? { complete: true } : {})
    });
  }
  const body: DispensationInput = { location_id: locationId, prescription: { kind: p.kind as DispensationInput["prescription"]["kind"], id: p.id }, items };
  if (needsRetention(d, p)) body.retention = {};
  return body;
}

// ─── Entrada e abertura ─────────────────────────────────────────────────────
export interface ReceiptLine {
  key: string; item: StockItem | null; lotNumber: string; expiresOn: string; manufacturer: string;
  byPackage: boolean; quantity: string; unitsPerPackage: string; packages: string;
}

export function newReceiptLine(key: string): ReceiptLine {
  return { key, item: null, lotNumber: "", expiresOn: "", manufacturer: "", byPackage: false, quantity: "", unitsPerPackage: "", packages: "" };
}

const MAX_CENTS = 9_999_999;
const INT = /^\d+$/;
const inRange = (raw: string, max: number): boolean => INT.test(raw.trim()) && Number(raw) >= 1 && Number(raw) <= max;

// O total em formato do api; null quando não dá para calcular (campo inválido ou total acima de 99999,99).
export function lineQuantity(l: ReceiptLine): string | null {
  if (!l.byPackage) return quantityProblem(l.quantity) === null ? toApiQuantity(l.quantity) : null;
  if (!inRange(l.unitsPerPackage, 10000) || !inRange(l.packages, 10000)) return null;
  const total = Number(l.unitsPerPackage) * Number(l.packages);
  return total * 100 > MAX_CENTS ? null : String(total);
}

function receiptLineProblem(l: ReceiptLine, today: string): string | null {
  if (!l.item) return "escolha o item do catálogo";
  const lot = l.lotNumber.trim();
  let text: string | null = null;
  if (lot === "") text = "informe o número do lote";
  else if (lot.length > 40) text = "o número do lote tem até 40 caracteres";
  else if (l.expiresOn === "") text = "informe a validade";
  else if (l.expiresOn < today) text = "lote vencido — não entra no estoque";
  else if (l.manufacturer.trim().length > 120) text = "o fabricante tem até 120 caracteres";
  else if (!l.byPackage) text = quantityProblem(l.quantity);
  else if (!inRange(l.unitsPerPackage, 10000)) text = "unidades por embalagem: número inteiro de 1 a 10000";
  else if (!inRange(l.packages, 10000)) text = "embalagens: número inteiro de 1 a 10000";
  else if (lineQuantity(l) === null) text = "unidades por embalagem × embalagens passa de 99999,99 — confira";
  return text === null ? null : `${l.item.name}: ${text}`;
}

// Documento só fora da abertura; por linha, a primeira recusa; todas de uma vez.
export function receiptProblems(
  lines: ReceiptLine[], today: string, doc: { kind: "invoice" | "donation" | "opening"; number: string; supplier: string }
): Problem[] {
  const out: Problem[] = [];
  if (doc.kind !== "opening") {
    const number = doc.number.trim(); const supplier = doc.supplier.trim();
    if (number === "") out.push({ path: "document.number", text: "informe o número do documento" });
    else if (number.length > 60) out.push({ path: "document.number", text: "o número do documento tem até 60 caracteres" });
    if (supplier === "") out.push({ path: "document.supplier", text: "informe o fornecedor ou doador" });
    else if (supplier.length > 120) out.push({ path: "document.supplier", text: "o fornecedor ou doador tem até 120 caracteres" });
  }
  if (lines.length === 0) out.push({ path: "items", text: "acrescente ao menos um item" });
  for (const l of lines) {
    const text = receiptLineProblem(l, today);
    if (text) out.push({ path: l.key, text });
  }
  return out;
}

// Só depois de receiptProblems == []. Por embalagem, manda o total e a conta.
export function receiptItems(lines: ReceiptLine[]): ReceiptItemInput[] {
  return lines.map((l) => {
    const manufacturer = l.manufacturer.trim();
    return {
      catalog_item_id: l.item?.catalog_item_id ?? "", lot_number: l.lotNumber.trim(), expires_on: l.expiresOn,
      ...(manufacturer ? { manufacturer } : {}), quantity: lineQuantity(l) ?? "",
      ...(l.byPackage ? { package: { units_per_package: Number(l.unitsPerPackage), packages: Number(l.packages) } } : {})
    };
  });
}

// ─── Transferência e recebimento ────────────────────────────────────────────
export interface TransferLine { key: string; position: StockPosition | null; lotId: string; quantity: string }

export function transferProblems(lines: TransferLine[], today: string): Problem[] {
  if (lines.length === 0) return [ { path: "items", text: "acrescente ao menos um item" } ];
  const out: Problem[] = [];
  for (const l of lines) {
    if (!l.position) { out.push({ path: l.key, text: "escolha o item" }); continue; }
    const name = l.position.item.name;
    const lot = l.position.lots.find((b) => b.lot.id === l.lotId);
    if (!l.lotId || !lot) { out.push({ path: l.key, text: `${name}: escolha o lote` }); continue; }
    const who = `${name}, lote ${lot.lot.lot_number}`;
    const q = lot.lot.expires_on < today ? "lote vencido — escolha outro lote" : quantityProblem(l.quantity)
      ?? (cents(toApiQuantity(l.quantity)) > cents(lot.balance) ? `saída maior que o saldo do lote (${fmtQuantity(lot.balance)})` : null);
    if (q) out.push({ path: l.key, text: `${who}: ${q}` });
  }
  return out;
}

export interface ReceiveLine { lotId: string; received: string; reason: string }

const lineFor = (lines: ReceiveLine[], lotId: string): ReceiveLine | undefined => lines.find((l) => l.lotId === lotId);

// Todos os lotes da transferência; diferença pede motivo; maior que o enviado recusa.
export function receiveProblems(lines: ReceiveLine[], t: StockTransfer): Problem[] {
  const out: Problem[] = [];
  for (const item of t.items) {
    const id = item.lot.id; const who = item.lot.lot_number;
    const line = lineFor(lines, id);
    if (!line || line.received.trim() === "") { out.push({ path: id, text: `${who}: informe a quantidade recebida (0 se nada chegou)` }); continue; }
    const q = quantityProblem(line.received, "a quantidade recebida", { allowZero: true });
    if (q) { out.push({ path: id, text: `${who}: ${q}` }); continue; }
    const received = cents(toApiQuantity(line.received)); const sent = cents(item.quantity_sent);
    if (received > sent) out.push({ path: id, text: `${who}: recebido maior que o enviado (${fmtQuantity(item.quantity_sent)})` });
    else if (received !== sent && reasonProblem(line.reason)) {
      out.push({ path: id, text: `${who}: recebido diferente do enviado — escreva o motivo (10 a 500 caracteres)` });
    }
  }
  return out;
}

export function receiveBody(lines: ReceiveLine[]): ReceiveInput {
  return {
    items: lines.map((l) => {
      const reason = l.reason.trim();
      return { lot_id: l.lotId, quantity_received: toApiQuantity(l.received), ...(reason ? { reason } : {}) };
    })
  };
}

// Algum lote com quantidade recebida válida e diferente da enviada.
export function hasDifference(lines: ReceiveLine[], t: StockTransfer): boolean {
  return t.items.some((item) => {
    const line = lineFor(lines, item.lot.id);
    if (!line || quantityProblem(line.received, "a quantidade recebida", { allowZero: true })) return false;
    return cents(toApiQuantity(line.received)) !== cents(item.quantity_sent);
  });
}

// ─── Ajuste, perda e vencimento ─────────────────────────────────────────────
// `amount`: a contagem no ajuste; a quantidade que sai na perda e no vencimento.
export interface AdjustmentDraft { lotId: string; kind: AdjustmentKind | ""; amount: string; reason: string }

const amountLabel = (kind: AdjustmentKind | ""): string => (kind === "adjustment" ? "a contagem" : "a quantidade");
const MAX_QUANTITY_CENTS = 9_999_999;

export function adjustmentProblem(d: AdjustmentDraft, balance: string): string | null {
  if (d.kind === "") return "escolha o tipo: ajuste de contagem, perda ou vencimento";
  if (!d.lotId) return "escolha o lote";
  // A contagem é um SALDO: pode passar de 99999,99; o que o api limita é a diferença para o saldo (422 invalid_quantity).
  const counting = d.kind === "adjustment";
  const q = quantityProblem(d.amount, amountLabel(d.kind), { allowZero: counting, unbounded: counting });
  if (q) return q;
  const amount = cents(toApiQuantity(d.amount));
  if (counting && amount === cents(balance)) return "a contagem é igual ao saldo — não há o que ajustar";
  if (counting && Math.abs(amount - cents(balance)) > MAX_QUANTITY_CENTS) return "a diferença entre a contagem e o saldo pode ser no máximo 99999,99";
  if (d.kind !== "adjustment" && amount > cents(balance)) return `saída maior que o saldo do lote (${fmtQuantity(balance)})`;
  return reasonProblem(d.reason);
}

// A variação do saldo, no formato do api e com sinal ("-1.5", "+1", "0"); 0 quando ainda não dá para calcular.
export function adjustmentDelta(d: AdjustmentDraft, balance: string): string {
  if (d.kind === "" || quantityProblem(d.amount, "", { allowZero: true, unbounded: d.kind === "adjustment" })) return "0";
  const amount = cents(toApiQuantity(d.amount));
  const delta = d.kind === "adjustment" ? amount - cents(balance) : -amount;
  if (delta === 0) return "0";
  const abs = (Math.abs(delta) / 100).toString();
  return `${delta > 0 ? "+" : "-"}${abs}`;
}

// Só depois de adjustmentProblem == null (o tipo é conhecido).
export function adjustmentBody(d: AdjustmentDraft, locationId: string): AdjustmentInput {
  const kind = d.kind as AdjustmentKind;
  const q = toApiQuantity(d.amount);
  return {
    location_id: locationId, lot_id: d.lotId, kind, ...(kind === "adjustment" ? { counted_quantity: q } : { quantity: q }), reason: d.reason.trim()
  };
}

// ─── Devolução (histórico de retiradas; H12) ────────────────────────────────
// O que ainda se pode devolver do item: dispensado − já devolvido (centésimos, sem erro de ponto flutuante).
export const returnRemaining = (i: DispensedItem): number => cents(i.quantity) - cents(i.returned_total);

export interface ReturnDraft { quantity: string; reason: string }

// Todas as recusas locais de uma vez (a quantidade antes do motivo); [] = pode ir para a confirmação (step-up).
export function returnProblems(d: ReturnDraft, i: DispensedItem): string[] {
  const out: string[] = [];
  const q = quantityProblem(d.quantity, "a quantidade");
  if (q) out.push(q);
  else if (cents(toApiQuantity(d.quantity)) > returnRemaining(i)) {
    out.push(`a quantidade passa do que resta devolver deste item (${fmtQuantity(String(returnRemaining(i) / 100))})`);
  }
  const reason = reasonProblem(d.reason);
  if (reason) out.push(reason);
  return out;
}

// Só depois de returnProblems == []: quantidade com ponto, motivo aparado; o local é o da dispensação.
export const returnBody = (d: ReturnDraft, i: DispensedItem, locationId: string): ReturnInput => ({
  location_id: locationId, dispensation_item_id: i.id, quantity: toApiQuantity(d.quantity), reason: d.reason.trim()
});

// ─── Textos ─────────────────────────────────────────────────────────────────
export function reasonProblem(text: string): string | null {
  const n = text.trim().length;
  return n >= 10 && n <= 500 ? null : "o motivo tem de 10 a 500 caracteres";
}

// Vazio aceito (a obrigatoriedade pela lista do item é de quem chama).
export function notificationNumberProblem(text: string): string | null {
  const t = text.trim();
  return t === "" || /^[0-9A-Za-z./-]{1,30}$/.test(t) ? null : "número da notificação: até 30 letras, números, ponto, barra ou hífen";
}

export function prescriberProblem(p: PrescriberInput): string | null {
  const n = p.name.trim().length;
  if (n < 3 || n > 120) return "o nome do profissional tem de 3 a 120 caracteres";
  if (!COUNCILS.includes(p.council)) return "escolha o conselho (CRM, CRO ou COREN)";
  if (!UFS.includes(p.council_state)) return "escolha a UF do conselho";
  if (!/^\d{1,10}$/.test(p.council_number.trim())) return "o número no conselho tem só dígitos (até 10)";
  return null;
}

export function issuedOnProblem(date: string, today: string): string | null {
  if (date === "") return "informe a data da receita";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "data da receita inválida";
  return date > today ? "a data da receita não pode ser depois de hoje" : null;
}

const SETTINGS_RULES: [ keyof PharmacySettings, number, number, string ][] = [
  [ "common_validity_days", 1, 365, "validade da receita comum de 1 a 365 dias" ],
  [ "continuous_validity_days", 1, 365, "validade da receita de uso contínuo de 1 a 365 dias" ],
  [ "continuous_interval_days", 1, 90, "intervalo do uso contínuo de 1 a 90 dias" ],
  [ "expiry_alert_days", 1, 365, "alerta de validade de 1 a 365 dias" ],
  [ "adjustment_approval_percent", 0, 100, "limite do ajuste: número inteiro de 0 a 100" ]
];

export function settingsProblem(raw: Record<keyof PharmacySettings, string>): string | null {
  for (const [ key, min, max, text ] of SETTINGS_RULES) {
    const v = raw[key].trim();
    if (!INT.test(v) || Number(v) < min || Number(v) > max) return text;
  }
  return null;
}

// ─── Recusas do api (frase, nunca o corpo nem o valor enviado) ─────────────
const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
export const RETURN_EXCEEDS = "a devolução passa do que ainda resta devolver deste item — abra o histórico de novo para ver o atual";
// `lot_expired` na devolução: o ERRORS manda "escolher outro lote", que aqui não existe (a devolução volta ao lote da retirada).
export const RETURN_LOT_EXPIRED = "o lote desta retirada já venceu — a devolução não é aceita; registre o vencimento no ajuste de estoque";
const QUANTITY_TEXT = "quantidade inválida — use até 2 casas depois da vírgula";
const ERRORS: Record<string, string> = {
  insufficient_balance: BALANCE_CHANGED,
  controlled_requires_pharmacist: CONTROLLED_PHARMACIST_ONLY,
  prescription_cancelled: PRESCRIPTION_CHANGED,
  prescription_expired: PRESCRIPTION_CHANGED,
  free_text_requires_pharmacist: FREE_TEXT_PHARMACIST_ONLY,
  retention_required: RETENTION_REQUIRED,
  lot_expired: "lote vencido — escolha outro lote",
  expired_lot: "lote vencido — escolha outro lote",
  invalid_item: "item do catálogo inválido ou inativo",
  invalid_quantity: QUANTITY_TEXT,
  opening_exists: "este item já teve inventário de abertura neste local — corrija por ajuste",
  already_received: "esta transferência já foi recebida — a lista foi relida",
  same_user: "outra pessoa do local precisa aprovar este ajuste",
  not_pending: "este ajuste já foi decidido — a lista foi relida",
  cbo_not_allowed: "farmacêutico precisa de vínculo profissional com CBO 2234",
  role_not_granted: "a pessoa precisa ter este papel na Equipe antes",
  unit_taken: "esta unidade já tem um local de estoque",
  central_exists: "a cidade já tem um almoxarifado central",
  location_has_stock: "o local ainda tem saldo — transfira ou ajuste antes de desativar",
  already_linked: "esta pessoa já está no local com este papel",
  location_inactive: "este local está inativo",
  no_difference: "a contagem é igual ao saldo — não há o que ajustar",
  lot_not_expired: "vencimento só de lote já vencido — use perda",
  lot_mismatch: "este lote já existe com outra validade ou fabricante — confira",
  item_completed: ITEM_COMPLETED,
  notification_required: NOTIFICATION_REQUIRED,
  prescription_not_found: "receita não encontrada nesta cidade — confira o código",
  person_not_found: "ninguém com este CPF no Rota Saúde",
  citizen_not_verified: "este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes",
  invalid_cpf: "CPF inválido: confira os 11 dígitos",
  invalid_cns: "CNS inválido: confira os 15 dígitos",
  reason_required: REASON_TEXT,
  invalid_reason: REASON_TEXT,
  return_exceeds: RETURN_EXCEEDS,
  invalid_items: "informe todos os lotes da transferência",
  too_many_requests: "muitas buscas em pouco tempo — espere um minuto",
  catalog_unavailable: "o catálogo de medicamentos está indisponível — tente de novo em instantes",
  not_found: "não encontrado — a tela foi atualizada",
  duplicate_suspected: DUPLICATE_SUSPECTED_TEXT,
  mfa_required: "o código do autenticador não valeu — digite o código atual",
  missing_role: PHARMACY_NO_ROLE
};

const PATH_RULES: [ RegExp, string ][] = [
  [ /^prescriber(\.|$)/, "confira os dados do profissional da receita: nome, conselho, UF e número" ],
  [ /^issued_on/, "data da receita inválida — confira" ],
  [ /notification_number/, "número da notificação inválido — confira" ],
  [ /quantity/, QUANTITY_TEXT ],
  [ /package/, "embalagem inválida — confira unidades por embalagem e embalagens" ],
  [ /lot_number/, "número do lote inválido — confira" ],
  [ /expires_on/, "validade inválida — confira" ],
  [ /reason/, REASON_TEXT ],
  [ /^document(\.|$)/, "confira o número do documento e o fornecedor" ],
  [ /^new_patient(\.|$)/, "confira os dados do paciente novo" ],
  [ /^items(\[|\.|$)/, "confira o item destacado" ]
];
const INVALID_REQUEST_TEXT = "pedido inválido — recarregue a tela e tente de novo";

function invalidRequestText(path: string | null): string {
  if (!path) return INVALID_REQUEST_TEXT;
  return PATH_RULES.find(([ re ]) => re.test(path))?.[1] ?? INVALID_REQUEST_TEXT;
}

function bodyOf(err: unknown): Record<string, unknown> | null {
  const b = err instanceof ApiError ? err.body : null;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}
const bodyString = (body: Record<string, unknown> | null, key: string): string | null =>
  typeof body?.[key] === "string" && body[key] !== "" ? (body[key] as string) : null;

function tooEarlyText(next: string | null): string {
  return next ? `uso contínuo: próxima retirada deste item a partir de ${fmtDay(next)}` : "uso contínuo: ainda não chegou a próxima retirada deste item";
}

// Uma recusa (do corpo ou de um item de `problems`) → frase. `status` só decide o 404 sem código.
function codeText(code: string | undefined, path: string | null, next: string | null, status: number): string {
  if (code === "invalid_request") return invalidRequestText(path);
  if (code === "too_early") return tooEarlyText(next);
  if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  if (status === 404 && !code) return ERRORS.not_found;
  return `não foi possível concluir (${code ?? status}) — tente de novo`;
}

export function pharmacyError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature !== null) return feature === "" || feature === "pharmacy" ? PHARMACY_DISABLED : `${featureLabel(feature)} está desligado nesta cidade`;
  if (!(err instanceof ApiError)) return "sem conexão com o servidor — tente de novo";
  const body = bodyOf(err);
  return codeText(errorCode(err), bodyString(body, "path"), bodyString(body, "next_allowed_on"), err.status);
}

export function errorPath(err: unknown): string | null {
  return bodyString(bodyOf(err), "path");
}

// D20: todas as recusas de uma vez; sem `problems` no corpo, []. Os índices `items[i]` são os do CORPO ENVIADO.
export function pharmacyProblems(err: unknown): Problem[] {
  const status = err instanceof ApiError ? err.status : 422;
  const list = bodyOf(err)?.problems;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): Problem[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path : "";
    const next = typeof row.next_allowed_on === "string" ? row.next_allowed_on : null;
    return [ { path, text: codeText(typeof row.error === "string" ? row.error : undefined, path || null, next, status) } ];
  });
}

// Recusas com o código de cada uma (a tela reage ao código: relê lotes, avisa receita mudada, abre a retenção). Com `problems`, uma por
// problema; sem ele, a recusa do corpo (path vazio quando não há; code vazio quando não é do api).
export type Refusal = Problem & { code: string };
export function pharmacyRefusals(err: unknown): Refusal[] {
  const status = err instanceof ApiError ? err.status : 422;
  const list = bodyOf(err)?.problems;
  const mapped = Array.isArray(list)
    ? list.flatMap((raw): Refusal[] => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as Record<string, unknown>;
      const code = typeof row.error === "string" ? row.error : "";
      const path = typeof row.path === "string" ? row.path : "";
      const next = typeof row.next_allowed_on === "string" ? row.next_allowed_on : null;
      return [ { path, code, text: codeText(code || undefined, path || null, next, status) } ];
    })
    : [];
  // `problems` ausente, vazio ou só com entradas inválidas: vale a recusa do topo do corpo.
  if (mapped.length > 0) return mapped;
  return [ { path: errorPath(err) ?? "", code: errorCode(err) ?? "", text: pharmacyError(err) } ];
}

// "items[2].quantity" → 2 (posição no corpo enviado); sem índice, null.
export function problemItemIndex(path: string | null | undefined): number | null {
  const m = path ? /^items\[(\d+)\]/.exec(path) : null;
  return m ? Number(m[1]) : null;
}
