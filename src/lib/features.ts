// Interruptores por cidade (módulo 16; ADR 0028; contratos §1 e §2). A sessão
// traz as chaves LIGADAS, não necessariamente utilizáveis: o que falta para
// funcionar vem de GET /integrations. Ausente = [] (api antigo, sessão do
// console de plataforma); chave desconhecida é ignorada por quem não a usa.
// Só o maintenance liga e desliga; o dashboard nunca escreve interruptor.
import { ApiError } from "./api";

export type FeatureKey =
  | "ledi_export" | "cadsus_lookup" | "clinical_record" | "digital_signature" | "clinical_documents" | "controlled_prescriptions"
  | "patient_timeline" | "exam_tracking" | "exam_fhir_inbound" | "exam_pec_bridge" | "fake_lab"
  | "municipal_lab" | "lab_hl7_inbound" | "fake_middleware" | "lab_quality_control" | "lab_inventory"
  | "procedure_billing" | "care_lines" | "territory_registry" | "surveillance" | "care_regulation"
  | "pharmacy" | "dental_care" | "vaccination" | "rnds_immunization" | "rnds_mock"
  | "sanitary_transport" | "tfd" | "psychosocial_care" | "urgency_care" | "waiting_room_display"
  | "urgency_stock_deduction" | "ombudsman" | "ombudsman_anonymous_web";

export const FEATURE_DISABLED_MESSAGE = "esta funcionalidade está desligada para a cidade";

const FEATURE_LABEL: Record<string, string> = {
  ledi_export: "Envio da produção ao e-SUS (LEDI)",
  cadsus_lookup: "Consulta ao CADSUS na validação presencial",
  clinical_record: "Prontuário da atenção primária",
  digital_signature: "Assinatura digital",
  clinical_documents: "Documentos clínicos",
  controlled_prescriptions: "Receita de controle especial e de antimicrobiano (SNCR)",
  patient_timeline: "Linha do tempo do paciente",
  exam_tracking: "Rastreamento de exames",
  exam_fhir_inbound: "Entrada de resultados por FHIR",
  exam_pec_bridge: "Solicitar exames pelo PEC",
  fake_lab: "Laboratório simulado (fora de produção)",
  municipal_lab: "Laboratório municipal",
  lab_hl7_inbound: "Entrada de resultados de aparelhos (HL7)",
  fake_middleware: "Middleware de aparelhos simulado (fora de produção)",
  lab_quality_control: "Controle de qualidade do laboratório (CIQ e CEQ)",
  lab_inventory: "Estoque do laboratório",
  // Módulo 22 (ADR 0039): sem pré-requisito de modo de prontuário.
  procedure_billing: "Faturamento de procedimentos (BPA)",
  // Módulo 23 (ADR 0040): exige clinical_record (modo record).
  care_lines: "Linhas de cuidado",
  // Módulo 24a (ADR 0042): exige clinical_record (modo record).
  territory_registry: "Cadastro individual e domiciliar",
  // Módulo 25 (ADR 0043): sem pré-requisito de modo de prontuário; a sugestão na consulta exige clinical_record.
  surveillance: "Vigilância epidemiológica",
  // Módulo 26a (ADR 0044): exige clinical_record.
  care_regulation: "Regulação municipal",
  // Módulo 27a (ADR 0045): sem pré-requisito.
  pharmacy: "Farmácia e almoxarifado",
  // Módulo 28 (ADR 0046): exige clinical_record.
  dental_care: "Saúde bucal",
  // Módulo 29 (ADR 0047): vaccination exige record_mode:record; o envio exige a credencial rnds.
  vaccination: "Sala de vacina",
  rnds_immunization: "Envio das vacinas à RNDS",
  rnds_mock: "RNDS simulada (fora de produção)",
  // Módulo 30 (ADR 0048): tfd exige sanitary_transport e clinical_record
  sanitary_transport: "Transporte sanitário",
  tfd: "Tratamento Fora de Domicílio (TFD)",
  // Módulo 31 (ADR 0049): exige clinical_record
  psychosocial_care: "Atenção psicossocial (CAPS)",
  // Módulo 32a (ADR 0050): urgency_care exige clinical_record; waiting_room_display é independente
  urgency_care: "Urgência (UPA)",
  waiting_room_display: "Painel de chamada na sala de espera (TV)",
  // Módulo 32b (ADR 0050): exige urgency_care e pharmacy
  urgency_stock_deduction: "Baixa de estoque na medicação da UPA",
  // Módulo 33 (ADR 0051): ombudsman sem pré-requisito; ombudsman_anonymous_web exige ombudsman. Os nomes do maintenance (Q38).
  ombudsman: "Ouvidoria do SUS",
  ombudsman_anonymous_web: "Denúncia anônima sem login (canal do cidadão)"
};

export function sessionFeatures(user: { features?: unknown } | null | undefined): string[] {
  const raw = user?.features;
  return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string") : [];
}

export function hasFeature(user: { features?: unknown } | null | undefined, key: FeatureKey): boolean {
  return sessionFeatures(user).includes(key);
}

// 403 { error: "feature_disabled", feature } → a chave ("" sem `feature`);
// qualquer outro erro → null. Um 403 de papel (missing_role) não é isto.
export function featureDisabledKey(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  const body = err.body as { error?: unknown; feature?: unknown } | null;
  if (!body || typeof body !== "object" || body.error !== "feature_disabled") return null;
  return typeof body.feature === "string" ? body.feature : "";
}

export function featureLabel(key: string): string {
  return FEATURE_LABEL[key] ?? key;
}
