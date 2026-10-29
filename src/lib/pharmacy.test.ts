// src/lib/pharmacy.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  CONTROLLED_PHARMACIST_ONLY, COUNCILS, EMPTY_DISPENSE, FREE_TEXT_PHARMACIST_ONLY, ITEM_COMPLETED, NO_PATIENT_RECORD, NOTHING_TO_DISPENSE,
  NOTIFICATION_LISTS, NOMINAL_QUERY, PHARMACY_ALERTS_REFRESH_MS, PHARMACY_DISABLED, PHARMACY_NO_ROLE, PRESCRIPTION_CHANGED, RETENTION_REQUIRED,
  STATIC_QUERY, UFS, type ReceiptLine, adjustmentBody, adjustmentDelta, adjustmentProblem, availableLots, canUsePharmacy, cents, dispenseBody, dispenseProblems,
  errorPath, filledLines, fmtQuantity, fmtSigned, hasDifference, issuedOnProblem, itemBlock, lineQuantity, locationRoles, lotOptionLabel,
  lotKindProblem, lotsForKind, lotsWithBalance, needsRetention, newReceiptLine, normalizeShortCode, notificationNumberProblem, pharmacyError, pharmacyProblems, pharmacyRefusals,
  pharmacyRoles, prescriberProblem, prescriptionBlock, problemItemIndex, quantityProblem, reasonProblem, receiptItems, receiptProblems,
  receiveBody, receiveProblems, settingsProblem, sortPositions, suggestedLotId, toApiQuantity, transferProblems, movementDocument, movementLabel
} from "./pharmacy";
import { AMOXI, CENTRAL, CLONA, TODAY27, UBS_FARM, lotBalance, position, prescription, rxItem, stockLot, transfer } from "../test/pharmacyFixtures";

const user = (roles: string[], features: string[] = [ "pharmacy" ], operator = false) => ({ operator, memberships: roles.map((role) => ({ role })), features });

describe("portão e papéis", () => {
  it("interruptor e nunca o operador; papéis pelo local", () => {
    expect(canUsePharmacy(user([ "pharmacist" ]))).toBe(true);
    expect(canUsePharmacy(user([ "pharmacist" ], []))).toBe(false);
    expect(canUsePharmacy(user([], [ "pharmacy" ], true))).toBe(false);
    expect(locationRoles(UBS_FARM)).toEqual({ pharmacist: true, assistant: false, keeper: false });
    expect(locationRoles(CENTRAL)).toEqual({ pharmacist: false, assistant: false, keeper: true });
  });
  it("papéis da sessão", () => {
    expect(pharmacyRoles(user([ "pharmacist", "municipal_admin" ]))).toEqual({ pharmacist: true, assistant: false, keeper: false, admin: true });
    expect(pharmacyRoles(user([ "pharmacy_assistant", "stock_keeper" ]))).toEqual({ pharmacist: false, assistant: true, keeper: true, admin: false });
    expect(pharmacyRoles(null)).toEqual({ pharmacist: false, assistant: false, keeper: false, admin: false });
  });
  it("constantes de consulta e listas", () => {
    expect(PHARMACY_ALERTS_REFRESH_MS).toBe(60_000);
    expect(NOMINAL_QUERY.refetchInterval).toBe(false);
    expect(STATIC_QUERY.retry).toBe(false);
    expect(COUNCILS).toEqual([ "CRM", "CRO", "COREN" ]);
    expect(UFS).toHaveLength(27);
    expect(NOTIFICATION_LISTS).toEqual([ "A1", "A2", "A3", "B1", "B2" ]);
  });
});

describe("quantidade: vírgula, até 2 casas, maior que zero; recusa em vez de cortar", () => {
  it("o que recusa e o que não recusa", () => {
    expect(quantityProblem("")).toBe("informe a quantidade");
    expect(quantityProblem("1.000")).toBe("use vírgula para decimais e não use ponto de milhar (ex.: 150000 ou 4,5)");
    expect(quantityProblem("2,555")).toBe("a quantidade tem no máximo 2 casas depois da vírgula");
    expect(quantityProblem("0")).toBe("a quantidade precisa ser maior que zero");
    expect(quantityProblem("0", "o mínimo", { allowZero: true })).toBeNull();
    expect(quantityProblem("100000")).toBe("a quantidade pode ser no máximo 99999,99");
    expect(quantityProblem("-1")).toBe("a quantidade: use só dígitos e vírgula");
    expect(quantityProblem("12,5")).toBeNull();
    expect(quantityProblem(" 30 ")).toBeNull();
  });
  it("o rótulo vai na frase; fronteiras", () => {
    expect(quantityProblem("", "o mínimo")).toBe("informe o mínimo");
    expect(quantityProblem("abc", "o mínimo")).toBe("o mínimo: use só dígitos e vírgula");
    expect(quantityProblem("99999,99")).toBeNull();
    expect(quantityProblem("0,01")).toBeNull();
    expect(quantityProblem("0,00")).toBe("a quantidade precisa ser maior que zero");
  });
  it("conversões", () => {
    expect(toApiQuantity("12,5")).toBe("12.5");
    expect(toApiQuantity(" 30 ")).toBe("30");
    expect(fmtQuantity("12.50")).toBe("12,5");
    expect(fmtQuantity("30.00")).toBe("30");
    expect(fmtQuantity("0.25")).toBe("0,25");
    expect(fmtQuantity(null)).toBe("—");
    expect(fmtSigned("-3.5")).toBe("-3,5");
    expect(fmtSigned("30")).toBe("+30");
    expect(cents("12.5")).toBe(1250);
    expect(cents("0.07")).toBe(7);
  });
});

