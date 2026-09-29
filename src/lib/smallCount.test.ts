import { describe, expect, it } from "vitest";
import { SUPPRESSED_LABEL, chartSeries, fmtCount, isSuppressed, numberOrNull, whenAllCounted } from "./smallCount";

const s = { suppressed: true as const };

describe("smallCount", () => {
  it("reconhece o suprimido e só ele", () => {
    expect(isSuppressed(s)).toBe(true);
    expect(isSuppressed(0)).toBe(false);
    expect(isSuppressed({ suppressed: false })).toBe(false);
    expect(isSuppressed(null)).toBe(false);
  });

  it("formata: suprimido é '< 5'; 0 continua 0", () => {
    expect(fmtCount(s)).toBe(SUPPRESSED_LABEL);
    expect(SUPPRESSED_LABEL).toBe("< 5");
    expect(fmtCount(0)).toBe("0");
    expect(fmtCount(1234)).toBe("1.234");
    expect(fmtCount(75, "%")).toBe("75%");
    expect(fmtCount(s, "%")).toBe("oculto");
    expect(fmtCount(s, "min")).toBe("oculto");
  });

  it("série para gráfico: suprimido vira lacuna, nunca 0", () => {
    expect(chartSeries([ 0, s, 7 ])).toEqual([ 0, null, 7 ]);
    expect(numberOrNull(s)).toBeNull();
  });

  it("whenAllCounted: null se alguma categoria está suprimida", () => {
    expect(whenAllCounted([ { label: "a", count: 1 }, { label: "b", count: 0 } ])).toHaveLength(2);
    expect(whenAllCounted([ { label: "a", count: s } ])).toBeNull();
  });
});
