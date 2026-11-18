// src/lib/vectorErrors.test.ts
import { describe, expect, it } from "vitest";
import { VECTOR_CONTROL_DISABLED, VECTOR_ERRORS, VECTOR_ERROR_CODES } from "./vectorErrors";

describe("vectorErrors", () => {
  it("cada código do contrato tem uma frase, e só uma por código", () => {
    expect(Object.keys(VECTOR_ERRORS).sort()).toEqual([ ...VECTOR_ERROR_CODES ].sort());
    const phrases = Object.values(VECTOR_ERRORS);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const p of phrases) expect(p.length).toBeGreaterThan(10);
  });

  it("frases que o campo copia, sem dado de pessoa nem código cru", () => {
    expect(VECTOR_ERRORS.reason_derived).toBe("os motivos de controle vetorial (34 a 37) saem do boletim — desmarque-os");
    expect(VECTOR_ERRORS.feature_disabled).toBe(VECTOR_CONTROL_DISABLED);
    expect(VECTOR_ERRORS.sample_label_taken).toBe("esta etiqueta já foi usada — gere etiquetas novas para este boletim");
    expect(VECTOR_ERRORS.invalid_transition).toBe("a situação mudou enquanto a tela estava aberta — os dados foram relidos");
    for (const p of Object.values(VECTOR_ERRORS)) expect(p).not.toMatch(/_/);
  });

  it("os 38 códigos da brief, o proposal_changed (Q26(4)) e os dois do PUT dos parâmetros (Q34)", () => {
    expect(VECTOR_ERROR_CODES).toHaveLength(41);
    expect(VECTOR_ERRORS.parameters_changed).toBe("outra pessoa alterou os parâmetros; confira e salve de novo");
    expect(VECTOR_ERRORS.expected_version_required).toBe("a tela está desatualizada — recarregue a página e tente de novo");
    expect(VECTOR_ERRORS.proposal_changed).toBe("a proposta ganhou caso novo enquanto a tela estava aberta — os dados foram relidos");
  });
});
