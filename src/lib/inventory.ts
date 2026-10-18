// src/lib/inventory.ts
// Estoque do laboratório municipal (módulo 21c; contrato 2026-10-18 §5 e §7).
// Regras de tela, puras. O saldo de verdade, o lote em uso e a recusa de
// saída maior que o saldo são do api; aqui só não se envia o que já se sabe
// que será recusado. Nada é baixado sozinho (spec §6.8).
import type { QueryClient } from "@tanstack/react-query";
import {
  errorCode,
  type LabSupply, type LabSupplyInput, type LabSupplyLotInput, type LabSupplyMovementInput, type ReagentLotRef, type SupplyKind, type SupplyOrigin
} from "./api";
import { featureDisabledKey } from "./features";
import { labError } from "./lab";
import { QC_DISABLED, TEXT_MAX, tooLong } from "./qc";
import type { Tone } from "../theme/tokens";

export const INV_SUPPLIES_KEY = "invSupplies";
export const INV_LOTS_KEY = "invLots";
export const INV_MOVEMENTS_KEY = "invMovements";
export const INV_IN_USE_KEY = "invInUse";
export const INV_ALERTS_KEY = "invAlerts";
export const INV_CONSUMPTION_KEY = "invConsumption";
const INV_KEYS = [ INV_SUPPLIES_KEY, INV_LOTS_KEY, INV_MOVEMENTS_KEY, INV_IN_USE_KEY, INV_ALERTS_KEY, INV_CONSUMPTION_KEY ];

export const INVENTORY_DISABLED = "o estoque do laboratório está desligado nesta cidade";
export const UNTRACED = "sem rastreio de reagente";

export const SUPPLY_KIND_LABEL: Record<SupplyKind, string> = { reagent: "Reagente", calibrator: "Calibrador", control: "Controle", consumable: "Consumível" };
export function supplyKindLabel(k: string): string { return (SUPPLY_KIND_LABEL as Record<string, string>)[k] ?? k; }
export const SUPPLY_ORIGIN_LABEL: Record<SupplyOrigin, string> = { purchase: "compra", donation: "doação", loan: "empréstimo" };
export function originLabel(o: string): string { return (SUPPLY_ORIGIN_LABEL as Record<string, string>)[o] ?? o; }
const MOVEMENT: Record<string, string> = { receipt: "entrada", opening: "abertura", loss: "perda", expiry: "vencimento", adjustment: "ajuste" };
export function movementLabel(k: string): string { return MOVEMENT[k] ?? k; }
// O api devolve a quantidade com sinal (abertura, perda e vencimento negativos).
export function fmtMovementQuantity(q: number): string { return q > 0 ? `+${q}` : String(q); }

