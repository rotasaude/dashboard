import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { isValidCns, maskCns, professionalError, professionalErrorOrNull, shiftWindow } from "./professionals";
import { setCityTimeZone } from "./format";

describe("isValidCns", () => {
  it.each([ "700000000000005", "100000000000007", "200123456789019", "898000000000002", "712345678901236", "123456789012348" ])(
    "aceita %s", (cns) => expect(isValidCns(cns)).toBe(true)
  );
  it("aceita com espaços e pontos", () => expect(isValidCns("7123 4567 8901 236")).toBe(true));
  it.each([ "712345678901237", "312345678901236", "70000000000000", "" ])("recusa %s", (cns) =>
    expect(isValidCns(cns)).toBe(false));
});

describe("maskCns", () => {
  it("mostra só os 4 últimos", () => expect(maskCns("712345678901236")).toBe("*** **** **** 1236"));
});

describe("shiftWindow", () => {
  it("turno no mesmo dia", () => {
    expect(shiftWindow("2026-10-05", "07:00", "13:00")).toEqual({
      startsAt: "2026-10-05T07:00:00-03:00", endsAt: "2026-10-05T13:00:00-03:00", nextDay: false, tooLong: false
    });
  });
  it("fim antes do início: termina no dia seguinte", () => {
    expect(shiftWindow("2026-10-05", "19:00", "07:00")).toMatchObject({
      endsAt: "2026-10-06T07:00:00-03:00", nextDay: true, tooLong: false
    });
  });
  it("fim igual ao início: 24h, no dia seguinte", () => {
    expect(shiftWindow("2026-10-31", "07:00", "07:00")).toMatchObject({
      endsAt: "2026-11-01T07:00:00-03:00", nextDay: true, tooLong: false
    });
  });
  it("vira o ano", () => {
    expect(shiftWindow("2026-12-31", "19:00", "07:00")?.endsAt).toBe("2027-01-01T07:00:00-03:00");
  });
  it("entrada ilegível: null", () => {
    expect(shiftWindow("", "07:00", "13:00")).toBeNull();
    expect(shiftWindow("2026-10-05", "7h", "13:00")).toBeNull();
  });
});

describe("professionalError", () => {
  const err = (status: number, body: unknown) => new ApiError(status, body, "x");
  it("traduz as recusas nomeadas", () => {
    expect(professionalError(err(422, { error: "council_mismatch" }))).toMatch(/conselho/);
    expect(professionalError(err(409, { error: "shift_overlap", conflict: { unit_name: "UBS Jardim", starts_at: "2026-10-05T10:00:00Z", ends_at: "2026-10-05T16:00:00Z" } })))
      .toBe("conflita com o turno em UBS Jardim, 05/10 07:00–13:00");
    expect(professionalError(err(422, { error: "invalid", fields: [ "cns", "phone" ] }))).toBe("confira: CNS, telefone");
    expect(professionalError(err(403, { error: "missing_link" }))).toBe("Você não tem vínculo com esta unidade");
  });
  it("recusa council_in_use: conselho travado por vínculo ativo", () => {
    expect(professionalError(err(422, { error: "council_in_use", cbo_codes: [ "225125" ] }))).toMatch(/conselho/);
  });
  it("desconhecido: genérico", () => {
    expect(professionalError(new Error("rede"))).toBe("não foi possível concluir — tente de novo");
  });
  it("shift_overlap sem conflito nomeado: mensagem genérica de sobreposição", () => {
    expect(professionalError(err(409, { error: "shift_overlap" }))).toBe("conflita com outro turno do profissional");
    expect(professionalError(err(409, { error: "shift_overlap", conflict: {} }))).toBe("conflita com outro turno do profissional");
  });
  it("invalid sem campos: mensagem genérica de dados inválidos", () => {
    expect(professionalError(err(422, { error: "invalid" }))).toBe("dados inválidos — confira os campos");
    expect(professionalError(err(422, { error: "invalid", fields: [] }))).toBe("dados inválidos — confira os campos");
  });
  it("not_found: pede para recarregar", () => {
    expect(professionalError(err(404, { error: "not_found" }))).toBe("registro não encontrado — recarregue a página");
  });
});

