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
  | "procedure_billing" | "care_lines" | "territory_registry";

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
  territory_registry: "Cadastro individual e domiciliar"
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
