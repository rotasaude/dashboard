// src/lib/territoryLabels.test.ts
import { describe, expect, it } from "vitest";
import { SECTIONS } from "./territoryDictionaries";
import { FIELD_LABELS, sectionFieldLabel } from "./territoryLabels";

describe("territoryLabels", () => {
  it("todo campo das seções das duas fichas tem rótulo, e nenhum rótulo sobra", () => {
    for (const section of [ "identification", "sociodemographic", "health_conditions", "street_situation", "living_conditions" ] as const) {
      const keys = SECTIONS[section].flatMap((f) => [ f.key, ...(f.fields ?? []).map((sub) => `${f.key}.${sub.key}`) ]);
      expect(keys.filter((key) => sectionFieldLabel(section, key) === key)).toEqual([]);
      expect(Object.keys(FIELD_LABELS[section] ?? {}).filter((key) => !keys.includes(key))).toEqual([]);
    }
  });

  it("chave desconhecida aparece crua", () => {
    expect(sectionFieldLabel("health_conditions", "campo_novo")).toBe("campo_novo");
  });
});
