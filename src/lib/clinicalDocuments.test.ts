// src/lib/clinicalDocuments.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, issueDocument } from "./api";
import {
  ANTIMICROBIAL_NOTE, backdateLimits, CANCEL_REASON_MAX, CONTROLLED_BLOCKED, CONTROLLED_DISABLED, DOCUMENTS_DISABLED, MIXED_CATEGORIES,
  PRESCRIBER_MISSING, EMPTY_EXTERNAL, PENDING_REFETCH_MS, addProtocolItem, canCancel,
  canUseDocuments, cancelReasonProblem, declarationInput, declarationProblem, documentError, documentSituation, documentsRefetchInterval, documentsStatusChanged,
  emptyDeclaration, emptyItem, itemFromProtocolItem, emptyProtocol, emptySickNote, externalChange, externalProblem, formatCnpj, hasAntimicrobial, isValidCnpj,
  issueModeLabel, issuedNotice, itemFromMedication, itemFromPrescription, kindLabel, kindsFor, medicationLine, prescriptionInput,
  prescriptionProblems, professionalKind, protocolDraftFrom, protocolInput, protocolLabel, protocolProblem, protocolVersionInput,
  reissueDraft, sickNoteInput, sickNoteProblem, sortMedications, vigentProtocols, withDocument, type ItemDraft
} from "./clinicalDocuments";
import {
  AMOXICILLIN, CLONAZEPAM, DIPYRONE_REF, TODAY19C, catalogItem, declarationDoc, examDoc, medication, nursingProtocol, prescriptionDoc,
  prescriptionItem, renewalItem, searchItem, sickNoteDoc
} from "../test/documentFixtures";

afterEach(() => vi.unstubAllGlobals());

const filled = (over: Partial<ItemDraft> = {}): ItemDraft => ({
  ...itemFromMedication(searchItem()), quantity: "60", route: "oral", dosage: "1 cp 2x/dia", ...over
});

describe("rótulos e situação", () => {
  it("tipo, modo e situação; desconhecido cru", () => {
    expect(kindLabel("sick_note")).toBe("Atestado");
    expect(kindLabel("attendance_declaration")).toBe("Declaração de comparecimento");
    expect(kindLabel("prescription")).toBe("Receita");
    expect(kindLabel("exam_requisition")).toBe("Requisição de exames");
    expect(kindLabel("referral")).toBe("referral");
    expect(issueModeLabel("digital")).toBe("digital");
    expect(issueModeLabel("paper")).toBe("papel");
    expect(issueModeLabel("hybrid")).toBe("hybrid");
    expect(documentSituation({ status: "issued", cancelled_at: null })).toBe("emitido");
    expect(documentSituation({ status: "cancelled", cancelled_at: "2026-10-09T10:05:00-03:00" })).toBe("cancelado em 09/10/2026, 10:05");
  });

  it("o aviso depois de emitir diz como o documento sai", () => {
    expect(issuedNotice(sickNoteDoc())).toBe("Documento emitido (Atestado) em modo papel: imprima e assine à mão.");
    expect(issuedNotice(sickNoteDoc({ issue_mode: "digital" })))
      .toBe("Documento emitido (Atestado) em modo digital: a assinatura entra na sua fila; o PDF assinado sai depois dela.");
    expect(issuedNotice(prescriptionDoc({ content: { items: [ prescriptionItem({ antimicrobial: true }) ], antimicrobial: true, copies: 2, valid_until: "2026-10-19" } })))
      .toBe("Documento emitido (Receita) em modo papel: imprima as 2 vias e assine à mão.");
  });
});

describe("quem emite o quê (espelho do api)", () => {
  it("CBO de médico, dentista, enfermeiro e outros", () => {
    expect(professionalKind("225142")).toBe("physician");
    expect(professionalKind("225250")).toBe("physician");
    expect(professionalKind("225320")).toBe("physician");
    expect(professionalKind("223208")).toBe("dentist");
    expect(professionalKind("223565")).toBe("nurse");
    expect(professionalKind("223605")).toBe("other");
    expect(professionalKind(null)).toBe("other");
    expect(kindsFor("225142")).toEqual([ "sick_note", "attendance_declaration", "prescription", "exam_requisition" ]);
    expect(kindsFor("223208")).toEqual([ "sick_note", "attendance_declaration", "prescription", "exam_requisition" ]);
    expect(kindsFor("223565")).toEqual([ "attendance_declaration", "prescription", "exam_requisition" ]);
    expect(kindsFor("223605")).toEqual([ "attendance_declaration", "exam_requisition" ]);
  });

  it("documentos só com clinical_documents e nunca para o operador; cancela só a autora o emitido", () => {
    expect(canUseDocuments({ operator: false, features: [ "clinical_record", "clinical_documents" ] })).toBe(true);
    expect(canUseDocuments({ operator: false, features: [ "clinical_record" ] })).toBe(false);
    expect(canUseDocuments({ operator: true, features: [ "clinical_documents" ] })).toBe(false);
    expect(canUseDocuments(null)).toBe(false);
    expect(canCancel(sickNoteDoc(), "us1")).toBe(true);
    expect(canCancel(sickNoteDoc(), "us2")).toBe(false);
    expect(canCancel(sickNoteDoc({ status: "cancelled" }), "us1")).toBe(false);
    expect(canCancel(sickNoteDoc(), undefined)).toBe(false);
  });

  it("relê a lista só enquanto há assinatura pendente", () => {
    expect(documentsRefetchInterval(undefined)).toBe(false);
    expect(documentsRefetchInterval([ sickNoteDoc() ])).toBe(false);
    expect(documentsRefetchInterval([ sickNoteDoc({ signature: { mode: "pending", request_id: "sr1" } }) ])).toBe(PENDING_REFETCH_MS);
    expect(documentsRefetchInterval([ sickNoteDoc({ status: "cancelled", signature: { mode: "pending" } }) ])).toBe(false);
  });

  it("documentsStatusChanged: só id, status e modo da assinatura contam", () => {
    const pending = sickNoteDoc({ signature: { mode: "pending", request_id: "sr1" } });
    const row = { id: pending.id, status: "issued" as const, signature_mode: "pending" };
    expect(documentsStatusChanged([ pending ], [ row ])).toBe(false);
    expect(documentsStatusChanged([ pending ], [ { ...row, signature_mode: "digital" } ])).toBe(true);
    expect(documentsStatusChanged([ pending ], [ { ...row, status: "cancelled" } ])).toBe(true);
    expect(documentsStatusChanged([ pending ], [ row, { id: "doc9", status: "issued", signature_mode: null } ])).toBe(true);
    expect(documentsStatusChanged([ pending ], [])).toBe(true);
    expect(documentsStatusChanged([ sickNoteDoc() ], [ { id: "doc1", status: "issued", signature_mode: null } ])).toBe(false);
    expect(documentsStatusChanged(undefined, [ row ])).toBe(false);
  });

  it("withDocument troca o que já existe e põe o novo no topo", () => {
    const list = [ sickNoteDoc(), prescriptionDoc() ];
    expect(withDocument(list, sickNoteDoc({ status: "cancelled" }))[0].status).toBe("cancelled");
    expect(withDocument(list, examDoc()).map((d) => d.id)).toEqual([ "doc4", "doc1", "doc2" ]);
  });

  it("motivo do cancelamento: 10 a 500 caracteres, contados como o api (pontas e espaços internos juntados)", () => {
    expect(cancelReasonProblem("   curto   ")).toBe("descreva o motivo com pelo menos 10 caracteres");
    expect(cancelReasonProblem("abc    def    gh")).toBeNull(); // junta os espaços: "abc def gh" tem 10
    expect(cancelReasonProblem("dias errados")).toBeNull();
    expect(cancelReasonProblem("a".repeat(CANCEL_REASON_MAX))).toBeNull();
    expect(cancelReasonProblem("a".repeat(CANCEL_REASON_MAX + 1))).toBe("o motivo passa de 500 caracteres — resuma");
    expect(cancelReasonProblem("a      b      c      d")).toBe("descreva o motivo com pelo menos 10 caracteres"); // "a b c d" tem 7
  });
});

