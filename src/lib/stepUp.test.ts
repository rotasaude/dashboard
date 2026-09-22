import { describe, expect, it } from "vitest";
import { STEP_UP_WINDOW_MS, stepUpWindow } from "./stepUp";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("stepUpWindow", () => {
  it("sem sessão ou sem TOTP: não cadastrado, fechada", () => {
    expect(stepUpWindow(null, NOW)).toEqual({ enrolled: false, open: false, remainingMs: 0 });
    expect(stepUpWindow({ mfa_enrolled: false, mfa_verified_at: at(1000) }, NOW))
      .toEqual({ enrolled: false, open: false, remainingMs: 0 });
  });

  it("cadastrado sem verificação: fechada", () => {
    expect(stepUpWindow({ mfa_enrolled: true, mfa_verified_at: null }, NOW))
      .toEqual({ enrolled: true, open: false, remainingMs: 0 });
  });

  it("verificado há 1 min: aberta, com 4 min restantes", () => {
    expect(stepUpWindow({ mfa_enrolled: true, mfa_verified_at: at(60_000) }, NOW))
      .toEqual({ enrolled: true, open: true, remainingMs: STEP_UP_WINDOW_MS - 60_000 });
  });

  it("exatamente no limite de 5 min: fechada (a API exige mfa_verified_at > 5.minutes.ago)", () => {
    expect(stepUpWindow({ mfa_enrolled: true, mfa_verified_at: at(STEP_UP_WINDOW_MS) }, NOW).open).toBe(false);
  });

  it("data ilegível: fechada", () => {
    expect(stepUpWindow({ mfa_enrolled: true, mfa_verified_at: "ontem" }, NOW).open).toBe(false);
  });
});
