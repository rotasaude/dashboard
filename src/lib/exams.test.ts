// src/lib/exams.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  EMPTY_GUIDE, EXAMS_DISABLED, PDF_LINK_EXPIRED, cnesProblem, cpfTail, deadlineDraft, deadlinesFrom, deadlinesProblem, deadlinesSummary,
  effectiveDeadline, emptyResultDraft, ESCALATION_LABEL, escalationLabel, escalationReasonsText, criticalFromTrail, eventLabel, examActions, examError, examRoles, examStatusLabel, fmtDay,
  guideBody, guideProblem, mergeById, overdueLabel, pdfLinkExpired, pendingCountText, pendingNoticeText, providerCanSchedule, reasonProblem, resultBody, resultFieldsProblem,
  resultProblem, scheduleBody, scheduleProblem, scheduleWhen, sigtapProblem, uploadProblem, canUseExams
} from "./exams";
import { VALID_CNS, examOrder, examResult } from "../test/examFixtures";

const NONE = { professional: false, reception: false, regulator: false, admin: false, provider: false };

describe("rótulos", () => {
  it("situação conhecida em português; desconhecida crua", () => {
    expect(examStatusLabel("awaiting_schedule")).toBe("a agendar");
    expect(examStatusLabel("resulted")).toBe("resultado registrado");
    expect(examStatusLabel("archived")).toBe("archived");
    expect(eventLabel("escalated")).toBe("enviado à equipe");
    expect(eventLabel("rerouted")).toBe("rerouted");
  });

  it("atraso, dia e o final do CPF", () => {
    expect(overdueLabel(null)).toBe("no prazo");
    expect(overdueLabel({ stage: "collect", due_on: "2026-10-10", days_late: 1 })).toBe("coleta · 1 dia de atraso");
    expect(overdueLabel({ stage: "acknowledge", due_on: "2026-10-01", days_late: 12 })).toBe("ciência · 12 dias de atraso");
    expect(fmtDay("2026-10-13")).toBe("13/10/2026");
    expect(fmtDay(null)).toBe("—");
    expect(cpfTail("725")).toBe("CPF final 725");
  });

  it("aviso do Início no singular e no plural", () => {
    expect(pendingNoticeText(0, 0)).toBe("");
    expect(pendingNoticeText(1, 0)).toBe("1 resultado aguardando sua ciência");
    expect(pendingNoticeText(3, 2)).toBe("3 resultados aguardando sua ciência · 2 exames negados");
    expect(pendingNoticeText(0, 1)).toBe("1 exame negado");
    expect(pendingNoticeText(50, 0, true)).toBe("50+ resultados aguardando sua ciência");
  });

  it("contador de ciência: 50+ quando há mais páginas", () => {
    expect(pendingCountText(7, false)).toBe("7");
    expect(pendingCountText(50, true)).toBe("50+");
  });
});

