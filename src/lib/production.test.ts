// src/lib/production.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  FICHA_STATUS, alertBanner, canReadProduction, canResend, deadlinePhrase, hasNextPage, productionError, productionErrorCode
} from "./production";
import { ficha } from "../test/recordModeFixtures";

describe("Produção — prazo e alertas (spec §6.5)", () => {
  it("prazo: dias úteis, hoje e vencido, sem deslocar a data", () => {
    expect(deadlinePhrase("2026-11-16", 7)).toBe("prazo em 16/11/2026 · faltam 7 dias úteis");
    expect(deadlinePhrase("2026-11-16", 1)).toBe("prazo em 16/11/2026 · falta 1 dia útil");
    expect(deadlinePhrase("2026-11-16", 0)).toBe("o prazo vence hoje (16/11/2026)");
    expect(deadlinePhrase("2026-11-16", -2)).toBe("prazo vencido em 16/11/2026");
  });

  it("alerta: atenção, crítico e nenhum", () => {
    expect(alertBanner("attention")).toEqual({ tone: "warn",
      text: "Há fichas pendentes ou recusadas, e o prazo está perto. Confira as recusas abaixo." });
    expect(alertBanner("critical")).toEqual({ tone: "down",
      text: "Nenhuma ficha aceita nesta competência, e o prazo está perto. Sem envio, o repasse da cidade fica em risco." });
    expect(alertBanner("none")).toBeNull();
    expect(alertBanner("novo")).toBeNull();
  });

  it("situação da ficha em português", () => {
    expect(FICHA_STATUS.accepted).toEqual({ label: "aceita", tone: "ok" });
    expect(FICHA_STATUS.rejected).toEqual({ label: "recusada", tone: "down" });
    expect(FICHA_STATUS.failed.label).toBe("falhou — sem novas tentativas");
  });
});

describe("Produção — papéis e paginação", () => {
  it("lê municipal_admin e analyst; reenvia só o admin e só ficha recusada", () => {
    expect(canReadProduction([ "analyst" ])).toBe(true);
    expect(canReadProduction([ "municipal_admin" ])).toBe(true);
    expect(canReadProduction([ "citizen_verifier" ])).toBe(false);
    expect(canResend([ "municipal_admin" ], ficha({ status: "rejected" }))).toBe(true);
    expect(canResend([ "municipal_admin" ], ficha({ status: "failed" }))).toBe(false);
    expect(canResend([ "analyst" ], ficha({ status: "rejected" }))).toBe(false);
  });

  it("há próxima página só quando o total passa da página atual", () => {
    expect(hasNextPage(1, 51)).toBe(true);
    expect(hasNextPage(1, 50)).toBe(false);
    expect(hasNextPage(2, 100)).toBe(false);
    expect(hasNextPage(2, 101)).toBe(true);
    expect(hasNextPage(1, 0)).toBe(false);
  });
});

describe("Produção — erros", () => {
  it("not_rejected, invalid_competence e feature_disabled têm frase própria; o resto segue o padrão", () => {
    const stale = new ApiError(409, { error: "not_rejected" }, "409");
    expect(productionErrorCode(stale)).toBe("not_rejected");
    expect(productionError(stale)).toBe("esta ficha não está mais recusada — a lista foi atualizada");
    expect(productionError(new ApiError(422, { error: "invalid_competence" }, "422")))
      .toBe("competência inválida — escolha outra da lista");
    expect(productionError(new ApiError(403, { error: "feature_disabled", feature: "ledi_export" }, "403")))
      .toBe("esta funcionalidade está desligada para a cidade");
    expect(productionError(new ApiError(403, { error: "missing_role" }, "403"))).toBe("seu papel não permite esta ação");
    expect(productionErrorCode(new Error("x"))).toBeNull();
  });
});
