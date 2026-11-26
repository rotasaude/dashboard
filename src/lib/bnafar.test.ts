// src/lib/bnafar.test.ts
import { describe, expect, it } from "vitest";
import { ApiError, type BnafarDomains, type LotBalance } from "./api";
import {
  BNAFAR_NOT_USABLE, BNAFAR_NO_ROLE, DOMAIN_FEATURE, EMPTY_LOT_BNAFAR, KIND_DOMAIN, alertLines, anvisaProblem, bnafarError, bnafarFieldsFor, bnafarProblems,
  bnafarRoles, canResend, canSeePendencies, canSeeStatus, canUseBnafar, catmatProblem, cnesProblem, cnpjProblem, docOf, environmentLabel,
  exitTypeLabel, externalExitBody, externalExitProblems, fmtCents, internationalNameProblem, isStale, lotBnafarBody, lotBnafarProblems,
  missingFields, parseUnitPrice, recordStatusLabel, recordStatusTone, subjectLabel, submissionStatusLabel, submissionStatusTone, type BnafarField
} from "./bnafar";
import { BNAFAR_DISABLED, BNAFAR_ERRORS } from "./bnafarErrors";
import { LOT_BLOCKED_TEXT, PHARMACY_DISABLED, pharmacyError } from "./pharmacy";
import { BNAFAR_DOMAINS, FIVE_MISSING, bnafarUser, lostRecord, record, submission } from "../test/bnafarFixtures";
import { AMOXI } from "../test/pharmacyFixtures";

const api = (status: number, body: unknown) => new ApiError(status, body, "x");

describe("portões e papéis", () => {
  it("canUseBnafar: a chave bnafar e nunca o operador", () => {
    expect(canUseBnafar(bnafarUser())).toBe(true);
    expect(canUseBnafar(bnafarUser([ "stock_keeper" ], [ "pharmacy" ]))).toBe(false);
    expect(canUseBnafar({ ...bnafarUser(), operator: true })).toBe(false);
    expect(canUseBnafar(null)).toBe(false);
  });
  it("leitores (Q32): admin, almoxarife e farmacêutico; auxiliar não", () => {
    expect(bnafarRoles(bnafarUser([ "municipal_admin" ]))).toEqual({ admin: true, keeper: false, pharmacist: false, reader: true });
    expect(bnafarRoles(bnafarUser([ "stock_keeper" ])).reader).toBe(true);
    expect(bnafarRoles(bnafarUser([ "pharmacist" ])).reader).toBe(true);
    expect(bnafarRoles(bnafarUser([ "pharmacy_assistant" ])).reader).toBe(false);
    expect(bnafarRoles(null).reader).toBe(false);
  });
  it("status exige o bnafar ligado; pendências só o estoque (Q22, Q40)", () => {
    const stockOnly = bnafarUser([ "pharmacist" ], [ "pharmacy" ]);
    expect(canSeeStatus(bnafarUser([ "stock_keeper" ]))).toBe(true);
    expect(canSeeStatus(stockOnly)).toBe(false);
    expect(canSeePendencies(stockOnly)).toBe(true);
    expect(canSeePendencies(bnafarUser([ "pharmacist" ], [ "bnafar" ]))).toBe(false);
    expect(canSeePendencies(bnafarUser([ "stock_keeper" ], [ "vaccination" ]))).toBe(true);
    expect(canSeePendencies(bnafarUser([ "pharmacy_assistant" ]))).toBe(false);
  });
  it("reenviar: só o admin, com recusados e remessa não perdida (F-23)", () => {
    const rejected = submission({ counts: { accepted: 0, rejected: 2, pending: 0, lost: 0 } });
    expect(canResend(rejected, true)).toBe(true);
    expect(canResend(rejected, false)).toBe(false);
    expect(canResend(submission(), true)).toBe(false);
    expect(canResend({ ...rejected, status: "lost" }, true)).toBe(false);
  });
  it("mapas de domínio", () => {
    expect(DOMAIN_FEATURE).toEqual({ medication: "bnafar_medications", immunobiological: "bnafar_vaccines", vector_control: "bnafar_vector_supplies" });
    expect(KIND_DOMAIN.central).toBe("medication");
    expect(KIND_DOMAIN.unit).toBe("medication");
    expect(KIND_DOMAIN.vaccine_room).toBe("immunobiological");
    expect(KIND_DOMAIN.cold_chain_central).toBe("immunobiological");
    expect(KIND_DOMAIN.vector_control).toBe("vector_control");
  });
});

