// Regras de tela do TFD (módulo 30; Portaria SAS/MS 55/1999; contrato §6). Distância, região metropolitana, procedimento da atenção básica, cálculo da ajuda de custo, BPA e trilha são do api; a tela espelha as recusas que já conhece.
// Formas e códigos conferidos contra o api (api-surface do módulo 30): onde o plano diz outra coisa, vale o api.
import {
  ApiError,
  type TfdAllowance, type TfdCase, type TfdCaseInput, type TfdCaseRow, type TfdDecision, type TfdLegInput, type TfdOptions, type TfdPayment,
  type TfdPaymentInput, type TfdPaymentMethod, type TfdPrefill
} from "./api";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { cityIsoDate, parseCityLocal } from "./format";
import type { Problem, Refusal } from "./pharmacy";
import { MAX_CENTS, canUseTransport, parseReais, transportRefusals, transportRoles } from "./transport";

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const TFD_DISABLED = "o TFD está desligado nesta cidade";
export const TFD_NO_ROLE = "seu papel não permite usar o TFD";
export const APPOINTMENT_REQUIRED = "marque o atendimento no destino antes de autorizar";
export const FILE_TOO_BIG = "o comprovante passa de 10 MB";
export const FILE_TYPE = "o comprovante precisa ser PDF, JPG ou PNG";
export const FILE_EMPTY = "o comprovante está vazio";
export const READ_TRAIL_NOTE = "Abrir o laudo fica registrado na trilha de acesso.";

export const TFD_CASES_KEY = "tfdCases";
export const TFD_MY_CASES_KEY = "tfdMyCases";
export const TFD_OPTIONS_KEY = "tfdOptions";

// ─── Portão e papéis ────────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// A sessão traz as chaves LIGADAS, não as usáveis: o api recusa o /tfd/* (403 feature_disabled) quando falta transporte ou prontuário.
export function canUseTfd(user: SessionLike): boolean {
  return canUseTransport(user) && hasFeature(user, "tfd") && hasFeature(user, "clinical_record");
}

export function tfdRoles(user: SessionLike): { committee: boolean; professional: boolean; admin: boolean } {
  const { committee, professional, admin } = transportRoles(user);
  return { committee, professional, admin };
}

// Pedir TFD: médico (vínculo profissional com CBO 225*). A sessão não traz o CBO: quem chama passa o do vínculo (null = não sabe → não oferece).
export function canRequestTfd(user: SessionLike, cbo: string | null | undefined): boolean {
  return canUseTfd(user) && tfdRoles(user).professional && !!cbo && cbo.startsWith("225");
}

// ─── Rótulos. Código novo do api aparece cru. ───────────────────────────────
const pick = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);

export const tfdStatusLabel = pick({
  draft: "rascunho", submitted: "aguardando a comissão", returned: "devolvido para complementar", authorized: "autorizado", denied: "recusado",
  scheduled: "viagem marcada", travelling: "em viagem", completed: "concluído", cancelled: "cancelado"
});
const STATUS_TONE: Record<string, string> = {
  draft: "neutral", submitted: "info", returned: "warn", authorized: "ok", denied: "down", scheduled: "ok", travelling: "info", completed: "neutral", cancelled: "down"
};
export const tfdStatusTone = (code: string): string => (Object.prototype.hasOwnProperty.call(STATUS_TONE, code) ? STATUS_TONE[code] : "neutral");
// `scheduled` nasce com o primeiro trecho registrado; `travelling`, com a primeira ida cumprida.
export const tfdStatusHint = pick({ scheduled: "primeiro trecho registrado", travelling: "primeira ida cumprida" });

// Eventos do processo: os três próprios e as situações (código novo aparece cru).
const EVENT_LABEL: Record<string, string> = { created: "pedido criado", appointment_set: "atendimento marcado", inpatient_recorded: "internação registrada" };
export const tfdEventLabel = (kind: string): string => (Object.prototype.hasOwnProperty.call(EVENT_LABEL, kind) ? EVENT_LABEL[kind] : tfdStatusLabel(kind));