describe("código da receita", () => {
  it("minúsculas, espaço e hífen; 10 do alfabeto sem ambíguos", () => {
    expect(normalizeShortCode("abcde-23456")).toBe("ABCDE23456");
    expect(normalizeShortCode(" ABCDE 23456 ")).toBe("ABCDE23456");
    expect(normalizeShortCode("ABCDE2345")).toBeNull();
    expect(normalizeShortCode("ABCDE2345O")).toBeNull();
    expect(normalizeShortCode("ABCDE23451")).toBeNull();
  });
});

describe("lote sugerido: o que vence primeiro, com saldo e não vencido", () => {
  const P = position({ lots: [
    lotBalance({ lot: stockLot({ id: "B", lot_number: "B", expires_on: "2026-12-01" }), balance: "10" }),
    lotBalance({ lot: stockLot({ id: "A", lot_number: "A", expires_on: "2026-11-15" }), balance: "0" }),
    lotBalance({ lot: stockLot({ id: "C", lot_number: "C", expires_on: "2026-10-28" }), balance: "5" }),
    lotBalance({ lot: stockLot({ id: "D", lot_number: "D", expires_on: "2026-11-20" }), balance: "3" })
  ] });
  it("ordem, sugestão e lotes para perda", () => {
    expect(availableLots(P, TODAY27).map((b) => b.lot.id)).toEqual([ "D", "B" ]);
    expect(suggestedLotId(P, TODAY27)).toBe("D");
    expect(suggestedLotId(undefined, TODAY27)).toBe("");
    expect(lotsWithBalance(P).map((b) => b.lot.id).sort()).toEqual([ "B", "C", "D" ]);
  });
  it("mesma validade: número do lote; vence hoje ainda vale; rótulo", () => {
    const Q = position({ lots: [
      lotBalance({ lot: stockLot({ id: "Z", lot_number: "Z9", expires_on: "2026-11-20" }), balance: "4" }),
      lotBalance({ lot: stockLot({ id: "Y", lot_number: "A1", expires_on: "2026-11-20" }), balance: "4" }),
      lotBalance({ lot: stockLot({ id: "T", lot_number: "T0", expires_on: TODAY27 }), balance: "4" })
    ] });
    expect(availableLots(Q, TODAY27).map((b) => b.lot.id)).toEqual([ "T", "Y", "Z" ]);
    expect(availableLots(undefined, TODAY27)).toEqual([]);
    const b = lotBalance({ lot: stockLot({ lot_number: "AMX2611", expires_on: "2026-11-20" }), balance: "30.00" });
    expect(lotOptionLabel(b, false)).toBe("AMX2611 · vence 20/11/2026 · saldo 30 cápsula");
    expect(lotOptionLabel(b, true)).toBe("AMX2611 · vence 20/11/2026 · saldo 30 cápsula · sugerido (vence primeiro)");
  });
});

describe("o que impede dispensar, na ordem", () => {
  it("receita", () => {
    expect(prescriptionBlock(prescription())).toBeNull();
    expect(prescriptionBlock(prescription({ cancelled: true }))).toBe("receita cancelada — não pode ser dispensada");
    expect(prescriptionBlock(prescription({ expired: true, valid_until: "2026-10-20" }))).toBe("receita vencida em 20/10/2026 — não pode ser dispensada");
  });
  it("item", () => {
    const ph = { pharmacist: true, today: TODAY27 }; const aux = { pharmacist: false, today: TODAY27 };
    expect(itemBlock(rxItem({ completed: true }), ph)).toBe(ITEM_COMPLETED);
    expect(itemBlock(rxItem({ expired: true, valid_until: "2026-10-20" }), ph)).toBe("item vencido em 20/10/2026");
    expect(itemBlock(rxItem({ continuous: true, next_allowed_on: "2026-11-03" }), ph)).toBe("uso contínuo: próxima retirada a partir de 03/11/2026");
    expect(itemBlock(rxItem({ continuous: true, next_allowed_on: TODAY27 }), ph)).toBeNull();
    expect(itemBlock(rxItem({ controlled: true }), aux)).toBe(CONTROLLED_PHARMACIST_ONLY);
    expect(itemBlock(rxItem({ catalog_item_id: null, free_text: "xarope caseiro" }), aux)).toBe(FREE_TEXT_PHARMACIST_ONLY);
    expect(itemBlock(rxItem({ controlled: true }), ph)).toBeNull();
  });
  it("antimicrobiano não controlado: o auxiliar dispensa; controlado: só o farmacêutico", () => {
    const aux = { pharmacist: false, today: TODAY27 };
    expect(itemBlock(rxItem({ controlled: false, retention_required: true }), aux)).toBeNull();
    expect(itemBlock(rxItem({ controlled: true, retention_required: true }), aux)).toBe(CONTROLLED_PHARMACIST_ONLY);
  });
});

