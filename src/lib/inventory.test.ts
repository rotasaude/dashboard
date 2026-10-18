// src/lib/inventory.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { QC_DISABLED } from "./qc";
import {
  EMPTY_LOT_ENTRY, EMPTY_MOVEMENT, EMPTY_SUPPLY, INVENTORY_DISABLED, UNTRACED, deviationTone, fmtDeviation, fmtMovementQuantity, integerProblem, inventoryError,
  lotEntryBody, lotEntryProblem, movementBody, movementProblem, movementLabel, reagentLotMark, supplyBody, supplyProblem, supplyDraft
} from "./inventory";

describe("inteiros", () => {
  it("só dígitos, mínimo e sinal quando permitido", () => {
    expect(integerProblem("3", "a quantidade", { min: 1 })).toBeNull();
    expect(integerProblem("1,5", "a quantidade", { min: 1 })).toBe("a quantidade é um número inteiro");
    expect(integerProblem("0", "a quantidade", { min: 1 })).toBe("a quantidade precisa ser ao menos 1");
    expect(integerProblem("-2", "o ajuste", { allowNegative: true })).toBeNull();
    expect(integerProblem("", "o mínimo", { min: 0 })).toBe("informe o mínimo");
  });
});

describe("item de estoque", () => {
  const reagent = { ...EMPTY_SUPPLY, name: "Glicose GOD-PAP", kind: "reagent" as const, unit: "kit", testsPerPackage: "400", minimumStock: "2", examIds: [ "le1" ] };
  it("reagente exige rendimento e exame ligado; os outros não", () => {
    expect(supplyProblem(reagent)).toBeNull();
    expect(supplyProblem({ ...reagent, testsPerPackage: "" })).toBe("informe quantos testes rende cada embalagem do reagente");
    expect(supplyProblem({ ...reagent, examIds: [] })).toBe("ligue o reagente a ao menos um exame");
    expect(supplyProblem({ ...reagent, kind: "consumable", testsPerPackage: "", examIds: [] })).toBeNull();
    expect(supplyProblem({ ...reagent, expiryAlertDays: "400" })).toBe("aviso de vencimento de 1 a 365 dias");
    expect(supplyProblem({ ...reagent, minimumStock: "100001" })).toBe("o estoque mínimo pode ser no máximo 100000");
    expect(supplyProblem({ ...reagent, testsPerPackage: "100001" })).toBe("o rendimento pode ser no máximo 100000");
    expect(supplyProblem({ ...reagent, name: "x".repeat(121) })).toBe("nome com até 120 caracteres");
  });
  it("corpo: rendimento só do reagente; padrão de 30 dias", () => {
    expect(supplyBody(reagent, "pv9")).toEqual({
      provider_id: "pv9", name: "Glicose GOD-PAP", kind: "reagent", unit: "kit", tests_per_package: 400, minimum_stock: 2,
      expiry_alert_days: 30, lab_exam_ids: [ "le1" ], active: true
    });
    expect(supplyBody({ ...reagent, kind: "consumable" }, "pv9").tests_per_package).toBeNull();
  });
});

describe("entrada de lote", () => {
  const d = { ...EMPTY_LOT_ENTRY, supplyId: "su1", lotNumber: "R-778", expiresOn: "2027-01-31", supplier: "Distribuidora Sul", origin: "purchase" as const, quantity: "6" };
  it("lote vencido não entra; quantidade inteira", () => {
    expect(lotEntryProblem(d, "2026-10-18")).toBeNull();
    expect(lotEntryProblem({ ...d, expiresOn: "2026-10-17" }, "2026-10-18")).toBe("lote vencido — não entra no estoque");
    expect(lotEntryProblem({ ...d, quantity: "2,5" }, "2026-10-18")).toBe("a quantidade é um número inteiro");
    expect(lotEntryBody({ ...d, document: " NF 1234 " })).toEqual({
      supply_id: "su1", lot_number: "R-778", expires_on: "2027-01-31", supplier: "Distribuidora Sul", origin: "purchase", quantity: 6, document: "NF 1234"
    });
    expect(lotEntryBody(d)).not.toHaveProperty("document");
  });
});