export const legModeLabel = pick({ fleet: "frota da cidade", bus_ticket: "passagem de ônibus", air: "passagem aérea", river: "passagem fluvial" });
export const transportModeLabel = legModeLabel;
export const directionLabel = pick({ outbound: "ida", return: "volta" });
export const allowanceKindLabel = pick({
  meal_overnight: "alimentação com pernoite", meal_day: "alimentação sem pernoite", ground_km: "deslocamento terrestre (50 km)",
  air_miles: "deslocamento aéreo (200 milhas)", river_miles: "deslocamento fluvial (27 milhas)"
});
export const allowancePersonLabel = pick({ patient: "paciente", companion: "acompanhante" });
export const paymentMethodLabel = pick({ cash: "dinheiro", transfer: "transferência", pix: "Pix", check: "cheque" });
export const decisionLabel = pick({ authorize: "Autorizar", return: "Devolver para complementar", deny: "Recusar" });

// ─── Datas ──────────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const isDay = (iso: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(dayMs(iso));
const instant = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

// ─── Laudo ──────────────────────────────────────────────────────────────────
export interface ReportDraft {
  sigtapCode: string; cid10: string; justification: string; companionIndicated: boolean; companionReason: string;
  transportMode: string; destinationId: string; providerId: string;
}

// Do pré-preenchimento da consulta (novo) ou do processo devolvido (editar).
export function reportDraftFrom(prefill: TfdPrefill | null, c?: TfdCase): ReportDraft {
  if (c) {
    const r = c.report;
    return {
      sigtapCode: r.sigtap_code ?? "", cid10: r.cid10 ?? "", justification: r.justification ?? "", companionIndicated: r.companion_indicated,
      companionReason: r.companion_reason ?? "", transportMode: r.transport_mode, destinationId: c.destination.id, providerId: c.provider?.id ?? ""
    };
  }
  return {
    sigtapCode: prefill?.sigtap_code ?? "", cid10: prefill?.cid10 ?? "", justification: "", companionIndicated: false, companionReason: "",
    transportMode: "fleet", destinationId: "", providerId: ""
  };
}

// As mesmas recusas que o envio (submit) daria, para o médico ver antes. A lista de grupos da atenção básica é só do api (`primary_care_procedure`).
export function reportProblems(d: ReportDraft, o: TfdOptions): Problem[] {
  const out: Problem[] = [];
  if (!/^\d{10}$/.test(d.sigtapCode.trim())) out.push({ path: "report.sigtap_code", text: "escolha o procedimento (SIGTAP)" });
  if (d.cid10.trim() === "") out.push({ path: "report.cid10", text: "informe o CID-10" });
  const just = d.justification.trim().length;
  if (just < 20 || just > 2000) out.push({ path: "report.justification", text: "explique por que o tratamento não pode ser feito na cidade (20 a 2000 caracteres)" });
  const companion = companionProblem(d);
  if (companion) out.push(companion);
  if (d.destinationId === "") {
    out.push({ path: "destination_id", text: "escolha o destino" });
  } else {
    const dest = o.destinations.find((x) => x.id === d.destinationId);
    if (dest && dest.distance_km < o.min_distance_km) out.push({ path: "destination_id", text: `destino a menos de ${o.min_distance_km} km da sede — não cabe TFD` });
    if (dest?.metropolitan) out.push({ path: "destination_id", text: "destino na mesma região metropolitana — não cabe TFD" });
  }
  return out;
}

// O api não exige o motivo do acompanhante; só confere 10–500 quando há texto. Sem indicação, o motivo nem vai no corpo (caseBody).
const COMPANION_REASON = "explique por que o paciente precisa de acompanhante (10 a 500 caracteres)";
function companionProblem(d: ReportDraft): Problem | null {
  if (!d.companionIndicated) return null;
  const n = d.companionReason.trim().length;
  return n > 0 && (n < 10 || n > 500) ? { path: "report.companion_reason", text: COMPANION_REASON } : null;
}

// Salvar rascunho: o api aceita laudo incompleto; só recusa o que é inválido ao salvar (formato do SIGTAP, justificativa > 2000,
// motivo do acompanhante fora de 10–500, destino ausente). O CID é normalizado pelo api (`invalid_cid10` volta do salvar).
export function draftProblems(d: ReportDraft): Problem[] {
  const out: Problem[] = [];
  const sigtap = d.sigtapCode.trim();
  if (sigtap !== "" && !/^\d{10}$/.test(sigtap)) out.push({ path: "report.sigtap_code", text: "escolha o procedimento (SIGTAP)" });
  if (d.justification.trim().length > 2000) out.push({ path: "report.justification", text: "a justificativa tem de 20 a 2000 caracteres" });
  const companion = companionProblem(d);
  if (companion) out.push(companion);
  if (d.destinationId === "") out.push({ path: "destination_id", text: "escolha o destino" });
  return out;
}

