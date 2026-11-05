// Regras do mapa dos leitos, da entrada e da saída (Task 10; P41, R20).
import { describe, expect, it } from "vitest";
import { NOW31 } from "../test/psychosocialFixtures";
import {
  DATE_TIME_TEXT, REASON_TEXT, STAY_END_BEFORE_START, STAY_END_IN_FUTURE, STAY_ENROLLMENT_TEXT, STAY_EXPECTED_END_TEXT, STAY_START_TEXT, bedNearLimit,
  bedStayText, closeStayInput, closeStayProblems, emptyCloseStayDraft, emptyNightStayDraft, nightStayInput, nightStayProblems, psyCodeText,
  reassessmentProblems
} from "./psychosocial";

const STAY = { enrollmentId: "en1", startedAt: "2026-11-04T09:00", expectedEndAt: "2026-11-05T08:00" };

describe("mapa dos leitos", () => {
  it("texto do ocupante: noites na janela; CAPS III diz intercaladas; sem contagem, só o nome", () => {
    expect(bedStayText("José Pereira", 9, 14, 30, "caps_ad_iii")).toBe("José Pereira · 9 de 14 noites em 30 dias");
    expect(bedStayText("José Pereira", 3, 10, 30, "caps_iii")).toBe("José Pereira · 3 de 10 noites intercaladas em 30 dias");
    expect(bedStayText("José Pereira", null, 14, 30, "caps_ad_iii")).toBe("José Pereira");
  });
  it("perto do limite: falta uma noite ou menos", () => {
    expect(bedNearLimit(12, 14)).toBe(false);
    expect(bedNearLimit(13, 14)).toBe(true);
    expect(bedNearLimit(14, 14)).toBe(true);
    expect(bedNearLimit(null, 14)).toBe(false);
  });
});

describe("entrada no leito", () => {
  it("padrão: agora, sem usuário nem saída prevista", () => {
    expect(emptyNightStayDraft(NOW31)).toEqual({ enrollmentId: "", startedAt: "2026-11-04T10:00", expectedEndAt: "" });
  });
  it("válida passa; tudo de uma vez quando falta", () => {
    expect(nightStayProblems(STAY, NOW31, "2026-09-10")).toEqual([]);
    expect(nightStayProblems({ enrollmentId: "", startedAt: "", expectedEndAt: "" }, NOW31)).toEqual([
      { path: "enrollment_id", text: STAY_ENROLLMENT_TEXT }, { path: "started_at", text: DATE_TIME_TEXT }, { path: "expected_end_at", text: DATE_TIME_TEXT }
    ]);
  });
  it("entrada até agora + 12 h", () => {
    expect(nightStayProblems({ ...STAY, startedAt: "2026-11-04T22:00", expectedEndAt: "2026-11-05T08:00" }, NOW31)).toEqual([]);
    expect(nightStayProblems({ ...STAY, startedAt: "2026-11-04T22:01", expectedEndAt: "2026-11-05T08:00" }, NOW31))
      .toEqual([ { path: "started_at", text: STAY_START_TEXT } ]);
  });
  it("saída prevista depois da entrada e em até 30 dias", () => {
    expect(nightStayProblems({ ...STAY, expectedEndAt: "2026-11-04T09:00" }, NOW31)).toEqual([ { path: "expected_end_at", text: STAY_EXPECTED_END_TEXT } ]);
    expect(nightStayProblems({ ...STAY, expectedEndAt: "2026-12-04T09:00" }, NOW31)).toEqual([]);
    expect(nightStayProblems({ ...STAY, expectedEndAt: "2026-12-04T09:01" }, NOW31)).toEqual([ { path: "expected_end_at", text: STAY_EXPECTED_END_TEXT } ]);
  });
  it("matrícula iniciada depois do dia da entrada: a frase do api para enrollment_id", () => {
    expect(nightStayProblems(STAY, NOW31, "2026-11-05")).toEqual([ { path: "enrollment_id", text: psyCodeText("enrollment_required", "enrollment_id") } ]);
    expect(nightStayProblems(STAY, NOW31, "2026-11-04")).toEqual([]);
  });
  it("corpo com a hora da cidade; reavaliação só quando há motivo", () => {
    expect(nightStayInput(STAY, "b1")).toEqual({
      bed_id: "b1", enrollment_id: "en1", started_at: "2026-11-04T09:00:00-03:00", expected_end_at: "2026-11-05T08:00:00-03:00"
    });
    expect(nightStayInput(STAY, "b1", "  risco de recaída na semana  ").reassessment).toEqual({ reason: "risco de recaída na semana" });
    expect("reassessment" in nightStayInput(STAY, "b1", "   ")).toBe(false);
  });
  it("reavaliação: motivo de 10 a 500", () => {
    expect(reassessmentProblems("curto")).toEqual([ { path: "reassessment.reason", text: REASON_TEXT } ]);
    expect(reassessmentProblems("x".repeat(501))).toEqual([ { path: "reassessment.reason", text: REASON_TEXT } ]);
    expect(reassessmentProblems("risco de recaída")).toEqual([]);
  });
});

describe("saída do leito", () => {
  const START = "2026-11-02T19:00:00-03:00";
  const OK = { endedAt: "2026-11-04T09:00", reason: "alta com plano de cuidado" };
  it("padrão: agora, sem motivo", () => {
    expect(emptyCloseStayDraft(NOW31)).toEqual({ endedAt: "2026-11-04T10:00", reason: "" });
  });
  it("depois da entrada, nunca futura, motivo de 10 a 500", () => {
    expect(closeStayProblems(OK, START, NOW31)).toEqual([]);
    expect(closeStayProblems({ ...OK, endedAt: "2026-11-02T19:00" }, START, NOW31)).toEqual([ { path: "ended_at", text: STAY_END_BEFORE_START } ]);
    expect(closeStayProblems({ ...OK, endedAt: "2026-11-04T10:01" }, START, NOW31)).toEqual([ { path: "ended_at", text: STAY_END_IN_FUTURE } ]);
    expect(closeStayProblems({ endedAt: "", reason: "curto" }, START, NOW31)).toEqual([
      { path: "ended_at", text: DATE_TIME_TEXT }, { path: "reason", text: REASON_TEXT }
    ]);
  });
  it("corpo com a hora da cidade e o motivo aparado; reavaliação só quando há motivo", () => {
    expect(closeStayInput({ ...OK, reason: " alta com plano de cuidado " })).toEqual({ ended_at: "2026-11-04T09:00:00-03:00", reason: "alta com plano de cuidado" });
    expect(closeStayInput(OK, "risco de recaída na semana").reassessment).toEqual({ reason: "risco de recaída na semana" });
  });
});
