// src/lib/campaigns.vaccination.test.ts
import { describe, expect, it } from "vitest";
import { ApiError, type CampaignOptions } from "./api";
import { buildAudience, campaignError, criterionKindsFor, newCriterion, validateCriterion } from "./campaigns";

const OPTIONS: CampaignOptions = { protocols: [], tiers: [], outcomes: [], neighborhoods: [], units: [] };
const VAC = { ...OPTIONS, immunobiologicals: [ { code: "42", name: "Penta" }, { code: "15", name: "BCG" } ] };

describe("critérios de vacina (módulo 29)", () => {
  it("só com o catálogo de vacinas nas opções", () => {
    expect(criterionKindsFor(OPTIONS)).not.toContain("vaccine_overdue");
    expect(criterionKindsFor(VAC).slice(-2)).toEqual([ "vaccine_overdue", "vaccination_record_unchecked" ]);
  });
  it("validação e JSON limpo", () => {
    const c = newCriterion("vaccine_overdue", "2026-11-02");
    expect(validateCriterion(c, "2026-11-02")).toBe("marque ao menos uma vacina");
    expect(validateCriterion({ kind: "vaccine_overdue", immunobiological_codes: [ "42" ], age_min_months: 24, age_max_months: 12 }, "2026-11-02"))
      .toBe("a idade mínima é maior que a máxima");
    expect(validateCriterion({ kind: "vaccination_record_unchecked", age_max_months: 1.5 }, "2026-11-02")).toBe("idade em meses: número inteiro de 0 a 1200");
    expect(validateCriterion({ kind: "vaccination_record_unchecked", age_max_months: 1201 }, "2026-11-02")).toBe("idade em meses: número inteiro de 0 a 1200");
    expect(validateCriterion({ kind: "vaccination_record_unchecked", age_min_months: -1 }, "2026-11-02")).toBe("idade em meses: número inteiro de 0 a 1200");
    expect(validateCriterion({ kind: "vaccination_record_unchecked", age_min_months: 0, age_max_months: 1200 }, "2026-11-02")).toBeNull();
    expect(validateCriterion({ kind: "vaccination_record_unchecked" }, "2026-11-02")).toBeNull();
    const audience = buildAudience({ geo: { scope: "city" }, criteria: [
      { key: "k1", criterion: { kind: "vaccine_overdue", immunobiological_codes: [ "42", "42", "15" ], age_max_months: 23 } },
      { key: "k2", criterion: { kind: "vaccination_record_unchecked", age_min_months: undefined } } ] });
    expect(audience.clinical.all).toEqual([
      { kind: "vaccine_overdue", immunobiological_codes: [ "42", "15" ], age_max_months: 23 },
      { kind: "vaccination_record_unchecked" } ]);
  });
  it("feature_disabled tem frase própria", () => {
    const msg = campaignError(new ApiError(403, { error: "feature_disabled", feature: "vaccination" }, "403"));
    expect(msg).toMatch(/sala de vacina não está ligada/);
  });
});
