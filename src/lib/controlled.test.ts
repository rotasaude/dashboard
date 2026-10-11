// src/lib/controlled.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type PrescriptionContent } from "./api";
import {
  CONTROLLED_DISABLED, DOCUMENTS_DISABLED, itemFromIssuedDocument, itemFromMedication, itemFromPrescription, issuedNotice, type ItemDraft
} from "./clinicalDocuments";
import {
  CATEGORY_NOTE, EMPTY_IDENTIFICATION, MIXED_CATEGORIES, PRESCRIBER_MISSING, SNCR_SIMULATED_NOTICE, addressDraftFrom, addressInput,
  addressLine, addressProblem, canRequestSncr, canSeeSncrOverview, controlledBlockReason, controlledError, controlledIssuedNotice,
  controlledOn, controlledProblems, controlledTagLabel, documentTitle, emptyNotification, formatPhone, identificationDraftFrom,
  identificationInput, itemClass, maxDaysFor, mixedIndex, notificationInput, notificationProblems, notificationTypeFor, overviewSummary,
  paperForecast, paperReasonLabel, phoneProblem, prescribesControlled, prescriptionCategory, readSncrCallback, rememberSncrState,
  sncrCallbackLanding, sncrCallbackSummary, sncrLabel, sncrOauthErrorPhrase, sortOverview, stockRows, takeSncrState, usesSimulatedSncr,
  type IdentificationDraft
} from "./controlled";
import { DIPYRONE, prescriptionDoc } from "../test/documentFixtures";
import {
  AMITRIPTYLINE, AMOXICILLIN_19D, CARBAMAZEPINE, CLONAZEPAM_B1, FLUOXETINE, ISOTRETINOIN, MORPHINE, SERTRALINE, address, controlledUser,
  notificationDoc, rceDoc, retDoc, sncrOverview, stock
} from "../test/controlledFixtures";
import { certificate } from "../test/signatureFixtures";

afterEach(() => vi.useRealTimers());

const err = (status: number, body: unknown) => new ApiError(status, body, `${status}`);
const item = (m: Parameters<typeof itemFromMedication>[0], over: Partial<ItemDraft> = {}): ItemDraft =>
  ({ ...itemFromMedication(m), quantity: "30", route: "oral", dosage: "1 comprimido ao dia", durationDays: "30", ...over });
const free = (text: string, over: Partial<ItemDraft> = {}): ItemDraft =>
  ({ ...itemFromMedication(DIPYRONE), medication: null, freeText: text, quantity: "1", route: "oral", dosage: "1x ao dia", durationDays: "7", ...over });
// Item de documento emitido: o api grava o catalog_item SEM as marcas da lista;
// a origem é marcada explicitamente (fromDocument), não inferida pela ausência da chave.
const fromDoc = (over: Partial<ItemDraft> = {}): ItemDraft => ({
  ...itemFromIssuedDocument((rceDoc().content as PrescriptionContent).items[0]), ...over
});
const FILLED: IdentificationDraft = { address: addressDraftFrom(address()) };
const MIXED_AT = (n: number) => `item ${n}: ${MIXED_CATEGORIES}`;

describe("quem pode", () => {
  it("receita de controlado: cidade com documentos e controlado, nunca operador", () => {
    expect(controlledOn(controlledUser())).toBe(true);
    expect(controlledOn(controlledUser([ "health_professional" ], { features: [ "clinical_documents" ] }))).toBe(false);
    expect(controlledOn(controlledUser([ "health_professional" ], { features: [ "controlled_prescriptions" ] }))).toBe(false);
    expect(controlledOn(controlledUser([ "health_professional" ], { operator: true }))).toBe(false);
    expect(controlledOn(null)).toBe(false);
  });

  it("SNCR do profissional; painel do admin; simulado com sncr_mock", () => {
    expect(canRequestSncr(controlledUser())).toBe(true);
    expect(canRequestSncr(controlledUser([ "municipal_admin" ]))).toBe(false);
    expect(canSeeSncrOverview(controlledUser([ "municipal_admin" ]))).toBe(true);
    expect(canSeeSncrOverview(controlledUser())).toBe(false);
    expect(usesSimulatedSncr(controlledUser())).toBe(false);
    expect(usesSimulatedSncr(controlledUser([ "health_professional" ], {
      features: [ "clinical_documents", "controlled_prescriptions", "sncr_mock" ] }))).toBe(true);
    expect(usesSimulatedSncr(controlledUser([ "health_professional" ], { features: [ "sncr_mock" ] }))).toBe(false);
  });

  it("controlado e Notificação só médico e dentista", () => {
    expect(prescribesControlled("225142")).toBe(true);
    expect(prescribesControlled("223208")).toBe(true);
    expect(prescribesControlled("223565")).toBe(false);
    expect(prescribesControlled(null)).toBe(false);
  });
});

