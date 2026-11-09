import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { EMPTY_VITALS_FORM } from "./screening";
import {
  DEFAULT_LEVELS, DESK_OUTCOMES, ENCOUNTER_OPEN_ON_IDENTIFY, OUTCOME_KINDS, OUTCOME_KIND_LABEL, SMALL_COUNT, URGENCY_COLORS,
  URGENCY_COLOR_LABEL, URGENCY_COLOR_TONE, URGENCY_DISABLED, URGENCY_ERRORS, WAITING_ROOM_DISABLED, arrivalBody, arrivalProblems,
  canUseUrgency, canUseWaitingRoom, classificationBody, classificationProblems, colorLabel, consultationContext, countLabel, isUpa,
  justificationNeeded, locationNameProblem, maxWaitLabel, outcomeBody, outcomeKindsFor, outcomeLabel, outcomeProblems,
  pairingCodeProblem, readCallLocation, ticketPrefixProblem, timesLabel, urgencyError, urgencyRefusals, urgencyRoles,
  writeCallLocation, type OutcomeDraft
} from "./urgency";
import { DOCTOR_LINK, NURSE_LINK, UBS, UPA, patientRef, urgencyUser } from "../test/urgencyFixtures";

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

const EVERY_CONTRACT_CODE = [
  "feature_disabled", "screening_not_in_upa", "not_an_upa", "caps_unit_not_allowed", "encounter_open", "already_identified",
  "justification_required", "call_location_required", "consultation_not_finalized", "urgency_outcome_required", "display_revoked",
  // Divergência D12: códigos que o contrato implica sem nome.
  "not_classified", "invalid_pairing_code", "destination_required", "return_guidance_required", "encounter_closed", "not_unidentified",
  "cbo_not_allowed", "missing_link", "already_called", "queue_empty", "patient_not_found", "invalid_ticket_prefix",
  // Preflight §B: os que o api manda e o plano não tinha; Q30: consultation_finalized.
  "duplicate_suspected", "pain_scale_required", "invalid_call_location", "display_inactive", "invalid_token", "patient_unidentified",
  "consultation_in_progress", "consultation_finalized", "merge_blocked", "cpf_taken", "cns_taken", "invalid_cpf", "invalid_cns",
  "cpf_or_reason_required", "citizen_not_verified", "too_many_requests", "invalid_unit", "missing_role", "not_called", "already_closed",
  "call_location_name_taken", "invalid_show_wait_times", "not_caller", "not_in_care", "not_found",
  // Task 5 carry: Patients::CreateTyped recusa `new_patient.<campo>`.
  "invalid_patient"
];
const err = (status: number, body: unknown) => new ApiError(status, body, "x");

