// Documentos pela ação do CAPS (Task 8): quem vê o botão de emitir, quem cancela e qual frase cada recusa recebe.
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { documentError } from "./clinicalDocuments";
import { PSY_DISABLED, PSY_ERRORS, canCancelPsyDocument, canIssuePsyDocument, psyDocumentError } from "./psychosocial";
import { ME_DOCTOR, ME_PSY, action } from "../test/psychosocialFixtures";
import { prescriptionDoc } from "../test/documentFixtures";

const refusal = (status: number, body: Record<string, unknown>) => new ApiError(status, body, "x");

describe("documentos pela ação do CAPS (Task 8)", () => {
  it("emite só o médico autor, na ação individual não cancelada com um usuário matriculado", () => {
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR }), "u-1")).toBe(true);
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR }), "u-9")).toBe(false);
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR }), null)).toBe(false);
    expect(canIssuePsyDocument(action({ professional: ME_PSY }), "u-1")).toBe(false);
    expect(canIssuePsyDocument(action({ professional: { ...ME_DOCTOR, cbo_code: "225250" } }), "u-1")).toBe(true);
    expect(canIssuePsyDocument(action({ professional: { ...ME_DOCTOR, cbo_code: "225410" } }), "u-1")).toBe(false);
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR, cancelled: true }), "u-1")).toBe(false);
    const maria = action().participants[0];
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR, participants: [ maria, maria ] }), "u-1")).toBe(false);
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR, participants: [] }), "u-1")).toBe(false);
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR, participants: [ { family_name: "Ana Souza" } ] }), "u-1")).toBe(false);
    expect(canIssuePsyDocument(action({ professional: ME_DOCTOR,
      participants: [ { enrollment_id: null, patient: { patient_id: "pt9", name: "Sem Matrícula", cns_masked: null } } ] }), "u-1")).toBe(false);
  });

  it("cancela a autora e a coordenação; ninguém cancela o cancelado", () => {
    const doc = prescriptionDoc({ author: { id: "u-2", name: "Dr. Outro", council: "CRM-PR 1", cbo_code: "225133" } });
    expect(canCancelPsyDocument(doc, "u-2", { lead: false })).toBe(true);
    expect(canCancelPsyDocument(doc, "u-1", { lead: false })).toBe(false);
    expect(canCancelPsyDocument(doc, "u-1", { lead: true })).toBe(true);
    expect(canCancelPsyDocument({ ...doc, status: "cancelled" }, "u-2", { lead: true })).toBe(false);
    expect(canCancelPsyDocument(doc, null, { lead: true })).toBe(false);
  });

  it("recusas do CAPS pela frase do CAPS; as do 19c/19d pela do 19", () => {
    expect(psyDocumentError(refusal(422, { error: "prescriber_required" }))).toBe(PSY_ERRORS.prescriber_required);
    expect(psyDocumentError(refusal(403, { error: "not_author" }))).toBe(PSY_ERRORS.not_author);
    expect(psyDocumentError(refusal(409, { error: "already_cancelled" }))).toBe(PSY_ERRORS.already_cancelled);
    expect(psyDocumentError(refusal(422, { error: "invalid_content", field: "kind" }))).toBe(PSY_ERRORS.invalid_content);
    expect(psyDocumentError(refusal(403, { error: "feature_disabled", feature: "psychosocial_care" }))).toBe(PSY_DISABLED);
    const item = refusal(422, { error: "invalid_content", field: "items" });
    expect(psyDocumentError(item)).toBe(documentError(item));
    const sncr = refusal(503, { error: "sncr_unavailable" });
    expect(psyDocumentError(sncr, { controlled: true })).toBe(documentError(sncr, { controlled: true }));
    const off = refusal(403, { error: "feature_disabled", feature: "clinical_documents" });
    expect(psyDocumentError(off)).toBe(documentError(off));
  });
});