describe("categoria pelos itens (espelho do classify do api: RCE > RET > comum)", () => {
  it("comum, controle especial e antimicrobiano puros", () => {
    expect(prescriptionCategory([])).toBe("common");
    expect(prescriptionCategory([ item(DIPYRONE) ])).toBe("common");
    expect(prescriptionCategory([ item(SERTRALINE), item(CARBAMAZEPINE) ])).toBe("special_control");
    expect(prescriptionCategory([ item(AMOXICILLIN_19D) ])).toBe("antimicrobial");
  });

  it("item comum não acompanha a categoria: misturada, com o índice do primeiro que não serve", () => {
    expect(prescriptionCategory([ item(AMOXICILLIN_19D), item(DIPYRONE) ])).toBe("mixed");
    expect(mixedIndex([ item(AMOXICILLIN_19D), item(DIPYRONE) ])).toBe(1);
    expect(prescriptionCategory([ item(DIPYRONE), item(SERTRALINE) ])).toBe("mixed");
    expect(mixedIndex([ item(DIPYRONE), item(SERTRALINE) ])).toBe(0);
  });

  it("texto livre junto de RCE ou RET: misturada", () => {
    expect(prescriptionCategory([ item(SERTRALINE), free("chá de camomila") ])).toBe("mixed");
    expect(mixedIndex([ item(SERTRALINE), free("chá de camomila") ])).toBe(1);
    expect(prescriptionCategory([ item(AMOXICILLIN_19D), free("soro fisiológico nasal") ])).toBe("mixed");
  });

  it("C1 com antimicrobiano (itens separados ou o mesmo item): misturada", () => {
    expect(prescriptionCategory([ item(SERTRALINE), item(AMOXICILLIN_19D) ])).toBe("mixed");
    expect(mixedIndex([ item(SERTRALINE), item(AMOXICILLIN_19D) ])).toBe(1);
    expect(prescriptionCategory([ item({ ...SERTRALINE, antimicrobial: true }) ])).toBe("mixed");
    expect(mixedIndex([ item({ ...SERTRALINE, antimicrobial: true }) ])).toBe(0);
  });

  it("só texto livre: comum para a tela (o antimicrobiano em texto livre o api reconhece e leva a papel)", () => {
    expect(prescriptionCategory([ free("amoxicilina 500 mg") ])).toBe("common");
    expect(mixedIndex([ free("amoxicilina 500 mg"), free("paracetamol") ])).toBeNull();
  });

  it("reemissão: item do documento (sem a marca da lista) segue a categoria do documento", () => {
    expect(prescriptionCategory([ fromDoc() ])).toBe("common");
    expect(prescriptionCategory([ fromDoc() ], "special_control")).toBe("special_control");
    expect(itemClass(fromDoc().medication, "special_control")).toBe("special_control");
    // Item novo da busca (marca explícita) continua conferido.
    expect(prescriptionCategory([ fromDoc(), item(DIPYRONE_19D()) ], "special_control")).toBe("mixed");
    // A origem é explícita: o mesmo item sem a chave da lista, mas fora de um documento
    // (ex.: renovação de 19c sem as marcas), não vira controle especial pela dica.
    const bare = itemFromPrescription((rceDoc().content as PrescriptionContent).items[0]);
    expect(bare.medication).not.toHaveProperty("controlled_list");
    expect(prescriptionCategory([ bare ], "special_control")).toBe("common");
    expect(fromDoc().medication?.fromDocument).toBe(true);
  });

  it("A/B bloqueados com o caminho da Notificação; C2/C3/C4 e lista desconhecida fora; sem lista, bloqueado; C1 entra", () => {
    expect(controlledBlockReason(MORPHINE)).toBe("Notificação de receita (listas A/B) — registre a de papel em “Notificação (papel)”");
    expect(controlledBlockReason(CLONAZEPAM_B1)).toBe("Notificação de receita (listas A/B) — registre a de papel em “Notificação (papel)”");
    expect(controlledBlockReason(ISOTRETINOIN)).toBe("lista C2 (retinoide, talidomida ou antirretroviral) — fora do Rota Saúde");
    expect(controlledBlockReason({ ...ISOTRETINOIN, controlled_list: "C4" })).toBe("lista C4 (retinoide, talidomida ou antirretroviral) — fora do Rota Saúde");
    expect(itemClass({ ...ISOTRETINOIN, controlled_list: "D1" })).toBe("unsupported");
    expect(controlledBlockReason({ ...ISOTRETINOIN, controlled_list: "D1" })).toBe("lista D1 — fora do Rota Saúde");
    expect(controlledBlockReason({ ...SERTRALINE, controlled_list: null }))
      .toBe("controlado sem a lista da Portaria 344 no catálogo — não entra na receita");
    expect(controlledBlockReason(SERTRALINE)).toBeNull();
    expect(controlledBlockReason(AMOXICILLIN_19D)).toBeNull();
    expect(controlledTagLabel(SERTRALINE)).toBe("lista C1");
    expect(controlledTagLabel(CARBAMAZEPINE)).toBe("lista C1 · anticonvulsivante");
    expect(controlledTagLabel(DIPYRONE)).toBeNull();
    expect(maxDaysFor(SERTRALINE)).toBe(60);
    expect(maxDaysFor(CARBAMAZEPINE)).toBe(180);
  });
});