describe("frases das recusas", () => {
  it("todo código do contrato tem frase própria", () => {
    for (const code of EVERY_CONTRACT_CODE) {
      expect(URGENCY_ERRORS[code], code).toBeTruthy();
      expect(urgencyError(err(422, { error: code })), code).toBe(URGENCY_ERRORS[code]);
    }
    expect(urgencyError(err(422, { error: "brand_new" }))).toBe("recusado pelo servidor (brand_new)");
    // Código fora do formato não ecoa.
    expect(urgencyError(err(422, { error: "Maria <script>" }))).toBe("recusado pelo servidor");
  });

  it("frases fixas dos códigos que mudam a tela", () => {
    expect(URGENCY_ERRORS.encounter_open).toBe("esta pessoa já tem um atendimento aberto nesta UPA");
    expect(URGENCY_ERRORS.call_location_required).toBe("escolha o local da chamada — a unidade tem TV na sala de espera");
    expect(URGENCY_ERRORS.urgency_outcome_required).toBe("numa UPA, o atendimento termina pelo desfecho da urgência");
    expect(URGENCY_ERRORS.already_identified).toBe("este paciente já foi identificado por outra pessoa");
    expect(URGENCY_ERRORS.justification_required).toBe("explique a cor escolhida (pelo menos 10 caracteres)");
    expect(URGENCY_ERRORS.invalid_token).toBe(URGENCY_ERRORS.display_revoked);
  });

  it("nenhuma frase traz dado da pessoa; todas em minúscula, fora a sigla do começo", () => {
    for (const [ code, text ] of Object.entries(URGENCY_ERRORS)) {
      expect(text, code).not.toMatch(/\d{3}\.\d{3}|Maria|queixa:/);
      expect(text.replace(/^(CPF|CNS)\b/, "").charAt(0), code).toBe(text.replace(/^(CPF|CNS)\b/, "").charAt(0).toLowerCase());
    }
  });

  it("interruptor, sessão, sinal vital e rede", () => {
    expect(urgencyError(err(403, { error: "feature_disabled", feature: "urgency_care" }))).toBe(URGENCY_DISABLED);
    expect(urgencyError(err(403, { error: "feature_disabled", feature: "waiting_room_display" }))).toBe(WAITING_ROOM_DISABLED);
    expect(urgencyError(err(401, { error: "unauthenticated" }))).toBe("sessão expirada — entre de novo");
    // A TV recebe 401 display_revoked/invalid_token: é a frase da TV, não "sessão expirada".
    expect(urgencyError(err(401, { error: "display_revoked" }))).toBe(URGENCY_ERRORS.display_revoked);
    expect(urgencyError(err(401, { error: "invalid_token" }))).toBe(URGENCY_ERRORS.display_revoked);
    expect(urgencyError(err(422, { error: "implausible_vital", field: "spo2" }))).toBe("Saturação (SpO2): valor fora do plausível — confira");
    expect(urgencyError(new TypeError("Failed to fetch"))).toBe("sem conexão com o servidor — tente de novo");
    expect(urgencyError(err(500, null))).toBe("recusado pelo servidor (500)");
  });

  it("invalid_request pelo campo; identificação troca a frase do encounter_open (Q25)", () => {
    expect(urgencyError(err(422, { error: "invalid_request", path: "unidentified.description" })))
      .toBe("descreva a pessoa (de 10 a 500 caracteres): sexo e idade aparentes, sinais, onde foi encontrada");
    expect(urgencyError(err(422, { error: "invalid_request", path: "vital_signs.spo2" }))).toBe("Saturação (SpO2): valor fora do plausível — confira");
    expect(urgencyError(err(422, { error: "invalid_request", path: "return_guidance.days" }))).toBe("o retorno vai de 1 a 90 dias");
    expect(urgencyError(err(422, { error: "invalid_request", path: "zzz" }))).toBe("confira os campos destacados");
    const open = err(409, { error: "encounter_open" });
    expect(urgencyError(open)).toBe(URGENCY_ERRORS.encounter_open);
    expect(urgencyError(open, { encounter_open: ENCOUNTER_OPEN_ON_IDENTIFY }))
      .toBe("o paciente escolhido já tem um atendimento aberto nesta UPA — encerre um dos dois (registrado por engano) antes de ligar");
  });

  it("recusas todas de uma vez, com `error` ou `code` (D12), cada uma com o path", () => {
    const e = err(422, {
      error: "invalid_request", path: "complaint",
      problems: [ { path: "complaint", error: "invalid_request" }, { path: "pain_scale", code: "pain_scale_required" }, { path: "x" } ]
    });
    expect(urgencyRefusals(e)).toEqual([
      { path: "complaint", code: "invalid_request", text: "a queixa tem de 3 a 500 caracteres" },
      { path: "pain_scale", code: "pain_scale_required", text: "informe a dor (0 a 10)" }
    ]);
    expect(urgencyRefusals(err(409, { error: "encounter_closed" }))).toEqual([ { path: "", code: "encounter_closed", text: URGENCY_ERRORS.encounter_closed } ]);
    expect(urgencyRefusals(err(403, { error: "feature_disabled", feature: "waiting_room_display" }))[0].text).toBe(WAITING_ROOM_DISABLED);
  });
});