// Chaves do contrato, uma a uma (o api recusa chave desconhecida). PATCH substitui tudo: o prestador do rascunho é reenviado.
export function caseBody(d: ReportDraft, ctx: { patientId: string; consultationId?: string; regulationRequestId?: string }): TfdCaseInput {
  return {
    patient_id: ctx.patientId,
    ...(ctx.consultationId ? { consultation_id: ctx.consultationId } : {}),
    ...(ctx.regulationRequestId ? { regulation_request_id: ctx.regulationRequestId } : {}),
    report: {
      sigtap_code: d.sigtapCode.trim() === "" ? null : d.sigtapCode.trim(),
      cid10: d.cid10.trim() === "" ? null : d.cid10.trim().toUpperCase(),
      justification: d.justification.trim() === "" ? null : d.justification.trim(),
      companion_indicated: d.companionIndicated,
      companion_reason: d.companionIndicated && d.companionReason.trim() !== "" ? d.companionReason.trim() : null,
      transport_mode: d.transportMode
    },
    destination_id: d.destinationId,
    ...(d.providerId ? { provider_id: d.providerId } : {})
  };
}

// Só o autor edita, e só rascunho ou devolvido (a tela decide o autor; o api devolve 404 para outro).
export function canEditCase(c: TfdCaseRow | TfdCase): boolean {
  return c.status === "draft" || c.status === "returned";
}

// ─── Comissão ───────────────────────────────────────────────────────────────
export function appointmentProblems(value: string, now: Date): Problem[] {
  const at = parseCityLocal(value);
  if (!at) return [ { path: "appointment_at", text: "informe data e hora" } ];
  if (at.getTime() <= now.getTime()) return [ { path: "appointment_at", text: "o atendimento não pode estar no passado" } ];
  if (at.getTime() > now.getTime() + 365 * DAY_MS) return [ { path: "appointment_at", text: "o atendimento pode ser marcado até 365 dias à frente" } ];
  return [];
}

// Motivo 10–500 em toda decisão. Autorizar exige atendimento futuro (o api trata o passado como ausente).
export function decisionProblems(decision: TfdDecision, reason: string, c: TfdCase, now: Date = new Date()): Problem[] {
  const out: Problem[] = [];
  const n = reason.trim().length;
  if (n < 10 || n > 500) out.push({ path: "reason", text: "o motivo tem de 10 a 500 caracteres" });
  if (decision === "authorize") {
    const at = instant(c.appointment_at);
    if (at === null || at <= now.getTime()) out.push({ path: "appointment_at", text: APPOINTMENT_REQUIRED });
  }
  return out;
}

// A faixa inferior (trecho mais antigo ou data do envio) é do api.
export function inpatientProblems(from: string, to: string, today: string = cityIsoDate()): Problem[] {
  const out: Problem[] = [];
  if (!isDay(from)) out.push({ path: "from", text: "informe o início da internação" });
  else if (from > today) out.push({ path: "from", text: "o início da internação não pode ser futuro" });
  if (to !== "") {
    if (!isDay(to)) out.push({ path: "to", text: "informe uma data válida para o fim" });
    else if (isDay(from) && to < from) out.push({ path: "to", text: "o fim não pode ser antes do início" });
    else if (to > today) out.push({ path: "to", text: "o fim da internação não pode ser futuro" });
  }
  return out;
}

// ─── Trechos e dinheiro ─────────────────────────────────────────────────────
export interface LegDraft {
  direction: string; mode: string; date: string; tripPassengerId: string; amount: string; carrier: string; companion: boolean;
}

// Na ida de frota a data é a da viagem do passageiro (o api exige igualdade); na volta é a de `return_at`, que o processo não traz.
export function fleetLegDate(c: TfdCase, tripPassengerId: string): string | null {
  return c.trip_passengers.find((p) => p.id === tripPassengerId)?.date ?? null;
}