describe("papéis e botões", () => {
  it("papéis da sessão; operador não tem nenhum", () => {
    const user = { operator: false, memberships: [ { role: "citizen_verifier" }, { role: "exam_regulator" } ] };
    expect(examRoles(user)).toEqual({ ...NONE, reception: true, regulator: true });
    expect(examRoles({ operator: true, memberships: [ { role: "municipal_admin" } ] })).toEqual(NONE);
    expect(examRoles(null)).toEqual(NONE);
    expect(canUseExams({ operator: false, features: [ "exam_tracking" ] })).toBe(true);
    expect(canUseExams({ operator: false, features: [] })).toBe(false);
    expect(canUseExams({ operator: true, features: [ "exam_tracking" ] })).toBe(false);
  });

  it("unidade agenda, coleta e registra resultado conforme a situação", () => {
    const reception = { ...NONE, reception: true };
    expect(examActions(examOrder({ status: "awaiting_schedule" }), reception, "us9")).toMatchObject({ schedule: true, collect: false, result: false, cancel: true });
    expect(examActions(examOrder({ status: "scheduled" }), reception, "us9")).toMatchObject({ schedule: true, collect: true, result: true });
    expect(examActions(examOrder({ status: "collected" }), reception, "us9").schedule).toBe(false);
    expect(examActions(examOrder({ status: "collected" }), reception, "us9")).toMatchObject({ collect: false, result: true, cancel: true });
    expect(examActions(examOrder({ status: "resulted", result: examResult() }), reception, "us9")).toMatchObject({ result: false, cancel: false, acknowledge: false });
  });

  it("ciência: quem pediu sem motivo; a equipe só no escalado e com motivo; ninguém mais", () => {
    const pro = { ...NONE, professional: true };
    const resulted = examOrder({ status: "resulted", result: examResult() });
    expect(examActions(resulted, pro, "us1")).toMatchObject({ acknowledge: true, acknowledgeNeedsReason: false });
    expect(examActions(resulted, pro, "us2")).toMatchObject({ acknowledge: false });
    expect(examActions({ ...resulted, escalated: true }, pro, "us2")).toMatchObject({ acknowledge: true, acknowledgeNeedsReason: true });
    expect(examActions({ ...resulted, escalated: true }, { ...NONE, reception: true }, "us2")).toMatchObject({ acknowledge: false });
  });

  it("administrador municipal não é da unidade (C4): nenhum botão da unidade", () => {
    const admin = { ...NONE, admin: true };
    for (const status of [ "awaiting_schedule", "scheduled", "collected" ]) {
      expect(examActions(examOrder({ status }), admin, "us9")).toMatchObject({ schedule: false, collect: false, result: false, cancel: false });
    }
  });

  it("portal do prestador reagenda o agendado, não o já coletado", () => {
    expect(providerCanSchedule("awaiting_schedule")).toBe(true);
    expect(providerCanSchedule("scheduled")).toBe(true);
    expect(providerCanSchedule("collected")).toBe(false);
  });

  it("cancelar: quem pediu ou a recepção, só antes do resultado", () => {
    const pro = { ...NONE, professional: true };
    expect(examActions(examOrder({ status: "awaiting_authorization" }), pro, "us1").cancel).toBe(true);
    expect(examActions(examOrder({ status: "awaiting_authorization" }), pro, "us2").cancel).toBe(false);
    expect(examActions(examOrder({ status: "denied" }), { ...NONE, admin: true }, "us2").cancel).toBe(false);
  });

  // B63: o motivo é o gravado pelo api, nunca deduzido do resultado vigente.
  it("motivos do escalonamento: os gravados, na ordem", () => {
    expect(escalationReasonsText(examOrder({ escalated: true, escalation_reasons: [ "critical" ], result: examResult({ critical: false }) }))).toBe("resultado crítico");
    expect(escalationReasonsText(examOrder({ escalated: true, escalation_reasons: [ "overdue", "critical" ] }))).toBe("prazo de ciência vencido · resultado crítico");
    expect(escalationReasonsText(examOrder({ escalated: true, escalation_reasons: [ "unlinked_requester" ] }))).toBe("solicitante sem vínculo");
    expect(escalationReasonsText(examOrder({ escalated: true, escalation_reasons: null, result: examResult({ critical: true }) }))).toBe("—");
    expect(ESCALATION_LABEL.overdue).toBe("prazo de ciência vencido");
    expect(escalationLabel("critical")).toBe("resultado crítico");
    expect(escalationLabel("outro_codigo")).toBe("outro_codigo");
    expect(escalationLabel(null)).toBe("—");
  });
});