function DIPYRONE_19D() {
  return { ...DIPYRONE, controlled_list: null, anticonvulsant: false };
}

describe("limites da receita de controle especial", () => {
  it("misturada diz qual item separar; antimicrobiano e comum não têm limite aqui", () => {
    expect(controlledProblems({ items: [ item(SERTRALINE, { durationDays: "60" }), item(AMOXICILLIN_19D) ] }, FILLED)).toEqual([ MIXED_AT(2) ]);
    expect(controlledProblems({ items: [ item(AMOXICILLIN_19D), item(DIPYRONE) ] }, FILLED)).toEqual([ MIXED_AT(2) ]);
    expect(controlledProblems({ items: [ item(AMOXICILLIN_19D, { durationDays: "" }) ] }, EMPTY_IDENTIFICATION)).toEqual([]);
    expect(controlledProblems({ items: [ item(DIPYRONE) ] }, EMPTY_IDENTIFICATION)).toEqual([]);
    expect(MIXED_CATEGORIES).toMatch(/separe em duas/);
  });

  it("até 3 itens da lista C1 (o api conta itens, não substâncias)", () => {
    const four = [ SERTRALINE, AMITRIPTYLINE, FLUOXETINE, CARBAMAZEPINE ].map((m) => item(m));
    expect(controlledProblems({ items: four }, FILLED)).toEqual([ "no máximo 3 substâncias da lista C1 por receita" ]);
    expect(controlledProblems({ items: four.slice(0, 3) }, FILLED)).toEqual([]);
    expect(controlledProblems({ items: [ item(SERTRALINE), item({ ...SERTRALINE, id: "ci99" }), item(FLUOXETINE), item(AMITRIPTYLINE) ] }, FILLED))
      .toEqual([ "no máximo 3 substâncias da lista C1 por receita" ]);
    // C5 não conta no teto de C1.
    expect(controlledProblems({ items: [ ...four.slice(0, 3), item({ ...SERTRALINE, id: "ci98", controlled_list: "C5" }) ] }, FILLED)).toEqual([]);
  });

  it("duração obrigatória e até 60 dias; 180 no anticonvulsivante", () => {
    expect(controlledProblems({ items: [ item(SERTRALINE, { durationDays: "" }) ] }, FILLED))
      .toEqual([ "item 1: informe a duração em dias (até 60)" ]);
    expect(controlledProblems({ items: [ item(SERTRALINE, { durationDays: "90" }) ] }, FILLED))
      .toEqual([ "item 1: duração acima de 60 dias" ]);
    expect(controlledProblems({ items: [ item(SERTRALINE), item(CARBAMAZEPINE, { durationDays: "120" }) ] }, FILLED)).toEqual([]);
    expect(controlledProblems({ items: [ item(SERTRALINE), item(CARBAMAZEPINE, { durationDays: "200" }) ] }, FILLED))
      .toEqual([ "item 2: duração acima de 180 dias (anticonvulsivante)" ]);
  });

  it("reemissão: duração obrigatória, mas o teto fica com o api (o item do documento não diz se é anticonvulsivante)", () => {
    expect(controlledProblems({ items: [ fromDoc({ durationDays: "150" }) ], category: "special_control" }, FILLED)).toEqual([]);
    expect(controlledProblems({ items: [ fromDoc({ durationDays: "" }) ], category: "special_control" }, FILLED))
      .toEqual([ "item 1: informe a duração em dias" ]);
    expect(controlledProblems({ items: [ fromDoc() ], category: "special_control" }, EMPTY_IDENTIFICATION))
      .toEqual([ "endereço do paciente: informe o logradouro" ]);
  });

  it("enfermagem: não prescreve controle especial (o api recusa com cbo_not_allowed); antimicrobiano dela passa", () => {
    expect(controlledProblems({ items: [ item(SERTRALINE) ] }, FILLED, { nurse: true }))
      .toEqual([ "item 1: a enfermagem não prescreve receita de controle especial" ]);
    expect(controlledProblems({ items: [ item(AMOXICILLIN_19D, { durationDays: "7" }) ] }, EMPTY_IDENTIFICATION, { nurse: true })).toEqual([]);
  });

  it("reemissão: o teto de C1 não conta o item do documento (sem marca, pode ser C5) — o api confere", () => {
    const docs = [ fromDoc(), fromDoc(), fromDoc() ];
    expect(controlledProblems({ items: [ ...docs, item(SERTRALINE) ], category: "special_control" }, FILLED)).toEqual([]);
  });

  it("item bloqueado aparece com o motivo, sozinho (o api recusa antes de classificar)", () => {
    expect(controlledProblems({ items: [ item(MORPHINE) ] }, EMPTY_IDENTIFICATION))
      .toEqual([ "item 1: Notificação de receita (listas A/B) — registre a de papel em “Notificação (papel)”" ]);
    expect(controlledProblems({ items: [ item(SERTRALINE), item(MORPHINE), item(DIPYRONE) ] }, FILLED))
      .toEqual([ "item 2: Notificação de receita (listas A/B) — registre a de papel em “Notificação (papel)”" ]);
  });

  it("controle especial pede o endereço do paciente", () => {
    expect(controlledProblems({ items: [ item(SERTRALINE) ] }, EMPTY_IDENTIFICATION))
      .toEqual([ "endereço do paciente: informe o logradouro" ]);
  });
});