describe("dispensação: todas as recusas de uma vez; linha vazia não vai; retenção pelo retention_required", () => {
  const P = prescription({ items: [ rxItem(), rxItem({ id: "pi2", catalog_item_id: "ci2", printed_description: "Clonazepam 2 mg comprimido", controlled: true }),
    rxItem({ id: "pi3", catalog_item_id: null, free_text: "xarope de guaco", printed_description: "xarope de guaco", retention_required: false }) ] });
  const ctx = { pharmacist: true, today: TODAY27, balances: { lot1: "30", lot2: "60" } };
  it("problemas", () => {
    expect(dispenseProblems(EMPTY_DISPENSE, P, ctx)).toEqual([ { path: "items", text: NOTHING_TO_DISPENSE } ]);
    const d = { ...EMPTY_DISPENSE, lines: {
      pi1: { catalogItemId: "ci1", lotId: "lot1", quantity: "40", complete: false },
      pi2: { catalogItemId: "ci2", lotId: "lot2", quantity: "2,555", complete: false },
      pi3: { catalogItemId: null, lotId: "", quantity: "1", complete: false } } };
    expect(dispenseProblems(d, P, ctx)).toEqual([
      { path: "pi1", text: "Amoxicilina 500 mg cápsula: saída maior que o saldo do lote (30)" },
      { path: "pi2", text: "Clonazepam 2 mg comprimido: a quantidade tem no máximo 2 casas depois da vírgula" },
      { path: "pi3", text: "xarope de guaco: escolha o item do catálogo" },
      { path: "retention", text: RETENTION_REQUIRED }
    ]);
  });
  it("lote vazio, bloqueio do item e retenção marcada", () => {
    const aux = { ...ctx, pharmacist: false };
    const d = { retained: true, lines: {
      pi1: { catalogItemId: "ci1", lotId: "", quantity: "5", complete: false },
      pi2: { catalogItemId: "ci2", lotId: "lot2", quantity: "5", complete: false },
      pi3: { catalogItemId: "ci9", lotId: "lot1", quantity: "5", complete: false } } };
    expect(dispenseProblems(d, P, aux)).toEqual([
      { path: "pi1", text: "Amoxicilina 500 mg cápsula: escolha o lote" },
      { path: "pi2", text: `Clonazepam 2 mg comprimido: ${CONTROLLED_PHARMACIST_ONLY}` },
      { path: "pi3", text: `xarope de guaco: ${FREE_TEXT_PHARMACIST_ONLY}` }
    ]);
  });
  it("retenção: só quando alguma linha preenchida pede (retention_required)", () => {
    const only3 = { retained: false, lines: { pi3: { catalogItemId: "ci9", lotId: "lot1", quantity: "5", complete: false } } };
    expect(needsRetention(only3, P)).toBe(false);
    expect(dispenseProblems(only3, P, ctx)).toEqual([]);
    const emptyAmox = { retained: false, lines: { pi1: { catalogItemId: "ci1", lotId: "lot1", quantity: " ", complete: false } } };
    expect(needsRetention(emptyAmox, P)).toBe(false);
    expect(filledLines(emptyAmox)).toEqual([]);
    const amox = { retained: false, lines: { pi1: { catalogItemId: "ci1", lotId: "lot1", quantity: "21", complete: false } } };
    expect(needsRetention(amox, P)).toBe(true);
    expect(dispenseProblems(amox, P, { ...ctx, pharmacist: false })).toEqual([ { path: "retention", text: RETENTION_REQUIRED } ]);
    expect(dispenseProblems({ ...amox, retained: true }, P, { ...ctx, pharmacist: false })).toEqual([]);
    expect(filledLines(amox).map(([ id ]) => id)).toEqual([ "pi1" ]);
  });
  it("corpo (a amoxicilina pede retenção)", () => {
    const d = { lines: {
      pi1: { catalogItemId: "ci1", lotId: "lot1", quantity: "21", complete: true },
      pi2: { catalogItemId: "ci2", lotId: "lot2", quantity: "", complete: false },
      pi3: { catalogItemId: "ci9", lotId: "lot9", quantity: "1,5", complete: false } }, retained: true };
    expect(dispenseBody(d, P, "l2")).toEqual({ location_id: "l2", prescription: { kind: "digital", id: "doc1" }, items: [
      { prescription_item_id: "pi1", lot_id: "lot1", quantity: "21", complete: true },
      { prescription_item_id: "pi3", catalog_item_id: "ci9", lot_id: "lot9", quantity: "1.5" } ], retention: {} });
    const withControlled = { ...d, lines: { ...d.lines, pi2: { catalogItemId: "ci2", lotId: "lot2", quantity: "30", complete: false } }, retained: true };
    expect(dispenseBody(withControlled, P, "l2").retention).toEqual({});
  });
  it("corpo sem retenção quando nenhum item preenchido pede", () => {
    const d = { retained: false, lines: { pi3: { catalogItemId: "ci9", lotId: "lot9", quantity: "1,5", complete: false } } };
    const body = dispenseBody(d, P, "l2");
    expect(body).toEqual({ location_id: "l2", prescription: { kind: "digital", id: "doc1" },
      items: [ { prescription_item_id: "pi3", catalog_item_id: "ci9", lot_id: "lot9", quantity: "1.5" } ] });
    expect("retention" in body).toBe(false);
    // item do catálogo na receita: a tela nunca manda o catalog_item_id
    expect(dispenseBody({ ...d, lines: { pi1: { catalogItemId: "ci1", lotId: "lot1", quantity: "3", complete: false } } }, P, "l2").items[0])
      .toEqual({ prescription_item_id: "pi1", lot_id: "lot1", quantity: "3" });
  });
});