describe("atestado", () => {
  it("backdateLimits: de hoje − 30 a hoje, atravessando mês e ano", () => {
    expect(backdateLimits("2026-10-09")).toEqual({ min: "2026-09-09", max: "2026-10-09" });
    expect(backdateLimits("2026-01-15")).toEqual({ min: "2025-12-16", max: "2026-01-15" });
    // Mesma aritmética de dia do addDays de campaigns.ts (reaproveitado), inclusive no ano bissexto.
    expect(backdateLimits("2028-03-10")).toEqual({ min: "2028-02-09", max: "2028-03-10" });
  });

  it("afastamento: dias inteiros e início; manda o código do CID só com autorização", () => {
    const d = { ...emptySickNote(TODAY19C), days: "3" };
    expect(d.startOn).toBe(TODAY19C);
    expect(sickNoteProblem({ ...d, days: "0" }, TODAY19C)).toBe("informe os dias de afastamento (número inteiro, de 1 a 365)");
    expect(sickNoteProblem({ ...d, days: "2,5" }, TODAY19C)).toBe("informe os dias de afastamento (número inteiro, de 1 a 365)");
    expect(sickNoteProblem({ ...d, days: "366" }, TODAY19C)).toBe("informe os dias de afastamento (número inteiro, de 1 a 365)");
    expect(sickNoteProblem({ ...d, days: "365" }, TODAY19C)).toBeNull();
    expect(sickNoteProblem({ ...d, startOn: "" }, TODAY19C)).toBe("informe o início do afastamento");
    expect(sickNoteProblem(d, TODAY19C)).toBeNull();
    expect(sickNoteInput({ ...d, note: "  repouso  " }))
      .toEqual({ type: "leave", days: 3, start_on: TODAY19C, cid_authorized: false, note: "repouso" });
    const withCid = { ...d, cid: { code: "J069", label: "Infecção aguda das vias aéreas superiores" }, cidAuthorized: true };
    expect(sickNoteInput(withCid)).toEqual({ type: "leave", days: 3, start_on: TODAY19C, cid10: { code: "J069" }, cid_authorized: true });
  });

  it("início entre 30 dias atrás e hoje (afastamento e acompanhante); observação até 500", () => {
    const d = { ...emptySickNote(TODAY19C), days: "3" };
    expect(sickNoteProblem({ ...d, startOn: "2026-09-09" }, TODAY19C)).toBeNull();
    expect(sickNoteProblem({ ...d, startOn: "2026-09-08" }, TODAY19C)).toBe("o início precisa estar entre 30 dias atrás e hoje");
    expect(sickNoteProblem({ ...d, startOn: "2026-10-10" }, TODAY19C)).toBe("o início precisa estar entre 30 dias atrás e hoje");
    const c = { ...emptySickNote(TODAY19C), type: "companion" as const, companionName: "Marcos", companionKinship: "filho", companionReason: "other" as const };
    expect(sickNoteProblem({ ...c, startOn: "2026-10-10" }, TODAY19C)).toBe("o dia do acompanhamento precisa estar entre 30 dias atrás e hoje");
    expect(sickNoteProblem({ ...d, note: "x".repeat(501) }, TODAY19C)).toBe("a observação passa de 500 caracteres");
    expect(sickNoteProblem({ ...d, note: "x".repeat(500) }, TODAY19C)).toBeNull();
    // virada de mês e de ano
    expect(sickNoteProblem({ ...d, startOn: "2025-12-02" }, "2026-01-01")).toBeNull();
    expect(sickNoteProblem({ ...d, startOn: "2025-12-01" }, "2026-01-01")).not.toBeNull();
  });

  it("atestado: CID sem autorização não passa; acompanhante nunca leva CID", () => {
    const d = { ...emptySickNote(TODAY19C), days: "3", cid: { code: "J069", label: "IVAS" }, cidAuthorized: false };
    expect(sickNoteProblem(d, TODAY19C)).toBe("o CID só entra com a autorização do paciente — marque a autorização ou tire o CID");
    const companion = { ...d, type: "companion" as const, companionName: "Marcos", companionKinship: "filho", companionReason: "clt_473_xi" as const };
    expect(sickNoteProblem(companion, TODAY19C)).toBeNull();
    expect(sickNoteInput(companion)).toEqual({
      type: "companion", start_on: TODAY19C, companion_name: "Marcos", companion_kinship: "filho", companion_reason: "clt_473_xi", cid_authorized: false
    });
  });

  it("acompanhante: pede nome (3 a 120), parentesco (2 a 60) e motivo", () => {
    const d = { ...emptySickNote(TODAY19C), type: "companion" as const };
    expect(sickNoteProblem(d, TODAY19C)).toBe("informe o nome do acompanhante");
    expect(sickNoteProblem({ ...d, companionName: "Jo" }, TODAY19C)).toBe("o nome do acompanhante precisa ter de 3 a 120 caracteres");
    expect(sickNoteProblem({ ...d, companionName: "x".repeat(121) }, TODAY19C)).toBe("o nome do acompanhante precisa ter de 3 a 120 caracteres");
    expect(sickNoteProblem({ ...d, companionName: "Marcos" }, TODAY19C)).toBe("informe o parentesco");
    expect(sickNoteProblem({ ...d, companionName: "Marcos", companionKinship: "f" }, TODAY19C)).toBe("o parentesco precisa ter de 2 a 60 caracteres");
    expect(sickNoteProblem({ ...d, companionName: "Marcos", companionKinship: "filho" }, TODAY19C)).toBe("escolha o motivo do acompanhamento");
  });
});

