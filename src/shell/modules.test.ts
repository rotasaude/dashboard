import { describe, expect, it } from "vitest";
import { NAV_GROUPS, labelFor } from "./modules";

describe("modules", () => {
  it("Segurança fica no grupo Conta", () => {
    const conta = NAV_GROUPS.find((g) => g.label === "Conta");
    expect(conta?.items.map((i) => i.id)).toEqual([ "security" ]);
    expect(labelFor("security")).toBe("Segurança");
  });
});