describe("entrada, recebimento e ajuste", () => {
  const inv = { kind: "invoice" as const, number: "NF 1234", supplier: "Distribuidora Sul" };
  const opening = { kind: "opening" as const, number: "", supplier: "" };
  const line = { ...newReceiptLine("k1"), item: AMOXI, lotNumber: "AMX2611", expiresOn: "2026-11-20", byPackage: true, unitsPerPackage: "30", packages: "10" };
  it("entrada: lote vencido não entra; por embalagem multiplica; abertura sem documento", () => {
    const l = line;
    expect(lineQuantity(l)).toBe("300");
    expect(lineQuantity({ ...l, unitsPerPackage: "0" })).toBeNull();
    expect(receiptProblems([ l ], TODAY27, inv)).toEqual([]);
    expect(receiptProblems([ { ...l, expiresOn: "2026-10-28" } ], TODAY27, inv))
      .toEqual([ { path: "k1", text: "Amoxicilina 500 mg cápsula: lote vencido — não entra no estoque" } ]);
    expect(receiptProblems([ l ], TODAY27, { kind: "invoice", number: "", supplier: "" }).map((p) => p.path)).toEqual([ "document.number", "document.supplier" ]);
    expect(receiptProblems([ l ], TODAY27, opening)).toEqual([]);
    expect(receiptProblems([], TODAY27, opening)).toEqual([ { path: "items", text: "acrescente ao menos um item" } ]);
  });
  it("entrada: a primeira recusa da linha, na ordem", () => {
    const base: ReceiptLine = { ...newReceiptLine("k1"), item: AMOXI, byPackage: false };
    const text = (l: ReceiptLine) => receiptProblems([ l ], TODAY27, opening)[0]?.text;
    expect(text({ ...base, item: null })).toBe("escolha o item do catálogo");
    expect(text({ ...base })).toBe("Amoxicilina 500 mg cápsula: informe o número do lote");
    expect(text({ ...base, lotNumber: "L".repeat(41) })).toBe("Amoxicilina 500 mg cápsula: o número do lote tem até 40 caracteres");
    expect(text({ ...base, lotNumber: "L1" })).toBe("Amoxicilina 500 mg cápsula: informe a validade");
    expect(text({ ...base, lotNumber: "L1", expiresOn: "2026-12-01", manufacturer: "F".repeat(121) })).toBe("Amoxicilina 500 mg cápsula: o fabricante tem até 120 caracteres");
    expect(text({ ...base, lotNumber: "L1", expiresOn: "2026-12-01" })).toBe("Amoxicilina 500 mg cápsula: informe a quantidade");
    expect(text({ ...base, lotNumber: "L1", expiresOn: "2026-12-01", quantity: "2,555" })).toBe("Amoxicilina 500 mg cápsula: a quantidade tem no máximo 2 casas depois da vírgula");
    expect(receiptProblems([ { ...base, lotNumber: "L1", expiresOn: TODAY27, quantity: "5" } ], TODAY27, opening)).toEqual([]);
  });
  it("entrada: documento acima do limite", () => {
    expect(receiptProblems([ line ], TODAY27, { kind: "donation", number: "N".repeat(61), supplier: "S".repeat(121) })).toEqual([
      { path: "document.number", text: "o número do documento tem até 60 caracteres" },
      { path: "document.supplier", text: "o fornecedor ou doador tem até 120 caracteres" } ]);
    expect(receiptProblems([ line ], TODAY27, { kind: "donation", number: " ", supplier: "" }).map((p) => p.text)).toEqual([
      "informe o número do documento", "informe o fornecedor ou doador" ]);
  });
  it("embalagem: unidades 1–10000, embalagens 1–10000, inteiros e total até 99999,99", () => {
    const text = (units: string, packages: string) => receiptProblems([ { ...line, unitsPerPackage: units, packages } ], TODAY27, inv)[0]?.text;
    const P = "Amoxicilina 500 mg cápsula: ";
    expect(text("", "10")).toBe(`${P}unidades por embalagem: número inteiro de 1 a 10000`);
    expect(text("10001", "1")).toBe(`${P}unidades por embalagem: número inteiro de 1 a 10000`);
    expect(text("2,5", "1")).toBe(`${P}unidades por embalagem: número inteiro de 1 a 10000`);
    expect(text("30", "0")).toBe(`${P}embalagens: número inteiro de 1 a 10000`);
    expect(text("30", "10001")).toBe(`${P}embalagens: número inteiro de 1 a 10000`);
    expect(text("30", "100000")).toBe(`${P}embalagens: número inteiro de 1 a 10000`);
    expect(text("9", "10000")).toBeUndefined();
    expect(text("10", "10000")).toBe(`${P}unidades por embalagem × embalagens passa de 99999,99 — confira`);
    expect(text("10000", "10000")).toBe(`${P}unidades por embalagem × embalagens passa de 99999,99 — confira`);
    expect(text("10", "10001")).toBe(`${P}embalagens: número inteiro de 1 a 10000`);
    expect(text("10000", "10")).toBe(`${P}unidades por embalagem × embalagens passa de 99999,99 — confira`);
    expect(text("9999", "10")).toBeUndefined();
    expect(lineQuantity({ ...line, unitsPerPackage: "10000", packages: "10000" })).toBeNull();
    expect(lineQuantity({ ...line, unitsPerPackage: "9999", packages: "10" })).toBe("99990");
    expect(lineQuantity({ ...line, byPackage: false, quantity: "12,5" })).toBe("12.5");
    expect(lineQuantity({ ...line, byPackage: false, quantity: "2,555" })).toBeNull();
  });
  it("itens da entrada para o api", () => {
    expect(receiptItems([ line, { ...newReceiptLine("k2"), item: CLONA, lotNumber: " C1 ", expiresOn: "2027-01-31", manufacturer: "EMS", quantity: "12,5" } ])).toEqual([
      { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-11-20", quantity: "300", package: { units_per_package: 30, packages: 10 } },
      { catalog_item_id: "ci2", lot_number: "C1", expires_on: "2027-01-31", manufacturer: "EMS", quantity: "12.5" } ]);
  });
  it("recebimento: diferença pede motivo de 10 a 500; maior que o enviado recusa", () => {
    const t = transfer();
    expect(receiveProblems([ { lotId: "lot1", received: "100", reason: "" } ], t)).toEqual([]);
    expect(receiveProblems([ { lotId: "lot1", received: "90", reason: "" } ], t)).toEqual([ { path: "lot1", text: "AMX2611: recebido diferente do enviado — escreva o motivo (10 a 500 caracteres)" } ]);
    expect(receiveProblems([ { lotId: "lot1", received: "110", reason: "" } ], t)).toEqual([ { path: "lot1", text: "AMX2611: recebido maior que o enviado (100)" } ]);
    expect(receiveProblems([ { lotId: "lot1", received: "", reason: "" } ], t)).toEqual([ { path: "lot1", text: "AMX2611: informe a quantidade recebida (0 se nada chegou)" } ]);
  });
  it("recebimento: zero é válido com motivo; lote sem linha; diferença e corpo", () => {
    const t = transfer();
    expect(receiveProblems([ { lotId: "lot1", received: "0", reason: "a caixa não chegou ao local" } ], t)).toEqual([]);
    expect(receiveProblems([ { lotId: "lot1", received: "90", reason: "caixa amassada na entrega" } ], t)).toEqual([]);
    expect(receiveProblems([], t)).toEqual([ { path: "lot1", text: "AMX2611: informe a quantidade recebida (0 se nada chegou)" } ]);
    expect(receiveProblems([ { lotId: "lot1", received: "9.5", reason: "" } ], t)[0].text).toContain("use vírgula");
    expect(hasDifference([ { lotId: "lot1", received: "100", reason: "" } ], t)).toBe(false);
    expect(hasDifference([ { lotId: "lot1", received: "99,5", reason: "" } ], t)).toBe(true);
    expect(hasDifference([ { lotId: "lot1", received: "", reason: "" } ], t)).toBe(false);
    expect(receiveBody([ { lotId: "lot1", received: "99,5", reason: " caixa amassada " }, { lotId: "lot2", received: "10", reason: "" } ])).toEqual({
      items: [ { lot_id: "lot1", quantity_received: "99.5", reason: "caixa amassada" }, { lot_id: "lot2", quantity_received: "10" } ] });
  });
  it("transferência: item, lote, lote vencido, quantidade e saldo", () => {
    const P = position({ lots: [ lotBalance({ lot: stockLot({ id: "lot1" }), balance: "30" }),
      lotBalance({ lot: stockLot({ id: "lot0", lot_number: "OLD", expires_on: "2026-10-01" }), balance: "5" }) ] });
    const text = (over: object) => transferProblems([ { key: "t1", position: P, lotId: "lot1", quantity: "10", ...over } ], TODAY27)[0]?.text;
    expect(transferProblems([], TODAY27)).toEqual([ { path: "items", text: "acrescente ao menos um item" } ]);
    expect(text({})).toBeUndefined();
    expect(text({ position: null })).toBe("escolha o item");
    expect(text({ lotId: "" })).toBe("Amoxicilina 500 mg cápsula: escolha o lote");
    expect(text({ lotId: "lot0" })).toBe("Amoxicilina 500 mg cápsula, lote OLD: lote vencido — escolha outro lote");
    expect(text({ quantity: "" })).toBe("Amoxicilina 500 mg cápsula, lote AMX2611: informe a quantidade");
    expect(text({ quantity: "31" })).toBe("Amoxicilina 500 mg cápsula, lote AMX2611: saída maior que o saldo do lote (30)");
    expect(transferProblems([ { key: "t1", position: P, lotId: "lot1", quantity: "31" } ], TODAY27)[0].path).toBe("t1");
  });
  it("ajuste: contagem igual ao saldo não é ajuste; perda maior que o saldo recusada; motivo", () => {
    const base = { lotId: "lot1", kind: "adjustment" as const, amount: "28,5", reason: "contagem do fim do mês" };
    expect(adjustmentProblem(base, "30")).toBeNull();
    expect(adjustmentDelta(base, "30")).toBe("-1.5");
    expect(adjustmentDelta({ ...base, amount: "31" }, "30")).toBe("+1");
    expect(adjustmentProblem({ ...base, amount: "30" }, "30")).toBe("a contagem é igual ao saldo — não há o que ajustar");
    expect(adjustmentProblem({ ...base, kind: "loss", amount: "31" }, "30")).toBe("saída maior que o saldo do lote (30)");
    expect(adjustmentProblem({ ...base, reason: "curto" }, "30")).toBe("o motivo tem de 10 a 500 caracteres");
  });
  it("ajuste: tipo, lote, contagem zero, perda e corpo", () => {
    const base = { lotId: "lot1", kind: "adjustment" as const, amount: "28,5", reason: "contagem do fim do mês" };
    expect(adjustmentProblem({ ...base, kind: "" }, "30")).toBe("escolha o tipo: ajuste de contagem, perda ou vencimento");
    expect(adjustmentProblem({ ...base, lotId: "" }, "30")).toBe("escolha o lote");
    expect(adjustmentProblem({ ...base, amount: "" }, "30")).toBe("informe a contagem");
    expect(adjustmentProblem({ ...base, amount: "0" }, "30")).toBeNull();
    expect(adjustmentProblem({ ...base, kind: "loss", amount: "0" }, "30")).toBe("a quantidade precisa ser maior que zero");
    expect(adjustmentProblem({ ...base, kind: "expiry", amount: "30" }, "30")).toBeNull();
    expect(adjustmentDelta({ ...base, kind: "loss", amount: "2,5" }, "30")).toBe("-2.5");
    expect(adjustmentDelta({ ...base, amount: "30" }, "30")).toBe("0");
    expect(adjustmentDelta({ ...base, amount: "" }, "30")).toBe("0");
    expect(adjustmentBody(base, "l2")).toEqual({ location_id: "l2", lot_id: "lot1", kind: "adjustment", counted_quantity: "28.5", reason: "contagem do fim do mês" });
    expect(adjustmentBody({ ...base, kind: "loss", amount: "2,5", reason: " frasco quebrado no balcão " }, "l2"))
      .toEqual({ location_id: "l2", lot_id: "lot1", kind: "loss", quantity: "2.5", reason: "frasco quebrado no balcão" });
  });
});

describe("ajuste: contagem é saldo; lotes por tipo", () => {
  it("a contagem passa de 99999,99; a diferença para o saldo não; perda e vencimento seguem com o teto", () => {
    const base = { lotId: "lot1", kind: "adjustment" as const, amount: "120000,5", reason: "contagem do fim do mês" };
    expect(adjustmentProblem(base, "120000")).toBeNull();
    expect(adjustmentDelta(base, "120000")).toBe("+0.5");
    expect(fmtSigned("+0.5")).toBe("+0,5");
    expect(fmtSigned("-1.50")).toBe("-1,5");
    expect(adjustmentProblem({ ...base, amount: "100029,99" }, "30")).toBeNull();
    expect(adjustmentProblem({ ...base, amount: "100030" }, "30")).toBe("a diferença entre a contagem e o saldo pode ser no máximo 99999,99");
    expect(adjustmentProblem({ ...base, amount: "0" }, "100031")).toBe("a diferença entre a contagem e o saldo pode ser no máximo 99999,99");
    expect(adjustmentProblem({ ...base, amount: "1".repeat(400) }, "30")).toBe("a diferença entre a contagem e o saldo pode ser no máximo 99999,99");
    expect(adjustmentProblem({ ...base, amount: "2,555" }, "30")).toBe("a contagem tem no máximo 2 casas depois da vírgula");
    expect(adjustmentProblem({ ...base, kind: "loss", amount: "100000" }, "200000")).toBe("a quantidade pode ser no máximo 99999,99");
    expect(adjustmentProblem({ ...base, kind: "expiry", amount: "100000" }, "200000")).toBe("a quantidade pode ser no máximo 99999,99");
  });
  it("lotes por tipo: perda só não vencido, vencimento só vencido, contagem qualquer (inclusive saldo zero)", () => {
    const fresh = lotBalance({ lot: stockLot({ id: "f", expires_on: TODAY27 }) });
    const old = lotBalance({ lot: stockLot({ id: "o", expires_on: "2026-10-28" }) });
    const empty = lotBalance({ lot: stockLot({ id: "e", expires_on: "2026-10-01" }), balance: "0" });
    const p = position({ lots: [ fresh, old, empty ] });
    const ids = (k: "" | "adjustment" | "loss" | "expiry") => lotsForKind(p, k, TODAY27).map((b) => b.lot.id);
    expect(ids("loss")).toEqual([ "f" ]);
    expect(ids("expiry")).toEqual([ "o" ]);
    expect(ids("adjustment")).toEqual([ "e", "o", "f" ]); // contagem parte de zero: o lote zerado entra
    expect(ids("")).toEqual([ "e", "o", "f" ]);
    expect(lotsForKind(undefined, "loss", TODAY27)).toEqual([]);
    expect(lotKindProblem("loss", old.lot, TODAY27)).toBe("lote vencido — registre como vencimento, não como perda");
    expect(lotKindProblem("expiry", fresh.lot, TODAY27)).toBe("vencimento só de lote já vencido — use perda");
    expect(lotKindProblem("expiry", old.lot, TODAY27)).toBeNull();
    expect(lotKindProblem("loss", fresh.lot, TODAY27)).toBeNull();
    expect(lotKindProblem("adjustment", old.lot, TODAY27)).toBeNull();
    expect(lotKindProblem("loss", undefined, TODAY27)).toBeNull();
  });
});

describe("textos da receita externa e configurações", () => {
  it("profissional, data, notificação, motivo e faixas", () => {
    const p = { name: "Dra. Helena Prado", council: "CRM", council_state: "PR", council_number: "12345" };
    expect(prescriberProblem(p)).toBeNull();
    expect(prescriberProblem({ ...p, council: "CRF" })).toBe("escolha o conselho (CRM, CRO ou COREN)");
    expect(prescriberProblem({ ...p, council_state: "XX" })).toBe("escolha a UF do conselho");
    expect(prescriberProblem({ ...p, council_number: "12a" })).toBe("o número no conselho tem só dígitos (até 10)");
    expect(prescriberProblem({ ...p, council_number: "12345678901" })).toBe("o número no conselho tem só dígitos (até 10)");
    expect(prescriberProblem({ ...p, name: "Dr" })).toBe("o nome do profissional tem de 3 a 120 caracteres");
    expect(issuedOnProblem("2026-10-30", TODAY27)).toBe("a data da receita não pode ser depois de hoje");
    expect(issuedOnProblem("", TODAY27)).toBe("informe a data da receita");
    expect(issuedOnProblem(TODAY27, TODAY27)).toBeNull();
    expect(notificationNumberProblem("")).toBeNull();
    expect(notificationNumberProblem("B1/0042-A.1")).toBeNull();
    expect(notificationNumberProblem("B1 0042")).toBe("número da notificação: até 30 letras, números, ponto, barra ou hífen");
    expect(notificationNumberProblem("1".repeat(31))).toBe("número da notificação: até 30 letras, números, ponto, barra ou hífen");
    expect(reasonProblem("a".repeat(501))).toBe("o motivo tem de 10 a 500 caracteres");
    expect(reasonProblem("a".repeat(10))).toBeNull();
    expect(reasonProblem("  curto  ")).toBe("o motivo tem de 10 a 500 caracteres");
    const s = { common_validity_days: "30", continuous_validity_days: "180", continuous_interval_days: "25", expiry_alert_days: "90", adjustment_approval_percent: "10" };
    expect(settingsProblem(s)).toBeNull();
    expect(settingsProblem({ ...s, continuous_interval_days: "91" })).toBe("intervalo do uso contínuo de 1 a 90 dias");
    expect(settingsProblem({ ...s, adjustment_approval_percent: "10,5" })).toBe("limite do ajuste: número inteiro de 0 a 100");
    expect(settingsProblem({ ...s, adjustment_approval_percent: "0" })).toBeNull();
    expect(settingsProblem({ ...s, adjustment_approval_percent: "101" })).toBe("limite do ajuste: número inteiro de 0 a 100");
    expect(settingsProblem({ ...s, common_validity_days: "0" })).toBe("validade da receita comum de 1 a 365 dias");
    expect(settingsProblem({ ...s, continuous_validity_days: "366" })).toBe("validade da receita de uso contínuo de 1 a 365 dias");
    expect(settingsProblem({ ...s, expiry_alert_days: "" })).toBe("alerta de validade de 1 a 365 dias");
  });
});

describe("recusas do api", () => {
  const e = (status: number, body: unknown) => new ApiError(status, body, String(status));
  it("frases; código novo cru; problems de uma vez", () => {
    expect(pharmacyError(e(403, { error: "feature_disabled", feature: "pharmacy" }))).toBe(PHARMACY_DISABLED);
    expect(pharmacyError(e(422, { error: "too_early", next_allowed_on: "2026-11-03", path: "items[0]" }))).toBe("uso contínuo: próxima retirada deste item a partir de 03/11/2026");
    expect(pharmacyError(e(422, { error: "insufficient_balance", path: "items[0].quantity" }))).toBe("o saldo do lote mudou — os lotes foram relidos; confira a quantidade");
    expect(pharmacyError(e(403, { error: "controlled_requires_pharmacist" }))).toBe(CONTROLLED_PHARMACIST_ONLY);
    expect(pharmacyError(e(422, { error: "xyz_new" }))).toBe("não foi possível concluir (xyz_new) — tente de novo");
    expect(pharmacyError(new Error("offline"))).toBe("sem conexão com o servidor — tente de novo");
    expect(pharmacyProblems(e(422, { error: "insufficient_balance", problems: [ { path: "items[0].quantity", error: "insufficient_balance" },
      { path: "items[1]", error: "lot_expired" } ] }))).toEqual([
      { path: "items[0].quantity", text: "o saldo do lote mudou — os lotes foram relidos; confira a quantidade" },
      { path: "items[1]", text: "lote vencido — escolha outro lote" } ]);
    expect(pharmacyProblems(e(422, { error: "lot_expired" }))).toEqual([]);
  });
  it("pharmacyRefusals: o código de cada recusa, com ou sem problems", () => {
    expect(pharmacyRefusals(e(422, { error: "too_early", path: "items[1]", problems: [
      { path: "items[1]", error: "too_early", next_allowed_on: "2026-11-03" }, "lixo", { path: "items[0].quantity", error: "insufficient_balance" } ] }))).toEqual([
      { path: "items[1]", code: "too_early", text: "uso contínuo: próxima retirada deste item a partir de 03/11/2026" },
      { path: "items[0].quantity", code: "insufficient_balance", text: "o saldo do lote mudou — os lotes foram relidos; confira a quantidade" } ]);
    expect(pharmacyRefusals(e(403, { error: "controlled_requires_pharmacist" }))).toEqual([
      { path: "", code: "controlled_requires_pharmacist", text: CONTROLLED_PHARMACIST_ONLY } ]);
    expect(pharmacyRefusals(e(422, { error: "retention_required", path: "items[0]" }))[0]).toMatchObject({ path: "items[0]", code: "retention_required" });
    expect(pharmacyRefusals(new Error("offline"))).toEqual([ { path: "", code: "", text: "sem conexão com o servidor — tente de novo" } ]);
  });
  it("outro interruptor, papel, 404 e status sem código", () => {
    expect(pharmacyError(e(403, { error: "feature_disabled", feature: "lab" }))).toContain("desligado nesta cidade");
    expect(pharmacyError(e(403, { error: "feature_disabled" }))).toBe(PHARMACY_DISABLED);
    expect(pharmacyError(e(403, { error: "missing_role" }))).toBe(PHARMACY_NO_ROLE);
    expect(pharmacyError(e(404, { error: "not_found" }))).toBe("não encontrado — a tela foi atualizada");
    expect(pharmacyError(e(404, null))).toBe("não encontrado — a tela foi atualizada");
    expect(pharmacyError(e(500, null))).toBe("não foi possível concluir (500) — tente de novo");
  });
  it("emendas: invalid_request pela path; pessoa; CBO; receita não encontrada", () => {
    const ir = (path?: string) => pharmacyError(e(422, { error: "invalid_request", path }));
    expect(ir("prescriber.council_number")).toBe("confira os dados do profissional da receita: nome, conselho, UF e número");
    expect(ir("prescriber")).toBe("confira os dados do profissional da receita: nome, conselho, UF e número");
    expect(ir("issued_on")).toBe("data da receita inválida — confira");
    expect(ir("notification_number")).toBe("número da notificação inválido — confira");
    expect(ir("items[0].quantity")).toBe("quantidade inválida — use até 2 casas depois da vírgula");
    expect(ir("items[1].package.packages")).toBe("embalagem inválida — confira unidades por embalagem e embalagens");
    expect(ir("items[0].lot_number")).toBe("número do lote inválido — confira");
    expect(ir("items[0].expires_on")).toBe("validade inválida — confira");
    expect(ir("reason")).toBe("o motivo tem de 10 a 500 caracteres");
    expect(ir("document.number")).toBe("confira o número do documento e o fornecedor");
    expect(ir("new_patient.birth_date")).toBe("confira os dados do paciente novo");
    expect(ir("items[2]")).toBe("confira o item destacado");
    expect(ir()).toBe("pedido inválido — recarregue a tela e tente de novo");
    expect(ir("algo.novo")).toBe("pedido inválido — recarregue a tela e tente de novo");
    expect(pharmacyError(e(422, { error: "citizen_not_verified" }))).toBe(
      "este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes");
    expect(pharmacyError(e(422, { error: "invalid_cpf" }))).toBe("CPF inválido: confira os 11 dígitos");
    expect(pharmacyError(e(422, { error: "invalid_cns" }))).toBe("CNS inválido: confira os 15 dígitos");
    expect(pharmacyError(e(422, { error: "cbo_not_allowed" }))).toBe("farmacêutico precisa de vínculo profissional com CBO 2234");
    expect(pharmacyError(e(422, { error: "invalid_cbo" }))).toBe("não foi possível concluir (invalid_cbo) — tente de novo");
    expect(pharmacyError(e(404, { error: "prescription_not_found" }))).toBe("receita não encontrada nesta cidade — confira o código");
    expect(pharmacyError(e(422, { error: "prescription_cancelled" }))).toBe(PRESCRIPTION_CHANGED);
    expect(pharmacyError(e(422, { error: "retention_required", path: "retention" }))).toBe(RETENTION_REQUIRED);
    expect(pharmacyError(e(422, { error: "item_completed" }))).toBe(ITEM_COMPLETED);
    expect(pharmacyError(e(422, { error: "free_text_requires_pharmacist" }))).toBe(FREE_TEXT_PHARMACIST_ONLY);
    expect(pharmacyError(e(422, { error: "duplicate_suspected" }))).toContain("duplicados");
    expect(NO_PATIENT_RECORD).toContain("Receita externa");
  });
  it("problems: next_allowed_on, índice do corpo enviado e path", () => {
    const err = e(422, { error: "too_early", path: "items[1]", problems: [
      { path: "items[1]", error: "too_early", next_allowed_on: "2026-11-03" },
      { path: "items[0].quantity", error: "invalid_request" },
      { path: "items[2]", error: "item_completed" } ] });
    expect(pharmacyProblems(err)).toEqual([
      { path: "items[1]", text: "uso contínuo: próxima retirada deste item a partir de 03/11/2026" },
      { path: "items[0].quantity", text: "quantidade inválida — use até 2 casas depois da vírgula" },
      { path: "items[2]", text: ITEM_COMPLETED } ]);
    expect(errorPath(err)).toBe("items[1]");
    expect(errorPath(e(422, { error: "x" }))).toBeNull();
    expect(errorPath(new Error("x"))).toBeNull();
    expect(problemItemIndex("items[0]")).toBe(0);
    expect(problemItemIndex("items[12].quantity")).toBe(12);
    expect(problemItemIndex("retention")).toBeNull();
    expect(problemItemIndex(null)).toBeNull();
    expect(pharmacyProblems(new Error("x"))).toEqual([]);
    expect(pharmacyProblems(e(422, { problems: "nope" }))).toEqual([]);
  });
});

describe("extrato e posição: rótulos, documento e ordem da página", () => {
  it("rótulos do movimento (código novo aparece cru)", () => {
    expect([ "opening", "receipt", "donation", "transfer_out", "transfer_in", "dispensing", "loss", "expiry", "adjustment", "return" ].map(movementLabel)).toEqual([
      "abertura", "entrada por nota", "doação", "saída por transferência", "entrada por transferência", "dispensação", "perda", "vencimento", "ajuste", "devolução"
    ]);
    expect(movementLabel("novo")).toBe("novo");
  });

  it("documento: o número quando houver; dispensação e transferência só o tipo; sem documento, traço", () => {
    expect(movementDocument({ type: "invoice", id: "n1", number: "NF 1234" })).toBe("NF 1234");
    expect(movementDocument({ type: "dispensation", id: "dp1", number: null })).toBe("dispensação");
    expect(movementDocument({ type: "transfer", id: "t1", number: null })).toBe("transferência");
    expect(movementDocument({ type: "novo", id: null, number: null })).toBe("novo");
    expect(movementDocument(null)).toBe("—");
  });

  it("ordena pelo nome do item e depois pelo local, sem mexer na lista original", () => {
    const a = position(); const c = position({ item: CLONA });
    const a2 = position({ location: { id: "l1", name: "Almoxarifado Central", kind: "central" } });
    const list = [ c, a, a2 ];
    expect(sortPositions(list)).toEqual([ a2, a, c ]);
    expect(list).toEqual([ c, a, a2 ]);
  });
});