describe("declaração de comparecimento", () => {
  it("período ou horário, nunca os dois; saída pode ser igual à chegada", () => {
    const byPeriod = emptyDeclaration(TODAY19C);
    expect(byPeriod.mode).toBe("period");
    expect(declarationProblem(byPeriod)).toBe("escolha o período");
    expect(declarationInput({ ...byPeriod, period: "morning", arrivedAt: "08:15" })).toEqual({ period: "morning" });
    const byTime = emptyDeclaration(TODAY19C, "08:15");
    expect(byTime.mode).toBe("times");
    expect(declarationProblem({ ...byTime, arrivedAt: "8:15" })).toBe("informe a hora de chegada (HH:MM)");
    expect(declarationProblem({ ...byTime, leftAt: "08:00" })).toBe("a saída não pode ser antes da chegada");
    expect(declarationProblem({ ...byTime, leftAt: "08:15" })).toBeNull();
    expect(declarationInput({ ...byTime, leftAt: "10:30", companionName: " Marcos ", issuerRegistration: " 4521 " }))
      .toEqual({ arrived_at: "08:15", left_at: "10:30", companion_name: "Marcos", issuer_registration: "4521" });
  });

  it("acompanhante de 3 a 120 e matrícula até 30 caracteres", () => {
    const byTime = emptyDeclaration(TODAY19C, "08:15");
    expect(declarationProblem({ ...byTime, companionName: "Jo" })).toBe("o nome do acompanhante precisa ter de 3 a 120 caracteres");
    expect(declarationProblem({ ...byTime, companionName: "Marcos" })).toBeNull();
    expect(declarationProblem({ ...byTime, companionName: "   " })).toBeNull();
    expect(declarationProblem({ ...byTime, issuerRegistration: "9".repeat(31) })).toBe("a matrícula passa de 30 caracteres");
    expect(declarationProblem({ ...byTime, issuerRegistration: "9".repeat(30) })).toBeNull();
    expect(declarationProblem({ ...emptyDeclaration(TODAY19C), period: "full_day", companionName: "x" }))
      .toBe("o nome do acompanhante precisa ter de 3 a 120 caracteres");
  });
});

