import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  FILE_EMPTY, FILE_TYPE, TFD_DISABLED, accountabilityFileProblem, allowanceTotal, appointmentProblems, canEditCase, canRequestTfd, canUseTfd, caseBody,
  decisionLabel, decisionProblems, fleetLegDate, inpatientProblems, legBody, legProblems, paidTotal, paymentBody, paymentProblems,
  reportDraftFrom, reportProblems, tfdError, tfdRefusals, tfdRoles, tfdStatusLabel, tfdStatusTone
} from "./tfd";
import { DEST_CURITIBA, DEST_METRO, DEST_NEAR, NOW30, TODAY30, tfdCase, tfdLeg, trUser } from "../test/transportFixtures";

const codes = (list: { path: string }[]) => list.map((p) => p.path);
const OPTIONS = { destinations: [ DEST_CURITIBA, DEST_NEAR, DEST_METRO ], providers: [], min_distance_km: 50 };
const report = { sigtapCode: "0405050372", cid10: "H25.1", justification: "Sem oftalmologia cirúrgica no município.", companionIndicated: false,
  companionReason: "", transportMode: "fleet", destinationId: "t1", providerId: "" };
const refused = (status: number, body: unknown) => new ApiError(status, body as never, String(status));
const ticket = { direction: "outbound", mode: "bus_ticket", date: "2026-11-20", tripPassengerId: "", amount: "85,00", carrier: "Viação Graciosa", companion: false } as const;

describe("portão do TFD", () => {
  it("exige tfd, sanitary_transport e clinical_record", () => {
    expect(canUseTfd(trUser([ "tfd_committee" ]))).toBe(true);
    expect(canUseTfd(trUser([ "tfd_committee" ], [ "tfd", "clinical_record" ]))).toBe(false);
    expect(canUseTfd(trUser([ "tfd_committee" ], [ "tfd", "sanitary_transport" ]))).toBe(false);
    expect(canUseTfd(trUser([ "tfd_committee" ], [ "sanitary_transport", "clinical_record" ]))).toBe(false);
  });
  it("pedir TFD: médico (CBO 225*) com health_professional", () => {
    expect(canRequestTfd(trUser([ "health_professional" ]), "225125")).toBe(true);
    expect(canRequestTfd(trUser([ "health_professional" ]), "223505")).toBe(false);
    expect(canRequestTfd(trUser([ "tfd_committee" ]), "225125")).toBe(false);
    expect(canRequestTfd(trUser([ "health_professional" ]), null)).toBe(false);
    expect(canRequestTfd(trUser([ "health_professional" ], [ "tfd" ]), "225125")).toBe(false);
  });
  it("papéis", () => {
    expect(tfdRoles(trUser([ "tfd_committee", "municipal_admin" ]))).toEqual({ committee: true, professional: false, admin: true });
  });
});

describe("laudo", () => {
  it("completo passa", () => { expect(reportProblems(report, OPTIONS)).toEqual([]); });
  it("menos de 50 km e região metropolitana recusam antes de enviar", () => {
    expect(reportProblems({ ...report, destinationId: "t2" }, OPTIONS).map((p) => p.text)).toEqual([ "destino a menos de 50 km da sede — não cabe TFD" ]);
    expect(reportProblems({ ...report, destinationId: "t3" }, OPTIONS).map((p) => p.text)).toEqual([ "destino na mesma região metropolitana — não cabe TFD" ]);
    expect(reportProblems({ ...report, destinationId: "t2" }, { ...OPTIONS, min_distance_km: 25 })).toEqual([]);
  });
  it("CID, justificativa, procedimento e motivo do acompanhante (só confere se houver texto)", () => {
    expect(codes(reportProblems({ ...report, cid10: "", justification: "curta", sigtapCode: "", companionIndicated: true }, OPTIONS)))
      .toEqual([ "report.sigtap_code", "report.cid10", "report.justification" ]);
    expect(codes(reportProblems({ ...report, companionIndicated: true, companionReason: "curto" }, OPTIONS))).toEqual([ "report.companion_reason" ]);
    expect(reportProblems({ ...report, companionIndicated: true, companionReason: "paciente idoso, não anda só" }, OPTIONS)).toEqual([]);
  });
  it("sem destino escolhido recusa no destino", () => {
    expect(codes(reportProblems({ ...report, destinationId: "" }, OPTIONS))).toEqual([ "destination_id" ]);
  });
  it("rascunho vem do pré-preenchimento ou do processo devolvido", () => {
    expect(reportDraftFrom({ patient_id: "pt1", cid10: "H25.1", sigtap_code: "0405050372" })).toMatchObject({ cid10: "H25.1", sigtapCode: "0405050372", justification: "" });
    expect(reportDraftFrom(null)).toMatchObject({ sigtapCode: "", cid10: "", companionIndicated: false });
    const d = reportDraftFrom(null, tfdCase({ status: "returned" }));
    expect(d).toMatchObject({ sigtapCode: "0405050372", destinationId: "t1", providerId: "cp1", transportMode: "fleet" });
  });
  it("o corpo leva só as chaves do contrato e reenvia o prestador", () => {
    const body = caseBody({ ...report, providerId: "cp1", cid10: " h25.1 " }, { patientId: "pt1", consultationId: "co1" });
    expect(body).toEqual({ patient_id: "pt1", consultation_id: "co1", destination_id: "t1", provider_id: "cp1",
      report: { sigtap_code: "0405050372", cid10: "H25.1", justification: "Sem oftalmologia cirúrgica no município.", companion_indicated: false,
        companion_reason: null, transport_mode: "fleet" } });
    expect(Object.keys(caseBody(report, { patientId: "pt1", regulationRequestId: "r1" })).sort())
      .toEqual([ "destination_id", "patient_id", "regulation_request_id", "report" ]);
  });
  it("editar: só rascunho ou devolvido", () => {
    expect(canEditCase(tfdCase({ status: "draft" }))).toBe(true);
    expect(canEditCase(tfdCase({ status: "returned" }))).toBe(true);
    expect(canEditCase(tfdCase({ status: "submitted" }))).toBe(false);
  });
});

