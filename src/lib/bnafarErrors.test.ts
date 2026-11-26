// src/lib/bnafarErrors.test.ts
import { describe, expect, it } from "vitest";
import { BNAFAR_DISABLED, BNAFAR_ERRORS, bnafarErrorText, bnafarErrorTexts } from "./bnafarErrors";

const TABLE_CODES = [
  "lot_incomplete", "location_without_cnes", "product_without_code", "fractional_balance", "exit_type_missing", "domain_off",
  "lot_number_too_long", "feature_disabled", "lot_bnafar_changed", "external_exit_changed", "retry_window_closed",
  "correction_window_closed", "not_correctable", "nothing_to_retry", "ampp_unknown", "ampp_not_in_vmp", "anvisa_mismatch",
  "program_unknown", "invalid_cnpj", "cnes_in_use", "invalid_environment",
  "MSG01", "MSG02", "MSG03", "MSG04", "MSG06", "MSG08", "MSG09", "MSG10", "MSG11", "MSG12", "MSG13", "MSG15", "MSG16", "MSG17", "MSG18",
  "MSG21", "MSG22", "MSG44", "MSG46", "MSG47", "MSG51", "MSG59", "MSG62", "MSG63", "MSG64", "MSG71", "MSG72", "MSG73"
];
// F-24: o que o api manda e o plano não traduzia, mais a saída externa (lot_blocked, lot_expired, invalid_items) e Q36/Q37/R24.
const EXTRA_CODES = [
  "not_sent", "not_processed", "window_closed", "bnafar_unavailable", "internal_error", "rejected", "lot_mismatch",
  "expected_version_required", "environment_not_allowed", "invalid_items", "lot_blocked", "lot_expired", "domain_disabled"
];
// As 21 recusas de linha da planilha (api-shapes, "Códigos de linha").
const ROW_CODES = [
  "cnes_unknown", "invalid_product_type", "product_unknown", "item_not_allowed_here", "domain_disabled", "invalid_lot_number", "invalid_date",
  "expired_lot", "invalid_quantity", "invalid_price", "invalid_cnpj", "invalid_anvisa", "program_unknown", "ampp_unknown", "ampp_not_in_vmp",
  "anvisa_mismatch", "manufacturer_not_in_catalog", "lot_mismatch", "duplicate_line", "opening_exists", "too_many_lots"
];
const GROUPS = [ [ "MSG12", "MSG59" ], [ "MSG16", "MSG17", "MSG18" ], [ "MSG01", "MSG02", "MSG03", "MSG04", "MSG64" ] ];

describe("BNAFAR_ERRORS", () => {
  it("cada código da tabela, do api e da planilha tem frase", () => {
    for (const code of [ ...TABLE_CODES, ...EXTRA_CODES, ...ROW_CODES ]) {
      expect(typeof BNAFAR_ERRORS[code], code).toBe("string");
      expect(BNAFAR_ERRORS[code].length, code).toBeGreaterThan(5);
    }
  });
  it("as frases são distintas, salvo os grupos declarados, e nenhuma tem sublinhado", () => {
    const grouped = new Set(GROUPS.flat().slice(1).filter((c) => !GROUPS.some((g) => g[0] === c)));
    const seen = new Map<string, string>();
    for (const [ code, text ] of Object.entries(BNAFAR_ERRORS)) {
      expect(text.includes("_"), `${code}: ${text}`).toBe(false);
      if (grouped.has(code)) continue;
      expect(seen.get(text), `${code} repete a frase de ${seen.get(text)}`).toBeUndefined();
      seen.set(text, code);
    }
    for (const g of GROUPS) for (const c of g) expect(BNAFAR_ERRORS[c]).toBe(BNAFAR_ERRORS[g[0]]);
  });
  it("feature_disabled é a frase do interruptor", () => {
    expect(BNAFAR_ERRORS.feature_disabled).toBe(BNAFAR_DISABLED);
    expect(BNAFAR_DISABLED).toBe("o envio à BNAFAR está desligado nesta cidade");
  });
  it("código ausente volta cru, inclusive os nomes de Object", () => {
    expect(bnafarErrorText("MSG99")).toBe("recusa da BNAFAR: MSG99");
    expect(bnafarErrorText("constructor")).toBe("recusa da BNAFAR: constructor");
    expect(bnafarErrorText("MSG09")).toBe(BNAFAR_ERRORS.MSG09);
  });
  it("MSG09 com MSG47, em qualquer ordem: as duas frases, sem repetir a do grupo", () => {
    const a = bnafarErrorTexts([ "MSG09", "MSG47" ]);
    const b = bnafarErrorTexts([ "MSG47", "MSG09" ]);
    expect([ ...a ].sort()).toEqual([ BNAFAR_ERRORS.MSG09, BNAFAR_ERRORS.MSG47 ].sort());
    expect([ ...b ].sort()).toEqual([ ...a ].sort());
    expect(bnafarErrorTexts([ "MSG12", "MSG59" ])).toEqual([ BNAFAR_ERRORS.MSG12 ]);
    expect(bnafarErrorTexts([ "MSG99" ])).toEqual([ "recusa da BNAFAR: MSG99" ]);
    expect(bnafarErrorTexts([])).toEqual([]);
  });
});
