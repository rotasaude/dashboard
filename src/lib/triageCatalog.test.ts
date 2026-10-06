import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  canEditCatalog, canReadCatalog, fmtCounter, formFrom, offerFormProblem, offerPayload, offerState, periodPhrase,
  triageCatalogError
} from "./triageCatalog";
import { RESPIRATORY, catalogOffer } from "../test/triageCatalogFixtures";

const TODAY = "2026-10-05";

describe("papéis", () => {
  it("lê quem lê protocolos; edita só o municipal_admin", () => {
    expect(canReadCatalog([ "protocol_author" ])).toBe(true);
    expect(canReadCatalog([ "protocol_reviewer" ])).toBe(true);
    expect(canReadCatalog([ "citizen_verifier", "analyst" ])).toBe(false);
    expect(canEditCatalog([ "protocol_reviewer" ])).toBe(false);
    expect(canEditCatalog([ "municipal_admin" ])).toBe(true);
  });
});

describe("situação no catálogo (ADR 0027, regra de oferta)", () => {
  it.each([
    [ "sem linha e sem elegibilidade: oferecida como hoje", RESPIRATORY, "oferecida (sem configuração)", "ok" ],
    [ "sem linha e com elegibilidade: fora de oferta", catalogOffer({ configured: false, enabled: null, position: null }), "fora de oferta: configure", "warn" ],
    [ "pausada", catalogOffer({ enabled: false }), "pausada", "neutral" ],
    [ "antes do início", catalogOffer({ available_from: "2026-10-06" }), "agendada", "info" ],
    [ "depois do fim", catalogOffer({ available_until: "2026-10-04" }), "período encerrado", "warn" ],
    [ "no último dia ainda vale", catalogOffer({ available_until: TODAY }), "oferecida", "ok" ],
    [ "só por sugestão", catalogOffer({ suggestion_only: true }), "só por sugestão", "info" ],
    [ "pausada vale mais que só por sugestão", catalogOffer({ enabled: false, suggestion_only: true }), "pausada", "neutral" ]
  ])("%s", (_name, offer, label, tone) => {
    expect(offerState(offer, TODAY)).toEqual({ label, tone });
  });
});

describe("período e contadores", () => {
  it("período sem deslocar o dia", () => {
    expect(periodPhrase(null, null)).toBe("sem período");
    expect(periodPhrase("2026-07-01", null)).toBe("a partir de 01/07/2026");
    expect(periodPhrase(null, "2026-12-31")).toBe("até 31/12/2026");
    expect(periodPhrase("2026-07-01", "2026-12-31")).toBe("de 01/07/2026 a 31/12/2026");
  });

  it("contador nulo é < 5, zero é 0", () => {
    expect(fmtCounter(null)).toBe("< 5");
    expect(fmtCounter(0)).toBe("0");
    expect(fmtCounter(1200)).toBe("1.200");
  });
});

describe("formulário", () => {
  it("linha configurada vem como está; datas nulas viram campo vazio", () => {
    expect(formFrom(catalogOffer(), [])).toEqual({
      enabled: true, suggestionOnly: false, position: "2", restriction: { in: [ "citizen.neighborhood_id", [ "n2" ] ] },
      from: "", until: "2026-12-31"
    });
    expect(formFrom(catalogOffer({ suggestion_only: true }), []).suggestionOnly).toBe(true);
    // api anterior ao campo: não manda a chave.
    expect(formFrom(catalogOffer({ suggestion_only: undefined }), []).suggestionOnly).toBe(false);
  });

  it("protocolo sem linha começa oferecido, na próxima posição livre", () => {
    expect(formFrom(RESPIRATORY, [ catalogOffer(), RESPIRATORY ])).toEqual({
      enabled: true, suggestionOnly: false, position: "3", restriction: null, from: "", until: ""
    });
    expect(formFrom(RESPIRATORY, [ RESPIRATORY ]).position).toBe("1");
  });

  it("ordem precisa ser inteiro a partir de 1; fim não pode vir antes do início", () => {
    const base = formFrom(catalogOffer(), []);
    expect(offerFormProblem(base)).toBeNull();
    expect(offerFormProblem({ ...base, position: "0" })).toBe("a ordem precisa ser um número inteiro a partir de 1");
    expect(offerFormProblem({ ...base, position: "2.5" })).toBe("a ordem precisa ser um número inteiro a partir de 1");
    expect(offerFormProblem({ ...base, from: "2026-12-01", until: "2026-11-01" })).toBe("o fim do período não pode ser antes do início");
    expect(offerFormProblem({ ...base, from: "2026-12-01", until: "2026-12-01" })).toBeNull();
  });

  it("payload: número na ordem e data vazia como null", () => {
    expect(offerPayload({ enabled: false, suggestionOnly: true, position: " 4 ", restriction: null, from: "", until: "2026-12-31" }))
      .toEqual({ enabled: false, suggestion_only: true, position: 4, restriction: null, available_from: null,
                 available_until: "2026-12-31" });
  });
});

describe("recusas da API", () => {
  it("traduz os códigos do PUT e deixa o resto para a mensagem padrão", () => {
    expect(triageCatalogError(new ApiError(422, { error: "invalid_restriction" }, "x")))
      .toBe("a restrição usa um campo que o catálogo não aceita ou está malformada");
    expect(triageCatalogError(new ApiError(422, { error: "invalid_period" }, "x"))).toBe("o fim do período não pode ser antes do início");
    expect(triageCatalogError(new ApiError(422, { error: "invalid_position" }, "x"))).toBe("a ordem precisa ser um número inteiro a partir de 1");
    expect(triageCatalogError(new ApiError(422, { error: "invalid_enabled" }, "x")))
      .toBe("o campo “oferecer no catálogo” precisa ser sim ou não");
    expect(triageCatalogError(new ApiError(422, { error: "invalid_suggestion_only" }, "x")))
      .toBe("o campo “só por sugestão” precisa ser sim ou não");
    expect(triageCatalogError(new ApiError(404, { error: "unknown_protocol" }, "x")))
      .toBe("este protocolo não existe mais nesta cidade — recarregue a lista");
    expect(triageCatalogError(new ApiError(422, { error: "outra_coisa" }, "x"))).toBeNull();
    expect(triageCatalogError(new ApiError(500, "erro", "x"))).toBeNull();
    expect(triageCatalogError(new Error("rede"))).toBeNull();
  });
});