describe("portões e papéis", () => {
  it("papéis pelo CBO do vínculo ativo na unidade (Q2: só 2235 classifica)", () => {
    const u = urgencyUser([ "health_professional" ]);
    expect(urgencyRoles(u, [ NURSE_LINK ], "upa1")).toEqual({ reception: false, nurse: true, doctor: false, identify: false, outcomeDesk: true });
    expect(urgencyRoles(u, [ { ...NURSE_LINK, cbo_code: "322205" } ], "upa1").nurse).toBe(false);
    expect(urgencyRoles(u, [ DOCTOR_LINK ], "upa1")).toEqual({ reception: false, nurse: false, doctor: true, identify: false, outcomeDesk: true });
    expect(urgencyRoles(u, [ { ...DOCTOR_LINK, ended_at: "2026-10-01" } ], "upa1").doctor).toBe(false);
    expect(urgencyRoles(u, [ DOCTOR_LINK ], "ubs1").doctor).toBe(false);
    // Vínculo sem o papel não conta.
    expect(urgencyRoles(urgencyUser([ "analyst" ]), [ DOCTOR_LINK ], "upa1").doctor).toBe(false);
    expect(urgencyRoles(urgencyUser([ "citizen_verifier" ]), [], "upa1"))
      .toEqual({ reception: true, nurse: false, doctor: false, identify: true, outcomeDesk: true });
    expect(urgencyRoles(urgencyUser([ "municipal_admin" ]), [], "upa1").outcomeDesk).toBe(false);
  });

  it("portões", () => {
    expect(canUseUrgency(urgencyUser([ "citizen_verifier" ]))).toBe(true);
    expect(canUseUrgency(urgencyUser([ "citizen_verifier" ], [ "urgency_care" ]))).toBe(false);
    expect(canUseWaitingRoom(urgencyUser([ "municipal_admin" ], [ "waiting_room_display" ]))).toBe(true);
    expect(canUseWaitingRoom(urgencyUser([ "municipal_admin" ], [ "urgency_care" ]))).toBe(false);
    expect(canUseUrgency({ ...urgencyUser([ "municipal_admin" ]), operator: true })).toBe(false);
    expect(canUseUrgency(null)).toBe(false);
    expect(isUpa(UPA)).toBe(true);
    expect(isUpa(UBS)).toBe(false);
  });
});

describe("cores, desfechos e contagens", () => {
  it("cores na ordem do contrato; laranja pelo tom de urgente e o texto", () => {
    expect(URGENCY_COLORS).toEqual([ "red", "orange", "yellow", "green", "blue" ]);
    expect(URGENCY_COLOR_LABEL.orange).toBe("laranja");
    expect(URGENCY_COLOR_TONE).toEqual({ red: "down", orange: "urgent", yellow: "warn", green: "ok", blue: "info" });
    expect(DEFAULT_LEVELS.map((l) => l.max_wait_minutes)).toEqual([ 0, 10, 60, 120, 240 ]);
    expect(colorLabel("yellow")).toBe("amarelo");
    expect(colorLabel("purple")).toBe("purple");
    expect(maxWaitLabel(0)).toBe("imediato");
    expect(maxWaitLabel(60)).toBe("até 60 min");
  });

  it("os 7 desfechos na ordem do api, com os rótulos do api (labels.rb)", () => {
    expect(OUTCOME_KINDS).toEqual([
      "discharged", "discharged_to_primary_care", "transferred", "left_without_care", "left_against_advice", "death", "registered_in_error"
    ]);
    expect(OUTCOME_KIND_LABEL).toEqual({
      discharged: "Alta", discharged_to_primary_care: "Alta com retorno na UBS", transferred: "Transferência",
      left_without_care: "Saiu sem atendimento", left_against_advice: "Saiu contra orientação médica", death: "Óbito",
      registered_in_error: "Registrado por engano"
    });
    expect(outcomeLabel("registered_in_error")).toBe("Registrado por engano");
    expect(outcomeLabel("novo")).toBe("novo");
    expect(DESK_OUTCOMES).toEqual([ "left_without_care", "registered_in_error" ]);
  });

  it("contagem e tempos suprimidos", () => {
    expect(countLabel("lt5")).toBe(SMALL_COUNT);
    expect(countLabel(0)).toBe("0");
    expect(countLabel(12)).toBe("12");
    expect(timesLabel({ median_minutes: 12, p90_minutes: 40 })).toBe("mediana 12 min · p90 40 min");
    expect(timesLabel({ median_minutes: "lt5", p90_minutes: "lt5" })).toBe(SMALL_COUNT);
    expect(timesLabel({ median_minutes: null, p90_minutes: null })).toBe("—");
  });
});

