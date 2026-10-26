// src/lib/patientDocument.ts
// O documento do PACIENTE na tela (contrato L8 do 24a; api
// `Patients::IdentifierJson`): `has_cpf` manda; com CPF, a máscara de hoje (ou
// "com CPF" quando a forma não traz a máscara); sem CPF, "sem CPF" e o CNS
// mascarado (só os 4 últimos dígitos), quando houver. Forma sem `has_cpf`: a
// presença da máscara decide. Nunca "undefined"/"null" na tela.
export interface PatientDocumentSource { has_cpf?: boolean; cpf_masked?: string | null; cns_masked?: string | null }
export interface PatientDocument { k: "CPF" | "CNS"; v: string }

export const NO_CPF = "sem CPF";
export const WITH_CPF = "com CPF";

export function patientDocument(p: PatientDocumentSource): PatientDocument {
  const hasCpf = p.has_cpf ?? !!p.cpf_masked;
  if (hasCpf) return { k: "CPF", v: p.cpf_masked || WITH_CPF };
  if (p.cns_masked) return { k: "CNS", v: `${NO_CPF} · CNS ${p.cns_masked}` };
  return { k: "CPF", v: NO_CPF };
}

// Para frases ("Paciente: Joana · CPF ***.982.247-**"): só a máscara do CPF
// leva o prefixo "CPF"; os demais casos já se explicam.
export function documentText(p: PatientDocumentSource): string {
  const doc = patientDocument(p);
  return doc.k === "CPF" && doc.v !== NO_CPF && doc.v !== WITH_CPF ? `CPF ${doc.v}` : doc.v;
}