describe("endereço, identificação e telefone", () => {
  it("rascunho ↔ corpo: CEP só dígitos, complemento ausente quando vazio, UF maiúscula", () => {
    const draft = addressDraftFrom(address());
    expect(draft.zip).toBe("80010-010");
    expect(addressInput({ ...draft, complement: "  " })).toEqual({
      street: "Rua Marechal Deodoro", number: "630", district: "Centro", city: "Curitiba", uf: "PR", zip: "80010010"
    });
    expect(addressInput(draft).complement).toBe("apto 12");
    expect(addressDraftFrom(null).street).toBe("");
    expect(addressDraftFrom(address({ complement: null })).complement).toBe("");
  });

  it("o que falta no endereço, um de cada vez, com os limites do api", () => {
    const ok = addressDraftFrom(address());
    expect(addressProblem(ok, "endereço")).toBeNull();
    expect(addressProblem({ ...ok, number: "" }, "endereço")).toBe("endereço: informe o número (ou s/n)");
    expect(addressProblem({ ...ok, number: "12345678901" }, "endereço")).toBe("endereço: o número tem até 10 caracteres");
    expect(addressProblem({ ...ok, district: " " }, "endereço")).toBe("endereço: informe o bairro");
    expect(addressProblem({ ...ok, uf: "" }, "endereço")).toBe("endereço: escolha a UF");
    expect(addressProblem({ ...ok, zip: "8001-001" }, "endereço")).toBe("endereço: o CEP precisa ter 8 dígitos");
    expect(addressProblem({ ...ok, street: "R".repeat(121) }, "endereço")).toBe("endereço: o logradouro tem até 120 caracteres");
    expect(addressProblem({ ...ok, complement: "c".repeat(61) }, "endereço")).toBe("endereço: o complemento tem até 60 caracteres");
  });

  it("linha do endereço para a tela", () => {
    expect(addressLine(address())).toBe("Rua Marechal Deodoro, 630 — apto 12 · Centro · Curitiba/PR · 80010-010");
    expect(addressLine(null)).toBe("—");
  });

  it("identificação: só o endereço no corpo (o CPF é o do cadastro, no api)", () => {
    expect(identificationInput(FILLED)).toEqual({ address: addressInput(FILLED.address) });
    expect(identificationDraftFrom({ cpf: "39053344705", address: address() })).toEqual({ address: addressDraftFrom(address()) });
    expect(identificationDraftFrom({ cpf: null, address: address() })).toEqual({ address: addressDraftFrom(address()) });
    expect(identificationDraftFrom(null)).toEqual(EMPTY_IDENTIFICATION);
  });

  it("telefone: DDD e número, 10 ou 11 dígitos", () => {
    expect(phoneProblem("(41) 3350-1234")).toBeNull();
    expect(phoneProblem("41 99876-5432")).toBeNull();
    expect(phoneProblem("3350-1234")).toBe("telefone: DDD e número, 10 ou 11 dígitos");
    expect(phoneProblem("(09) 3350-1234")).toBe("telefone: DDD inválido");
    expect(formatPhone("4133501234")).toBe("(41) 3350-1234");
    expect(formatPhone("41998765432")).toBe("(41) 99876-5432");
    expect(formatPhone(null)).toBe("—");
  });
});