describe("classificação", () => {
  const d = { complaint: "dor no peito", vitals: EMPTY_VITALS_FORM, pain: "6", color: "orange" as const, justification: "curta" };

  it("justificativa: sem sugestão sempre; com sugestão só se a cor mudou", () => {
    expect(justificationNeeded(null, "green")).toBe(true);
    expect(justificationNeeded(null, null)).toBe(true);
    expect(justificationNeeded("yellow", "yellow")).toBe(false);
    expect(justificationNeeded("yellow", "orange")).toBe(true);
    expect(classificationProblems(d, "yellow").map((p) => p.path)).toEqual([ "justification" ]);
    expect(classificationProblems({ ...d, justification: "mudou a cor porque a dor piorou" }, "yellow")).toEqual([]);
    expect(classificationProblems({ ...d, color: "yellow" }, "yellow")).toEqual([]);
  });

  it("dor obrigatória (Q22), na ordem do formulário", () => {
    expect(classificationProblems({ ...d, complaint: "", pain: "", color: null }, null).map((p) => p.path))
      .toEqual([ "complaint", "pain_scale", "color", "justification" ]);
    expect(classificationProblems({ ...d, color: "yellow", pain: "11" }, "yellow").map((p) => p.text)).toEqual([ "informe a dor (0 a 10)" ]);
    expect(classificationProblems({ ...d, color: "yellow", pain: "0" }, "yellow")).toEqual([]);
  });

  it("sinal vital fora do plausível vai no path do api; a dor do formulário de sinais é ignorada", () => {
    const vitals = { ...EMPTY_VITALS_FORM, spo2: "30", systolic: "120", pain_score: "99" };
    expect(classificationProblems({ ...d, color: "yellow", vitals }, "yellow").map((p) => p.path))
      .toEqual([ "vital_signs.spo2", "vital_signs.diastolic" ]);
  });

  it("corpo: dor em pain_scale, sem pain_score; justificativa só quando exigida", () => {
    const parsed = { spo2: 97, pain_score: 6 };
    expect(classificationBody({ ...d, color: "yellow", justification: "  " }, parsed, "yellow"))
      .toEqual({ complaint: "dor no peito", vital_signs: { spo2: 97 }, pain_scale: 6, color: "yellow" });
    expect(classificationBody({ ...d, justification: " a dor piorou muito " }, parsed, null))
      .toEqual({ complaint: "dor no peito", vital_signs: { spo2: 97 }, pain_scale: 6, color: "orange", justification: "a dor piorou muito" });
  });
});

describe("chegada", () => {
  it("uma forma só; descrição de 10 a 500", () => {
    expect(arrivalProblems({ mode: "unidentified", description: "homem 40a" }, "2026-11-05"))
      .toEqual([ { path: "unidentified.description", text: "descreva a pessoa (de 10 a 500 caracteres): sexo e idade aparentes, sinais, onde foi encontrada" } ]);
    expect(arrivalProblems({ mode: "unidentified", description: "homem, cerca de 40 anos" }, "2026-11-05")).toEqual([]);
    expect(arrivalProblems({ mode: "existing", patient: null }, "2026-11-05").map((p) => p.path)).toEqual([ "patient" ]);
    expect(arrivalProblems({ mode: "existing", patient: patientRef() }, "2026-11-05")).toEqual([]);
  });

  it("paciente novo pelas regras do 24a", () => {
    const np = { full_name: "Maria Lima", birth_date: "2030-01-01", sex: "female" as const, cpf: null, no_cpf_reason: null };
    expect(arrivalProblems({ mode: "new", patient: np }, "2026-11-05")).toEqual([ { path: "new_patient.birth_date", text: "nascimento depois de hoje" } ]);
  });

  it("corpo por forma", () => {
    expect(arrivalBody("upa1", { mode: "existing", patient: patientRef() })).toEqual({ health_unit_id: "upa1", patient_id: "pa1" });
    expect(arrivalBody("upa1", { mode: "unidentified", description: "  homem, cerca de 40 anos " }))
      .toEqual({ health_unit_id: "upa1", unidentified: { description: "homem, cerca de 40 anos" } });
    const np = { full_name: "Maria Lima", birth_date: "1980-03-02", sex: "female" as const, cpf: "52998224725" };
    expect(arrivalBody("upa1", { mode: "new", patient: np })).toEqual({ health_unit_id: "upa1", new_patient: np });
    expect(arrivalBody("upa1", { mode: "new", patient: np, duplicatesReviewed: true }))
      .toEqual({ health_unit_id: "upa1", new_patient: np, duplicates_reviewed: true });
  });
});

