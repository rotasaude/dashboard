// Regras de tela do módulo 27b (envio à BNAFAR, saída externa e saldo inicial; contrato 2026-11-24 §1–§7, Q6–Q17, Q40–Q45) sem React.
// O api é a fonte: pendência, alerta, prazo de reenvio e de correção, divisão em remessas e conversão de unidade são dele. A tela mostra o que
// vem e só não oferece nem envia o que já sabe que será recusado. Nenhuma conta de prazo ou de relógio aqui (Q42, Q25).
import {
  ApiError, errorCode,
  type BnafarAlert, type BnafarDomains, type BnafarField, type BnafarLotInput, type BnafarRecord, type BnafarSubmission, type ExternalExitInput,
  type ExternalExitType, type LotBalance, type LotBnafarState, type StockDomain, type VaccineBnafarLotInput
} from "./api";
import { BNAFAR_DISABLED, bnafarErrorText, hasBnafarError } from "./bnafarErrors";
import { featureDisabledKey, hasFeature, type FeatureKey } from "./features";
import { STATIC_QUERY, canUseStockScreens, pharmacyError, pharmacyRefusals, type Problem } from "./pharmacy";

export { STATIC_QUERY };
export type { BnafarField };
export { BNAFAR_DISABLED, BNAFAR_ERRORS, bnafarErrorText, bnafarErrorTexts, rowErrorText } from "./bnafarErrors";

// ─── Frases fixas (proposta) ────────────────────────────────────────────────
export const BNAFAR_NO_ROLE = "seu papel não permite ver o envio à BNAFAR";
// Reenvio e correção pedem o `bnafar` utilizável (Q40): ligado, mas sem credencial ou IBGE, o api responde 403 `feature_disabled` `bnafar`.
export const BNAFAR_NOT_USABLE = "o envio está sem credencial válida — o administrador confere em Integrações";
// F-32: o complemento mostra a recusa `lot_mismatch` no campo que o api cita.
export const LOT_MISMATCH_FIELD = "o lote já tem outro valor gravado aqui — confira no extrato do lote";
export const LOT_BNAFAR_SAVED = "Dados do lote salvos. O lote entra na posição de estoque do próximo envio.";
// Q21: o CNPJ do fabricante da vacina sai do catálogo de imunobiológicos, nunca da tela.
export const VACCINE_CNPJ_FROM_CATALOG = "o CNPJ do fabricante vem do catálogo de imunobiológicos — peça à equipe do Rota Saúde";

// ─── Chaves de leitura (tudo sem pessoa → STATIC_QUERY; nenhum polling) ─────
export const BNAFAR_STATUS_KEY = "bnafarStatus";
export const BNAFAR_SUBMISSIONS_KEY = "bnafarSubmissions";
export const BNAFAR_SUBMISSION_KEY = "bnafarSubmission";
export const BNAFAR_PENDENCIES_KEY = "bnafarPendencies";
export const BNAFAR_DOMAINS_KEY = "bnafarDomains";
export const BNAFAR_PRESENTATIONS_KEY = "bnafarPresentations";
export const EXTERNAL_EXITS_KEY = "externalExits";
export const PH_OPENINGS_KEY = "pharmacyOpenings";
export const OPENING_IMPORTS_KEY = "openingImports";

// ─── Portões e papéis ───────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// `bnafar` LIGADO na sessão e nunca o operador. A sessão traz as ligadas, não as utilizáveis: o api ainda pode responder 403
// `feature_disabled` (sem credencial ou IBGE) em reenvio e correção.
export function canUseBnafar(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "bnafar");
}

// Q32 (F-13): leem o `municipal_admin`, o `stock_keeper` e o `pharmacist` de qualquer local; o `room_lead` de sala de vacina também lê,
// mas é papel de sala e a sessão não o traz (a tela trata o 403 `missing_role` com BNAFAR_NO_ROLE). Reenvio e correção: só o admin.
export function bnafarRoles(user: SessionLike): { admin: boolean; keeper: boolean; pharmacist: boolean; reader: boolean } {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const admin = roles.includes("municipal_admin"), keeper = roles.includes("stock_keeper"), pharmacist = roles.includes("pharmacist");
  return { admin, keeper, pharmacist, reader: admin || keeper || pharmacist };
}

// Status e remessas: o `bnafar` ligado (Q40) e papel de leitor.
export const canSeeStatus = (user: SessionLike): boolean => canUseBnafar(user) && bnafarRoles(user).reader;

// Pendências e complemento do lote: só o estoque de algum domínio, nunca o `bnafar` (Q22, Q23).
export function canSeePendencies(user: SessionLike): boolean {
  return !!user && !user.operator && bnafarRoles(user).reader && (canUseStockScreens(user) || hasFeature(user, "vaccination"));
}

