// src/lib/production.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  CORRECTION_PENDING_NOTE, FICHA_STATUS, SOURCE_LABEL, alertBanner, canReadProduction, canResend, canRetryGeneration, deadlinePhrase, errorCodesLabel, hasNextPage,
  productionError, productionErrorCode, reasonsLabel, replacedIds, retryOutcome
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
      text: "Há fichas pendentes, recusadas ou com falha, e o prazo está perto. Confira a situação abaixo." });
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

  it("correção pendente (módulo 19) tem rótulo e nunca se reenvia", () => {
    expect(FICHA_STATUS.correction_pending).toEqual({ label: "correção pendente — não enviada", tone: "info" });
    expect(canResend([ "municipal_admin" ], ficha({ status: "correction_pending" }))).toBe(false);
    expect(CORRECTION_PENDING_NOTE.length).toBeGreaterThan(0);
  });

  it("origem Consultation (módulo 19) tem rótulo", () => {
    expect(SOURCE_LABEL.Consultation).toBe("consulta");
  });

  it("há próxima página só quando o total passa da página atual", () => {
    expect(hasNextPage(1, 51)).toBe(true);
    expect(hasNextPage(1, 50)).toBe(false);
    expect(hasNextPage(2, 100)).toBe(false);
    expect(hasNextPage(2, 101)).toBe(true);
    expect(hasNextPage(1, 0)).toBe(false);
  });
});

describe("Produção — códigos e fichas não geradas (módulo 18)", () => {
  it("códigos de recusa como vêm; other/unknown vira 'erro não classificado'; vazio é traço", () => {
    expect(errorCodesLabel([ { field: "profissional.cns", code: "invalid" }, { field: "other", code: "unknown" } ]))
      .toBe("profissional.cns · invalid; erro não classificado");
    expect(errorCodesLabel([])).toBe("—");
    expect(errorCodesLabel(undefined)).toBe("—");
  });

  it("motivos em português; desconhecido aparece como veio", () => {
    expect(reasonsLabel([ "unit_without_cnes", "citizen_without_sex", "new_reason" ]))
      .toBe("unidade sem CNES, cidadão sem sexo no cadastro, new_reason");
  });

  it("gerar de novo: resolvida ou o que ainda falta", () => {
    expect(retryOutcome({ resolved_at: "2026-10-07T10:00:00Z", reason_codes: [] })).toBe("Ficha gerada: ela entra na fila de envio.");
    expect(retryOutcome({ resolved_at: null, reason_codes: [ "professional_without_team" ] }))
      .toBe("Ainda não foi possível gerar: profissional sem equipe (INE). Corrija na origem e tente de novo.");
  });

  it("só o municipal_admin gera de novo; already_resolved, generation_failed e export_unusable têm frase", () => {
    expect(canRetryGeneration([ "municipal_admin" ])).toBe(true);
    expect(canRetryGeneration([ "analyst" ])).toBe(false);
    expect(productionError(new ApiError(409, { error: "already_resolved" }, "409"))).toBe("esta ficha já foi gerada — a lista foi atualizada");
    expect(productionError(new ApiError(409, { error: "generation_failed" }, "409")))
      .toBe('não foi possível gerar a ficha de novo — veja "Fichas que não puderam ser geradas"');
    expect(productionError(new ApiError(409, { error: "export_unusable" }, "409")))
      .toBe("o envio da produção ao e-SUS não está utilizável agora nesta cidade");
  });

  it("substituída: o id que outra ficha da página aponta", () => {
    const set = replacedIds([ ficha({ id: "a" }), ficha({ id: "b", replaces_outbox_id: "a" }) ]);
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("correção pendente não substitui a ficha aceita (só depois de enviada)", () => {
    const set = replacedIds([
      ficha({ id: "a", status: "accepted" }), ficha({ id: "c", status: "correction_pending", replaces_outbox_id: "a" })
    ]);
    expect(set.has("a")).toBe(false);
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
