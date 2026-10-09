// src/lib/clinicalRecord.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  EMPTY_OPENING, clinicalRecordError, deadlineMs, countdownLabel, openingBody, openingProblem, reasonLabel, remainingMs
} from "./clinicalRecord";

describe("abertura justificada", () => {
  it("CPF, motivo e a nota obrigatória só em 'Outro motivo'", () => {
    expect(openingProblem({ ...EMPTY_OPENING, cpf: "111.111.111-11", reason: "case_review" })).toBe("CPF inválido");
    expect(openingProblem({ ...EMPTY_OPENING, cpf: "529.982.247-25" })).toBe("escolha o motivo");
    expect(openingProblem({ cpf: "529.982.247-25", reason: "other", note: "curta" }))
      .toBe("em 'Outro motivo', descreva com pelo menos 10 caracteres");
    expect(openingProblem({ cpf: "529.982.247-25", reason: "other", note: "revisão pedida pela equipe" })).toBeNull();
    expect(openingProblem({ cpf: "529.982.247-25", reason: "active_search", note: "" })).toBeNull();
  });

  it("corpo: nota só quando escrita", () => {
    expect(openingBody({ cpf: "529.982.247-25", reason: "active_search", note: "  " }))
      .toEqual({ cpf: "529.982.247-25", reason_code: "active_search" });
    expect(openingBody({ cpf: "529.982.247-25", reason: "other", note: " revisão pedida pela equipe " }))
      .toEqual({ cpf: "529.982.247-25", reason_code: "other", reason_note: "revisão pedida pela equipe" });
  });

  it("contagem regressiva", () => {
    const now = Date.parse("2026-10-07T10:00:00-03:00");
    expect(remainingMs("2026-10-07T10:30:00-03:00", now)).toBe(30 * 60_000);
    expect(remainingMs("2026-10-07T09:59:00-03:00", now)).toBe(0);
    expect(remainingMs("lixo", now)).toBe(0);
    expect(countdownLabel(30 * 60_000)).toBe("30:00");
    expect(countdownLabel(30 * 60_000 - 1000)).toBe("29:59");
    expect(countdownLabel(59_500)).toBe("1:00");
    expect(countdownLabel(0)).toBe("0:00");
  });

  it("relógio local atrasado: vale recebida + 30 min, não o expires_at do servidor", () => {
    const receivedAt = Date.parse("2026-10-07T09:50:00-03:00"); // local 10 min atrás do servidor
    expect(deadlineMs("2026-10-07T10:30:00-03:00", receivedAt)).toBe(receivedAt + 30 * 60_000);
    expect(deadlineMs("2026-10-07T10:10:00-03:00", receivedAt)).toBe(Date.parse("2026-10-07T10:10:00-03:00"));
    expect(deadlineMs("lixo", receivedAt)).toBe(0);
  });

  it("rótulos e recusas", () => {
    expect(reasonLabel("continuity_of_care")).toBe("Continuidade do cuidado");
    expect(clinicalRecordError(new ApiError(404, { error: "patient_not_found" }, "404")))
      .toBe("nenhum prontuário para este CPF — o prontuário nasce na primeira consulta de um cadastro validado");
    expect(clinicalRecordError(new ApiError(422, { error: "invalid_reason" }, "422")))
      .toBe("escolha o motivo; em 'Outro motivo', descreva com pelo menos 10 caracteres");
    expect(clinicalRecordError(new ApiError(403, { error: "opening_required" }, "403")))
      .toBe("a abertura justificada terminou ou não existe — abra o prontuário de novo com o motivo");
  });
});