describe("validação", () => {
  it("arquivo: tipo, tamanho e vazio", () => {
    expect(uploadProblem(null)).toBe("escolha um arquivo");
    expect(uploadProblem({ size: 10, type: "application/msword" })).toBe("envie PDF, JPEG ou PNG");
    expect(uploadProblem({ size: 12 * 1024 * 1024, type: "image/jpeg" })).toBe("o arquivo passa de 10 MB");
    expect(uploadProblem({ size: 0, type: "application/pdf" })).toBe("o arquivo está vazio");
    expect(uploadProblem({ size: 2048, type: "image/png" })).toBeNull();
  });

  it("motivo com ao menos 5 caracteres", () => {
    expect(reasonProblem("  ok ")).toBe("escreva o motivo (ao menos 5 caracteres)");
    expect(reasonProblem("Paciente avisado")).toBeNull();
  });

  it("prazos: branco = herda; inteiro de 1 a 365", () => {
    const d = deadlineDraft({ authorize: null, schedule: 7, collect: null, result: 10, acknowledge: null });
    expect(d).toEqual({ authorize: "", schedule: "7", collect: "", result: "10", acknowledge: "" });
    expect(deadlinesProblem(d)).toBeNull();
    expect(deadlinesProblem({ ...d, collect: "0" })).toBe("prazo de coleta: use dias inteiros de 1 a 365, ou deixe em branco");
    expect(deadlinesProblem({ ...d, result: "2.5" })).toBe("prazo de resultado: use dias inteiros de 1 a 365, ou deixe em branco");
    expect(deadlinesFrom({ ...d, collect: " 20 " })).toEqual({ authorize: null, schedule: 7, collect: 20, result: 10, acknowledge: null });
  });

  it("prazo herdado: prestador, catálogo, plataforma; urgente usa a metade para cima", () => {
    const catalog = { authorize: null, schedule: null, collect: null, result: 10, acknowledge: null };
    const provider = { authorize: null, schedule: null, collect: null, result: 5, acknowledge: null };
    expect(effectiveDeadline("result", provider, catalog)).toBe(5);
    expect(effectiveDeadline("result", null, catalog)).toBe(10);
    expect(effectiveDeadline("authorize", null, catalog)).toBe(15);
    expect(effectiveDeadline("authorize", null, catalog, "urgent")).toBe(8);
    expect(deadlinesSummary(catalog)).toBe("15 · 15 · 30 · 10 · 15");
  });

  it("campos de resultado: chave, repetição, nome e LOINC", () => {
    const ok = [ { key: "hemoglobina", label: "Hemoglobina", unit: "g/dL", loinc: "718-7" } ];
    expect(resultFieldsProblem(ok)).toBeNull();
    expect(resultFieldsProblem([ { ...ok[0], key: "Hemoglobina" } ])).toBe("campo 1: a chave usa letras minúsculas, números e _ (ex.: hemoglobina)");
    expect(resultFieldsProblem([ ...ok, { ...ok[0], label: "Hb" } ])).toBe("campo 2: a chave hemoglobina repete");
    expect(resultFieldsProblem([ { ...ok[0], label: " " } ])).toBe("campo 1: informe o nome");
    expect(resultFieldsProblem([ { ...ok[0], loinc: "7187" } ])).toBe("campo 1: LOINC no formato 718-7");
  });

  it("SIGTAP e CNES", () => {
    expect(sigtapProblem("0202020380")).toBeNull();
    expect(sigtapProblem("02.02.02.038-0")).toBe("o código SIGTAP tem 10 dígitos");
    expect(cnesProblem("")).toBeNull();
    expect(cnesProblem("1234567")).toBeNull();
    expect(cnesProblem("123")).toBe("o CNES tem 7 dígitos");
  });

  it("resultado: anexo, data não futura, laboratório; valores vazios ficam fora", () => {
    const d = { ...emptyResultDraft("2026-10-13"), laboratoryName: "Lab" };
    expect(d.releasedOn).toBe("2026-10-13");
    expect(resultProblem(d, "2026-10-13")).toBe("anexe o laudo");
    const full = { ...d, uploadId: "up1", values: { hemoglobina: " 13.5 ", leucocitos: "" } };
    expect(resultProblem({ ...full, releasedOn: "2026-10-14" }, "2026-10-13")).toBe("a data de liberação não pode ser no futuro");
    expect(resultProblem({ ...full, laboratoryName: " " }, "2026-10-13")).toBe("informe o laboratório");
    expect(resultProblem(full, "2026-10-13")).toBeNull();
    expect(resultBody({ ...full, critical: true })).toEqual({
      upload_id: "up1", released_on: "2026-10-13", laboratory_name: "Lab", critical: true, values: [ { key: "hemoglobina", value: "13.5" } ]
    });
  });

  it("agendamento: prestador quando falta, data e hora da cidade e local", () => {
    const d = { providerId: "", at: "2026-10-20T08:30", place: " Posto de coleta " };
    expect(scheduleProblem(d, true)).toBe("escolha o prestador");
    expect(scheduleProblem(d, false)).toBeNull();
    expect(scheduleProblem({ ...d, at: "" }, false)).toBe("informe data e hora");
    expect(scheduleProblem({ ...d, place: "" }, false)).toBe("informe o local");
    expect(scheduleWhen(d)).toEqual({ scheduled_at: "2026-10-20T08:30:00-03:00", scheduled_place: "Posto de coleta" });
    expect(scheduleBody({ ...d, providerId: "pv2" })).toMatchObject({ provider_id: "pv2" });
    expect(scheduleBody(d, "pv1")).toMatchObject({ provider_id: "pv1" });
  });

  it("guia: exame, CID-10, solicitante e anexo; corpo com solicitante digitado ou da rede", () => {
    expect(guideProblem(EMPTY_GUIDE)).toBe("escolha o exame");
    const base = { ...EMPTY_GUIDE, sigtapCode: "0202020380", guideUploadId: "up1" };
    expect(guideProblem({ ...base, cid10: "xx" })).toBe("use um código CID-10, ex.: E11 ou E119");
    expect(guideProblem(base)).toBe("escolha o profissional que pediu");
    expect(guideProblem({ ...base, requesterMode: "typed", requesterName: "Dr. Externo", requesterCns: "123" })).toBe("CNS de quem pediu inválido");
    expect(guideProblem({ ...base, requesterId: "us1", guideUploadId: null })).toBe("anexe a foto ou o PDF da guia");
    expect(guideBody({ ...base, requesterId: "us1", cid10: "e11.9", priority: "urgent" }, "pa1", "u1")).toEqual({
      patient_id: "pa1", unit_id: "u1", sigtap_code: "0202020380", priority: "urgent", cid10_justification: "E119",
      requester: { user_id: "us1" }, guide_upload_id: "up1"
    });
    expect(guideBody({ ...base, requesterMode: "typed", requesterName: " Dr. Externo ", requesterCns: VALID_CNS, externalReference: " G-77 " }, "pa1", "u1"))
      .toEqual({ patient_id: "pa1", unit_id: "u1", sigtap_code: "0202020380", priority: "routine", requester: { name: "Dr. Externo", cns: VALID_CNS },
        external_reference: "G-77", guide_upload_id: "up1" });
  });
});

