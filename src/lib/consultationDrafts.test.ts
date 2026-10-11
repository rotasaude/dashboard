// src/lib/consultationDrafts.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { draftAdminError, draftReasonProblem } from "./consultationDrafts";

const err = (status: number, error: string) => new ApiError(status, { error }, String(status));

describe("draftAdminError", () => {
  it("frase em português para cada código da API", () => {
    expect(draftAdminError(err(404, "not_found"))).toBe("rascunho não encontrado — atualize a lista");
    expect(draftAdminError(err(409, "not_draft"))).toBe("este rascunho já foi finalizado ou descartado — atualize a lista");
    expect(draftAdminError(err(422, "invalid_reason"))).toBe("o motivo precisa ter de 10 a 500 caracteres");
    expect(draftAdminError(err(422, "invalid_professional"))).toBe("este profissional não é elegível nesta unidade — atualize os candidatos");
    expect(draftAdminError(err(422, "same_author"))).toBe("este profissional já é o autor do rascunho — escolha outro");
    expect(draftAdminError(err(403, "missing_role"))).toBe("seu papel não permite esta ação");
    expect(draftAdminError(err(403, "feature_disabled"))).toBe("o prontuário está desligado nesta cidade");
    expect(draftAdminError(err(401, "mfa_required"))).toBe("a verificação em duas etapas expirou — informe um novo código");
    expect(draftAdminError(err(415, "json_required"))).toBe("não foi possível concluir — tente de novo");
  });

  it("erro desconhecido cai na frase genérica", () => {
    expect(draftAdminError(new Error("x"))).toBe("não foi possível concluir — tente de novo");
  });
});

describe("draftReasonProblem", () => {
  it("mesma regra do api: 10 a 500 após colapsar espaços", () => {
    expect(draftReasonProblem("curto")).not.toBeNull();
    expect(draftReasonProblem("   a    b   c  ")).not.toBeNull();
    expect(draftReasonProblem("motivo suficiente")).toBeNull();
    expect(draftReasonProblem("a".repeat(500))).toBeNull();
    expect(draftReasonProblem("a".repeat(501))).not.toBeNull();
  });
});
