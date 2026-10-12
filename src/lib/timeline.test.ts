// src/lib/timeline.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  ALL_FILTERS, EMPTY_DRAFT, TIMELINE_DISABLED, TIMELINE_KINDS, detailTarget, endsOpening, entryWhen, entryWhere,
  filterProblem, filtersFrom, mergePages, openLabel, statusLabel, subjectKey, timelineError, timelineKindLabel, toggleKind
} from "./timeline";
import { OPENING_ENDED } from "./clinicalRecord";
import { APPOINTMENT, CONSULTATION, DOCUMENT, SCREENING, TRIAGE, entry, page } from "../test/timelineFixtures";

const refusal = (status: number, error: string, extra: object = {}) => new ApiError(status, { error, ...extra }, String(status));

describe("tipos", () => {
  it("oito tipos do contrato, em português; desconhecido sai cru", () => {
    expect(TIMELINE_KINDS.map((k) => k.key)).toEqual([
      "triage", "attendance", "screening", "appointment", "consultation", "clinical_document", "controlled_notification", "campaign"
    ]);
    expect(timelineKindLabel("screening")).toBe("Escuta");
    expect(timelineKindLabel("controlled_notification")).toBe("Notificação de receita");
    expect(timelineKindLabel("vaccination")).toBe("vaccination");
  });

  it("subjectKey separa as três formas de chegar à pessoa", () => {
    expect(subjectKey({ attendanceId: "a1" })).toBe("attendance:a1");
    expect(subjectKey({ openingId: "op1" })).toBe("opening:op1");
    expect(subjectKey({ patientId: "pa1" })).toBe("patient:pa1");
  });
});

describe("filtros", () => {
  it("todos marcados = sem kinds[]; parte marcada vai na ordem do contrato", () => {
    expect(filtersFrom(EMPTY_DRAFT)).toEqual(ALL_FILTERS);
    const d = toggleKind(toggleKind(EMPTY_DRAFT, "campaign"), "triage");
    expect(filtersFrom({ ...d, from: "2026-09-01", to: "2026-09-30" })).toEqual({
      kinds: [ "attendance", "screening", "appointment", "consultation", "clinical_document", "controlled_notification" ],
      from: "2026-09-01", to: "2026-09-30"
    });
    expect(toggleKind(d, "triage").kinds).toContain("triage");
  });

  it("período invertido ou nenhum tipo: o motivo", () => {
    expect(filterProblem({ ...EMPTY_DRAFT, from: "2026-10-01", to: "2026-09-01" })).toBe("o início do período é depois do fim");
    expect(filterProblem({ ...EMPTY_DRAFT, kinds: [] })).toBe("marque ao menos um tipo de registro");
    expect(filterProblem(toggleKind(EMPTY_DRAFT, "campaign"))).toBeNull();
    expect(filterProblem({ ...EMPTY_DRAFT, from: "2026-09-01", to: "2026-09-01" })).toBeNull();
    expect(filterProblem({ ...EMPTY_DRAFT, from: "2026-09-01" })).toBeNull();
  });
});

describe("mergePages: junta sem repetir, na ordem", () => {
  it("a entrada repetida na página seguinte aparece uma vez, no primeiro lugar", () => {
    const merged = mergePages([
      page({ entries: [ APPOINTMENT, DOCUMENT ] }),
      page({ entries: [ DOCUMENT, CONSULTATION, SCREENING ] }),
      page({ entries: [ TRIAGE ] })
    ]);
    expect(merged.map((e) => e.id)).toEqual([ APPOINTMENT.id, DOCUMENT.id, CONSULTATION.id, SCREENING.id, TRIAGE.id ]);
    expect(mergePages([])).toEqual([]);
  });
});