describe("desfecho", () => {
  const base: OutcomeDraft = { kind: null, destination: "", vacancyRequest: "", returnDays: "", returnReason: "", reason: "" };
  const doctorDone = { doctor: true, consultationFinalized: true, consultationDraft: false, unidentified: false };
  const deskNone = { doctor: false, consultationFinalized: false, consultationDraft: false, unidentified: false };

  it("campos por tipo", () => {
    expect(outcomeProblems(base, doctorDone).map((p) => p.path)).toEqual([ "kind" ]);
    expect(outcomeProblems({ ...base, kind: "transferred" }, doctorDone).map((p) => p.path)).toEqual([ "destination" ]);
    expect(outcomeProblems({ ...base, kind: "transferred", destination: "Hospital do Trabalhador", vacancyRequest: "x".repeat(501) }, doctorDone)
      .map((p) => p.path)).toEqual([ "vacancy_request" ]);
    expect(outcomeProblems({ ...base, kind: "discharged_to_primary_care", returnDays: "0" }, doctorDone).map((p) => p.path))
      .toEqual([ "return_guidance.days", "return_guidance.reason" ]);
    expect(outcomeProblems({ ...base, kind: "discharged_to_primary_care", returnDays: "7", returnReason: "reavaliar a pressão" }, doctorDone))
      .toEqual([]);
  });

  it("consulta finalizada, rascunho e paciente identificado", () => {
    expect(outcomeProblems({ ...base, kind: "discharged" }, { ...doctorDone, consultationFinalized: false })[0].text)
      .toBe(URGENCY_ERRORS.consultation_not_finalized);
    expect(outcomeProblems({ ...base, kind: "discharged" }, { ...doctorDone, unidentified: true })[0].text)
      .toBe(URGENCY_ERRORS.patient_unidentified);
    // Óbito e evasão não exigem identificação.
    expect(outcomeProblems({ ...base, kind: "death" }, { ...doctorDone, unidentified: true })).toEqual([]);
    expect(outcomeProblems({ ...base, kind: "left_against_advice" }, { ...doctorDone, consultationFinalized: false, consultationDraft: true })[0].text)
      .toBe(URGENCY_ERRORS.consultation_in_progress);
    expect(outcomeProblems({ ...base, kind: "left_without_care" }, { ...deskNone, consultationDraft: true })[0].text)
      .toBe(URGENCY_ERRORS.consultation_in_progress);
  });

  it("só o balcão para quem não é médico (Q10, Q25)", () => {
    expect(outcomeProblems({ ...base, kind: "left_without_care" }, deskNone)).toEqual([]);
    expect(outcomeProblems({ ...base, kind: "death" }, { ...deskNone, consultationFinalized: true })[0].path).toBe("kind");
  });

  it("registrado por engano: motivo de 10 a 500; recusado com a consulta finalizada (Q30)", () => {
    expect(outcomeProblems({ ...base, kind: "registered_in_error", reason: "duplicado" }, deskNone))
      .toEqual([ { path: "reason", text: "o motivo tem de 10 a 500 caracteres" } ]);
    expect(outcomeProblems({ ...base, kind: "registered_in_error", reason: "aberto em duplicidade" }, deskNone)).toEqual([]);
    expect(outcomeProblems({ ...base, kind: "registered_in_error", reason: "aberto em duplicidade" }, doctorDone))
      .toEqual([ { path: "kind", text: URGENCY_ERRORS.consultation_finalized } ]);
  });

  it("tipos oferecidos: o médico todos, o balcão dois; sem o engano depois da consulta finalizada", () => {
    expect(outcomeKindsFor(doctorDone)).toEqual(OUTCOME_KINDS.filter((k) => k !== "registered_in_error"));
    expect(outcomeKindsFor({ ...doctorDone, consultationFinalized: false })).toEqual(OUTCOME_KINDS);
    expect(outcomeKindsFor(deskNone)).toEqual([ "left_without_care", "registered_in_error" ]);
    expect(outcomeKindsFor({ ...deskNone, consultationFinalized: true })).toEqual([ "left_without_care" ]);
  });

  it("consulta descartada conta como nenhuma", () => {
    expect(consultationContext("discarded")).toEqual({ consultationFinalized: false, consultationDraft: false });
    expect(consultationContext(null)).toEqual({ consultationFinalized: false, consultationDraft: false });
    expect(consultationContext("draft")).toEqual({ consultationFinalized: false, consultationDraft: true });
    expect(consultationContext("finalized")).toEqual({ consultationFinalized: true, consultationDraft: false });
  });

  it("corpo só com os campos do tipo escolhido", () => {
    const filled = { ...base, destination: "x", vacancyRequest: "y", returnDays: "7", returnReason: "reavaliar a pressão", reason: "aberto em duplicidade" };
    expect(outcomeBody({ ...filled, kind: "discharged_to_primary_care" }))
      .toEqual({ kind: "discharged_to_primary_care", return_guidance: { days: 7, reason: "reavaliar a pressão" } });
    expect(outcomeBody({ ...filled, kind: "transferred", destination: " Hospital do Trabalhador ", vacancyRequest: " " }))
      .toEqual({ kind: "transferred", destination: "Hospital do Trabalhador" });
    expect(outcomeBody({ ...filled, kind: "transferred", destination: "Hospital", vacancyRequest: "CROSS 123" }))
      .toEqual({ kind: "transferred", destination: "Hospital", vacancy_request: "CROSS 123" });
    expect(outcomeBody({ ...filled, kind: "registered_in_error" })).toEqual({ kind: "registered_in_error", reason: "aberto em duplicidade" });
    expect(outcomeBody({ ...filled, kind: "death" })).toEqual({ kind: "death" });
  });
});