export function legProblems(d: LegDraft, c: TfdCase): Problem[] {
  const out: Problem[] = [];
  const outbound = c.legs.filter((l) => l.direction === "outbound" && !l.voided);
  if (!isDay(d.date)) out.push({ path: "date", text: "informe a data do trecho" });
  if (d.direction === "return") {
    if (outbound.length === 0) out.push({ path: "direction", text: "registre a ida antes da volta" });
    else if (isDay(d.date) && d.date < outbound.map((l) => l.date).sort()[0]) out.push({ path: "date", text: "a volta precisa ser no dia da ida ou depois" });
  }
  if (d.mode === "fleet") {
    if (d.tripPassengerId === "") {
      out.push({ path: "trip_passenger_id", text: "escolha a viagem da frota em que o paciente está" });
    } else if (d.direction === "outbound" && isDay(d.date)) {
      const day = fleetLegDate(c, d.tripPassengerId);
      if (day !== null && day !== d.date) out.push({ path: "date", text: "na frota, a data da ida é a da viagem escolhida" });
    }
    if (d.companion) out.push({ path: "companion", text: "na frota o acompanhante vai pelo cadastro da viagem" });
  } else {
    const cents = parseReais(d.amount);
    if (cents === null || cents < 1 || cents > MAX_CENTS) out.push({ path: "ticket.amount_cents", text: "informe o valor da passagem (até R$ 100.000,00)" });
    const carrier = d.carrier.trim().length;
    if (carrier < 1 || carrier > 120) out.push({ path: "ticket.carrier", text: "informe a empresa (até 120 caracteres)" });
    if (d.companion && !c.report.companion_indicated) out.push({ path: "companion", text: "o laudo não indica acompanhante" });
  }
  return out;
}

export function legBody(d: LegDraft): TfdLegInput {
  const base = { direction: d.direction as TfdLegInput["direction"], mode: d.mode as TfdLegInput["mode"], date: d.date };
  if (d.mode === "fleet") return { ...base, trip_passenger_id: d.tripPassengerId };
  return {
    ...base,
    ticket: { amount_cents: parseReais(d.amount) ?? 0, carrier: d.carrier.trim() },
    ...(d.companion ? { companion: true } : {})
  };
}

export interface PaymentDraft { paidOn: string; amount: string; method: string; receiptNumber: string }
const METHODS = [ "cash", "transfer", "pix", "check" ];

export function paymentProblems(d: PaymentDraft, today: string): Problem[] {
  const out: Problem[] = [];
  if (!isDay(d.paidOn)) out.push({ path: "paid_on", text: "informe a data do pagamento" });
  else if (d.paidOn > today) out.push({ path: "paid_on", text: "a data do pagamento não pode ser futura" });
  else if (isDay(today) && dayMs(d.paidOn) < dayMs(today) - 365 * DAY_MS) out.push({ path: "paid_on", text: "a data do pagamento não pode ser de mais de 365 dias atrás" });
  const cents = parseReais(d.amount);
  if (cents === null || cents < 1 || cents > MAX_CENTS) out.push({ path: "amount_cents", text: "informe um valor maior que zero (até R$ 100.000,00)" });
  const rec = d.receiptNumber.trim().length;
  if (rec < 1 || rec > 40) out.push({ path: "receipt_number", text: "informe o número do recibo (até 40 caracteres)" });
  if (!METHODS.includes(d.method)) out.push({ path: "method", text: "escolha a forma de pagamento" });
  return out;
}

export function paymentBody(d: PaymentDraft): TfdPaymentInput {
  return { paid_on: d.paidOn, amount_cents: parseReais(d.amount) ?? 0, method: d.method as TfdPaymentMethod, receipt_number: d.receiptNumber.trim() };
}

export const allowanceTotal = (list: TfdAllowance[]): number => list.reduce((sum, a) => sum + a.total_cents, 0);
export const paidTotal = (list: TfdPayment[]): number => list.reduce((sum, p) => sum + p.amount_cents, 0);

const FILE_TYPES = [ "application/pdf", "image/jpeg", "image/png" ];
const MAX_FILE = 10 * 1024 * 1024;
// O tamanho vem antes do tipo. O api confere de novo (`invalid_file`, incluindo os bytes iniciais).
export function accountabilityFileProblem(file: File): string | null {
  if (file.size === 0) return FILE_EMPTY;
  if (file.size > MAX_FILE) return FILE_TOO_BIG;
  if (!FILE_TYPES.includes(file.type)) return FILE_TYPE;
  return null;
}

