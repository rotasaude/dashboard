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
    expect(featureLabel("rnds_sync")).toBe("rnds_sync");
  });
});