describe("previsão de papel (o api decide)", () => {
  const base = { category: "special_control" as const, cboCode: "225142", signatureOn: true, certificate: certificate(), stock: stock() };

  it("digital quando tudo existe; comum e misturada não preveem", () => {
    expect(paperForecast(base)).toBeNull();
    expect(paperForecast({ ...base, category: "common" })).toBeNull();
    expect(paperForecast({ ...base, category: "mixed" })).toBeNull();
  });

  it("os motivos, na ordem do api", () => {
    expect(paperForecast({ ...base, category: "antimicrobial", cboCode: "223565" })).toBe("nurse_antimicrobial");
    expect(paperForecast({ ...base, signatureOn: false })).toBe("signature_unavailable");
    expect(paperForecast({ ...base, certificate: null })).toBe("no_certificate");
    expect(paperForecast({ ...base, certificate: certificate({ status: "expired" }) })).toBe("no_certificate");
    expect(paperForecast({ ...base, stock: stock({ rce: { free: 0, used: 1000, voided: 0, requests_this_month: 1 } }) })).toBe("no_sncr_number");
    expect(paperForecast({ ...base, category: "antimicrobial", stock: stock({ ret: { free: 0, used: 0, voided: 0, requests_this_month: 0 } }) }))
      .toBe("no_sncr_number");
  });

  it("enquanto carrega (certificado ou estoque indefinidos), não prevê papel", () => {
    expect(paperForecast({ ...base, certificate: undefined, stock: undefined })).toBeNull();
  });

  it("frase de cada um dos 6 motivos; desconhecido cru; nulo vira traço", () => {
    expect(paperReasonLabel("no_sncr_number")).toBe("sem número SNCR no seu estoque — obtenha números em Conta → SNCR");
    expect(paperReasonLabel("no_certificate")).toBe("você não tem certificado digital ativo — vincule em Conta → Assinatura digital");
    expect(paperReasonLabel("signature_unavailable")).toBe("a assinatura digital não está disponível na cidade");
    expect(paperReasonLabel("nurse_antimicrobial")).toBe("a receita de antimicrobiano da enfermagem sai sempre em papel");
    expect(paperReasonLabel("feature_disabled")).toBe("a receita digital de antimicrobiano (SNCR) está desligada nesta cidade");
    expect(paperReasonLabel("free_text_items")).toBe("itens digitados à mão — sai em papel");
    expect(paperReasonLabel("vigilance_rule")).toBe("vigilance_rule");
    expect(paperReasonLabel(null)).toBe("—");
    expect(paperReasonLabel(undefined)).toBe("—");
  });
});