describe("páginas e recusas", () => {
  it("mergeById: junta sem repetir, vale a primeira", () => {
    const a = examOrder({ id: "a" });
    const b = examOrder({ id: "b" });
    expect(mergeById([ { orders: [ a, b ] }, { orders: [ { ...b, status: "scheduled" } ] } ]).map((o) => [ o.id, o.status ]))
      .toEqual([ [ "a", "awaiting_schedule" ], [ "b", "awaiting_schedule" ] ]);
  });

  it("frases das recusas", () => {
    expect(examError(new ApiError(403, { error: "feature_disabled", feature: "exam_tracking" }, "x"))).toBe(EXAMS_DISABLED);
    expect(examError(new ApiError(409, { error: "invalid_transition", status: "scheduled" }, "x"))).toBe("a situação do exame mudou — atualize para ver a atual");
    expect(examError(new ApiError(422, { error: "provider_not_enabled_for_exam" }, "x"))).toBe("este prestador não faz este exame — escolha outro ou habilite-o no cadastro");
    expect(examError(new ApiError(422, { error: "invalid_file" }, "x"))).toBe("arquivo inválido — envie PDF, JPEG ou PNG de até 10 MB");
    expect(examError(new ApiError(404, { error: "patient_not_found" }, "x"))).toBe("nenhum paciente com este CPF na cidade");
    expect(examError(new ApiError(500, "", "x"))).toBe("não foi possível concluir (500) — tente de novo");
    expect(examError(new TypeError("fetch failed"))).toBe("sem conexão com o servidor — tente de novo");
  });

  it("frases dos códigos do api (C6)", () => {
    const msg = (status: number, error: string) => examError(new ApiError(status, { error }, "x"));
    for (const code of [
      "invalid_policy", "invalid_result_fields", "invalid_active", "invalid_requires_authorization", "missing_pdf", "invalid_values",
      "invalid_released_on", "invalid_laboratory", "invalid_critical", "invalid_schedule", "invalid_requester", "invalid_cid10",
      "reason_too_long", "invalid_filter", "invalid_cursor", "filter_required", "not_unit_staff", "not_in_team", "citizen_not_verified",
      "sigtap_not_in_catalog", "too_many_requests", "already_acknowledged", "invalid_external_reference", "invalid_priority", "invalid_month"
    ]) {
      expect(msg(422, code), code).not.toMatch(/^não foi possível concluir|código/);
    }
    expect(msg(429, "too_many_requests")).toBe("muitas tentativas seguidas — espere um minuto e tente de novo");
    expect(msg(403, "not_unit_staff")).toBe("você não atua nesta unidade");
    expect(msg(422, "estranho_novo")).toBe("não foi possível concluir (422: estranho_novo) — tente de novo");
    expect(examError(new ApiError(403, { error: "feature_disabled", feature: "fake_lab" }, "x"))).toBe("o laboratório simulado está desligado nesta cidade");
  });

  it("link do laudo vencido: só 410 link_expired (C9)", () => {
    expect(pdfLinkExpired(new ApiError(410, { error: "link_expired" }, "x"))).toBe(true);
    expect(pdfLinkExpired(new ApiError(410, "", "x"))).toBe(false);
    expect(pdfLinkExpired(new ApiError(403, "", "x"))).toBe(false);
    expect(pdfLinkExpired(new ApiError(403, { error: "feature_disabled", feature: "exam_tracking" }, "x"))).toBe(false);
    expect(pdfLinkExpired(new ApiError(500, "", "x"))).toBe(false);
    expect(examError(new ApiError(410, { error: "link_expired" }, "x"))).toBe(PDF_LINK_EXPIRED);
  });
});

describe("criticalFromTrail (A31)", () => {
  const ev = (kind: string, reason: string | null) =>
    ({ kind, occurred_at: "2026-10-12T08:00:00-03:00", actor: { type: "system" as const, name: null }, reason });
  it("só a escalada por crítico conta", () => {
    expect(criticalFromTrail(undefined)).toBe(false);
    expect(criticalFromTrail([])).toBe(false);
    expect(criticalFromTrail([ ev("escalated", "overdue") ])).toBe(false);
    expect(criticalFromTrail([ ev("cancelled", "critical") ])).toBe(false);
    expect(criticalFromTrail([ ev("escalated", "overdue"), ev("escalated", "critical") ])).toBe(true);
  });
});
