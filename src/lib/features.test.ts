import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { featureDisabledKey, featureLabel, hasFeature, sessionFeatures } from "./features";

describe("features da sessão (contratos §1)", () => {
  it("ausente, nulo ou fora de formato vira []", () => {
    expect(sessionFeatures(null)).toEqual([]);
    expect(sessionFeatures(undefined)).toEqual([]);
    expect(sessionFeatures({})).toEqual([]);
    expect(sessionFeatures({ features: null })).toEqual([]);
    expect(sessionFeatures({ features: "ledi_export" })).toEqual([]);
  });

  it("mantém só strings e não quebra com chave desconhecida", () => {
    expect(sessionFeatures({ features: [ "ledi_export", 3, "rnds_sync" ] })).toEqual([ "ledi_export", "rnds_sync" ]);
    expect(hasFeature({ features: [ "rnds_sync" ] }, "ledi_export")).toBe(false);
    expect(hasFeature({ features: [ "cadsus_lookup" ] }, "cadsus_lookup")).toBe(true);
    expect(hasFeature(null, "cadsus_lookup")).toBe(false);
  });

  it("featureDisabledKey só reconhece 403 feature_disabled", () => {
    expect(featureDisabledKey(new ApiError(403, { error: "feature_disabled", feature: "ledi_export" }, "x"))).toBe("ledi_export");
    expect(featureDisabledKey(new ApiError(403, { error: "feature_disabled" }, "x"))).toBe("");
    expect(featureDisabledKey(new ApiError(403, { error: "missing_role" }, "x"))).toBeNull();
    expect(featureDisabledKey(new ApiError(403, "", "x"))).toBeNull();
    expect(featureDisabledKey(new ApiError(404, { error: "feature_disabled" }, "x"))).toBeNull();
    expect(featureDisabledKey(new Error("x"))).toBeNull();
  });

  it("rótulo conhecido em português; desconhecido sai como a chave", () => {
    expect(featureLabel("ledi_export")).toBe("Envio da produção ao e-SUS (LEDI)");
    expect(featureLabel("cadsus_lookup")).toBe("Consulta ao CADSUS na validação presencial");
    expect(featureLabel("clinical_record")).toBe("Prontuário da atenção primária");
    expect(hasFeature({ features: [ "clinical_record" ] }, "clinical_record")).toBe(true);
    expect(featureLabel("digital_signature")).toBe("Assinatura digital");
    expect(hasFeature({ features: [ "digital_signature" ] }, "digital_signature")).toBe(true);
    expect(featureLabel("clinical_documents")).toBe("Documentos clínicos");
    expect(hasFeature({ features: [ "clinical_documents" ] }, "clinical_documents")).toBe(true);
    expect(featureLabel("controlled_prescriptions")).toBe("Receita de controle especial e de antimicrobiano (SNCR)");
    expect(hasFeature({ features: [ "controlled_prescriptions" ] }, "controlled_prescriptions")).toBe(true);
    expect(featureLabel("rnds_sync")).toBe("rnds_sync");
  });
  it("patient_timeline (módulo 20) tem rótulo e é lida da sessão", () => {
    expect(featureLabel("patient_timeline")).toBe("Linha do tempo do paciente");
    expect(hasFeature({ features: [ "patient_timeline" ] }, "patient_timeline")).toBe(true);
    expect(hasFeature({ features: [ "clinical_record" ] }, "patient_timeline")).toBe(false);
  });
  it("módulo 21a: os quatro interruptores de exames têm rótulo", () => {
    expect(featureLabel("exam_tracking")).toBe("Rastreamento de exames");
    expect(featureLabel("exam_fhir_inbound")).toBe("Entrada de resultados por FHIR");
    expect(featureLabel("exam_pec_bridge")).toBe("Solicitar exames pelo PEC");
    expect(featureLabel("fake_lab")).toBe("Laboratório simulado (fora de produção)");
  });

  it("rótulos do laboratório municipal (módulo 21b)", () => {
    expect(featureLabel("municipal_lab")).toBe("Laboratório municipal");
    expect(featureLabel("lab_hl7_inbound")).toBe("Entrada de resultados de aparelhos (HL7)");
    expect(featureLabel("fake_middleware")).toBe("Middleware de aparelhos simulado (fora de produção)");
    expect(hasFeature({ features: [ "exam_tracking", "municipal_lab" ] }, "municipal_lab")).toBe(true);
  });

  it("21c: CIQ/CEQ e estoque do laboratório", () => {
    expect(featureLabel("lab_quality_control")).toBe("Controle de qualidade do laboratório (CIQ e CEQ)");
    expect(featureLabel("lab_inventory")).toBe("Estoque do laboratório");
    expect(hasFeature({ features: [ "lab_inventory" ] }, "lab_inventory")).toBe(true);
    expect(hasFeature({ features: [ "lab_inventory" ] }, "lab_quality_control")).toBe(false);
  });
});

describe("módulo 22", () => {
  it("procedure_billing tem nome e vem da sessão", () => {
    expect(featureLabel("procedure_billing")).toBe("Faturamento de procedimentos (BPA)");
    expect(hasFeature({ features: [ "procedure_billing" ] }, "procedure_billing")).toBe(true);
    expect(hasFeature({ features: [ "municipal_lab" ] }, "procedure_billing")).toBe(false);
  });
});

describe("módulo 23", () => {
  it("care_lines tem nome e vem da sessão", () => {
    expect(featureLabel("care_lines")).toBe("Linhas de cuidado");
    expect(hasFeature({ features: [ "clinical_record", "care_lines" ] }, "care_lines")).toBe(true);
    expect(hasFeature({ features: [ "clinical_record" ] }, "care_lines")).toBe(false);
  });
});

describe("módulo 24a", () => {
  it("territory_registry tem rótulo em português e vem da sessão", () => {
    expect(featureLabel("territory_registry")).toBe("Cadastro individual e domiciliar");
    expect(hasFeature({ features: [ "clinical_record", "territory_registry" ] }, "territory_registry")).toBe(true);
    expect(hasFeature({ features: [ "clinical_record" ] }, "territory_registry")).toBe(false);
  });
});