// ─── Recusas do api ─────────────────────────────────────────────────────────
const ERRORS: Record<string, string> = {
  distance_below_minimum: "destino a menos da distância mínima da cidade — não cabe TFD",
  metropolitan_destination: "destino na mesma região metropolitana — não cabe TFD",
  primary_care_procedure: "procedimento da atenção básica — não cabe TFD",
  invalid_sigtap_code: "procedimento fora da tabela SIGTAP de hoje — escolha outro",
  invalid_cid10: "CID-10 inválido — confira o código",
  cid_required: "informe o CID-10",
  justification_required: "explique por que o tratamento não pode ser feito na cidade",
  appointment_required: APPOINTMENT_REQUIRED,
  billing_unit_missing: "falta a unidade de faturamento nos ajustes do transporte — peça ao administrador",
  invalid_transition: "o processo mudou de situação — recarregue",
  inpatient_open: "já há uma internação aberta — feche-a primeiro",
  inpatient_overlap: "a internação se sobrepõe a outra deste processo",
  no_outbound_leg: "registre a ida antes da volta",
  fleet_leg_by_trip: "trecho de frota é dado como cumprido pela viagem — não tem baixa aqui",
  tfd_leg_done: "este trecho já foi cumprido",
  leg_in_future: "o trecho é de data futura — dê baixa a partir do dia",
  legs_pending: "há trecho sem baixa — dê baixa antes da prestação de contas",
  receipt_taken: "já existe pagamento com este número de recibo neste processo",
  invalid_file: "o comprovante precisa ser PDF, JPG ou PNG de até 10 MB",
  companion_not_allowed: "o laudo não indica acompanhante",
  invalid_cursor: "a lista mudou — recarregue",
  link_expired: "o link do comprovante expirou — abra de novo",
  cbo_not_allowed: "só médico (CBO 225) pede TFD",
  missing_role: TFD_NO_ROLE
};

const INVALID_REQUEST_PATHS: [ RegExp, string ][] = [
  [ /^appointment_at$/, "o atendimento precisa ser futuro e em até 365 dias" ],
  [ /^consultation_id$/, "ligue o laudo a uma consulta sua ou a uma solicitação de regulação" ],
  [ /^destination_id$/, "escolha um destino ativo" ],
  [ /^provider_id$/, "o prestador escolhido não está ativo" ],
  [ /^trip_passenger_id$/, "esta viagem não serve a este paciente — escolha outra" ],
  [ /^date$/, "a data não confere com o trecho — confira e tente de novo" ],
  [ /^paid_on$/, "a data do pagamento precisa estar entre 365 dias atrás e hoje" ],
  [ /amount_cents$/, "o valor precisa ser maior que zero e até R$ 100.000,00" ],
  [ /^ticket\.carrier$/, "informe a empresa (até 120 caracteres)" ],
  [ /^receipt_number$/, "informe o número do recibo (até 40 caracteres)" ],
  [ /^(from|to)$/, "confira as datas da internação" ],
  [ /^report\.justification$/, "a justificativa tem de 20 a 2000 caracteres" ],
  [ /^report\.companion_reason$/, "o motivo do acompanhante tem de 10 a 500 caracteres" ],
  [ /^report\.transport_mode$/, "escolha o modo de transporte" ],
  [ /^direction$/, "escolha ida ou volta" ],
  [ /^mode$/, "escolha o modo do trecho" ],
  [ /^method$/, "escolha a forma de pagamento" ],
  [ /^content_type$/, FILE_TYPE ],
  [ /^decision$/, "escolha autorizar, devolver ou recusar" ]
];

// Todas as recusas, traduzidas (uma por `problems[]`). Código que o TFD não manda aparece cru, nunca com a frase de outro módulo.
export function tfdRefusals(err: unknown): Refusal[] {
  const feature = featureDisabledKey(err);
  if (feature !== null) {
    const text = feature === "" || feature === "tfd" ? TFD_DISABLED : `${featureLabel(feature)} está desligado nesta cidade`;
    return [ { path: "", code: "feature_disabled", text } ];
  }
  return transportRefusals(err).map((r) => {
    if (!(err instanceof ApiError)) return r;
    if (r.code === "invalid_request") {
      const hit = INVALID_REQUEST_PATHS.find(([ re ]) => re.test(r.path));
      return hit ? { ...r, text: hit[1] } : r;
    }
    return Object.prototype.hasOwnProperty.call(ERRORS, r.code) ? { ...r, text: ERRORS[r.code] } : r;
  });
}

export function tfdError(err: unknown): string {
  return tfdRefusals(err)[0].text;
}