describe("documento emitido", () => {
  it("RCE digital com número (e simulado)", () => {
    expect(controlledIssuedNotice(rceDoc())).toBe(
      "Receita de controle especial emitida em modo digital com o número SNCR RCE nº 2610.1-41.0001234: a assinatura entra na sua fila; o PDF assinado sai depois dela.");
    expect(controlledIssuedNotice(rceDoc({}, { sncr: { kind: "rce", number: "2610.1-41.0001234", simulated: true } }))).toBe(
      "Receita de controle especial emitida em modo digital com o número SNCR RCE nº 2610.1-41.0001234 (numeração simulada — sem validade): a assinatura entra na sua fila; o PDF assinado sai depois dela.");
  });

  it("papel com o motivo do api; voltou ao papel sem motivo; comum como no 19c; Notificação registrada", () => {
    expect(controlledIssuedNotice(retDoc({ issue_mode: "paper", paper_reason: "no_certificate", signature: null }))).toBe(
      "Receita de antimicrobiano emitida em modo papel (você não tem certificado digital ativo — vincule em Conta → Assinatura digital): imprima as 2 vias e assine à mão.");
    expect(controlledIssuedNotice(retDoc({ issue_mode: "paper", paper_reason: "free_text_items", signature: null }))).toBe(
      "Receita de antimicrobiano emitida em modo papel (itens digitados à mão — sai em papel): imprima as 2 vias e assine à mão.");
    expect(controlledIssuedNotice(retDoc({ issue_mode: "paper", paper_reason: null, signature: null }))).toBe(
      "Receita de antimicrobiano emitida em modo papel: imprima as 2 vias e assine à mão.");
    expect(controlledIssuedNotice(prescriptionDoc())).toBe(issuedNotice(prescriptionDoc()));
    expect(controlledIssuedNotice(notificationDoc())).toBe(
      "Notificação de papel registrada: o medicamento entra na lista de medicamentos em uso. Guarde o talão; nada é impresso aqui.");
  });

  it("título e número na lista", () => {
    expect(documentTitle(rceDoc())).toBe("Receita de controle especial");
    expect(documentTitle(retDoc())).toBe("Receita de antimicrobiano");
    expect(documentTitle(prescriptionDoc())).toBe("Receita");
    expect(documentTitle(notificationDoc())).toBe("Notificação de receita (papel)");
    expect(sncrLabel({ kind: "ret", number: "2610.2-41.0000501" })).toBe("RET nº 2610.2-41.0000501");
    expect(SNCR_SIMULATED_NOTICE).toBe("Numeração simulada — sem validade");
    expect(CATEGORY_NOTE.special_control).toMatch(/válida por 30 dias/);
    expect(CATEGORY_NOTE.antimicrobial).toMatch(/válida por 10 dias/);
  });
});

describe("estoque", () => {
  it("saldo baixo, zerado e limite do mês", () => {
    const [ rce, ret ] = stockRows(stock());
    expect(rce).toMatchObject({ kind: "rce", label: "Receita de controle especial (RCE)", free: 812, requests: 1, limitReached: false, notice: null });
    expect(ret.notice).toEqual({ tone: "warn", text: "saldo baixo: menos de 50 números — obtenha mais antes que acabe" });
    const [ empty ] = stockRows(stock({ rce: { free: 0, used: 2000, voided: 3, requests_this_month: 3 } }));
    expect(empty.notice).toEqual({ tone: "down", text: "sem números: as receitas de controle especial saem em papel" });
    expect(empty.limitReached).toBe(true);
  });
});