describe("decisão (Review Focus 4)", () => {
  const ok = "laudo completo e destino confirmado";
  it("autorizar sem atendimento marcado recusa; devolver e recusar não exigem", () => {
    expect(decisionProblems("authorize", ok, tfdCase(), NOW30).map((p) => p.text)).toEqual([ "marque o atendimento no destino antes de autorizar" ]);
    expect(decisionProblems("authorize", ok, tfdCase({ appointment_at: "2026-11-20T08:00:00-03:00" }), NOW30)).toEqual([]);
    expect(decisionProblems("return", "falta o exame de vista", tfdCase(), NOW30)).toEqual([]);
    expect(codes(decisionProblems("deny", "curto", tfdCase(), NOW30))).toEqual([ "reason" ]);
  });
  it("autorizar com atendimento já passado também recusa (o api trata como ausente)", () => {
    expect(codes(decisionProblems("authorize", ok, tfdCase({ appointment_at: "2026-11-02T08:00:00-03:00" }), NOW30))).toEqual([ "appointment_at" ]);
  });
  it("motivo tem no máximo 500 caracteres", () => {
    expect(codes(decisionProblems("return", "x".repeat(501), tfdCase(), NOW30))).toEqual([ "reason" ]);
  });
  it("atendimento: futuro e até 365 dias", () => {
    expect(codes(appointmentProblems("2026-11-02T08:00", NOW30))).toEqual([ "appointment_at" ]);
    expect(appointmentProblems("2026-11-20T08:00", NOW30)).toEqual([]);
    expect(codes(appointmentProblems("2027-12-20T08:00", NOW30))).toEqual([ "appointment_at" ]);
    expect(appointmentProblems("", NOW30)[0].text).toBe("informe data e hora");
  });
  it("internação: início até hoje; fim não antes do início nem depois de hoje", () => {
    expect(inpatientProblems("2026-11-01", "", TODAY30)).toEqual([]);
    expect(codes(inpatientProblems("", "", TODAY30))).toEqual([ "from" ]);
    expect(codes(inpatientProblems("2026-11-04", "", TODAY30))).toEqual([ "from" ]);
    expect(codes(inpatientProblems("2026-11-02", "2026-11-01", TODAY30))).toEqual([ "to" ]);
    expect(codes(inpatientProblems("2026-11-02", "2026-11-04", TODAY30))).toEqual([ "to" ]);
  });
});