describe("bnafarFieldsFor (F-11, F-12: só pelo /domains)", () => {
  it("campos exigidos seguem o domínio utilizável do api", () => {
    expect(bnafarFieldsFor([ "medication" ], "central")).toHaveLength(5);
    expect(bnafarFieldsFor([ "medication" ], "unit")).toEqual([ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program", "ampp_code" ]);
    expect(bnafarFieldsFor([ "vector_control" ], "vector_control")).toEqual([ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program" ]);
    expect(bnafarFieldsFor([], "unit")).toEqual([]);
  });
  it("vacina não tem campo de fabricante (Q21)", () => {
    expect(bnafarFieldsFor([ "immunobiological" ], "vaccine_room")).toEqual([ "unit_price_cents", "anvisa_registration", "health_program", "ampp_code" ]);
  });
  it("sem lista (carregando, 403, api antigo) ou com outro domínio ligado: nada exigido", () => {
    expect(bnafarFieldsFor(undefined, "central")).toEqual([]);
    expect(bnafarFieldsFor(null, "central")).toEqual([]);
    expect(bnafarFieldsFor([ "immunobiological" ], "central")).toEqual([]);
    expect(bnafarFieldsFor([ "medication" ], "kind-novo")).toEqual([]);
  });
});

describe("formato", () => {
  it.each([
    [ "12,5", 1250 ], [ "1.234,56", 123456 ], [ " 3 ", 300 ], [ "0,01", 1 ], [ "20.000.000,00", 2000000000 ],
    [ "0,00", null ], [ "12,345", null ], [ "1234.56", null ], [ "1.23,4", null ], [ "-1", null ], [ "", null ], [ "20.000.000,01", null ]
  ])("parseUnitPrice(%j) = %j", (raw, cents) => expect(parseUnitPrice(raw)).toBe(cents));
  it("fmtCents", () => {
    expect(fmtCents(123456)).toBe("1.234,56");
    expect(fmtCents(5)).toBe("0,05");
    expect(fmtCents(100)).toBe("1,00");
    expect(fmtCents(2000000000)).toBe("20.000.000,00");
  });
  it("CNPJ alfanumérico (Q7): pontuação sai, minúscula sobe, DV com letra recusa", () => {
    expect(docOf("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(cnpjProblem("12ABC34501DE35")).toBeNull();
    expect(cnpjProblem("12.abc.345/01de-35")).toBeNull();
    expect(cnpjProblem("12ABC34501DE3X")).not.toBeNull();
    expect(cnpjProblem("1234567890123")).not.toBeNull();
    expect(docOf("12#345")).toBeNull();
  });
  it("ANVISA 11 ou 13 dígitos; CNES 7; CATMAT 1 a 9 dígitos; nome internacional 1 a 120", () => {
    expect(anvisaProblem("12345678901")).toBeNull();
    expect(anvisaProblem("1.2345.678.901-23")).toBeNull();
    expect(anvisaProblem("123456789012")).not.toBeNull();
    expect(cnesProblem("2384299")).toBeNull();
    expect(cnesProblem("23842991")).not.toBeNull();
    expect(cnesProblem("238429A")).not.toBeNull();
    expect(catmatProblem("123456789")).toBeNull();
    expect(catmatProblem("1234567890")).not.toBeNull();
    expect(catmatProblem("0")).not.toBeNull();
    expect(internationalNameProblem("Pharma GmbH")).toBeNull();
    expect(internationalNameProblem("   ")).not.toBeNull();
    expect(internationalNameProblem("x".repeat(120))).toBeNull();
    expect(internationalNameProblem("x".repeat(121))).not.toBeNull();
  });
});

describe("campos BNAFAR do lote", () => {
  const all: BnafarField[] = [ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program", "ampp_code" ];
  const intl = { ...EMPTY_LOT_BNAFAR, unitPrice: "1,00", international: true, internationalName: "Pharma GmbH", anvisa: "12345678901", program: "AF" };
  it("AMPP só com VMP; fabricante internacional sem CNPJ (Q15); corpo só com o preenchido (F-10)", () => {
    expect(lotBnafarProblems(intl, all, { hasVmp: false })).toEqual([]);
    expect(lotBnafarProblems(intl, all, { hasVmp: true }).map((p) => p.field)).toEqual([ "ampp_code" ]);
    expect(lotBnafarBody(intl)).toEqual({
      unit_price_cents: 100, manufacturer_international: true, manufacturer: "Pharma GmbH", anvisa_registration: "12345678901", health_program: "AF"
    });
  });
  it("campo exigido vazio pede; internacional sem nome pede o nome", () => {
    const empty = lotBnafarProblems(EMPTY_LOT_BNAFAR, all, { hasVmp: true });
    expect(empty.map((p) => p.field)).toEqual([ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "health_program", "ampp_code" ]);
    expect(empty[0].text).toMatch(/^informe /);
    expect(lotBnafarProblems({ ...intl, internationalName: "" }, all, { hasVmp: false }).map((p) => p.field)).toEqual([ "manufacturer" ]);
  });
  it("internacional marcado sem o nome é sempre recusado, mesmo sem exigência do domínio (o api exige o nome)", () => {
    expect(lotBnafarProblems({ ...EMPTY_LOT_BNAFAR, international: true }, [], { hasVmp: false }).map((p) => p.field)).toEqual([ "manufacturer" ]);
    expect(lotBnafarProblems({ ...EMPTY_LOT_BNAFAR, international: true, internationalName: "Pharma GmbH" }, [], { hasVmp: false })).toEqual([]);
  });
  it("campo preenchido e inválido recusa, exigido ou não; sem exigência, vazio passa", () => {
    expect(lotBnafarProblems(EMPTY_LOT_BNAFAR, [], { hasVmp: true })).toEqual([]);
    const bad = { ...EMPTY_LOT_BNAFAR, unitPrice: "12,345", cnpj: "123", anvisa: "12", ampp: "AMPP 1" };
    expect(lotBnafarProblems(bad, [], { hasVmp: true }).map((p) => p.field)).toEqual([ "unit_price_cents", "manufacturer_cnpj", "anvisa_registration", "ampp_code" ]);
  });
  it("corpo nacional: CNPJ normalizado, sem a chave do internacional; vazio vira {}", () => {
    const d = { ...EMPTY_LOT_BNAFAR, unitPrice: "1.234,56", cnpj: "11.222.333/0001-81", anvisa: "1234567890123", program: "INSULDEP I", ampp: " AMPP0001 " };
    expect(lotBnafarBody(d)).toEqual({
      unit_price_cents: 123456, manufacturer_cnpj: "11222333000181", anvisa_registration: "1234567890123", health_program: "INSULDEP I", ampp_code: "AMPP0001"
    });
    expect(lotBnafarBody(EMPTY_LOT_BNAFAR)).toEqual({});
  });
  it("missingFields: só os campos conhecidos que o api cita", () => {
    expect(missingFields({ version: 0, missing: FIVE_MISSING })).toEqual(FIVE_MISSING);
    expect(missingFields({ version: 1, missing: [ "ampp_code", "campo_novo" ] })).toEqual([ "ampp_code" ]);
    expect(missingFields(undefined)).toEqual([]);
  });
});

describe("saída externa", () => {
  const lot = (id: string, balance: string): LotBalance => ({
    lot: { id, item: AMOXI, lot_number: id, expires_on: "2027-06-30", manufacturer: null }, balance, in_transit: "0", expiring_soon: false, expired: false
  });
  const base = {
    exitType: "S-D", destinationKind: "cnes" as const, destination: "2384299", reason: "doação à unidade vizinha",
    lines: [ { key: "a", lot: lot("lt1", "3.50"), quantity: "3" } ]
  };
  it("a saída correta não tem problema", () => expect(externalExitProblems(base)).toEqual([]));
  it("quantidade inteira, até a parte inteira do saldo", () => {
    const qty = (q: string) => externalExitProblems({ ...base, lines: [ { key: "a", lot: lot("lt1", "3.50"), quantity: q } ] }).map((p) => p.path);
    expect(qty("3")).toEqual([]);
    expect(qty("4")).toEqual([ "items[0].quantity" ]);
    expect(qty("2,5")).toEqual([ "items[0].quantity" ]);
    expect(qty("0")).toEqual([ "items[0].quantity" ]);
    expect(qty("")).toEqual([ "items[0].quantity" ]);
    expect(qty("100000")).toEqual([ "items[0].quantity" ]);
  });
  it("motivo de 10 a 500 caracteres, destino pelo tipo, tipo escolhido, ao menos uma linha, lote escolhido e não repetido", () => {
    const paths = (o: object) => externalExitProblems({ ...base, ...o }).map((p) => p.path);
    expect(paths({ reason: "123456789" })).toEqual([ "reason" ]);
    expect(paths({ reason: "x".repeat(501) })).toEqual([ "reason" ]);
    expect(paths({ reason: "  123456789  " })).toEqual([ "reason" ]);
    expect(paths({ reason: "x".repeat(500) })).toEqual([]);
    expect(paths({ destination: "23842991" })).toEqual([ "destination_code" ]);
    expect(paths({ destinationKind: "cnpj", destination: "11.222.333/0001-81" })).toEqual([]);
    expect(paths({ destinationKind: "cnpj", destination: "2384299" })).toEqual([ "destination_code" ]);
    expect(paths({ exitType: "" })).toEqual([ "exit_type" ]);
    expect(paths({ lines: [] })).toEqual([ "items" ]);
    expect(paths({ lines: [ { key: "a", lot: null, quantity: "1" } ] })).toEqual([ "items[0].lot_id" ]);
    expect(paths({ lines: [ { key: "a", lot: lot("lt1", "9"), quantity: "1" }, { key: "b", lot: lot("lt1", "9"), quantity: "1" } ] })).toEqual([ "items[1].lot_id" ]);
  });
  it("Q28/Q29: lote bloqueado nunca sai (frase da temperatura); vencido só na devolução ao fornecedor", () => {
    const withLot = (b: LotBalance, exitType: string) => externalExitProblems({ ...base, exitType, lines: [ { key: "a", lot: b, quantity: "1" } ] }, "2026-11-26");
    const blocked = { ...lot("lt1", "9"), blocked: true };
    expect(withLot(blocked, "S-DF")).toEqual([ { path: "items[0].lot_id", text: LOT_BLOCKED_TEXT } ]);
    const expired = { ...lot("lt1", "9"), lot: { ...lot("lt1", "9").lot, expires_on: "2026-11-25" }, expired: true };
    expect(withLot(expired, "S-DF")).toEqual([]);
    expect(withLot(expired, "S-D").map((p) => p.path)).toEqual([ "items[0].lot_id" ]);
    expect(withLot(expired, "S-D")[0].text).toBe(BNAFAR_ERRORS.lot_expired);
    expect(externalExitProblems({ ...base, lines: [ { key: "a", lot: expired, quantity: "1" } ] })).toEqual([]);
    expect(withLot({ ...expired, blocked: true }, "S-D")[0].text).toBe(BNAFAR_ERRORS.lot_expired);
    expect(withLot({ ...expired, blocked: true }, "S-DF")[0].text).toBe(LOT_BLOCKED_TEXT);
  });
  it("lot_blocked na saída usa a frase da temperatura do 27a, em bnafarError e bnafarProblems", () => {
    expect(BNAFAR_ERRORS.lot_blocked).toBe(LOT_BLOCKED_TEXT);
    const err = new ApiError(422, { error: "lot_blocked", problems: [ { path: "items[0].lot_id", error: "lot_blocked" } ] }, "422");
    expect(bnafarError(err)).toBe(LOT_BLOCKED_TEXT);
    expect(bnafarProblems(err)).toEqual([ { path: "items[0].lot_id", text: LOT_BLOCKED_TEXT } ]);
  });
  it("corpo: documento sem pontuação, quantidade número, motivo aparado", () => {
    expect(externalExitBody({ ...base, destinationKind: "cnpj", destination: "11.222.333/0001-81", reason: "  doação à unidade vizinha  " }, "l1")).toEqual({
      location_id: "l1", exit_type: "S-D", destination_kind: "cnpj", destination_code: "11222333000181", reason: "doação à unidade vizinha",
      items: [ { lot_id: "lt1", quantity: 3 } ]
    });
  });
});

describe("rótulos", () => {
  it("assunto, ambiente, remessa; código desconhecido aparece cru", () => {
    expect(subjectLabel("position")).toBe("Posição de estoque");
    expect(subjectLabel("exit")).toBe("Saídas");
    expect(subjectLabel("novo")).toBe("novo");
    expect(environmentLabel("production")).toBe("Produção");
    expect(environmentLabel("homologation")).toBe("Homologação");
    expect(environmentLabel("x")).toBe("x");
    expect([ "building", "queued", "sending", "processing", "finished", "failed", "lost" ].map(submissionStatusLabel)).toEqual([
      "montando", "na fila", "enviando", "em processamento na BNAFAR", "concluída", "falhou", "perdida"
    ]);
    expect(submissionStatusLabel("novo")).toBe("novo");
    expect(submissionStatusTone("finished")).toBe("ok");
    expect(submissionStatusTone("failed")).toBe("down");
    expect(submissionStatusTone("novo")).toBe("neutral");
  });
  it("situação do registro: perdido, excluído, em parte (F-07), recusado, aceito, aguardando", () => {
    expect(recordStatusLabel(record({ status: "accepted", rejected_items: 2 }))).toBe("aceito em parte (2 itens)");
    expect(recordStatusLabel(record({ status: "accepted", rejected_items: 1 }))).toBe("aceito em parte (1 item)");
    expect(recordStatusLabel(record())).toBe("aceito");
    expect(recordStatusLabel(record({ status: "pending" }))).toBe("aguardando");
    expect(recordStatusLabel(record({ status: "rejected" }))).toBe("recusado");
    expect(recordStatusLabel(lostRecord())).toBe("perdido");
    expect(recordStatusLabel(record({ deleted: true }))).toBe("excluído na BNAFAR");
    expect(recordStatusLabel(record({ status: "novo" }))).toBe("novo");
    expect(recordStatusTone(lostRecord())).toBe("down");
    expect(recordStatusTone(record())).toBe("ok");
    expect(recordStatusTone(record({ status: "accepted", rejected_items: 1 }))).toBe("warn");
  });
  it("tipo de saída: do api, senão a tabela da BNAFAR, senão cru", () => {
    expect(exitTypeLabel(BNAFAR_DOMAINS, "S-TR")).toBe("Transferência");
    expect(exitTypeLabel(undefined, "S-TR")).toBe("Remanejamento a outro ente");
    expect(exitTypeLabel(null, "S-DF")).toBe("Devolução ao fornecedor");
    const partial: BnafarDomains = { ...BNAFAR_DOMAINS, exit_types: [] };
    expect(exitTypeLabel(partial, "S-D")).toBe("Doação");
    expect(exitTypeLabel(undefined, "S-X")).toBe("S-X");
  });
});

describe("alerta", () => {
  it("uma linha por condição, sem relógio nem meia-noite (F-23)", () => {
    expect(alertLines({ late: 1, rejected: 1, lost: 0, last_finished_on: "2026-11-24" })).toEqual([
      "1 remessa ainda não concluída pela BNAFAR depois das 15:00 do dia seguinte.",
      "1 registro recusado ainda pode ser corrigido e reenviado hoje."
    ]);
    expect(alertLines({ late: 2, rejected: 3, lost: 1, last_finished_on: null })).toEqual([
      "2 remessas ainda não concluídas pela BNAFAR depois das 15:00 do dia seguinte.",
      "3 registros recusados ainda podem ser corrigidos e reenviados hoje.",
      "1 registro perdido nos últimos 30 dias — veja o motivo na lista."
    ]);
    expect(alertLines({ late: 0, rejected: 0, lost: 4, last_finished_on: null })).toEqual([ "4 registros perdidos nos últimos 30 dias — veja o motivo na lista." ]);
    expect(alertLines({ late: 0, rejected: 0, lost: 0, last_finished_on: null })).toEqual([]);
  });
});

describe("recusas", () => {
  it("feature_disabled escolhe a frase pela chave (F-14)", () => {
    expect(bnafarError(api(403, { error: "feature_disabled", feature: "bnafar" }))).toBe(BNAFAR_DISABLED);
    expect(bnafarError(api(403, { error: "feature_disabled", feature: "bnafar" }), { write: true })).toBe(BNAFAR_NOT_USABLE);
    expect(bnafarError(api(403, { error: "feature_disabled", feature: "pharmacy" }))).toBe(PHARMACY_DISABLED);
    expect(bnafarError(api(403, { error: "feature_disabled", feature: "vaccination" }))).toContain("desligado");
  });
  it("papel e códigos do envio", () => {
    expect(bnafarError(api(403, { error: "missing_role" }))).toBe(BNAFAR_NO_ROLE);
    expect(bnafarError(api(409, { error: "retry_window_closed" }))).toBe(BNAFAR_ERRORS.retry_window_closed);
    expect(bnafarError(api(409, { error: "lot_bnafar_changed" }))).toBe(BNAFAR_ERRORS.lot_bnafar_changed);
    expect(bnafarError(api(422, { error: "ampp_unknown", path: "ampp_code" }))).toBe(BNAFAR_ERRORS.ampp_unknown);
  });
  it("o resto cai nas frases da farmácia; sem conexão tem frase", () => {
    expect(bnafarError(api(422, { error: "invalid_request", path: "ampp_code" }))).toBe("escolha a apresentação (AMPP) do produto");
    expect(bnafarError(new Error("rede"))).toMatch(/sem conexão/);
  });
  it("a tabela do envio vem antes da da farmácia onde o sentido difere (saída externa), e a entrada 27a segue como era", () => {
    const quantity = api(422, { error: "invalid_request", problems: [ { path: "items[0].quantity", error: "invalid_quantity" }, { path: "items[1].lot_id", error: "lot_expired" } ] });
    expect(bnafarProblems(quantity)).toEqual([
      { path: "items[0].quantity", text: BNAFAR_ERRORS.invalid_quantity }, { path: "items[1].lot_id", text: BNAFAR_ERRORS.lot_expired }
    ]);
    expect(bnafarError(api(422, { error: "invalid_quantity", path: "items[0].quantity" }))).toBe(BNAFAR_ERRORS.invalid_quantity);
    expect(bnafarError(api(422, { error: "invalid_quantity", path: "items[0].quantity" }))).not.toContain("casas");
    expect(bnafarError(api(422, { error: "invalid_request", path: "ampp_code" }))).toBe("escolha a apresentação (AMPP) do produto");
    // Entrada do 27a (pharmacyError): a frase antiga continua valendo.
    expect(pharmacyError(api(422, { error: "invalid_quantity", path: "items[0].quantity" }))).toContain("2 casas");
    expect(pharmacyError(api(422, { error: "expired_lot" }))).toBe("lote vencido — escolha outro lote");
  });
  it("isStale: 409 com o código", () => {
    expect(isStale(api(409, { error: "lot_bnafar_changed" }), "lot_bnafar_changed")).toBe(true);
    expect(isStale(api(409, { error: "external_exit_changed" }), "lot_bnafar_changed")).toBe(false);
    expect(isStale(api(422, { error: "lot_bnafar_changed" }), "lot_bnafar_changed")).toBe(false);
    expect(isStale(new Error("x"), "lot_bnafar_changed")).toBe(false);
  });
});