describe("retorno do gov.br", () => {
  it("lê session_id, error (e o state, se vier) só no caminho de retorno, sob a base", () => {
    expect(readSncrCallback("/dashboard/sncr/callback", "?session_id=sid1", "/dashboard/")).toEqual({ state: null, sessionId: "sid1", error: null });
    expect(readSncrCallback("/dashboard/sncr/callback/", "?state=s1&session_id=sid1", "/dashboard/"))
      .toEqual({ state: "s1", sessionId: "sid1", error: null });
    expect(readSncrCallback("/dashboard/sncr/callback", "?error=access_denied", "/dashboard/")).toEqual({ state: null, sessionId: null, error: "access_denied" });
    expect(readSncrCallback("/dashboard/sncr/callback", "?session_id=%20", "/dashboard/")).toEqual({ state: null, sessionId: null, error: null });
    expect(readSncrCallback("/dashboard/signature/callback", "?session_id=sid1", "/dashboard/")).toBeNull();
    expect(readSncrCallback("/dashboard/", "?session_id=sid1", "/dashboard/")).toBeNull();
  });

  it("o state fica no sessionStorage só entre a ida e a volta, e sai na primeira leitura", () => {
    window.sessionStorage.clear();
    rememberSncrState("st1");
    expect(window.sessionStorage.getItem("rotasaude.sncr.state")).toBe("st1");
    expect(takeSncrState()).toBe("st1");
    expect(window.sessionStorage.getItem("rotasaude.sncr.state")).toBeNull();
    expect(takeSncrState()).toBeNull();
    // Storage indisponível (aba privada, política): não quebra.
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined } as unknown as Storage;
    expect(() => rememberSncrState("st1", broken)).not.toThrow();
    expect(takeSncrState(broken)).toBeNull();
    expect(takeSncrState(null)).toBeNull();
  });

  it("resumo, destino e recusa do gov.br", () => {
    expect(sncrCallbackSummary({ kind: "rce", received: 1000, batch_id: "b1" }))
      .toBe("1.000 números recebidos do SNCR para receita de controle especial (RCE).");
    expect(sncrCallbackSummary({ kind: "ret", received: 1, batch_id: "b1" }))
      .toBe("1 número recebido do SNCR para receita de antimicrobiano (RET).");
    expect(sncrCallbackLanding({ return_to: "/sncr" })).toBe("/sncr");
    expect(sncrCallbackLanding({ return_to: "//evil.example" })).toBe("/sncr");
    expect(sncrCallbackLanding({ return_to: "/" })).toBe("/sncr");
    expect(sncrCallbackLanding(undefined)).toBe("/sncr");
    expect(sncrOauthErrorPhrase("access_denied")).toBe("a autorização foi negada no gov.br — nenhum número foi pedido");
    expect(sncrOauthErrorPhrase(null)).toBe("o gov.br não concluiu a autorização — comece de novo");
  });
});

describe("Notificação de papel", () => {
  it("tipo pela lista do item", () => {
    expect(notificationTypeFor("A1")).toBe("A");
    expect(notificationTypeFor("A3")).toBe("A");
    expect(notificationTypeFor("B1")).toBe("B");
    expect(notificationTypeFor("B2")).toBe("B2");
    expect(notificationTypeFor("C1")).toBeNull();
    expect(notificationTypeFor(null)).toBeNull();
  });

  const filled = () => ({ ...emptyNotification("PR"), type: "B" as const, paperNumber: "PR0012345", medication: CLONAZEPAM_B1,
    quantity: "30", quantityUnit: "comprimido", route: "oral" as const, dosage: "1 comprimido à noite", durationDays: "30" });

  it("o que falta, tipo que não bate e duração por tipo", () => {
    expect(notificationProblems(filled())).toEqual([]);
    expect(notificationProblems(emptyNotification("PR"))).toEqual([
      "escolha o tipo da Notificação", "informe o número impresso no talão", "escolha o medicamento (listas A ou B)",
      "informe a quantidade (até 9999, com no máximo 2 casas decimais)", "escolha a via", "escreva a posologia", "informe a duração em dias"
    ]);
    expect(notificationProblems({ ...filled(), type: "A" })).toEqual([ "o medicamento é da lista B1: a Notificação é B" ]);
    expect(notificationProblems({ ...filled(), medication: SERTRALINE })).toEqual([ "o medicamento escolhido não é de Notificação (listas A ou B)" ]);
    expect(notificationProblems({ ...filled(), type: "A", medication: MORPHINE, durationDays: "45" }))
      .toEqual([ "duração acima de 30 dias para a Notificação A" ]);
    expect(notificationProblems({ ...filled(), durationDays: "60" })).toEqual([]);
    expect(notificationProblems({ ...filled(), numberingUf: "" })).toEqual([ "escolha a UF da numeração" ]);
    expect(notificationProblems({ ...filled(), paperNumber: "PR 001#" }))
      .toEqual([ "o número do talão aceita até 30 letras, números, ponto, barra ou hífen" ]);
  });

  it("quantidade decimal como o api: até 2 casas e 9999; vírgula vale", () => {
    const bad = [ "informe a quantidade (até 9999, com no máximo 2 casas decimais)" ];
    expect(notificationProblems({ ...filled(), quantity: "0,5" })).toEqual([]);
    expect(notificationProblems({ ...filled(), quantity: "1.25" })).toEqual([]);
    expect(notificationProblems({ ...filled(), quantity: "9999" })).toEqual([]);
    expect(notificationProblems({ ...filled(), quantity: "10000" })).toEqual(bad);
    expect(notificationProblems({ ...filled(), quantity: "1,234" })).toEqual(bad);
    expect(notificationProblems({ ...filled(), quantity: "0" })).toEqual(bad);
    expect(notificationInput({ ...filled(), quantity: "0,5" }).item.quantity).toBe(0.5);
  });

  it("corpo do POST", () => {
    expect(notificationInput(filled())).toEqual({
      notification_type: "B", paper_number: "PR0012345", numbering_uf: "PR",
      item: { catalog_item: { id: "ci3" }, quantity: 30, quantity_unit: "comprimido", route: "oral",
        dosage_instructions: "1 comprimido à noite", duration_days: 30 }
    });
  });
});