// F-23: o botão depende dos recusados da remessa; o prazo é do api (409 `retry_window_closed`), nunca conta de relógio.
export function canResend(s: Pick<BnafarSubmission, "counts" | "status">, admin: boolean): boolean {
  return admin && s.counts.rejected > 0 && s.status !== "lost";
}

export const DOMAIN_FEATURE: Record<string, FeatureKey> = {
  medication: "bnafar_medications", immunobiological: "bnafar_vaccines", vector_control: "bnafar_vector_supplies"
};
export const KIND_DOMAIN: Record<string, StockDomain> = {
  central: "medication", unit: "medication", vaccine_room: "immunobiological", cold_chain_central: "immunobiological", vector_control: "vector_control"
};

const LOT_FIELDS: BnafarField[] = [ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program", "ampp_code" ];

// Campos exigidos na entrada e na abertura: os do domínio do local, só se o `GET /pharmacy/bnafar/domains` o lista em `enabled_domains`
// (Gate.domains_enabled é a fonte única, Q41; sem sessão de apoio). Sem a lista ou com o domínio fora dela, nada é exigido e os campos
// são opcionais. A vacina não tem fabricante (Q21); o produto de campo não tem AMPP.
export function bnafarFieldsFor(enabled: StockDomain[] | null | undefined, locationKind: string): BnafarField[] {
  const domain = KIND_DOMAIN[locationKind];
  if (!domain || !enabled?.includes(domain)) return [];
  if (domain === "immunobiological") return LOT_FIELDS.filter((f) => f !== "manufacturer_cnpj");
  if (domain === "vector_control") return LOT_FIELDS.filter((f) => f !== "ampp_code");
  return LOT_FIELDS;
}

// ─── Formato (recusar, nunca cortar; o api confere de novo) ────────────────
const MAX_PRICE_CENTS = 2_000_000_000;
const PRICE_PLAIN = /^\d+(,\d{1,2})?$/;
const PRICE_GROUPED = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;

// Reais com vírgula, até 2 casas, > 0 e até 20.000.000,00 → centavos inteiros; qualquer outra coisa, null.
export function parseUnitPrice(raw: string): number | null {
  const t = raw.trim();
  if (!PRICE_PLAIN.test(t) && !PRICE_GROUPED.test(t)) return null;
  const [ int, dec = "" ] = t.replace(/\./g, "").split(",");
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  return cents > 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}

export function fmtCents(cents: number): string {
  const int = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${int},${String(cents % 100).padStart(2, "0")}`;
}

// Documento: pontos, barras, hífens e espaços saem, e as letras sobem. Outro caractere → null (o CNPJ novo da Receita é alfanumérico, Q7).
export function docOf(raw: string): string | null {
  const t = raw.replace(/[\s./-]/g, "").toUpperCase();
  return /^[0-9A-Z]*$/.test(t) ? t : null;
}

export function cnpjProblem(raw: string): string | null {
  const d = docOf(raw);
  return d !== null && /^[0-9A-Z]{12}\d{2}$/.test(d) ? null : bnafarErrorText("invalid_cnpj");
}
export function anvisaProblem(raw: string): string | null {
  const d = docOf(raw);
  return d !== null && /^(\d{11}|\d{13})$/.test(d) ? null : bnafarErrorText("invalid_anvisa");
}
export function cnesProblem(raw: string): string | null {
  const d = docOf(raw);
  return d !== null && /^\d{7}$/.test(d) ? null : "o CNES tem 7 dígitos";
}
// CATMAT: inteiro positivo de até 9 dígitos (proposta).
export function catmatProblem(raw: string): string | null {
  const t = raw.trim();
  return /^\d{1,9}$/.test(t) && Number(t) > 0 ? null : "o CATMAT é um número inteiro positivo de até 9 dígitos";
}
const length = (s: string): number => Array.from(s).length;
// F-10: o nome do fabricante internacional vai em `manufacturer`, com 1 a 120 caracteres.
export function internationalNameProblem(raw: string): string | null {
  const n = length(raw.trim());
  return n >= 1 && n <= 120 ? null : "o nome do fabricante internacional tem de 1 a 120 caracteres";
}
const amppProblem = (raw: string): string | null => /^[@0-9A-Za-z]{1,25}$/.test(raw.trim()) ? null : "escolha a apresentação (AMPP) do produto";

// ─── Campos BNAFAR do lote ──────────────────────────────────────────────────
export const BNAFAR_FIELD_LABEL: Record<string, string> = {
  unit_price_cents: "Valor unitário (R$)", manufacturer_cnpj: "CNPJ do fabricante", manufacturer: "Nome do fabricante internacional",
  anvisa_registration: "Registro ANVISA", health_program: "Programa de saúde", ampp_code: "Apresentação (AMPP)",
  // Campos que o api cita nas pendências (`fields`) e não são do lote.
  lot_number: "Número do lote", cnes: "CNES", vmp_code: "VMP do medicamento", obm_vmp: "Código OBM da vacina", catmat_code: "CATMAT do produto"
};
export const bnafarFieldLabel = (field: string): string => BNAFAR_FIELD_LABEL[field] ?? field;

export type LotBnafarDraft = {
  unitPrice: string; international: boolean; cnpj: string; internationalName: string; anvisa: string; program: string; ampp: string
};
export const EMPTY_LOT_BNAFAR: LotBnafarDraft = { unitPrice: "", international: false, cnpj: "", internationalName: "", anvisa: "", program: "", ampp: "" };

// Os campos que o `missing` do api cita (os que a tela sabe preencher); chave nova do api é ignorada.
export function missingFields(state: LotBnafarState | null | undefined): BnafarField[] {
  const missing = state?.missing ?? [];
  return LOT_FIELDS.filter((f) => missing.includes(f));
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const filled = (s: string): boolean => s.trim() !== "";
const inform = (field: string): string => `informe ${lowerFirst(bnafarFieldLabel(field))}`;

// Exigido vazio → "informe …". Fabricante: o CNPJ ou, com `international`, o nome (Q15). AMPP só com VMP (Q15). Preenchido e inválido recusa,
// exigido ou não. O campo do problema é o do api (`manufacturer` para o nome internacional).
export function lotBnafarProblems(d: LotBnafarDraft, required: BnafarField[], opts: { hasVmp: boolean }): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const need = (f: BnafarField) => required.includes(f);
  if (filled(d.unitPrice)) {
    if (parseUnitPrice(d.unitPrice) === null) out.push({ field: "unit_price_cents", text: "valor unitário inválido — use reais com vírgula, maior que zero" });
  } else if (need("unit_price_cents")) out.push({ field: "unit_price_cents", text: inform("unit_price_cents") });

  if (d.international) {
    if (filled(d.internationalName)) {
      const text = internationalNameProblem(d.internationalName);
      if (text) out.push({ field: "manufacturer", text });
    } else out.push({ field: "manufacturer", text: inform("manufacturer") }); // o api exige o nome sempre que `manufacturer_international` é true
  } else if (filled(d.cnpj)) {
    const text = cnpjProblem(d.cnpj);
    if (text) out.push({ field: "manufacturer_cnpj", text });
  } else if (need("manufacturer_cnpj")) out.push({ field: "manufacturer_cnpj", text: inform("manufacturer_cnpj") });

  if (filled(d.anvisa)) {
    const text = anvisaProblem(d.anvisa);
    if (text) out.push({ field: "anvisa_registration", text });
  } else if (need("anvisa_registration")) out.push({ field: "anvisa_registration", text: inform("anvisa_registration") });

  if (!filled(d.program) && need("health_program")) out.push({ field: "health_program", text: inform("health_program") });

  if (filled(d.ampp)) {
    const text = amppProblem(d.ampp);
    if (text) out.push({ field: "ampp_code", text });
  } else if (need("ampp_code") && opts.hasVmp) out.push({ field: "ampp_code", text: inform("ampp_code") });
  return out;
}

// Só o preenchido. Internacional: `manufacturer_international: true` e o nome em `manufacturer`, sem CNPJ (F-10). Só depois de
// lotBnafarProblems vazio: o que não passa no formato fica de fora.
export function lotBnafarBody(d: LotBnafarDraft): BnafarLotInput {
  const body: BnafarLotInput = {};
  const cents = parseUnitPrice(d.unitPrice);
  if (cents !== null) body.unit_price_cents = cents;
  if (d.international) {
    body.manufacturer_international = true;
    if (filled(d.internationalName)) body.manufacturer = d.internationalName.trim();
  } else if (filled(d.cnpj)) {
    const cnpj = docOf(d.cnpj);
    if (cnpj) body.manufacturer_cnpj = cnpj;
  }
  const anvisa = filled(d.anvisa) ? docOf(d.anvisa) : null;
  if (anvisa) body.anvisa_registration = anvisa;
  if (filled(d.program)) body.health_program = d.program.trim();
  if (filled(d.ampp)) body.ampp_code = d.ampp.trim();
  return body;
}

// Q21: a vacina não leva fabricante nem CNPJ no corpo (o api recusa com `invalid_request`).
export function vaccineBnafarBody(d: LotBnafarDraft): VaccineBnafarLotInput {
  const { manufacturer_cnpj: _c, manufacturer_international: _i, manufacturer: _m, ...rest } = lotBnafarBody(d);
  return rest;
}

// ─── Saída externa ──────────────────────────────────────────────────────────
export type ExitLine = { key: string; lot: LotBalance | null; quantity: string };
export type ExternalExitDraft = {
  exitType: string; destinationKind: "cnes" | "cnpj"; destination: string; reason: string; lines: ExitLine[]
};
const MAX_EXIT_QUANTITY = 99_999;

// Parte inteira do saldo ("3.50" → 3): a BNAFAR só aceita quantidade inteira.
const wholeBalance = (balance: string): number => Math.trunc(Number(balance));

// `today` (Q28/Q29): com ele, lote bloqueado nunca sai e lote vencido só sai na devolução ao fornecedor (S-DF); o api recusa de novo.
export function externalExitProblems(d: ExternalExitDraft, today?: string): Problem[] {
  const out: Problem[] = [];
  if (!d.exitType) out.push({ path: "exit_type", text: "escolha o tipo da saída" });
  const destProblem = d.destinationKind === "cnes" ? cnesProblem(d.destination) : cnpjProblem(d.destination);
  if (destProblem) out.push({ path: "destination_code", text: destProblem });
  const reasonLength = length(d.reason.trim());
  if (reasonLength < 10 || reasonLength > 500) out.push({ path: "reason", text: "o motivo tem de 10 a 500 caracteres" });
  if (d.lines.length === 0) out.push({ path: "items", text: "informe ao menos um lote" });
  const seen = new Set<string>();
  d.lines.forEach((line, i) => {
    if (!line.lot) { out.push({ path: `items[${i}].lot_id`, text: "escolha o lote" }); return; }
    if (seen.has(line.lot.lot.id)) out.push({ path: `items[${i}].lot_id`, text: "este lote já está na saída — junte as quantidades" });
    seen.add(line.lot.lot.id);
    if (today && line.lot.blocked) { out.push({ path: `items[${i}].lot_id`, text: bnafarErrorText("lot_blocked") }); return; }
    if (today && d.exitType !== "S-DF" && line.lot.lot.expires_on < today) { out.push({ path: `items[${i}].lot_id`, text: bnafarErrorText("lot_expired") }); return; }
    const q = line.quantity.trim();
    const whole = wholeBalance(line.lot.balance);
    if (!/^\d+$/.test(q)) out.push({ path: `items[${i}].quantity`, text: "a quantidade é um número inteiro, sem vírgula" });
    else if (Number(q) < 1) out.push({ path: `items[${i}].quantity`, text: "a quantidade precisa ser ao menos 1" });
    else if (Number(q) > MAX_EXIT_QUANTITY) out.push({ path: `items[${i}].quantity`, text: "a quantidade pode ser no máximo 99999" });
    else if (Number(q) > whole) out.push({ path: `items[${i}].quantity`, text: `saída maior que o saldo inteiro do lote (${whole})` });
  });
  return out;
}

// Só depois de externalExitProblems vazio. O destino sem pontuação, a quantidade como número e o motivo aparado.
export function externalExitBody(d: ExternalExitDraft, locationId: string): ExternalExitInput {
  return {
    location_id: locationId, exit_type: d.exitType as ExternalExitType, destination_kind: d.destinationKind,
    destination_code: docOf(d.destination) ?? d.destination, reason: d.reason.trim(),
    items: d.lines.flatMap((l) => l.lot ? [ { lot_id: l.lot.lot.id, quantity: Number(l.quantity.trim()) } ] : [])
  };
}

// ─── Rótulos (proposta; código desconhecido aparece cru) ───────────────────
const SUBJECT: Record<string, string> = { position: "Posição de estoque", exit: "Saídas" };
export const subjectLabel = (code: string): string => SUBJECT[code] ?? code;

const ENVIRONMENT: Record<string, string> = { production: "Produção", homologation: "Homologação" };
export const environmentLabel = (code: string): string => ENVIRONMENT[code] ?? code;

const SUBMISSION: Record<string, [ string, string ]> = {
  building: [ "montando", "info" ], queued: [ "na fila", "info" ], sending: [ "enviando", "info" ],
  processing: [ "em processamento na BNAFAR", "info" ], finished: [ "concluída", "ok" ], failed: [ "falhou", "down" ], lost: [ "perdida", "down" ]
};
export const submissionStatusLabel = (code: string): string => SUBMISSION[code]?.[0] ?? code;
export const submissionStatusTone = (code: string): string => SUBMISSION[code]?.[1] ?? "neutral";

// F-07: `lost` é um sinal sobre o registro recusado, não um status; o excluído vem de `deleted`; aceito em parte tem `rejected_items > 0`.
export function recordStatusLabel(r: Pick<BnafarRecord, "status" | "lost" | "deleted" | "rejected_items">): string {
  if (r.lost) return "perdido";
  if (r.deleted) return "excluído na BNAFAR";
  if (r.status === "accepted" && r.rejected_items > 0) return `aceito em parte (${r.rejected_items} ${r.rejected_items === 1 ? "item" : "itens"})`;
  return ({ pending: "aguardando", accepted: "aceito", rejected: "recusado" } as Record<string, string>)[r.status] ?? r.status;
}
export function recordStatusTone(r: Pick<BnafarRecord, "status" | "lost" | "deleted" | "rejected_items">): string {
  if (r.lost) return "down";
  if (r.deleted) return "neutral";
  if (r.status === "accepted") return r.rejected_items > 0 ? "warn" : "ok";
  return ({ pending: "info", rejected: "down" } as Record<string, string>)[r.status] ?? "neutral";
}

const EXIT_TYPE: Record<string, string> = { "S-DF": "Devolução ao fornecedor", "S-TR": "Remanejamento a outro ente", "S-D": "Doação", "S-E": "Empréstimo" };
export function exitTypeLabel(domains: Pick<BnafarDomains, "exit_types"> | null | undefined, code: string): string {
  return domains?.exit_types.find((t) => t.code === code)?.label ?? EXIT_TYPE[code] ?? code;
}

export const pendencyLabel = bnafarErrorText;

// ─── Alerta (as contagens são do api; só a frase é daqui) ──────────────────
export function alertLines(a: BnafarAlert): string[] {
  const out: string[] = [];
  if (a.late > 0) {
    out.push(a.late === 1
      ? "1 remessa ainda não concluída pela BNAFAR depois das 15:00 do dia seguinte."
      : `${a.late} remessas ainda não concluídas pela BNAFAR depois das 15:00 do dia seguinte.`);
  }
  if (a.rejected > 0) {
    out.push(a.rejected === 1
      ? "1 registro recusado ainda pode ser corrigido e reenviado hoje."
      : `${a.rejected} registros recusados ainda podem ser corrigidos e reenviados hoje.`);
  }
  if (a.lost > 0) {
    out.push(a.lost === 1
      ? "1 registro perdido nos últimos 30 dias — veja o motivo na lista."
      : `${a.lost} registros perdidos nos últimos 30 dias — veja o motivo na lista.`);
  }
  return out;
}

// ─── Recusas ────────────────────────────────────────────────────────────────
// `write`: reenvio e correção, que pedem o `bnafar` UTILIZÁVEL (Q40); o 403 `bnafar` ali é credencial, não interruptor desligado.
export function bnafarError(err: unknown, opts: { write?: boolean } = {}): string {
  const feature = featureDisabledKey(err);
  if (feature === "bnafar") return opts.write ? BNAFAR_NOT_USABLE : BNAFAR_DISABLED;
  if (feature === null && errorCode(err) === "missing_role") return BNAFAR_NO_ROLE;
  // Nas telas do envio a tabela da BNAFAR vem antes da da farmácia: `invalid_quantity`, `lot_expired` etc. querem dizer outra coisa aqui.
  const code = errorCode(err);
  if (feature === null && code && hasBnafarError(code)) return bnafarErrorText(code);
  return pharmacyError(err);
}

// Recusas por item (`problems`) com a mesma prioridade; o path é o do api (`items[i].campo`).
export function bnafarProblems(err: unknown): Problem[] {
  return pharmacyRefusals(err).map(({ path, code, text }) => ({ path, text: code && hasBnafarError(code) ? bnafarErrorText(code) : text }));
}

// 409 com este código: o dado mudou; a tela relê uma vez e mantém o digitado.
export function isStale(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.status === 409 && errorCode(err) === code;
}

// Entrada e abertura: a frase da farmácia vence (`opening_exists` quer dizer "inventário de abertura" ali); o código que a farmácia
// não conhece (`lot_mismatch`, `anvisa_mismatch`, `required` por campo...) usa a tabela do envio, nunca o genérico.
export function entryProblems(err: unknown): Problem[] {
  return pharmacyRefusals(err).map(({ path, code, text }) => ({
    path, text: code && hasBnafarError(code) && text.startsWith(`não foi possível concluir (${code})`) ? bnafarErrorText(code) : text
  }));
}
