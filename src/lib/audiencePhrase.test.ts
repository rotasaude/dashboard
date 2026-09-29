import { describe, expect, it } from "vitest";
import type { Audience, Criterion } from "./api";
import { describeAudience, fmtDay, joinPt } from "./audiencePhrase";
import { OPTIONS } from "../test/campaignFixtures";

const aud = (geo: Audience["geo"], all: Criterion[] = []): Audience => ({ version: 1, geo, clinical: { all } });
const city = (c: Criterion) => describeAudience(aud({ scope: "city" }, [ c ]), OPTIONS);

describe("fmtDay e joinPt", () => {
  it("data sem deslocar o dia (nunca lida como UTC)", () => {
    expect(fmtDay("2026-07-01")).toBe("01/07/2026");
    expect(fmtDay("2026-12-31")).toBe("31/12/2026");
  });

  it("lista em português", () => {
    expect(joinPt([ "A" ])).toBe("A");
    expect(joinPt([ "A", "B" ])).toBe("A e B");
    expect(joinPt([ "A", "B", "C" ])).toBe("A, B e C");
    expect(joinPt([ "A", "B" ], "ou")).toBe("A ou B");
  });
});

describe("describeAudience", () => {
  it("o exemplo da spec", () => {
    expect(describeAudience(aud({ scope: "neighborhoods", neighborhood_ids: [ "n1", "n2" ] },
      [ { kind: "appointment_no_show", from: "2026-07-01", to: "2026-09-29" } ]), OPTIONS))
      .toBe("moradores de Boqueirão e Xaxim que faltaram a um agendamento entre 01/07/2026 e 29/09/2026");
  });

  it("recortes sem critério", () => {
    expect(describeAudience(aud({ scope: "city" }), OPTIONS)).toBe("cidadãos de toda a cidade");
    expect(describeAudience(aud({ scope: "unit", health_unit_id: "u1" }), OPTIONS))
      .toBe("moradores da área de cobertura de UBS Centro");
    expect(describeAudience(aud({ scope: "neighborhoods", neighborhood_ids: [ "n1", "n2", "n3" ] }), OPTIONS))
      .toBe("moradores de Boqueirão, Xaxim e Centro");
  });

  it("bairro que não está na lista (desativado depois do rascunho)", () => {
    expect(describeAudience(aud({ scope: "neighborhoods", neighborhood_ids: [ "n1", "sumiu" ] }), OPTIONS))
      .toBe("moradores de Boqueirão e (bairro inativo)");
    expect(describeAudience(aud({ scope: "unit", health_unit_id: "sumiu" }), OPTIONS))
      .toBe("moradores da área de cobertura de (unidade inativa)");
  });

  it("uma frase por tipo de critério", () => {
    const p = { from: "2026-07-01", to: "2026-07-31" };
    expect(city({ kind: "protocol_period", protocol_name: "Febre", ...p }))
      .toBe("cidadãos de toda a cidade que fizeram triagem concluída pelo protocolo Febre entre 01/07/2026 e 31/07/2026");
    expect(city({ kind: "triage_tier", tiers: [ "vermelha", "amarela" ], ...p }))
      .toBe("cidadãos de toda a cidade que tiveram triagem concluída na faixa vermelha ou amarela entre 01/07/2026 e 31/07/2026");
    expect(city({ kind: "triage_incomplete", ...p }))
      .toBe("cidadãos de toda a cidade que deixaram uma triagem sem concluir entre 01/07/2026 e 31/07/2026");
    expect(city({ kind: "attendance_outcome", outcomes: [ "referred" ], health_unit_id: "u2", ...p }))
      .toBe("cidadãos de toda a cidade que tiveram atendimento encerrado como encaminhado em UPA Boqueirão entre 01/07/2026 e 31/07/2026");
    expect(city({ kind: "triaged_not_attended", ...p }))
      .toBe("cidadãos de toda a cidade que fizeram triagem concluída entre 01/07/2026 e 31/07/2026 e não foram atendidos depois dela");
    expect(city({ kind: "appointment_request_open" }))
      .toBe("cidadãos de toda a cidade que têm pedido de agendamento aberto");
    expect(city({ kind: "appointment_request_open", kinds: [ "return" ], target_unit_id: "u1" }))
      .toBe("cidadãos de toda a cidade que têm pedido de agendamento de retorno aberto para UBS Centro");
  });

  it("período de um dia só", () => {
    expect(city({ kind: "appointment_no_show", from: "2026-07-01", to: "2026-07-01" }))
      .toBe("cidadãos de toda a cidade que faltaram a um agendamento em 01/07/2026");
  });

  it("critérios somados por E, como no construtor", () => {
    expect(describeAudience(aud({ scope: "neighborhoods", neighborhood_ids: [ "n2" ] }, [
      { kind: "appointment_no_show", from: "2026-07-01", to: "2026-07-31" },
      { kind: "appointment_request_open" }
    ]), OPTIONS)).toBe(
      "moradores de Xaxim que faltaram a um agendamento entre 01/07/2026 e 31/07/2026 " +
      "e também têm pedido de agendamento aberto"
    );
  });
});