describe("receita", () => {
  it("item do catálogo e de texto livre viram o corpo do POST; quantidade com casas decimais", () => {
    const d = { items: [ filled({ durationDays: "30", continuous: true }),
      { ...emptyItem(), freeText: " Soro fisiológico 0,9% ", quantity: "1,5", quantityUnit: "frasco", route: "nasal" as const, dosage: "2 jatos" } ],
      protocolVersionId: "" };
    expect(prescriptionProblems(d, false)).toEqual([]);
    expect(prescriptionInput(d)).toEqual({ items: [
      { catalog_item: { id: "ci1" }, quantity: 60, quantity_unit: "comprimido", route: "oral", dosage_instructions: "1 cp 2x/dia", duration_days: 30, continuous: true },
      { free_text: "Soro fisiológico 0,9%", quantity: 1.5, quantity_unit: "frasco", route: "nasal", dosage_instructions: "2 jatos", continuous: false }
    ] });
  });

  it("quantidade: até 4 inteiros e 2 casas, maior que zero, no máximo 9999", () => {
    const problem = (quantity: string) => prescriptionProblems({ items: [ filled({ quantity }) ], protocolVersionId: "" }, false);
    for (const ok of [ "1", "0,5", "0.25", "9999", "1,50" ]) expect(problem(ok)).toEqual([]);
    for (const bad of [ "", "0", "0,00", "1,234", "10000", "9999,5", "-1", "um", "1e2" ]) {
      expect(problem(bad)).toEqual([ "item 1: informe a quantidade (número maior que 0, com até 2 casas decimais)" ]);
    }
  });

  it("diz o que falta por item, e controlado nunca entra", () => {
    expect(prescriptionProblems({ items: [], protocolVersionId: "" }, false)).toEqual([ "inclua ao menos um medicamento" ]);
    expect(prescriptionProblems({ items: [ emptyItem() ], protocolVersionId: "" }, false)).toEqual([
      "item 1: escolha um medicamento do catálogo ou escreva em texto livre",
      "item 1: informe a quantidade (número maior que 0, com até 2 casas decimais)",
      "item 1: informe a unidade da quantidade",
      "item 1: escolha a via",
      "item 1: escreva a posologia"
    ]);
    expect(prescriptionProblems({ items: [ filled({ medication: CLONAZEPAM }) ], protocolVersionId: "" }, false))
      .toEqual([ `item 1: ${CONTROLLED_BLOCKED}` ]);
    expect(prescriptionProblems({ items: [ filled({ durationDays: "sete" }) ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: a duração é em dias (número inteiro, de 1 a 365)" ]);
    expect(prescriptionProblems({ items: [ filled({ durationDays: "366" }) ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: a duração é em dias (número inteiro, de 1 a 365)" ]);
  });

  it("limites do api: até 20 itens, texto livre, unidade e posologia", () => {
    const twentyOne = Array.from({ length: 21 }, () => filled());
    expect(prescriptionProblems({ items: twentyOne, protocolVersionId: "" }, false)).toEqual([ "a receita aceita até 20 itens" ]);
    expect(prescriptionProblems({ items: twentyOne.slice(0, 20), protocolVersionId: "" }, false)).toEqual([]);
    const free = (freeText: string) => ({ ...filled(), medication: null, freeText });
    expect(prescriptionProblems({ items: [ free("ab") ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: o texto livre precisa ter de 3 a 200 caracteres" ]);
    expect(prescriptionProblems({ items: [ free("x".repeat(201)) ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: o texto livre precisa ter de 3 a 200 caracteres" ]);
    expect(prescriptionProblems({ items: [ filled({ quantityUnit: "u".repeat(31) }) ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: a unidade da quantidade tem até 30 caracteres" ]);
    expect(prescriptionProblems({ items: [ filled({ dosage: "ab" }) ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: a posologia precisa ter de 3 a 500 caracteres" ]);
    expect(prescriptionProblems({ items: [ filled({ dosage: "d".repeat(501) }) ], protocolVersionId: "" }, false))
      .toEqual([ "item 1: a posologia precisa ter de 3 a 500 caracteres" ]);
  });

  it("enfermagem: protocolo obrigatório, sem texto livre e até a dose máxima (unidade sem diferenciar maiúsculas)", () => {
    const fromProtocol = filled({ medication: { ...DIPYRONE_REF, max_dose: { quantity: 2, unit: "comprimido" } }, quantity: "3" });
    expect(prescriptionProblems({ items: [ fromProtocol ], protocolVersionId: "" }, true)).toEqual([
      "escolha o protocolo de enfermagem", "item 1: acima da dose máxima do protocolo (até 2 comprimido)"
    ]);
    const free = { ...emptyItem(), freeText: "Dipirona gotas", quantity: "1", quantityUnit: "frasco", route: "oral" as const, dosage: "20 gotas" };
    expect(prescriptionProblems({ items: [ free ], protocolVersionId: "npv1" }, true)).toEqual([ "item 1: a enfermagem só prescreve itens do protocolo" ]);
    expect(prescriptionInput({ items: [ { ...fromProtocol, quantity: "1" } ], protocolVersionId: "npv1" }))
      .toEqual({ items: [ { catalog_item: { id: "ci4" }, quantity: 1, quantity_unit: "comprimido", route: "oral", dosage_instructions: "1 cp 2x/dia", continuous: false } ],
        nursing_protocol: { version_id: "npv1" } });
    const capital = { ...fromProtocol, quantity: "2", quantityUnit: " Comprimido " };
    expect(prescriptionProblems({ items: [ capital ], protocolVersionId: "npv1" }, true)).toEqual([]);
    const other = { ...fromProtocol, quantity: "1", quantityUnit: "frasco" };
    expect(prescriptionProblems({ items: [ other ], protocolVersionId: "npv1" }, true))
      .toEqual([ "item 1: acima da dose máxima do protocolo (até 2 comprimido)" ]);
    const decimal = { ...fromProtocol, medication: { ...DIPYRONE_REF, max_dose: { quantity: 2.5, unit: "frasco" } }, quantity: "2,5", quantityUnit: "frasco" };
    expect(prescriptionProblems({ items: [ decimal ], protocolVersionId: "npv1" }, true)).toEqual([]);
  });

  it("antimicrobiano é avisado; renovação e item do catálogo preenchem o rascunho", () => {
    expect(hasAntimicrobial({ items: [ itemFromMedication(AMOXICILLIN) ], protocolVersionId: "" })).toBe(true);
    expect(hasAntimicrobial({ items: [ itemFromMedication(searchItem()) ], protocolVersionId: "" })).toBe(false);
    expect(ANTIMICROBIAL_NOTE).toBe("antimicrobiano: a receita sai em papel, em 2 vias (1ª via — farmácia, 2ª via — paciente), válida por 10 dias");
    const picked = itemFromMedication(searchItem());
    expect([ picked.quantityUnit, picked.route, picked.continuous, picked.medication?.id ]).toEqual([ "comprimido", "", false, "ci1" ]);
    const renewed = itemFromPrescription(prescriptionItem());
    expect([ renewed.medication?.id, renewed.quantity, renewed.quantityUnit, renewed.route, renewed.dosage, renewed.durationDays, renewed.continuous ])
      .toEqual([ "ci1", "60", "comprimido", "oral", "1 comprimido após o café e 1 após o jantar", "30", true ]);
    const freeRenewed = itemFromPrescription(prescriptionItem({ catalog_item: undefined, free_text: "Soro", duration_days: undefined }));
    expect([ freeRenewed.medication, freeRenewed.freeText, freeRenewed.durationDays ]).toEqual([ null, "Soro", "" ]);
    expect(itemFromMedication(searchItem()).key).not.toBe(itemFromMedication(searchItem()).key);
  });

  it("quantidade gravada com casas volta ao rascunho e passa na validação", () => {
    const item = itemFromPrescription(prescriptionItem({ quantity: 1.5, quantity_unit: "frasco" }));
    expect(item.quantity).toBe("1.5");
    expect(prescriptionProblems({ items: [ item ], protocolVersionId: "" }, false)).toEqual([]);
    expect(prescriptionInput({ items: [ item ], protocolVersionId: "" }).items[0].quantity).toBe(1.5);
  });

  it("item da renovação parcial (chaves ausentes) não quebra nem vira 'undefined'", () => {
    const partial = renewalItem({ catalog_item: catalogItem({ dosage_form: null }), dosage_instructions: undefined });
    const item = itemFromPrescription(partial);
    expect([ item.quantity, item.quantityUnit, item.route, item.dosage, item.freeText, item.durationDays, item.continuous ])
      .toEqual([ "", "", "", "", "", "", true ]);
    expect(item.medication?.id).toBe("ci1");
    expect(prescriptionProblems({ items: [ item ], protocolVersionId: "" }, false)).toEqual([
      "item 1: informe a quantidade (número maior que 0, com até 2 casas decimais)",
      "item 1: informe a unidade da quantidade",
      "item 1: escolha a via",
      "item 1: escreva a posologia"
    ]);
    const some = itemFromPrescription(renewalItem({ quantity: 30, quantity_unit: "comprimido", route: "oral", duration_days: 30 }));
    expect([ some.quantity, some.quantityUnit, some.route, some.dosage, some.durationDays ]).toEqual([ "30", "comprimido", "oral", "1 cp/dia", "30" ]);
    const freeText = itemFromPrescription(renewalItem({ free_text: "Soro" }));
    expect([ freeText.medication, freeText.freeText ]).toEqual([ null, "Soro" ]);
  });

  it("item de protocolo antimicrobiano avisa antes de emitir; controlado vem marcado", () => {
    const protocol = nursingProtocol({ current_version: {
      id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: null,
      items: [ { catalog_item: { ...AMOXICILLIN, antimicrobial: true, controlled: false }, max_dose: { quantity: 21, unit: "cápsula" } },
        { catalog_item: { ...DIPYRONE_REF, antimicrobial: false, controlled: false }, max_dose: null },
        { catalog_item: { ...DIPYRONE_REF, id: "ci9", antimicrobial: false, controlled: true } } ]
    } });
    const [ amox, dipy, controlled ] = protocol.current_version!.items.map(itemFromProtocolItem);
    expect(hasAntimicrobial({ items: [ amox ], protocolVersionId: "npv1" })).toBe(true);
    expect(hasAntimicrobial({ items: [ dipy ], protocolVersionId: "npv1" })).toBe(false);
    expect(amox.medication?.max_dose).toEqual({ quantity: 21, unit: "cápsula" });
    expect(amox.quantityUnit).toBe("cápsula");
    expect(controlled.medication?.controlled).toBe(true);
    expect(prescriptionProblems({ items: [ { ...controlled, quantity: "1", route: "oral", dosage: "1 cp" } ], protocolVersionId: "npv1" }, true))
      .toEqual([ `item 1: ${CONTROLLED_BLOCKED}` ]);
  });

  it("dosage_form null não quebra o item nem a validação", () => {
    const m = searchItem({ dosage_form: null });
    const item = itemFromMedication(m);
    expect(item.quantityUnit).toBe("");
    expect(() => prescriptionProblems({ items: [ item ], protocolVersionId: "" }, false)).not.toThrow();
    const protocol = addProtocolItem({ ...emptyProtocol(TODAY19C), title: "Protocolo", number: "1" }, catalogItem({ dosage_form: null }));
    expect(protocol.items[0].maxUnit).toBe("");
    expect(() => protocolProblem(protocol, true)).not.toThrow();
  });
});

describe("cancelar e emitir outro", () => {
  it("o novo abre com o conteúdo do cancelado", () => {
    const sick = reissueDraft(sickNoteDoc({ content: { type: "leave", days: 3, start_on: "2026-10-09", cid10: { code: "J069", label: "IVAS" }, cid_authorized: true, note: null } }));
    expect(sick?.kind).toBe("sick_note");
    if (sick?.kind === "sick_note") expect([ sick.draft.days, sick.draft.cid?.code, sick.draft.cidAuthorized, sick.draft.note ]).toEqual([ "3", "J069", true, "" ]);
    const decl = reissueDraft(declarationDoc());
    if (decl?.kind === "attendance_declaration") expect([ decl.draft.mode, decl.draft.period ]).toEqual([ "period", "morning" ]);
    const rx = reissueDraft(prescriptionDoc());
    if (rx?.kind === "prescription") expect(rx.draft.items.map((i) => i.medication?.id)).toEqual([ "ci1" ]);
    const exam = reissueDraft(examDoc({ content: { exams: [], note: "jejum de 8 h" } }));
    if (exam?.kind === "exam_requisition") expect(exam.draft.note).toBe("jejum de 8 h");
    expect(reissueDraft(sickNoteDoc({ kind: "referral" as never }))).toBeNull();
  });

  it("receita cancelada com quantidade fracionária reabre válida", () => {
    const rx = reissueDraft(prescriptionDoc({ content: { items: [ prescriptionItem({ quantity: 1.5, quantity_unit: "frasco" }) ], antimicrobial: false, copies: 1 } }));
    expect(rx?.kind).toBe("prescription");
    if (rx?.kind === "prescription") expect(prescriptionProblems(rx.draft, false)).toEqual([]);
  });
});

describe("medicamentos em uso", () => {
  it("de fora: do catálogo ou texto livre", () => {
    expect(externalProblem(EMPTY_EXTERNAL)).toBe("escolha o medicamento no catálogo ou escreva o nome");
    expect(externalChange({ ...EMPTY_EXTERNAL, medication: catalogItem(), dosage: " 1 cp/dia " }))
      .toEqual({ action: "add_external", catalog_item_id: "ci1", dosage_summary: "1 cp/dia", continuous: true });
    expect(externalChange({ ...EMPTY_EXTERNAL, freeText: " Losartana 50 mg ", continuous: false }))
      .toEqual({ action: "add_external", free_text: "Losartana 50 mg", continuous: false });
  });

  it("limites do api: texto livre de 3 a 200 e posologia até 200", () => {
    expect(externalProblem({ ...EMPTY_EXTERNAL, freeText: "ab" })).toBe("o nome do medicamento precisa ter de 3 a 200 caracteres");
    expect(externalProblem({ ...EMPTY_EXTERNAL, freeText: "x".repeat(201) })).toBe("o nome do medicamento precisa ter de 3 a 200 caracteres");
    expect(externalProblem({ ...EMPTY_EXTERNAL, freeText: "Losartana" })).toBeNull();
    expect(externalProblem({ ...EMPTY_EXTERNAL, medication: catalogItem(), dosage: "d".repeat(201) })).toBe("a posologia passa de 200 caracteres");
    expect(externalProblem({ ...EMPTY_EXTERNAL, medication: catalogItem(), dosage: "d".repeat(200) })).toBeNull();
  });

  it("linha e ordem: em uso primeiro, depois por nome", () => {
    expect(medicationLine(medication())).toBe("Metformina 850 mg — 1 cp 2x/dia");
    expect(medicationLine(medication({ dosage_summary: null }))).toBe("Metformina 850 mg");
    const list = [ medication({ id: "b", label: "Sinvastatina", status: "suspended" }), medication({ id: "c", label: "Losartana" }), medication({ id: "a" }) ];
    expect(sortMedications(list).map((m) => m.id)).toEqual([ "c", "a", "b" ]);
  });
});

describe("protocolos de enfermagem", () => {
  it("vigentes na data; rótulo com número e ano", () => {
    const current = nursingProtocol();
    const expired = nursingProtocol({ id: "np2", current_version: { id: "npv2", version: 1, valid_from: "2024-01-01", valid_until: "2025-12-31", items: [] } });
    const future = nursingProtocol({ id: "np3", current_version: { id: "npv3", version: 1, valid_from: "2026-11-01", valid_until: null, items: [] } });
    const none = nursingProtocol({ id: "np4", current_version: null });
    expect(vigentProtocols([ current, expired, future, none ], TODAY19C).map((p) => p.id)).toEqual([ "np1" ]);
    expect(protocolLabel(current)).toBe("Protocolo de enfermagem na atenção primária (nº 007/2025, 2025)");
  });

  it("rascunho: cabeçalho, vigência, itens e dose máxima", () => {
    const d = emptyProtocol(TODAY19C);
    expect(d.year).toBe("2026");
    expect(protocolProblem(d, true)).toBe("informe o título do protocolo");
    const full = addProtocolItem({ ...d, title: "Protocolo", number: "007/2025", year: "2025" }, DIPYRONE_REF);
    expect(addProtocolItem(full, DIPYRONE_REF).items).toHaveLength(1);
    expect(protocolProblem({ ...full, year: "25" }, true)).toBe("informe o ano de publicação com 4 dígitos");
    expect(protocolProblem({ ...full, validUntil: "2026-01-01" }, true)).toBe("o fim da vigência não pode ser antes do início");
    expect(protocolProblem({ ...full, items: [] }, true)).toBe("inclua ao menos um medicamento no protocolo");
    expect(protocolProblem({ ...full, items: [ { item: DIPYRONE_REF, maxDose: "dois", maxUnit: "frasco" } ] }, true))
      .toBe("item 1: a dose máxima é um número maior que 0, com até 2 casas decimais (ou deixe em branco)");
    expect(protocolProblem({ ...full, title: "" }, false)).toBeNull();
    expect(protocolInput({ ...full, items: [ { item: DIPYRONE_REF, maxDose: "2", maxUnit: "frasco" } ] })).toEqual({
      title: "Protocolo", number: "007/2025", year: 2025, valid_from: TODAY19C, items: [ { catalog_item_id: "ci4", max_dose: { quantity: 2, unit: "frasco" } } ]
    });
    expect(protocolVersionInput({ ...full, validUntil: "2027-12-31" }))
      .toEqual({ valid_from: TODAY19C, valid_until: "2027-12-31", items: [ { catalog_item_id: "ci4" } ] });
    const next = protocolDraftFrom(nursingProtocol(), TODAY19C);
    expect([ next.title, next.validFrom, next.items[0].item.id, next.items[0].maxDose, next.items[0].maxUnit ])
      .toEqual([ "Protocolo de enfermagem na atenção primária", TODAY19C, "ci4", "2", "frasco" ]);
    expect(protocolProblem({ ...full, items: [ { item: DIPYRONE_REF, maxDose: "2", maxUnit: " " } ] }, true))
      .toBe("item 1: informe a unidade da dose máxima");
  });

  it("dose máxima com casas: a nova versão de um protocolo com 2,5 reabre válida e manda número", () => {
    const protocol = nursingProtocol({ current_version: {
      id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: null, items: [ { catalog_item: { ...DIPYRONE_REF, antimicrobial: false, controlled: false }, max_dose: { quantity: 2.5, unit: "frasco" } } ]
    } });
    const next = protocolDraftFrom(protocol, TODAY19C);
    expect(next.items[0].maxDose).toBe("2.5");
    expect(protocolProblem(next, false)).toBeNull();
    expect(protocolVersionInput(next).items[0].max_dose).toEqual({ quantity: 2.5, unit: "frasco" });
    const comma = { ...next, items: [ { ...next.items[0], maxDose: "0,75" } ] };
    expect(protocolVersionInput(comma).items[0].max_dose).toEqual({ quantity: 0.75, unit: "frasco" });
    expect(protocolProblem({ ...next, items: [ { ...next.items[0], maxDose: "1,234" } ] }, false)).not.toBeNull();
  });

  it("limites do api: título, número, ano, unidade e itens", () => {
    const base = addProtocolItem({ ...emptyProtocol(TODAY19C), title: "Protocolo", number: "7", year: "2025" }, DIPYRONE_REF);
    expect(protocolProblem({ ...base, title: "ab" }, true)).toBe("o título precisa ter de 3 a 200 caracteres");
    expect(protocolProblem({ ...base, title: "t".repeat(201) }, true)).toBe("o título precisa ter de 3 a 200 caracteres");
    expect(protocolProblem({ ...base, number: "n".repeat(31) }, true)).toBe("o número precisa ter de 1 a 30 caracteres");
    expect(protocolProblem({ ...base, year: "1989" }, true, TODAY19C)).toBe("o ano de publicação vai de 1990 até o ano que vem");
    expect(protocolProblem({ ...base, year: "2027" }, true, TODAY19C)).toBeNull();
    expect(protocolProblem({ ...base, year: "2028" }, true, TODAY19C)).toBe("o ano de publicação vai de 1990 até o ano que vem");
    expect(protocolProblem({ ...base, items: [ { item: DIPYRONE_REF, maxDose: "2", maxUnit: "u".repeat(31) } ] }, true))
      .toBe("item 1: a unidade da dose máxima tem até 30 caracteres");
    const many = Array.from({ length: 101 }, (_, i) => ({ item: { ...DIPYRONE_REF, id: `c${i}` }, maxDose: "", maxUnit: "" }));
    expect(protocolProblem({ ...base, items: many }, true)).toBe("o protocolo aceita até 100 itens");
  });
});

describe("CNPJ", () => {
  it("dígito verificador, máscara e ausente", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12abc34501de35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE36")).toBe(false);
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj(null)).toBe("não cadastrado");
  });
});

describe("frases das recusas", () => {
  const err = (status: number, body: unknown) => new ApiError(status, body, String(status));

  it("cada recusa do contrato tem frase; item e campo apontam onde", () => {
    expect(documentError(err(403, { error: "cbo_not_allowed" }))).toBe("o seu CBO não emite este tipo de documento");
    expect(documentError(err(403, { error: "not_author" }))).toBe("só a autora da consulta emite e cancela os documentos dela");
    expect(documentError(err(422, { error: "controlled_not_allowed", index: 1 })))
      .toBe("item 2: medicamento controlado não entra aqui (receita de controle especial — 19d)");
    expect(documentError(err(422, { error: "invalid_content", field: "days" }))).toBe("confira o campo: dias de afastamento");
    expect(documentError(err(422, { error: "invalid_content", field: "xyz" }))).toBe("confira o campo: xyz");
    expect(documentError(err(422, { error: "city_cnpj_missing" })))
      .toBe("a cidade ainda não cadastrou o CNPJ — sem ele a receita de enfermagem não sai; avise o administrador da cidade");
    expect(documentError(err(409, { error: "attendance_not_found_or_closed_long_ago" })))
      .toBe("atendimento não encontrado ou encerrado há mais de 30 dias — a declaração não sai mais por aqui");
    expect(documentError(err(409, { error: "already_cancelled" }))).toBe("este documento já estava cancelado — a lista foi atualizada");
    expect(documentError(err(409, { error: "awaiting_signature" })))
      .toBe("o documento digital ainda não foi assinado — assine (sessão ou lote) ou volte ao papel em Pendentes de assinatura para imprimir");
  });

  it("catalog_unavailable não sugere texto livre (o api recusa qualquer receita sem catálogo)", () => {
    const phrase = documentError(err(503, { error: "catalog_unavailable" }));
    expect(phrase).toBe("o catálogo de medicamentos está indisponível agora — a receita não sai; tente de novo em instantes");
    expect(phrase).not.toMatch(/texto livre/);
  });

  it("campos do invalid_content: rótulos e frases próprias", () => {
    const field = (name: string) => documentError(err(422, { error: "invalid_content", field: name }));
    expect(field("replaces_document_id")).toBe("este documento já foi substituído (ou não pode ser substituído) — a lista foi atualizada");
    expect(field("exams")).toBe("um exame pedido não tem nome na tabela SIGTAP vigente — avise o suporte");
    const labels: Record<string, string> = {
      type: "tipo do atestado", cid10: "CID", cid_authorized: "autorização do CID", kind: "tipo de documento", valid_until: "fim da vigência",
      issuer_registration: "matrícula de quem emite", action: "ação", free_text: "nome do medicamento", dosage_summary: "posologia",
      continuous: "uso contínuo", catalog_item_id: "medicamento do catálogo", title: "título", number: "número", year: "ano",
      valid_from: "início da vigência", items: "medicamentos"
    };
    for (const [ name, label ] of Object.entries(labels)) expect(field(name)).toBe(`confira o campo: ${label}`);
    expect(field("")).toBe("confira o campo: do formulário");
  });

  it("invalid_item aponta o item e o campo, na receita e no protocolo", () => {
    const item = (index: number, f: string) => documentError(err(422, { error: "invalid_item", index, field: f }));
    expect(item(0, "quantity")).toBe("item 1: confira quantidade");
    expect(item(2, "dosage_instructions")).toBe("item 3: confira posologia");
    expect(item(1, "catalog_item_id")).toBe("item 2: confira medicamento do catálogo");
    expect(item(0, "max_dose")).toBe("item 1: confira dose máxima");
    expect(item(0, "novo_campo")).toBe("item 1: confira novo_campo");
    expect(documentError(err(422, { error: "invalid_item", index: 0 }))).toBe("item 1: confira os dados do item");
    expect(documentError(err(422, { error: "invalid_item" }))).toBe("um dos itens não foi aceito");
  });

  it("códigos novos do contrato tem frase própria (nenhum cai no genérico)", () => {
    const code = (status: number, error: string, extra: object = {}) => documentError(err(status, { error, ...extra }));
    const generic = "não foi possível concluir — tente de novo";
    const all: [ number, string ][] = [
      [ 403, "not_author" ], [ 403, "cbo_not_allowed" ], [ 403, "missing_role" ], [ 403, "forbidden" ], [ 422, "cid_requires_authorization" ],
      [ 422, "companion_cid_not_allowed" ], [ 422, "controlled_not_allowed" ], [ 422, "not_in_nursing_protocol" ], [ 422, "above_protocol_max_dose" ],
      [ 422, "free_text_not_allowed" ], [ 422, "city_cnpj_missing" ], [ 422, "no_exam_requests" ], [ 422, "invalid_item" ], [ 422, "invalid_reason" ],
      [ 422, "invalid_cnpj" ], [ 422, "invalid_medication" ], [ 422, "invalid_catalog_item" ], [ 422, "invalid_unit" ], [ 404, "not_found" ],
      [ 409, "attendance_not_found_or_closed_long_ago" ], [ 409, "already_cancelled" ], [ 409, "awaiting_signature" ], [ 409, "already_exists" ],
      [ 409, "already_active" ], [ 409, "not_draft" ], [ 503, "catalog_unavailable" ], [ 403, "out_of_context" ], [ 403, "opening_required" ]
    ];
    for (const [ status, error ] of all) {
      const phrase = code(status, error);
      expect(phrase, error).not.toBe(generic);
      expect(phrase, error).not.toBe("a API recusou a ação");
      expect(phrase, error).not.toBe(error);
    }
    expect(code(422, "invalid_medication")).toBe("este medicamento mudou desde a leitura — a lista foi atualizada");
    expect(code(404, "not_found")).toBe("não encontramos o que você pediu — pode ter sido removido");
  });

  it("mfa_required fica com o SensitiveAction: aqui só cai na frase genérica", () => {
    expect(documentError(err(401, { error: "mfa_required" }))).toBe("não foi possível concluir — tente de novo");
  });

  it("out_of_context é genérico: serve a documento, renovação e medicamentos", () => {
    expect(documentError(err(403, { error: "out_of_context" })))
      .toBe("fora do atendimento, abra o prontuário com motivo para ver isto");
  });

  it("interruptor desligado: documentos ou prontuário", () => {
    expect(documentError(err(403, { error: "feature_disabled", feature: "clinical_documents" }))).toBe(DOCUMENTS_DISABLED);
    expect(documentError(err(403, { error: "feature_disabled", feature: "clinical_record" }))).toBe("o prontuário está desligado nesta cidade");
  });

  it("recusa desconhecida não mostra o código cru", () => {
    expect(documentError(err(500, ""))).not.toMatch(/500|http/);
    expect(documentError(new Error("x"))).toBe("não foi possível concluir — tente de novo");
  });

  it("um 422 {error, field} do api real vira ApiError com o corpo preservado e a frase certa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_content", field: "cid10" }),
      { status: 422, headers: { "Content-Type": "application/json" } })));
    const thrown = await issueDocument("cs1", { kind: "exam_requisition", content: {} }).catch((e) => e);
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(422);
    expect((thrown as ApiError).body).toEqual({ error: "invalid_content", field: "cid10" });
    expect(documentError(thrown)).toBe("confira o campo: CID");
  });

  it("um 422 com index (invalid_item) atravessa o cliente com index e field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_item", index: 1, field: "route" }),
      { status: 422, headers: { "Content-Type": "application/json" } })));
    const thrown = await issueDocument("cs1", { kind: "exam_requisition", content: {} }).catch((e) => e);
    expect((thrown as ApiError).body).toEqual({ error: "invalid_item", index: 1, field: "route" });
    expect(documentError(thrown)).toBe("item 2: confira via");
  });
});

describe("frases e regras do 19d nas regras do 19c", () => {
  const err = (status: number, body: unknown) => new ApiError(status, body, String(status));

  it("rótulo da Notificação e o interruptor do controlado", () => {
    expect(kindLabel("controlled_notification_record")).toBe("Notificação de receita (papel)");
    expect(documentError(err(403, { error: "feature_disabled", feature: "controlled_prescriptions" }))).toBe(CONTROLLED_DISABLED);
    expect(CONTROLLED_DISABLED).toBe("a receita de controlado está desligada nesta cidade");
    expect(documentError(err(403, { error: "feature_disabled", feature: "clinical_documents" }))).toBe(DOCUMENTS_DISABLED);
  });

  it("recusas novas da emissão, com a posição do item quando vem", () => {
    expect(documentError(err(422, { error: "mixed_categories", index: 1 }))).toBe(`item 2: ${MIXED_CATEGORIES}`);
    expect(MIXED_CATEGORIES).toBe(
      "este item não pode ir nesta receita — separe em duas receitas (controle especial só com itens C1/C5 do catálogo; antimicrobiano só com antimicrobianos do catálogo; item comum e texto livre vão numa receita comum)");
    expect(documentError(err(422, { error: "duration_exceeded", index: 1 })))
      .toBe("item 2: duração acima do permitido (controle especial: 60 dias, 180 para anticonvulsivante; Notificação A: 30; B: 60)");
    expect(documentError(err(422, { error: "duration_exceeded" })))
      .toBe("duração acima do permitido (controle especial: 60 dias, 180 para anticonvulsivante; Notificação A: 30; B: 60)");
    expect(documentError(err(422, { error: "requires_notification", index: 0 })))
      .toBe("item 1: este medicamento é de Notificação (listas A/B): registre a Notificação de papel em vez da receita");
    expect(documentError(err(422, { error: "not_supported", index: 2 })))
      .toBe("item 3: medicamento das listas C2, C3 ou C4 (retinoide, talidomida, antirretroviral) não sai pelo Rota Saúde");
    // Com o 19d ligado, só o texto livre é recusado assim; desligado, continua a frase do 19c.
    expect(documentError(err(422, { error: "controlled_not_allowed", index: 0 }), { controlled: true }))
      .toBe("item 1: medicamento controlado não entra em texto livre — escolha o item no catálogo");
    expect(documentError(err(422, { error: "controlled_not_allowed", index: 0 })))
      .toBe(`item 1: medicamento controlado não entra aqui (${CONTROLLED_BLOCKED})`);
    expect(documentError(err(422, { error: "too_many_c1_substances" }))).toBe("no máximo 3 substâncias da lista C1 por receita");
    expect(documentError(err(422, { error: "invalid_item", index: 0, field: "duration_days" }))).toBe("item 1: confira duração");
    expect(documentError(err(422, { error: "prescriber_address_missing" }))).toBe(PRESCRIBER_MISSING);
    expect(documentError(err(422, { error: "item_not_in_notification_list" }))).toBe("o medicamento não é de Notificação (listas A ou B)");
    expect(documentError(err(422, { error: "notification_type_mismatch" }))).toBe("o tipo da Notificação não bate com a lista do medicamento");
    expect(documentError(err(403, { error: "cbo_not_allowed" }))).toBe("o seu CBO não emite este tipo de documento");
  });

  it("identificação do paciente: os campos reais do api", () => {
    const required = (field: string) => documentError(err(422, { error: "patient_identification_required", field }));
    expect(required("patient_identification")).toBe("falta na identificação do paciente: endereço");
    expect(required("patient_identification.address")).toBe("falta na identificação do paciente: endereço");
    expect(required("patient_identification.cpf")).toBe("o paciente está sem CPF válido no cadastro — corrija o cadastro antes");
    const invalid = (field: string) => documentError(err(422, { error: "invalid_content", field }));
    expect(invalid("patient_identification.address.zip")).toBe("endereço do paciente: confira o CEP");
    expect(invalid("patient_identification.address.street")).toBe("endereço do paciente: confira o logradouro");
    expect(invalid("patient_identification.address")).toBe("endereço do paciente: confira o endereço");
    expect(invalid("patient_identification")).toBe("identificação do paciente inválida");
  });

  it("campos da Notificação no invalid_content", () => {
    const field = (name: string) => documentError(err(422, { error: "invalid_content", field: name }));
    const labels: Record<string, string> = {
      paper_number: "número do talão", numbering_uf: "UF da numeração", notification_type: "tipo da Notificação",
      "item.catalog_item": "medicamento", "item.quantity": "quantidade", "item.quantity_unit": "unidade", "item.route": "via",
      "item.dosage_instructions": "posologia", "item.duration_days": "duração em dias"
    };
    for (const [ name, label ] of Object.entries(labels)) expect(field(name)).toBe(`confira o campo: ${label}`);
  });

  it("nenhum código novo cai no genérico nem aparece cru", () => {
    const codes = [
      "mixed_categories", "requires_notification", "not_supported", "too_many_c1_substances", "duration_exceeded", "patient_identification_required",
      "prescriber_address_missing", "controlled_not_allowed", "item_not_in_notification_list", "notification_type_mismatch"
    ];
    for (const code of codes) {
      const phrase = documentError(err(422, { error: code }));
      expect(phrase, code).not.toBe("não foi possível concluir — tente de novo");
      expect(phrase, code).not.toBe("a API recusou a ação");
      expect(phrase, code).not.toContain(code);
    }
  });

  it("com o controlado liberado, a receita não acusa o controlado (quem confere é controlledProblems)", () => {
    const sertraline = { ...itemFromMedication({ ...catalogItem({ id: "ci10" }), controlled: true, controlled_list: "C1" }),
      quantity: "30", route: "oral" as const, dosage: "1 cp ao dia", durationDays: "60" };
    expect(prescriptionProblems({ items: [ sertraline ], protocolVersionId: "" }, false)).toEqual([ `item 1: ${CONTROLLED_BLOCKED}` ]);
    expect(prescriptionProblems({ items: [ sertraline ], protocolVersionId: "" }, false, true)).toEqual([]);
  });

  it("cancelar e emitir outro leva a categoria e a identificação do paciente da receita cancelada", () => {
    const pi = { cpf: "39053344705", address: { street: "Rua A", number: "1", district: "Centro", city: "Curitiba", uf: "PR", zip: "80010010" } };
    const doc = prescriptionDoc({ content: { items: [ prescriptionItem() ], antimicrobial: false, copies: 2, category: "special_control", patient_identification: pi } });
    const next = reissueDraft(doc);
    expect(next?.kind).toBe("prescription");
    const draft = next?.kind === "prescription" ? next.draft : null;
    expect(draft?.identification).toEqual(pi);
    expect(draft?.category).toBe("special_control");
    // A origem do item fica marcada (não se infere pela ausência de controlled_list).
    expect(draft?.items[0].medication?.fromDocument).toBe(true);
    // Receita do 19c (sem os campos do 19d): nada de "undefined".
    const old = reissueDraft(prescriptionDoc());
    const oldDraft = old?.kind === "prescription" ? old.draft : null;
    expect(oldDraft?.identification).toBeNull();
    expect(oldDraft?.category).toBe("common");
  });
});