describe("detalhe", () => {
  it("em contexto abre as quatro telas que existem (o pedido, só com citizen_verifier)", () => {
    expect(detailTarget(CONSULTATION, true)).toEqual({ type: "consultation", id: "cs0" });
    expect(detailTarget(DOCUMENT, true)).toEqual({ type: "clinical_document", id: "doc2" });
    expect(detailTarget(SCREENING, true)).toEqual({ type: "screening", id: "sc1" });
    expect(detailTarget(APPOINTMENT, true, true)).toEqual({ type: "appointment_request", id: "rq1" });
    expect(detailTarget(APPOINTMENT, true)).toBeNull();
    expect(detailTarget(APPOINTMENT, true, false)).toBeNull();
    expect(detailTarget(TRIAGE, true)).toBeNull();
    expect(detailTarget(entry({ detail_ref: null }), true)).toBeNull();
    expect(detailTarget(entry({ kind: "vaccination", detail_ref: { type: "vaccination", id: "v1" } }), true)).toBeNull();
  });

  it("pela abertura justificada só a consulta abre (contrato §9)", () => {
    expect(detailTarget(CONSULTATION, false)).toEqual({ type: "consultation", id: "cs0" });
    expect(detailTarget(DOCUMENT, false)).toBeNull();
    expect(detailTarget(SCREENING, false)).toBeNull();
    expect(detailTarget(APPOINTMENT, false)).toBeNull();
    expect(detailTarget(APPOINTMENT, false, true)).toBeNull();
    expect(detailTarget(TRIAGE, false)).toBeNull();
    expect(detailTarget(entry({ detail_ref: null }), false)).toBeNull();
  });

  it("quando, onde/quem e o nome do botão", () => {
    expect(entryWhen(CONSULTATION)).toBe("10/09/2026, 14:30");
    expect(entryWhere(CONSULTATION)).toBe("UBS Centro · Dra. Helena Prado");
    expect(entryWhere(entry({ professional: null }))).toBe("UBS Centro");
    expect(entryWhere(TRIAGE)).toBe("—");
    expect(openLabel(CONSULTATION)).toBe("Abrir consulta de 10/09/2026, 14:30");
    expect(openLabel(APPOINTMENT)).toBe("Abrir agendamento de 01/10/2026, 09:00");
  });
});

describe("situação", () => {
  it("códigos das origens em português; desconhecido cru; nulo vira —", () => {
    expect(statusLabel("finalized")).toBe("finalizada");
    expect(statusLabel("issued")).toBe("emitido");
    expect(statusLabel("in_care")).toBe("em atendimento");
    expect(statusLabel("cancelled_by_citizen")).toBe("cancelado pelo cidadão");
    expect(statusLabel("aborted_by_revocation")).toBe("consentimento revogado");
    expect(statusLabel("unread")).toBe("aviso não lido");
    expect(statusLabel("something_new")).toBe("something_new");
    expect(statusLabel(null)).toBe("—");
  });
});

describe("recusas", () => {
  it("a abertura acaba com opening_required; out_of_context só na leitura pela abertura", () => {
    expect(endsOpening(refusal(403, "opening_required"), false)).toBe(true);
    expect(endsOpening(refusal(403, "out_of_context"), true)).toBe(true);
    expect(endsOpening(refusal(403, "out_of_context"), false)).toBe(false);
    expect(endsOpening(refusal(422, "invalid_cursor"), true)).toBe(false);
    expect(endsOpening(new Error("rede"), true)).toBe(false);
  });

  it("frases", () => {
    expect(timelineError(refusal(403, "feature_disabled", { feature: "patient_timeline" }))).toBe(TIMELINE_DISABLED);
    expect(timelineError(refusal(403, "out_of_context")))
      .toBe("esta pessoa não está em atendimento com você — para ler, use a abertura justificada em Prontuário");
    expect(timelineError(refusal(403, "opening_required"))).toBe(OPENING_ENDED);
    expect(timelineError(refusal(403, "missing_role"))).toBe("seu papel não permite ler a linha do tempo");
    expect(timelineError(refusal(422, "invalid_cursor"))).toBe("a lista mudou desde a última página — use Atualizar");
    expect(timelineError(refusal(422, "invalid_period"))).toBe("período inválido — confira as datas");
    expect(timelineError(refusal(404, "not_found"))).toBe("pessoa não encontrada — atualize a fila");
    // Pela abertura não há fila: a frase é neutra.
    expect(timelineError(refusal(404, "not_found"), { opening: true })).toBe("não há dados desta pessoa para mostrar");
    expect(timelineError(refusal(422, "invalid_kinds"))).toBe("tipo de registro inválido — use Limpar filtros");
    expect(timelineError(refusal(409, "citizen_not_verified")))
      .toBe("esta pessoa ainda não validou o cadastro na unidade — a linha do tempo só existe para cadastro validado");
    expect(timelineError(refusal(500, "boom"))).toBe("não foi possível ler a linha do tempo (500) — tente de novo");
    expect(timelineError(new TypeError("Failed to fetch"))).toBe("sem conexão com o servidor — tente de novo");
  });
});
