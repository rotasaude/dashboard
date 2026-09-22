import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { describeActionError } from "./actionErrors";

const apiError = (status: number, body: unknown) => new ApiError(status, body, `${status}`);

describe("describeActionError", () => {
  it("401 mfa_required", () => {
    expect(describeActionError(apiError(401, { error: "mfa_required" }))).toEqual({ kind: "mfa_required" });
  });

  it("422 invalid_code", () => {
    expect(describeActionError(apiError(422, { error: "invalid_code" })))
      .toEqual({ kind: "invalid_code", code: "invalid_code", message: "código inválido" });
  });

  it("422 code_reused é erro do campo do código", () => {
    expect(describeActionError(apiError(422, { error: "code_reused" })))
      .toEqual({ kind: "invalid_code", code: "code_reused", message: "código já usado — espere o próximo" });
  });

  it("422 enrollment_expired pede recomeçar", () => {
    expect(describeActionError(apiError(422, { error: "enrollment_expired" })))
      .toEqual({ kind: "rejected", code: "enrollment_expired", message: "cadastro expirado — comece de novo" });
  });

  // D2: no retry de uma resposta perdida, o cadastro na verdade deu certo — o
  // 422 genérico ("a API recusou a ação") não diz isso.
  it("422 no_pending_enrollment diz que o cadastro já foi concluído", () => {
    expect(describeActionError(apiError(422, { error: "no_pending_enrollment" })))
      .toEqual({ kind: "rejected", code: "no_pending_enrollment", message: "este cadastro já foi concluído — recarregue a página" });
  });

  it("403 sem corpo", () => {
    expect(describeActionError(apiError(403, "")))
      .toEqual({ kind: "forbidden", message: "seu papel não permite esta ação" });
  });

  it("422/409 com mensagem do domínio: a mensagem da API, verbatim", () => {
    expect(describeActionError(apiError(422, { error: "insufficient_signatures", message: "falta 1 assinatura" })))
      .toEqual({ kind: "rejected", message: "falta 1 assinatura" });
    expect(describeActionError(apiError(409, { error: "conflict", message: "versão mudou" })))
      .toEqual({ kind: "rejected", message: "versão mudou" });
  });

  it("422 sem mensagem: frase genérica, nunca o código cru", () => {
    expect(describeActionError(apiError(422, { error: "invalid_state" })))
      .toEqual({ kind: "rejected", message: "a API recusou a ação" });
  });

  it("401 que não é mfa_required: sessão expirada", () => {
    expect(describeActionError(apiError(401, "")))
      .toEqual({ kind: "session_expired", message: "sessão expirada — entre de novo" });
  });

  it("429: muitas tentativas", () => {
    expect(describeActionError(apiError(429, { error: "too_many_requests" })))
      .toEqual({ kind: "rate_limited", message: "muitas tentativas — aguarde alguns minutos" });
  });

  it("5xx, rede e qualquer outra coisa: genérico", () => {
    const generic = { kind: "failed", message: "não foi possível concluir — tente de novo" };
    expect(describeActionError(apiError(500, ""))).toEqual(generic);
    expect(describeActionError(new TypeError("Failed to fetch"))).toEqual(generic);
    expect(describeActionError("x")).toEqual(generic);
  });
});