export function integerProblem(raw: string, label: string, opts: { min?: number; max?: number; allowNegative?: boolean } = {}): string | null {
  const t = raw.trim();
  if (t === "") return `informe ${label}`;
  if (!(opts.allowNegative ? /^-?\d+$/ : /^\d+$/).test(t)) return `${label} é um número inteiro`;
  const n = Number(t);
  if (opts.min !== undefined && n < opts.min) return `${label} precisa ser ao menos ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `${label} pode ser no máximo ${opts.max}`;
  return null;
}

const QTY_MAX = 100000; // limite do api em quantidades, rendimento e mínimo

export interface SupplyDraft {
  name: string; kind: SupplyKind | ""; unit: string; testsPerPackage: string; minimumStock: string; expiryAlertDays: string; examIds: string[]; active: boolean;
}
export const EMPTY_SUPPLY: SupplyDraft = { name: "", kind: "", unit: "", testsPerPackage: "", minimumStock: "0", expiryAlertDays: "30", examIds: [], active: true };

export function supplyDraft(s: LabSupply): SupplyDraft {
  return {
    name: s.name, kind: s.kind as SupplyKind, unit: s.unit, testsPerPackage: s.tests_per_package === null ? "" : String(s.tests_per_package),
    minimumStock: String(s.minimum_stock), expiryAlertDays: String(s.expiry_alert_days), examIds: s.lab_exam_ids, active: s.active
  };
}

export function supplyProblem(d: SupplyDraft): string | null {
  if (!d.name.trim()) return "informe o nome do item";
  if (!d.kind) return "escolha o tipo do item";
  if (!d.unit.trim()) return "informe a unidade (ex.: kit, frasco, caixa)";
  const long = tooLong(d.name, 120, "nome") ?? tooLong(d.unit, 20, "unidade");
  if (long) return long;
  if (d.kind === "reagent" && !d.testsPerPackage.trim()) return "informe quantos testes rende cada embalagem do reagente";
  if (d.testsPerPackage.trim()) {
    const p = integerProblem(d.testsPerPackage, "o rendimento", { min: 1, max: QTY_MAX });
    if (p) return p;
  }
  const min = integerProblem(d.minimumStock, "o estoque mínimo", { min: 0, max: QTY_MAX });
  if (min) return min;
  if (integerProblem(d.expiryAlertDays, "o aviso", { min: 1, max: 365 })) return "aviso de vencimento de 1 a 365 dias";
  if (d.kind === "reagent" && d.examIds.length === 0) return "ligue o reagente a ao menos um exame";
  return null;
}

export function supplyBody(d: SupplyDraft, providerId: string): LabSupplyInput {
  return {
    provider_id: providerId, name: d.name.trim(), kind: d.kind as SupplyKind, unit: d.unit.trim(),
    tests_per_package: d.kind === "reagent" && d.testsPerPackage.trim() ? Number(d.testsPerPackage) : null,
    minimum_stock: Number(d.minimumStock), expiry_alert_days: Number(d.expiryAlertDays), lab_exam_ids: d.examIds, active: d.active
  };
}

export interface LotEntryDraft { supplyId: string; lotNumber: string; expiresOn: string; supplier: string; origin: SupplyOrigin | ""; quantity: string; document: string }
export const EMPTY_LOT_ENTRY: LotEntryDraft = { supplyId: "", lotNumber: "", expiresOn: "", supplier: "", origin: "", quantity: "", document: "" };

export function lotEntryProblem(d: LotEntryDraft, today: string): string | null {
  if (!d.supplyId) return "escolha o item";
  if (!d.lotNumber.trim()) return "informe o número do lote";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.expiresOn)) return "informe a validade";
  if (d.expiresOn < today) return "lote vencido — não entra no estoque";
  if (!d.supplier.trim()) return "informe o fornecedor";
  if (!d.origin) return "escolha a origem";
  const long = tooLong(d.lotNumber, 40, "número do lote") ?? tooLong(d.supplier, 120, "fornecedor") ?? tooLong(d.document, 60, "documento");
  if (long) return long;
  return integerProblem(d.quantity, "a quantidade", { min: 1, max: QTY_MAX });
}

export function lotEntryBody(d: LotEntryDraft): LabSupplyLotInput {
  const doc = d.document.trim();
  return {
    supply_id: d.supplyId, lot_number: d.lotNumber.trim(), expires_on: d.expiresOn, supplier: d.supplier.trim(), origin: d.origin as SupplyOrigin,
    quantity: Number(d.quantity), ...(doc ? { document: doc } : {})
  };
}

export interface MovementDraft { kind: LabSupplyMovementInput["kind"] | ""; quantity: string; reason: string }
export const EMPTY_MOVEMENT: MovementDraft = { kind: "", quantity: "", reason: "" };

// Abertura sem motivo; perda, vencimento e ajuste com motivo (spec §6.4).
export function movementProblem(d: MovementDraft, balance: number, isAdmin: boolean): string | null {
  if (!d.kind) return "escolha o movimento";
  if (d.kind === "adjustment" && !isAdmin) return "ajuste é só do administrador";
  const adjustment = d.kind === "adjustment";
  const q = integerProblem(d.quantity, adjustment ? "o ajuste" : "a quantidade", adjustment ? { allowNegative: true, min: -QTY_MAX, max: QTY_MAX } : { min: 1, max: QTY_MAX });
  if (q) return q;
  const n = Number(d.quantity);
  if (adjustment && n === 0) return "o ajuste não pode ser zero";
  const out = adjustment ? -n : n;
  if (out > balance) return `saída maior que o saldo do lote (${balance})`;
  if (d.kind !== "opening" && !d.reason.trim()) return "escreva o motivo";
  return tooLong(d.reason, TEXT_MAX, "motivo");
}

export function movementBody(d: MovementDraft, lotId: string): LabSupplyMovementInput {
  const kind = d.kind as LabSupplyMovementInput["kind"];
  const reason = d.reason.trim();
  // A abertura não leva motivo (o api aceita sem); sobra de outro movimento não vai junto.
  return { lot_id: lotId, kind, quantity: Number(d.quantity), ...(kind !== "opening" && reason ? { reason } : {}) };
}

// Contrato §7: `reagent_lot` null = gravado sem lote em uso. Ausente = api
// antigo ou quem não é do laboratório: nada aparece. Com o estoque desligado
// todo resultado viria null — a marca não aparece para não acender tudo.
export function reagentLotMark(row: { reagent_lot?: ReagentLotRef | null }, inventoryOn: boolean): { text: string; untraced: boolean } | null {
  // Estoque desligado: nenhuma marca (o 21b fica igual), nem o lote gravado antes.
  if (!inventoryOn) return null;
  if (row.reagent_lot) return { text: `lote ${row.reagent_lot.lot_number}`, untraced: false };
  if (row.reagent_lot === null) return { text: UNTRACED, untraced: true };
  return null;
}

export function fmtDeviation(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const rounded = Number(pct.toFixed(1));
  const t = Math.abs(rounded).toFixed(1).replace(".", ",");
  return rounded > 0 ? `+${t}%` : rounded < 0 ? `-${t}%` : `${t}%`;
}

export function deviationTone(pct: number | null): Tone | undefined {
  return pct !== null && Math.abs(pct) > 20 ? "warn" : undefined;
}

// Frases próprias: o labError fala de etiqueta, de motivo de rejeição e de unidade de origem.
const ERRORS: Record<string, string> = {
  not_found: "não encontrado neste laboratório — a tela foi atualizada",
  duplicate_name: "já existe um item com este nome neste laboratório",
  duplicate_lot: "este número de lote já existe neste item com outra validade",
  expired_lot: "lote vencido — não pode ser usado",
  insufficient_balance: "saída maior que o saldo do lote — o saldo foi relido",
  reason_required: "escreva o motivo",
  invalid_reason: "motivo longo demais — use até 1000 caracteres",
  lot_not_reagent: "só lote de reagente fica em uso no aparelho",
  exam_not_linked: "este exame não está ligado ao item — o administrador liga no cadastro do item",
  invalid_instrument: "aparelho inválido — ele precisa estar ativo e ser deste laboratório",
  invalid_quantity: "quantidade inválida — use um número inteiro de 1 a 100000 (o ajuste aceita sinal)",
  invalid_name: "nome do item inválido — use de 1 a 120 caracteres",
  invalid_unit: "unidade inválida — use de 1 a 20 caracteres",
  invalid_kind: "tipo inválido",
  invalid_tests_per_package: "rendimento inválido — só o reagente tem, de 1 a 100000 testes por embalagem",
  invalid_minimum_stock: "estoque mínimo inválido — use de 0 a 100000",
  invalid_expiry_alert_days: "aviso de vencimento de 1 a 365 dias",
  invalid_exams: "exames inválidos — escolha exames deste laboratório, sem repetir",
  invalid_active: "situação do item inválida",
  invalid_lot_number: "número do lote inválido — use de 1 a 40 caracteres",
  invalid_supplier: "fornecedor inválido — use de 1 a 120 caracteres",
  invalid_origin: "origem inválida",
  invalid_document: "documento longo demais — use até 60 caracteres",
  invalid_expires_on: "validade inválida — informe a data",
  invalid_month: "mês inválido",
  invalid_provider: "laboratório inválido; escolha o laboratório de novo",
  filter_required: "faltou escolher o item, o lote ou o aparelho",
  mfa_required: "o código do autenticador não valeu — digite o código atual",
  missing_role: "seu papel não permite esta ação"
};

export function inventoryError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature === "lab_inventory") return INVENTORY_DISABLED;
  if (feature === "lab_quality_control") return QC_DISABLED;
  const code = errorCode(err);
  if (code && ERRORS[code]) return ERRORS[code];
  return labError(err);
}

export async function refreshInventory(client: QueryClient): Promise<void> {
  await Promise.all(INV_KEYS.map((key) => client.invalidateQueries({ queryKey: [ key ] })));
}