describe("professionalErrorOrNull", () => {
  const err = (status: number, body: unknown) => new ApiError(status, body, "x");
  it("traduz recusas conhecidas, igual a professionalError", () => {
    expect(professionalErrorOrNull(err(422, { error: "council_mismatch" }))).toMatch(/conselho/);
    expect(professionalErrorOrNull(err(403, { error: "missing_link" }))).toBe("Você não tem vínculo com esta unidade");
  });
  it("código desconhecido: null, para o SensitiveAction cair na sua própria mensagem", () => {
    expect(professionalErrorOrNull(err(422, { error: "algo_novo_nao_mapeado" }))).toBeNull();
  });
  it("erro que não é da API (rede): null, para o SensitiveAction usar sua tradução de rede", () => {
    expect(professionalErrorOrNull(new Error("rede"))).toBeNull();
  });
  it("sessão expirada (401): null, para o SensitiveAction usar a mensagem de sessão expirada", () => {
    expect(professionalErrorOrNull(err(401, {}))).toBeNull();
  });
});

describe("shiftWindow no fuso da cidade (api#27)", () => {
  afterEach(() => setCityTimeZone(null));

  it("em Manaus, o turno leva o deslocamento -04:00", () => {
    setCityTimeZone("America/Manaus");
    expect(shiftWindow("2026-10-05", "19:00", "07:00")).toEqual({
      startsAt: "2026-10-05T19:00:00-04:00", endsAt: "2026-10-06T07:00:00-04:00", nextDay: true, tooLong: false
    });
  });
});

describe("recusas do módulo 17", () => {
  it("invalid_blocks traduz o detail; sem detail, frase genérica", () => {
    expect(professionalError(new ApiError(422, { error: "invalid_blocks", detail: "overlap" }, "x")))
      .toBe("faixas sobrepostas — ajuste os horários");
    expect(professionalError(new ApiError(422, { error: "invalid_blocks" }, "x"))).toBe("faixas inválidas — confira o modelo");
    expect(professionalError(new ApiError(422, { error: "invalid_blocks", detail: "inactive_type" }, "x")))
      .toBe("faixa com tipo de atendimento desativado — escolha um tipo ativo");
    expect(professionalError(new ApiError(422, { error: "invalid_blocks", detail: "bad_block" }, "x")))
      .toBe("faixa inválida ou mais de 24 faixas — confira o modelo");
    expect(professionalError(new ApiError(422, { error: "invalid_blocks", detail: "nao_existe" }, "x")))
      .toBe("faixas inválidas — confira o modelo");
    expect(professionalError(new ApiError(422, { error: "platform_type_locked" }, "x")))
      .toBe("tipo da plataforma: a chave e os grupos de CBO não mudam");
  });

  it("tipos, modelos, modelo do turno e tipo padrão do vínculo", () => {
    const msg = (error: string) => professionalError(new ApiError(422, { error }, "x"));
    expect(msg("invalid_name")).toBe("nome obrigatório, com até 60 caracteres");
    expect(msg("invalid_key")).toBe("chave inválida: minúsculas, números e _, começando por letra");
    expect(msg("key_taken")).toBe("já existe um tipo com esta chave");
    expect(msg("invalid_duration")).toBe("duração entre 5 e 240 minutos");
    expect(msg("invalid_fit_in_limit")).toBe("limite de encaixes entre 0 e 20");
    expect(msg("invalid_template")).toBe("modelo de agenda inexistente ou desativado — escolha outro");
    expect(msg("inactive_type")).toBe("tipo de atendimento desativado — escolha um tipo ativo");
    expect(msg("type_not_served")).toBe("a ocupação do vínculo não atende este tipo de atendimento");
    expect(msg("already_cancelled")).toBe("este turno já foi cancelado");
    expect(msg("already_ended")).toBe("este vínculo já foi encerrado");
  });
});