describe("movimento", () => {
  it("saída maior que o saldo e ajuste sem admin", () => {
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "opening", quantity: "1" }, 5, false)).toBeNull();
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "loss", quantity: "6", reason: "frasco quebrado" }, 5, false)).toBe("saída maior que o saldo do lote (5)");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "loss", quantity: "1", reason: "" }, 5, false)).toBe("escreva o motivo");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "loss", quantity: "1", reason: "x".repeat(1000) }, 5, false)).toBeNull();
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "loss", quantity: "1", reason: "x".repeat(1001) }, 5, false)).toBe("motivo com até 1000 caracteres");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "loss", quantity: "100001", reason: "x" }, 999999, false)).toBe("a quantidade pode ser no máximo 100000");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "adjustment", quantity: "-1", reason: "contagem física" }, 5, false)).toBe("ajuste é só do administrador");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "adjustment", quantity: "-6", reason: "contagem física" }, 5, true)).toBe("saída maior que o saldo do lote (5)");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "adjustment", quantity: "0", reason: "contagem física" }, 5, true)).toBe("o ajuste não pode ser zero");
    expect(movementProblem({ ...EMPTY_MOVEMENT, kind: "adjustment", quantity: "2", reason: "contagem física" }, 5, true)).toBeNull();
  });
  it("abertura não manda motivo, nem o que sobrou de outro movimento", () => {
    expect(movementBody({ kind: "opening", quantity: "1", reason: "sobra" }, "sl1")).toEqual({ lot_id: "sl1", kind: "opening", quantity: 1 });
  });
  it("quantidade do api vem com sinal", () => {
    expect(fmtMovementQuantity(6)).toBe("+6");
    expect(fmtMovementQuantity(-1)).toBe("-1");
    expect(movementLabel("expiry")).toBe("vencimento");
  });
  it("corpo com quantidade inteira", () => {
    expect(movementBody({ kind: "adjustment", quantity: "-1", reason: " contagem física " }, "sl1")).toEqual({ lot_id: "sl1", kind: "adjustment", quantity: -1, reason: "contagem física" });
  });
});

describe("lote no resultado", () => {
  it("número do lote; null com o estoque ligado = sem rastreio; ausente = nada", () => {
    expect(reagentLotMark({ reagent_lot: { id: "sl1", lot_number: "R-778" } }, true)).toEqual({ text: "lote R-778", untraced: false });
    expect(reagentLotMark({ reagent_lot: null }, true)).toEqual({ text: UNTRACED, untraced: true });
    expect(reagentLotMark({ reagent_lot: null }, false)).toBeNull();
    expect(reagentLotMark({}, true)).toBeNull();
  });
});

describe("consumo e recusas", () => {
  it("desvio com sinal e vírgula; acima de 20% acende", () => {
    expect(fmtDeviation(12.5)).toBe("+12,5%");
    expect(fmtDeviation(-30)).toBe("-30,0%");
    expect(fmtDeviation(null)).toBe("—");
    expect(deviationTone(-30)).toBe("warn");
    expect(deviationTone(5)).toBeUndefined();
  });
  it("códigos novos têm frase própria; 404 não fala de etiqueta", () => {
    expect(inventoryError(new ApiError(404, { error: "not_found" }, "x"))).toBe("não encontrado neste laboratório — a tela foi atualizada");
    expect(inventoryError(new ApiError(422, { error: "duplicate_name" }, "x"))).toBe("já existe um item com este nome neste laboratório");
    expect(inventoryError(new ApiError(422, { error: "duplicate_lot" }, "x"))).toBe("este número de lote já existe neste item com outra validade");
    expect(inventoryError(new ApiError(422, { error: "invalid_reason" }, "x"))).toBe("motivo longo demais — use até 1000 caracteres");
    expect(inventoryError(new ApiError(422, { error: "invalid_instrument" }, "x"))).toContain("aparelho");
    expect(inventoryError(new ApiError(401, { error: "mfa_required" }, "x"))).toContain("autenticador");
    expect(inventoryError(new ApiError(403, { error: "feature_disabled", feature: "lab_quality_control" }, "x"))).toBe(QC_DISABLED);
  });
  it("item vindo do api volta ao rascunho", () => {
    const s = { id: "su1", provider_id: "pv9", name: "Glicose", kind: "reagent", unit: "kit", tests_per_package: 400, minimum_stock: 2, expiry_alert_days: 30,
      lab_exam_ids: [ "le1" ], active: true, balance: 3, below_minimum: false };
    expect(supplyDraft(s)).toEqual({ name: "Glicose", kind: "reagent", unit: "kit", testsPerPackage: "400", minimumStock: "2", expiryAlertDays: "30", examIds: [ "le1" ], active: true });
    expect(supplyDraft({ ...s, kind: "consumable", tests_per_package: null }).testsPerPackage).toBe("");
  });
  it("frases do estoque; motivo do estoque não é o da rejeição de amostra", () => {
    expect(inventoryError(new ApiError(403, { error: "feature_disabled", feature: "lab_inventory" }, "x"))).toBe(INVENTORY_DISABLED);
    expect(inventoryError(new ApiError(422, { error: "insufficient_balance" }, "x"))).toBe("saída maior que o saldo do lote — o saldo foi relido");
    expect(inventoryError(new ApiError(422, { error: "reason_required" }, "x"))).toBe("escreva o motivo");
    expect(inventoryError(new ApiError(422, { error: "exam_not_linked" }, "x"))).toBe("este exame não está ligado ao item — o administrador liga no cadastro do item");
  });
});
