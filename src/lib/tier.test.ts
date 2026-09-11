import { describe, it, expect } from "vitest";
import { tierTone } from "./tier";

describe("tierTone", () => {
  it("maps the PT vocabulary", () => {
    expect(tierTone("alta")).toBe("down");
    expect(tierTone("media")).toBe("warn");
    expect(tierTone("baixa")).toBe("ok");
  });

  it("maps the EN vocabulary used by the demo seed", () => {
    expect(tierTone("high")).toBe("down");
    expect(tierTone("medium")).toBe("warn");
    expect(tierTone("low")).toBe("ok");
  });

  it("is case- and accent-insensitive", () => {
    expect(tierTone("ALTA")).toBe("down");
    expect(tierTone("Média")).toBe("warn");
  });

  it("degrades to neutral for an unknown author vocabulary", () => {
    expect(tierTone("vermelho")).toBe("neutral");
    expect(tierTone(null)).toBe("neutral");
    expect(tierTone(undefined)).toBe("neutral");
    expect(tierTone("")).toBe("neutral");
  });
});