describe("painel do admin", () => {
  it("saldo baixo primeiro, depois por nome; contagens", () => {
    expect(sortOverview(sncrOverview().professionals).map((p) => p.user_id)).toEqual([ "us3", "us1", "us2" ]);
    expect(overviewSummary(sncrOverview())).toEqual({ professionals: 3, low: 2, neverRequested: 1 });
  });
});

describe("frases das recusas do SNCR e do contato", () => {
  it("cada código do contrato tem frase própria", () => {
    const phrase = (status: number, body: object) => controlledError(err(status, body));
    expect(phrase(409, { error: "monthly_limit_reached" }))
      .toBe("você já fez os 3 pedidos deste mês para este tipo — o limite volta no mês que vem");
    expect(phrase(409, { error: "authorization_expired", return_to: "/sncr" }))
      .toBe("a autorização demorou demais e venceu — comece de novo; o pedido ao SNCR precisa sair em até 30 segundos");
    expect(phrase(403, { error: "authorization_denied" })).toBe("a autorização foi negada no gov.br — nenhum número foi pedido");
    expect(phrase(422, { error: "invalid_state" })).toBe("este retorno do gov.br não vale mais (já usado ou vencido) — comece de novo");
    expect(phrase(503, { error: "sncr_exhausted" }))
      .toBe("o SNCR está sem números para a sua UF agora — tente mais tarde; até lá, as receitas saem em papel");
    expect(phrase(503, { error: "sncr_unavailable" })).toBe("o SNCR não respondeu — tente de novo em alguns minutos; nenhum número foi gasto");
    expect(phrase(403, { error: "cbo_not_allowed" })).toBe("só médicos e dentistas pedem números do SNCR e prescrevem controlado");
    expect(phrase(403, { error: "registration_mismatch" }))
      .toBe("a conta gov.br usada não bate com a sua inscrição no conselho, ou você não tem cadastro de prescritor no SNCR — entre com a sua própria conta gov.br");
    expect(phrase(422, { error: "invalid_content", field: "kind" })).toBe("pedido inválido — recarregue a página e tente de novo");
    expect(phrase(422, { error: "invalid_address", field: "zip" })).toBe("endereço inválido: confira o CEP");
    expect(phrase(422, { error: "invalid_address", field: "number" })).toBe("endereço inválido: confira o número");
    expect(phrase(422, { error: "invalid_address", field: "address" })).toBe("endereço inválido: confira o endereço");
    expect(phrase(422, { error: "invalid_phone" })).toBe("telefone inválido — DDD e número, 10 ou 11 dígitos");
    expect(phrase(404, { error: "not_found" }))
      .toBe("seu cadastro de profissional ainda não foi feito — fale com a administração da cidade");
    expect(phrase(403, { error: "missing_role" })).toBe("seu papel não permite esta ação");
  });

  it("interruptores: controlado, prontuário (rota do contato) e documentos", () => {
    expect(controlledError(err(403, { error: "feature_disabled", feature: "controlled_prescriptions" }))).toBe(CONTROLLED_DISABLED);
    expect(controlledError(err(403, { error: "feature_disabled", feature: "clinical_record" }))).toBe("o prontuário está desligado nesta cidade");
    expect(controlledError(err(403, { error: "feature_disabled", feature: "clinical_documents" }))).toBe(DOCUMENTS_DISABLED);
  });

  it("desconhecido cai na frase genérica, sem código cru", () => {
    expect(controlledError(err(500, ""))).toBe("não foi possível concluir — tente de novo");
    expect(controlledError(new Error("rede"))).toBe("não foi possível concluir — tente de novo");
  });

  it("as frases compartilhadas vêm de uma fonte só", () => {
    expect(PRESCRIBER_MISSING).toBe("falta o seu endereço e telefone — cadastre em Meu perfil antes de emitir esta receita");
  });
});