describe("local lembrado, prefixo, código e nomes", () => {
  it("local lembrado na sessão, por usuário e unidade, e sobrevive a storage bloqueado", () => {
    writeCallLocation("u-1", "upa1", "loc2");
    expect(readCallLocation("u-1", "upa1")).toBe("loc2");
    expect(readCallLocation("u-1", "ubs1")).toBeNull();
    expect(readCallLocation("u-2", "upa1")).toBeNull();
    writeCallLocation("u-1", "upa1", null);
    expect(readCallLocation("u-1", "upa1")).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readCallLocation("u-1", "upa1")).toBeNull();
    expect(() => writeCallLocation("u-1", "upa1", "loc2")).not.toThrow();
  });

  it("prefixo, código e nomes (limites do api, Q15)", () => {
    expect(ticketPrefixProblem("UB")).toBeNull();
    expect(ticketPrefixProblem("u")).toBe("o prefixo tem de 1 a 3 letras maiúsculas, sem acento");
    expect(ticketPrefixProblem("ÁB")).toBe("o prefixo tem de 1 a 3 letras maiúsculas, sem acento");
    expect(ticketPrefixProblem("ABCD")).toBe("o prefixo tem de 1 a 3 letras maiúsculas, sem acento");
    expect(URGENCY_ERRORS.invalid_ticket_prefix).toBe("o prefixo tem de 1 a 3 letras maiúsculas, sem acento");
    expect(pairingCodeProblem("12345")).toBe("o código tem 6 dígitos");
    expect(pairingCodeProblem("012345")).toBeNull();
    expect(locationNameProblem("C")).toBeNull();
    expect(locationNameProblem("  ")).toBe("o nome tem de 1 a 40 caracteres");
    expect(locationNameProblem("x".repeat(41))).toBe("o nome tem de 1 a 40 caracteres");
    expect(locationNameProblem("x".repeat(60), 60)).toBeNull();
  });
});