describe("trechos, pagamento e arquivo", () => {
  const authorized = tfdCase({ status: "authorized", appointment_at: "2026-11-20T08:00:00-03:00" });
  it("frota exige o passageiro da viagem; passagem exige valor e empresa", () => {
    expect(codes(legProblems({ direction: "outbound", mode: "fleet", date: "2026-11-20", tripPassengerId: "", amount: "", carrier: "", companion: false }, authorized))).toEqual([ "trip_passenger_id" ]);
    expect(codes(legProblems({ direction: "outbound", mode: "bus_ticket", date: "2026-11-20", tripPassengerId: "", amount: "", carrier: "", companion: false }, authorized))).toEqual([ "ticket.amount_cents", "ticket.carrier" ]);
    expect(legProblems(ticket, authorized)).toEqual([]);
  });
  it("frota na ida: a data é a da viagem do passageiro", () => {
    const c = tfdCase({ status: "authorized", trip_passengers: [ { id: "tp1", date: "2026-11-20", departure_at: "2026-11-20T05:00:00-03:00", attendance: "pending", companion_attendance: null } ] });
    expect(fleetLegDate(c, "tp1")).toBe("2026-11-20");
    expect(fleetLegDate(c, "x")).toBeNull();
    const d = { ...ticket, mode: "fleet", tripPassengerId: "tp1", amount: "", carrier: "" } as const;
    expect(legProblems(d, c)).toEqual([]);
    expect(codes(legProblems({ ...d, date: "2026-11-21" }, c))).toEqual([ "date" ]);
  });
  it("volta: precisa de ida em aberto e não pode ser antes da ida", () => {
    const back = { ...ticket, direction: "return", date: "2026-11-22" } as const;
    expect(codes(legProblems(back, authorized))).toEqual([ "direction" ]);
    const withOut = tfdCase({ status: "scheduled", legs: [ tfdLeg({ date: "2026-11-20" }) ] });
    expect(legProblems(back, withOut)).toEqual([]);
    expect(codes(legProblems({ ...back, date: "2026-11-19" }, withOut))).toEqual([ "date" ]);
    const voidedOut = tfdCase({ status: "scheduled", legs: [ tfdLeg({ date: "2026-11-20", voided: true }) ] });
    expect(codes(legProblems(back, voidedOut))).toEqual([ "direction" ]);
  });
  it("acompanhante só em passagem e só se o laudo indicou", () => {
    expect(codes(legProblems({ ...ticket, companion: true }, authorized))).toEqual([ "companion" ]);
    const withCompanion = tfdCase({ status: "authorized", report: { ...tfdCase().report, companion_indicated: true } });
    expect(legProblems({ ...ticket, companion: true }, withCompanion)).toEqual([]);
  });
  it("corpo do trecho: frota sem ticket; passagem em centavos", () => {
    expect(legBody({ ...ticket, mode: "fleet", tripPassengerId: "tp1", amount: "", carrier: "" })).toEqual({ direction: "outbound", mode: "fleet", date: "2026-11-20", trip_passenger_id: "tp1" });
    expect(legBody({ ...ticket, amount: "1.234,56", companion: true })).toEqual({ direction: "outbound", mode: "bus_ticket", date: "2026-11-20",
      ticket: { amount_cents: 123456, carrier: "Viação Graciosa" }, companion: true });
    expect(legBody(ticket)).not.toHaveProperty("companion");
  });
  it("pagamento: data futura, valor e recibo", () => {
    expect(codes(paymentProblems({ paidOn: "2026-11-04", amount: "0", method: "pix", receiptNumber: "" }, TODAY30))).toEqual([ "paid_on", "amount_cents", "receipt_number" ]);
    expect(paymentProblems({ paidOn: TODAY30, amount: "1.234,56", method: "pix", receiptNumber: "R-77" }, TODAY30)).toEqual([]);
  });
  it("pagamento: não mais de 365 dias atrás, recibo até 40, forma conhecida", () => {
    expect(codes(paymentProblems({ paidOn: "2025-11-02", amount: "10", method: "pix", receiptNumber: "R" }, TODAY30))).toEqual([ "paid_on" ]);
    expect(paymentProblems({ paidOn: "2025-11-03", amount: "10", method: "pix", receiptNumber: "R" }, TODAY30)).toEqual([]);
    expect(codes(paymentProblems({ paidOn: TODAY30, amount: "10", method: "pix", receiptNumber: "x".repeat(41) }, TODAY30))).toEqual([ "receipt_number" ]);
    expect(codes(paymentProblems({ paidOn: TODAY30, amount: "10", method: "boleto", receiptNumber: "R" }, TODAY30))).toEqual([ "method" ]);
    expect(codes(paymentProblems({ paidOn: TODAY30, amount: "100.000,01", method: "pix", receiptNumber: "R" }, TODAY30))).toEqual([ "amount_cents" ]);
  });
  it("corpo do pagamento em centavos", () => {
    expect(paymentBody({ paidOn: TODAY30, amount: "1.234,56", method: "pix", receiptNumber: " R-77 " }))
      .toEqual({ paid_on: TODAY30, amount_cents: 123456, method: "pix", receipt_number: "R-77" });
  });
  it("arquivo: 10 MB (antes do tipo) e tipo", () => {
    const big = new File([ new Uint8Array(10 * 1024 * 1024 + 1) ], "a.pdf", { type: "application/pdf" });
    const bigDoc = new File([ new Uint8Array(10 * 1024 * 1024 + 1) ], "a.docx", { type: "application/msword" });
    const doc = new File([ "x" ], "a.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const png = new File([ "x" ], "a.png", { type: "image/png" });
    const jpeg = new File([ "x" ], "a.jpg", { type: "image/jpeg" });
    expect(accountabilityFileProblem(big)).toBe("o comprovante passa de 10 MB");
    expect(accountabilityFileProblem(bigDoc)).toBe("o comprovante passa de 10 MB");
    expect(accountabilityFileProblem(doc)).toBe(FILE_TYPE);
    expect(accountabilityFileProblem(png)).toBeNull();
    expect(accountabilityFileProblem(new File([], "v.pdf", { type: "application/pdf" }))).toBe(FILE_EMPTY);
    expect(accountabilityFileProblem(new File([ new Uint8Array(10 * 1024 * 1024) ], "ok.pdf", { type: "application/pdf" }))).toBeNull();
    expect(accountabilityFileProblem(jpeg)).toBeNull();
  });
  it("totais", () => {
    const a = (id: string, total: number) => ({ id, person: "patient", kind: "meal_day", sigtap_code: "x", quantity: 1, table_cents: 840, complement_cents: 0, total_cents: total });
    expect(allowanceTotal([ a("a", 1840), a("b", 840) ])).toBe(2680);
    expect(allowanceTotal([])).toBe(0);
    expect(paidTotal([ { id: "p", paid_on: TODAY30, amount_cents: 1000, method: "pix", receipt_number: "1", by_name: "x" },
      { id: "q", paid_on: TODAY30, amount_cents: 500, method: "cash", receipt_number: "2", by_name: "x" } ])).toBe(1500);
  });
});

describe("rótulos", () => {
  it("situação e código cru", () => {
    expect(tfdStatusLabel("returned")).toBe("devolvido para complementar");
    expect(tfdStatusLabel("x_novo")).toBe("x_novo");
    expect(tfdStatusTone("authorized")).toBe("ok");
    expect(tfdStatusTone("x_novo")).toBe("neutral");
    expect(decisionLabel("return")).toBe("Devolver para complementar");
    expect(decisionLabel("novo")).toBe("novo");
  });
});

describe("recusas", () => {
  it("recusas do envio do laudo, todas", () => {
    const err = refused(422, { error: "invalid", problems: [ { path: "destination_id", error: "distance_below_minimum" }, { path: "report.sigtap_code", error: "primary_care_procedure" } ] });
    expect(tfdRefusals(err).map((r) => r.text)).toEqual([ "destino a menos da distância mínima da cidade — não cabe TFD", "procedimento da atenção básica — não cabe TFD" ]);
  });
  it("cobre os códigos que o api manda, sem cair no cru", () => {
    const sent = [ "distance_below_minimum", "metropolitan_destination", "primary_care_procedure", "cid_required", "justification_required", "invalid_sigtap_code",
      "invalid_cid10", "appointment_required", "billing_unit_missing", "invalid_transition", "inpatient_open", "inpatient_overlap", "no_outbound_leg",
      "fleet_leg_by_trip", "tfd_leg_done", "leg_in_future", "legs_pending", "receipt_taken", "invalid_file", "cbo_not_allowed", "companion_not_allowed",
      "invalid_cursor", "link_expired", "missing_role", "not_found", "mfa_required" ];
    for (const code of sent) {
      const [ r ] = tfdRefusals(refused(422, { error: code }));
      expect(r.code).toBe(code);
      expect(r.text, code).not.toContain("recusado pelo servidor");
      expect(r.text, code).not.toBe(code);
    }
  });
  it("códigos que o api nunca manda aparecem crus", () => {
    for (const code of [ "not_author", "trip_passenger_mismatch", "file_too_large", "invalid_file_type" ]) {
      expect(tfdRefusals(refused(422, { error: code }))[0].text).toBe(`recusado pelo servidor (${code})`);
    }
  });
  it("desligado: tfd e os pré-requisitos", () => {
    expect(tfdError(refused(403, { error: "feature_disabled", feature: "tfd" }))).toBe(TFD_DISABLED);
    expect(tfdError(refused(403, { error: "feature_disabled" }))).toBe(TFD_DISABLED);
    expect(tfdError(refused(403, { error: "feature_disabled", feature: "clinical_record" }))).toContain("desligado nesta cidade");
  });
  it("pedido inválido depende do caminho", () => {
    const text = (path: string) => tfdRefusals(refused(422, { error: "invalid_request", path }))[0].text;
    expect(text("appointment_at")).toContain("365");
    expect(text("consultation_id")).toContain("consulta");
    expect(text("reason")).toBe("o motivo tem de 10 a 500 caracteres");
    expect(text("report.justification")).toContain("20 a 2000");
    expect(text("report.companion_reason")).toContain("acompanhante");
    for (const p of [ "report.transport_mode", "direction", "mode", "method", "content_type" ]) expect(text(p), p).not.toContain("pedido inválido");
    expect(text("alguma.coisa")).toContain("pedido inválido");
  });
  it("sem conexão", () => { expect(tfdError(new Error("x"))).toBe("sem conexão com o servidor — tente de novo"); });
});
