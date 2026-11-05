import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  CAPS_MODALITIES, CLOSE_BEFORE_START, CLOSE_DESTINATION_TEXT, DESTINATION_LABEL, NEXT_VISIT_TEXT, carePlanOverdue, carePlanTitle, cidKey, closeProblems,
  enrollmentDraftOf, enrollmentEditProblems, enrollmentPatch, foldName, nextVisitInput, MONTH_PROBLEM_TEXT, NO_ACTIVE_CAPS, NO_CAPS_BEDS, MONTH_WARNING_TEXT, PSY_DISABLED, PSY_ERRORS, REASON_TEXT, actionInput, actionProblems,
  canUsePsychosocial, carePlanInput, carePlanProblems, cidLabel, codeLabel, countLabel, destinationLabel, emptyActionDraft, emptyEnrollmentDraft,
  enrollmentInput, enrollmentProblems, hasBeds, indexFromPath, isPrescriber, isStale, modalityLabel, monthProblemLabel, monthWarningLabel, nightLimitText,
  phoneProblem, psyError, psyRefusals, psychosocialRoles, reasonProblem, settingsProblems, textProblem, unitCapsProblems, weekdayLabel,
  type ActionDraft, type CarePlanDraft
} from "./psychosocial";
import { NOW31, OPTIONS, TODAY31, enrollment, psySettings, psyUser } from "../test/psychosocialFixtures";

const proc = (code: string) => OPTIONS.procedures.find((p) => p.code === code);
const refusal = (status: number, body: unknown) => new ApiError(status, body, "recusa");

// Todo código que o api do 31 pode devolver, com o status real: `Psychosocial::BaseController::FAILURE_STATUS`, os comandos e
// controladores de app/{commands,controllers,services}/psychosocial, o /attendance/units (P34, P53) e os guardas de outros módulos
// (P32, P51), mais o §15 (P13, P23–P25, P37, P40–P44, P47, P54, P57).
// O status real fica nos comentários: a frase depende só do código (e do path), nunca do status.
const API_CODES: string[] = [
  // 409
  "enrollment_open", "bed_taken", "already_staying", "already_exported", "bed_label_taken", "already_closed", "already_cancelled", "month_open",
  "record_not_open", "referral_not_pending", "night_stay_open", "integrity_mismatch", "citizen_not_verified", "unit_has_caps_records",
  "caps_has_beds", "unit_has_attendances",
  // 403, 401, 404, 429
  "not_on_caps_team", "missing_role", "lead_required", "not_author", "out_of_context", "unauthenticated", "mfa_required", "not_found",
  "person_not_found", "too_many_requests",
  // 422
  "action_rejected", "invalid_request", "too_long", "month_closed", "month_has_problems", "raas_layout_unavailable", "nothing_to_export",
  "caps_without_beds", "instrument_mismatch", "esf_cnes_required", "closed_on_in_future", "origin_locked", "destination_is_permanence",
  "invalid_cursor", "started_after_actions", "invalid_cpf", "invalid_cns", "prescriber_required", "invalid_content", "enrollment_required",
  "caps_modality_mismatch", "invalid_service_classification", "invalid_phone", "caps_unit_not_allowed", "invalid_kinds",
  // Crítica da ação (P23), dentro de `action_rejected`, e também sozinhos (422)
  "cbo_incompatible", "quantity_exceeded", "performed_in_future", "authorization_required", "family_only_for_family_care", "bpa_i_single_patient"
];
const PENDING_CODES = [ "patient_cns_missing", "phone_missing", "homeless_missing", "professional_cns_missing", "professional_not_in_cnes",
  "cid_missing", "action_out_of_rule", "night_stay_open" ];
const WARNING_CODES = [ "no_actions", "phone_missing" ];

const actionBase = (o: Partial<ActionDraft> = {}): ActionDraft => ({
  ...emptyActionDraft(NOW31), sigtapCode: "0301080208", performedAt: "2026-11-04T09:00", quantity: "1",
  participants: [ { kind: "enrollment", enrollmentId: "en1", name: "Maria" } ], ...o
});
const paths = (d: ActionDraft, code = d.sigtapCode) => actionProblems(d, proc(code), NOW31).map((p) => p.path);

describe("regras do CAPS (módulo 31)", () => {
  it("portão exige psychosocial_care e clinical_record; lead implica equipe", () => {
    expect(canUsePsychosocial(psyUser())).toBe(true);
    expect(canUsePsychosocial(psyUser([ "psychosocial_staff" ], [ "psychosocial_care" ]))).toBe(false);
    expect(canUsePsychosocial(psyUser([ "psychosocial_staff" ], [ "clinical_record" ]))).toBe(false);
    expect(canUsePsychosocial({ ...psyUser(), operator: true })).toBe(false);
    expect(canUsePsychosocial(null)).toBe(false);
    expect(psychosocialRoles(psyUser([ "psychosocial_lead" ]))).toMatchObject({ staff: true, lead: true });
    expect(psychosocialRoles(psyUser([ "psychosocial_staff" ]))).toMatchObject({ staff: true, lead: false });
    expect(psychosocialRoles(psyUser([ "billing_clerk" ]))).toEqual({ staff: false, lead: false, admin: false, analyst: false, billing: true, professional: false });
    expect(psychosocialRoles(psyUser([ "municipal_admin", "analyst", "health_professional" ])))
      .toMatchObject({ admin: true, analyst: true, professional: true, staff: false });
  });

  it("a tabela tem os 57 códigos do api (mais feature_disabled e night_limit_reached à parte)", () => {
    expect(new Set(API_CODES).size).toBe(57);
  });

  it.each(API_CODES)("código do api %s tem frase própria, nunca o código cru", (code) => {
    const text = psyError(refusal(422, { error: code }));
    expect(text, code).toBeTruthy();
    expect(text, code).not.toContain(code);
    expect(text, code).not.toMatch(/recusado pelo servidor/);
    expect(PSY_ERRORS[code], code).toBeTruthy();
  });

  it("feature_disabled e night_limit_reached têm frase própria fora de PSY_ERRORS", () => {
    expect(psyError(refusal(403, { error: "feature_disabled", feature: "psychosocial_care" }))).toBe(PSY_DISABLED);
    expect(psyError(refusal(403, { error: "feature_disabled", feature: "clinical_documents" }))).toMatch(/está desligado nesta cidade$/);
    expect(psyError(refusal(422, { error: "night_limit_reached", used: 14, limit: 14, window_days: 30, rule: "total" })))
      .toBe(nightLimitText({ used: 14, limit: 14, window_days: 30, rule: "total" }));
    expect(psyError(refusal(422, { error: "night_limit_reached" }))).not.toContain("night_limit_reached");
    expect(PSY_ERRORS.lead_required).toBe("só a coordenação do CAPS pode fazer isso");
  });

  it("pendências e avisos da RAAS: todo código tem frase; no_actions é só aviso; phone_missing nas duas listas (P57)", () => {
    for (const code of PENDING_CODES) expect(MONTH_PROBLEM_TEXT[code], code).toBeTruthy();
    for (const code of WARNING_CODES) expect(MONTH_WARNING_TEXT[code], code).toBeTruthy();
    expect(MONTH_PROBLEM_TEXT.no_actions).toBeUndefined();
    expect(monthProblemLabel("homeless_missing")).toBe("situação de rua do mês não informada");
    expect(monthWarningLabel("no_actions")).toMatch(/fora da remessa/);
    // phone_missing como aviso: frase neutra (rebaixado por situação de rua ou por falta de ação RAAS).
    expect(monthWarningLabel("phone_missing")).toBe("telefone do usuário ausente — não bloqueia o fechamento");
    // Pendência que o api mande no papel de aviso cai na frase da pendência, nunca crua.
    expect(monthWarningLabel("homeless_missing")).toBe("situação de rua do mês não informada");
    expect(monthWarningLabel("cid_missing")).toBe("CID ausente");
    expect(monthWarningLabel("aviso_novo")).toBe("aviso_novo");
    expect(monthProblemLabel("nova_pendencia")).toBe("nova_pendencia");
  });

  it("limite de noites: os números, a janela e a regra do CAPS III (R20)", () => {
    // Texto base do brief; R20 só acrescenta o tipo no CAPS III.
    expect(nightLimitText({ used: 14, limit: 14 }))
      .toBe("limite de noites atingido: 14 de 14 na janela de 30 dias — só a coordenação passa, com reavaliação");
    expect(nightLimitText({ used: 14, limit: 14, window_days: 30, rule: "total" }))
      .toBe("limite de noites atingido: 14 de 14 na janela de 30 dias — só a coordenação passa, com reavaliação");
    expect(nightLimitText({ used: 7, limit: 7, window_days: 30, rule: "consecutive" }))
      .toBe("limite de noites atingido: 7 de 7 seguidas na janela de 30 dias — só a coordenação passa, com reavaliação");
    expect(nightLimitText({ used: 10, limit: 10, window_days: 45, rule: "alternate" }))
      .toBe("limite de noites atingido: 10 de 10 intercaladas na janela de 45 dias — só a coordenação passa, com reavaliação");
    expect(psyError(refusal(422, { error: "night_limit_reached", used: 7, limit: 7, window_days: 30, rule: "consecutive" })))
      .toContain("7 de 7 seguidas na janela de 30 dias");
  });

  it("código desconhecido aparece cru; erro de rede tem frase; 404 sem código é não encontrado", () => {
    expect(psyError(refusal(422, { error: "something_new" }))).toBe("recusado pelo servidor (something_new)");
    expect(psyError(refusal(422, { error: "x".repeat(65) }))).toBe("recusado pelo servidor");
    expect(psyError(new TypeError("Failed to fetch"))).toBe("não foi possível falar com o servidor — tente de novo");
    expect(psyError(refusal(404, null))).toBe(PSY_ERRORS.not_found);
    expect(psyError(refusal(500, null))).toBe("recusado pelo servidor (500)");
  });

  it("crítica da ação: todas de uma vez, com o path do api e o índice do participante (P23)", () => {
    const r = psyRefusals(refusal(422, { error: "action_rejected", problems: [
      { error: "cbo_incompatible", path: "sigtap_code" }, { error: "quantity_exceeded", path: "quantity" },
      { error: "family_only_for_family_care", path: "participants[1].family_name", participant_index: 1 },
      { error: "enrollment_required", path: "participants[2]", participant_index: 2 },
      { error: "enrollment_required", path: "participants" }, { error: "bpa_i_single_patient", path: "participants" },
      { error: "month_closed", path: "performed_at" }, { error: "authorization_required", path: "authorization_number" },
      { error: "instrument_mismatch", path: "sigtap_code" }, { error: "performed_in_future", path: "performed_at" } ] }));
    expect(r.map((x) => x.code)).toEqual([ "cbo_incompatible", "quantity_exceeded", "family_only_for_family_care", "enrollment_required",
      "enrollment_required", "bpa_i_single_patient", "month_closed", "authorization_required", "instrument_mismatch", "performed_in_future" ]);
    expect(r.map((x) => x.participantIndex)).toEqual([ null, null, 1, 2, null, null, null, null, null, null ]);
    expect(r[2].path).toBe("participants[1].family_name");
    expect(r[2].text).toBe(PSY_ERRORS.family_only_for_family_care);
    expect(r[3].text).toBe("este participante não tem matrícula aberta neste CAPS na data da ação");
    expect(r[4].text).toBe(PSY_ERRORS.enrollment_required);
    expect(r[6].text).toBe(PSY_ERRORS.month_closed);
    expect(r.every((x) => !x.text.includes(x.code))).toBe(true);
  });

  it("problemas com `code` (tolerância) e índice tirado do path quando falta participant_index", () => {
    const r = psyRefusals(refusal(422, { error: "invalid_request", path: "participants[3]", problems: [
      { code: "cbo_incompatible" }, { error: "invalid_request", path: "participants[3]" }, { foo: 1 }, null ] }));
    expect(r.map((x) => [ x.code, x.participantIndex ])).toEqual([ [ "cbo_incompatible", null ], [ "invalid_request", 3 ] ]);
    expect(r[1].text).toBe("este participante está repetido ou não existe");
    // Sem problems: o topo, com o índice do path.
    const top = psyRefusals(refusal(422, { error: "invalid_request", path: "participants[0].family_name" }));
    expect(top).toEqual([ { path: "participants[0].family_name", code: "invalid_request", text: "nome do familiar: de 3 a 120 caracteres",
      participantIndex: 0 } ]);
  });

  it("o corpo nunca vaza: só código no formato do api é ecoado; campos extras ficam fora", () => {
    const leak = /Maria|12345678909|Ideação|segredo|F32/;
    const bodies = [
      { error: "something_new", patient_name: "Maria da Silva", message: "Ideação suicida", cpf: "12345678909" },
      { error: "Maria da Silva CPF 12345678909", message: "segredo" },
      { error: "action_rejected", message: "segredo", problems: [ { error: "Ideação F32", path: "notes", message: "segredo" },
        { error: "cbo_incompatible", path: "sigtap_code", patient_name: "Maria" } ] },
      { error: "invalid_request", path: "Maria da Silva", patient_name: "Maria" }
    ];
    for (const body of bodies) {
      for (const r of psyRefusals(refusal(422, body))) {
        expect(r.text).not.toMatch(leak);
        expect(r.code).not.toMatch(leak);
        expect(r.path).not.toMatch(leak);
      }
    }
    expect(psyError(refusal(422, bodies[1]))).toBe("recusado pelo servidor");
    expect(psyRefusals(refusal(422, bodies[2])).map((r) => r.text)).toEqual([ "recusado pelo servidor", PSY_ERRORS.cbo_incompatible ]);
  });

  it("indexFromPath: índice do participante pelo path do api", () => {
    expect(indexFromPath("participants[2]")).toBe(2);
    expect(indexFromPath("participants[10].family_name")).toBe(10);
    expect(indexFromPath("participants")).toBeNull();
    expect(indexFromPath("goals[1].text")).toBeNull();
  });

  it("month_closed e enrollment_required mudam a frase pelo path (P37, P40, P41)", () => {
    const text = (code: string, path: string) => psyError(refusal(422, { error: code, path, problems: [ { error: code, path } ] }));
    expect(text("month_closed", "started_on")).toMatch(/início da matrícula cai num mês já fechado/);
    expect(text("month_closed", "enrollment.started_on")).toMatch(/início da matrícula cai num mês já fechado/);
    expect(text("month_closed", "closed_on")).toMatch(/encerramento cai num mês já fechado/);
    expect(text("month_closed", "started_at")).toMatch(/entrada no leito cai num mês já fechado/);
    expect(text("month_closed", "ended_at")).toMatch(/noite num mês já fechado/);
    expect(text("month_closed", "performed_at")).toBe(PSY_ERRORS.month_closed);
    expect(text("enrollment_required", "enrollment_id")).toMatch(/matrícula não está aberta/);
    expect(text("enrollment_required", "at")).toMatch(/acolhimento é anterior/);
    expect(text("performed_in_future", "held_on")).toBe("a data não pode ser futura");
  });

  it.each([
    [ "reason", "o motivo tem pelo menos 10 caracteres e não pode passar do limite" ],
    [ "reassessment.reason", REASON_TEXT ],
    [ "notes", "a evolução tem até 4000 caracteres" ],
    [ "needs", "problemas e necessidades: de 1 a 4000 caracteres" ],
    [ "goals[0].text", "objetivo: de 1 a 500 caracteres" ],
    [ "goals[0].responsible_user_id", "escolha um responsável lotado neste CAPS" ],
    [ "goals[2].due_on", "o prazo do objetivo precisa ser uma data válida" ],
    [ "topic", "o tema tem de 1 a 200 caracteres" ],
    [ "shared_text", "o texto compartilhado tem de 10 a 2000 caracteres" ],
    [ "participants[1].family_name", "nome do familiar: de 3 a 120 caracteres" ],
    [ "name", "o nome tem de 1 a 120 caracteres" ],
    [ "label", "o nome do leito tem de 1 a 20 caracteres" ],
    [ "capacity", "as vagas vão de 1 a 100" ],
    [ "quantity", "a quantidade é um número inteiro de 1 a 999" ],
    [ "authorization_number", "o número de autorização tem 13 dígitos" ],
    [ "care_plan_review_days", "o prazo de revisão do PTS vai de 30 a 365 dias" ],
    [ "night_limits.caps_iii.window_days", "a janela vai de 7 a 90 dias" ],
    [ "night_limits.caps_ad_iii.total", "o limite de noites vai de 1 a 90" ],
    [ "enrollment.started_on", "o início vai até 12 meses para trás, nunca futuro nem antes do nascimento" ],
    [ "esf_cnes", "o CNES da USF tem 7 dígitos e só vai com cobertura de ESF" ],
    [ "health_unit_id", "escolha um CAPS ativo" ],
    [ "month", "mês inválido ou futuro" ],
    [ "unknown_key", PSY_ERRORS.invalid_request ]
  ])("invalid_request/too_long em %s tem a frase do campo", (path, text) => {
    expect(psyError(refusal(422, { error: "invalid_request", path, problems: [ { error: "invalid_request", path } ] }))).toBe(text);
    expect(psyError(refusal(422, { error: "too_long", path, problems: [ { error: "too_long", path } ] })))
      .toBe(path === "unknown_key" ? PSY_ERRORS.too_long : text);
  });

  it("month_has_problems: a lista nova, uma por registro, com a frase da pendência (P24)", () => {
    const r = psyRefusals(refusal(422, { error: "month_has_problems", problems: [
      { error: "homeless_missing", path: "records.mr1" }, { error: "night_stay_open", path: "records.mr2" } ] }));
    expect(r.map((x) => [ x.path, x.text ])).toEqual([
      [ "records.mr1", "situação de rua do mês não informada" ], [ "records.mr2", "permanência noturna aberta no mês" ] ]);
    expect(psyError(refusal(422, { error: "month_has_problems" }))).toBe(PSY_ERRORS.month_has_problems);
    expect(psyRefusals(refusal(422, { error: "month_has_problems", problems: [ { error: "cid_missing", path: "records.mr3" } ] }))[0].text)
      .toBe("CID ausente");
  });

  it("month_has_problems com o id real (uuid, com hífen): path preservado e frase da pendência", () => {
    const id1 = "3f2b8c1e-9a4d-4e6f-8b2a-1c0d9e8f7a6b";
    const id2 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    expect(id1).toHaveLength(36);
    const r = psyRefusals(refusal(422, { error: "month_has_problems", problems: [
      { error: "homeless_missing", path: `records.${id1}` }, { error: "night_stay_open", path: `records.${id2}` } ] }));
    expect(r.map((x) => [ x.path, x.code, x.text ])).toEqual([
      [ `records.${id1}`, "homeless_missing", "situação de rua do mês não informada" ],
      [ `records.${id2}`, "night_stay_open", "permanência noturna aberta no mês" ] ]);
  });

  it("frases do portão moram aqui", () => {
    expect(NO_CAPS_BEDS).toBe("nenhum CAPS seu tem leitos — só CAPS III, AD III e AD IV");
    expect(NO_ACTIVE_CAPS).toBe("nenhum CAPS ativo nesta cidade");
  });

  it("isStale: não encontrado e encaminhamento já acolhido", () => {
    expect(isStale(refusal(404, { error: "not_found" }))).toBe(true);
    expect(isStale(refusal(409, { error: "referral_not_pending" }))).toBe(true);
    expect(isStale(refusal(409, { error: "bed_taken" }))).toBe(false);
    expect(isStale(new Error("x"))).toBe(false);
  });

  it("unidade CAPS: modalidade obrigatória; classificação 115 opcional com 3 dígitos; telefone 10–11 dígitos; fora do CAPS, nada", () => {
    expect(unitCapsProblems({ kind: "caps", capsModality: "", serviceClassification: "02" }).map((p) => p.path))
      .toEqual([ "caps_modality", "service_classification" ]);
    expect(unitCapsProblems({ kind: "caps", capsModality: "caps_ii", serviceClassification: "002" })).toEqual([]);
    expect(unitCapsProblems({ kind: "caps", capsModality: "caps_ii", serviceClassification: "" })).toEqual([]);
    expect(unitCapsProblems({ kind: "ubs", capsModality: "", serviceClassification: "x" })).toEqual([]);
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("4133334444")).toBeNull();
    expect(phoneProblem("41999998888")).toBeNull();
    expect(phoneProblem("(41) 3333-4444")).toBe(PSY_ERRORS.invalid_phone);
    expect(phoneProblem("413333444")).toBe(PSY_ERRORS.invalid_phone);
  });

  it("rótulos: modalidade, leitos, dia, destino local (R6), CID com ponto (R5), código cru", () => {
    expect(CAPS_MODALITIES).toEqual([ "caps_i", "caps_ii", "caps_iii", "caps_i_child", "caps_ad", "caps_ad_iii", "caps_ad_iv" ]);
    expect(CAPS_MODALITIES.filter(hasBeds)).toEqual([ "caps_iii", "caps_ad_iii", "caps_ad_iv" ]);
    expect(hasBeds(null)).toBe(false);
    expect(modalityLabel("caps_i_child")).toBe("CAPS i (infantojuvenil)");
    expect(modalityLabel("caps_x")).toBe("caps_x");
    expect(weekdayLabel(1)).toBe("segunda");
    expect(weekdayLabel(7)).toBe("domingo");
    expect(weekdayLabel(8)).toBe("8");
    expect(Object.keys(DESTINATION_LABEL)).toEqual([ "00", "01", "02", "03", "04", "05", "06", "07" ]);
    expect(destinationLabel("03")).toBe("Encaminhamento para a atenção básica");
    expect(destinationLabel("08")).toBe("08");
    expect(codeLabel(OPTIONS.origins, "02")).toBe("Atenção básica");
    expect(codeLabel(OPTIONS.origins, "77")).toBe("77");
    expect(cidLabel("F322")).toBe("F32.2");
    expect(cidLabel("F10")).toBe("F10");
    expect(cidLabel("F32.2")).toBe("F32.2");
    expect(cidLabel("f1020")).toBe("F10.20");
    expect(countLabel("lt5")).toBe("menos de 5");
    expect(countLabel(0)).toBe("0");
    expect(countLabel(12)).toBe("12");
  });

  it("matrícula: CID, origem, técnico, CNES da USF quando coberto, '99' sozinho, início entre 12 meses atrás e hoje", () => {
    const d = { ...emptyEnrollmentDraft(TODAY31, "u-1"), origin: "01", cidMain: { code: "F322", label: "x" }, substances: [ "99" ] };
    expect(enrollmentProblems(d, TODAY31)).toEqual([]);
    const at = (o: object) => enrollmentProblems({ ...d, ...o }, TODAY31).map((p) => p.path);
    expect(at({ cidMain: null })).toEqual([ "cid_main" ]);
    expect(at({ origin: "" })).toEqual([ "origin" ]);
    expect(at({ esfCovered: true, esfCnes: "123" })).toEqual([ "esf_cnes" ]);
    expect(at({ esfCovered: true, esfCnes: "2384299" })).toEqual([]);
    expect(at({ substances: [ "99", "01" ] })).toEqual([ "substances" ]);
    expect(at({ substances: [] })).toEqual([ "substances" ]);
    expect(at({ substances: [ "01", "02" ] })).toEqual([]);
    expect(at({ startedOn: "2026-11-05" })).toEqual([ "started_on" ]);
    expect(at({ startedOn: "2025-11-01" })).toEqual([]);
    expect(at({ startedOn: "2025-10-31" })).toEqual([ "started_on" ]);
    expect(at({ referenceUserId: "" })).toEqual([ "reference_user_id" ]);
    expect(at({ cidSecondary: [ 1, 2, 3, 4, 5 ].map((n) => ({ code: `F4${n}`, label: "" })) })).toEqual([ "cid_secondary" ]);
    expect(enrollmentProblems({ ...d, startedOn: "" }, TODAY31)[0].text).toBe("o início vai de 01/11/2025 até hoje — nunca futuro");
    // Janeiro: o piso volta ao ano anterior.
    expect(enrollmentProblems({ ...d, startedOn: "2025-01-01" }, "2026-01-15")).toEqual([]);
    expect(enrollmentProblems({ ...d, startedOn: "2024-12-31" }, "2026-01-15").map((p) => p.path)).toEqual([ "started_on" ]);
  });

  it("matrícula: corpo sem esf_cnes quando não coberto e sem secundários vazios", () => {
    const d = { ...emptyEnrollmentDraft(TODAY31, "u-1"), origin: "01", cidMain: { code: "F322", label: "x" }, substances: [ "99" ], esfCnes: "999" };
    expect(enrollmentInput(d, "caps2", "pt1")).toEqual({ health_unit_id: "caps2", patient_id: "pt1", started_on: TODAY31, origin: "01",
      cid_main: "F322", substances: [ "99" ], esf_covered: false, reference_user_id: "u-1" });
    expect(enrollmentInput({ ...d, esfCovered: true, esfCnes: " 2384299 ", cidSecondary: [ { code: "F100", label: "" } ] }, "caps2", "pt1"))
      .toMatchObject({ esf_covered: true, esf_cnes: "2384299", cid_secondary: [ "F100" ] });
  });

  it("ação: crítica local com max_quantity e requires_authorization (R2/P56); sem eles, não restringe", () => {
    expect(paths(actionBase())).toEqual([]);
    expect(paths(actionBase({ performedAt: "2026-11-04T11:00" }))).toEqual([ "performed_at" ]);
    expect(paths(actionBase({ performedAt: "ontem" }))).toEqual([ "performed_at" ]);
    expect(paths(actionBase({ quantity: "32" }))).toEqual([ "quantity" ]);
    expect(actionProblems(actionBase({ quantity: "32" }), proc("0301080208"), NOW31)[0].text).toContain("(máximo 31)");
    expect(paths(actionBase({ quantity: "31" }))).toEqual([]);
    expect(paths(actionBase({ quantity: "1.5" }))).toEqual([ "quantity" ]);
    expect(paths(actionBase({ quantity: "0" }))).toEqual([ "quantity" ]);
    expect(paths(actionBase({ quantity: "1000" }), "0301080305")).toEqual([ "quantity" ]);
    // 0301080291 exige autorização; 13 dígitos exatos quando preenchida.
    expect(paths(actionBase({ sigtapCode: "0301080291" }))).toEqual([ "authorization_number" ]);
    expect(paths(actionBase({ sigtapCode: "0301080291", authorizationNumber: "1234567890123" }))).toEqual([]);
    expect(paths(actionBase({ authorizationNumber: "123" }))).toEqual([ "authorization_number" ]);
    // max_quantity e requires_authorization ausentes (api antigo): só a forma.
    const loose = { ...proc("0301080291")!, max_quantity: undefined, requires_authorization: undefined } as unknown as Parameters<typeof actionProblems>[1];
    expect(actionProblems(actionBase({ sigtapCode: "0301080291", quantity: "500" }), loose, NOW31)).toEqual([]);
    expect(paths(actionBase({ sigtapCode: "" }), "")).toEqual([ "sigtap_code" ]);
  });

  it("ação: familiar só no atendimento familiar, nome 3–120; RAAS sem matriculado; BPA-I com um usuário; repetido; evolução", () => {
    const family = { kind: "family" as const, name: "Joana Silva" };
    const maria = { kind: "enrollment" as const, enrollmentId: "en1", name: "Maria" };
    expect(paths(actionBase({ participants: [ maria, family ] }))).toEqual([ "participants[1].family_name" ]);
    expect(paths(actionBase({ sigtapCode: "0301080224", participants: [ maria, family ] }))).toEqual([]);
    expect(paths(actionBase({ sigtapCode: "0301080224", participants: [ maria, { kind: "family", name: "Jo" } ] })))
      .toEqual([ "participants[1].family_name" ]);
    // 0301080208 só tem 09: sem matriculado → enrollment_required em `participants`.
    expect(paths(actionBase({ participants: [] }))).toEqual([ "participants" ]);
    expect(paths(actionBase({ participants: [ { kind: "patient", patientId: "pt9", name: "X" } ] }))).toEqual([ "participants" ]);
    // 0301080232 tem 02 e 09: sem matriculado vira BPA-I, que pede exatamente um usuário.
    expect(paths(actionBase({ sigtapCode: "0301080232", participants: [ { kind: "patient", patientId: "pt9", name: "X" } ] }))).toEqual([]);
    expect(paths(actionBase({ sigtapCode: "0301080232", participants: [] }))).toEqual([ "participants" ]);
    expect(actionProblems(actionBase({ sigtapCode: "0301080232", participants: [] }), proc("0301080232"), NOW31)[0].text)
      .toBe(PSY_ERRORS.bpa_i_single_patient);
    // BPA-C (01) aceita zero participantes; código fora de `options`, nada a conferir.
    expect(paths(actionBase({ sigtapCode: "0301080305", participants: [] }))).toEqual([]);
    expect(paths(actionBase({ sigtapCode: "0301080313", participants: [] }))).toEqual([]);
    expect(paths(actionBase({ participants: [ maria, maria ] }))).toEqual([ "participants[1]" ]);
    expect(paths(actionBase({ sigtapCode: "0301080305", participants: Array.from({ length: 101 }, (_, i) => ({ kind: "patient" as const,
      patientId: `p${i}`, name: "" })) }))).toEqual([ "participants" ]);
    expect(paths(actionBase({ notes: "x".repeat(4001) }))).toEqual([ "notes" ]);
    expect(paths(actionBase({ notes: ` ${"x".repeat(4000)} ` }))).toEqual([]);
  });

  it("ação: corpo com hora da cidade, quantidade número, ids certos; vazios não vão", () => {
    const body = actionInput(actionBase({ sigtapCode: "0301080224", notes: "  Relata melhora  ", participants: [
      { kind: "enrollment", enrollmentId: "en1", name: "Maria" }, { kind: "patient", patientId: "pt2", name: "José" },
      { kind: "family", name: " Joana Silva " } ] }), "caps2");
    expect(body).toEqual({ health_unit_id: "caps2", sigtap_code: "0301080224", performed_at: "2026-11-04T09:00:00-03:00", place: "caps",
      quantity: 1, notes: "Relata melhora",
      participants: [ { enrollment_id: "en1" }, { patient_id: "pt2" }, { family_name: "Joana Silva" } ] });
    expect(actionInput(actionBase({ authorizationNumber: "1234567890123", groupId: "g1", notes: "   " }), "caps2"))
      .toMatchObject({ authorization_number: "1234567890123", group_id: "g1" });
    expect("notes" in actionInput(actionBase({ notes: "   " }), "caps2")).toBe(false);
    expect(emptyActionDraft(NOW31)).toMatchObject({ performedAt: "2026-11-04T10:00", place: "caps", quantity: "1", groupId: null, participants: [] });
  });

  it("PTS: limites do api (necessidades 1–4000, objetivo 1–500 com responsável, 1–20 objetivos, revisão até hoje + 365)", () => {
    const d: CarePlanDraft = { needs: "Insônia", goals: [ { text: "Dormir", responsibleUserId: "u-1", dueOn: "" } ], intensity: "intensive",
      reviewOn: "2026-12-01" };
    expect(carePlanProblems(d, TODAY31)).toEqual([]);
    const at = (o: Partial<CarePlanDraft>) => carePlanProblems({ ...d, ...o }, TODAY31).map((p) => p.path);
    expect(at({ needs: "  " })).toEqual([ "needs" ]);
    expect(at({ needs: "x".repeat(4001) })).toEqual([ "needs" ]);
    expect(at({ goals: [] })).toEqual([ "goals" ]);
    expect(at({ goals: [ { text: "", responsibleUserId: "", dueOn: "" } ] })).toEqual([ "goals[0].text", "goals[0].responsible_user_id" ]);
    expect(at({ goals: [ { text: "x".repeat(501), responsibleUserId: "u-1", dueOn: "" } ] })).toEqual([ "goals[0].text" ]);
    expect(at({ goals: Array.from({ length: 21 }, () => d.goals[0]) })).toEqual([ "goals" ]);
    expect(at({ intensity: "" })).toEqual([ "intensity" ]);
    expect(at({ reviewOn: TODAY31 })).toEqual([ "review_on" ]);
    expect(at({ reviewOn: "2027-11-04" })).toEqual([]);
    expect(at({ reviewOn: "2027-11-05" })).toEqual([ "review_on" ]);
    expect(carePlanInput({ ...d, needs: " Insônia ", goals: [ { text: " Dormir ", responsibleUserId: "u-1", dueOn: "2026-11-30" },
      { text: "Grupo", responsibleUserId: "u-2", dueOn: "" } ] })).toEqual({ needs: "Insônia", intensity: "intensive", review_on: "2026-12-01",
      goals: [ { text: "Dormir", responsible_user_id: "u-1", due_on: "2026-11-30" }, { text: "Grupo", responsible_user_id: "u-2" } ] });
  });

  it("regras da cidade: janela 7–90, noites 1–90, prazo do PTS 30–365 (api)", () => {
    expect(settingsProblems(psySettings())).toEqual([]);
    const s = psySettings({ care_plan_review_days: 29, night_limits: { caps_iii: { consecutive: 0, alternate: 10, window_days: 91 },
      caps_ad_iii: { total: 14, window_days: 6 }, caps_ad_iv: { total: 1.5, window_days: 30 } } });
    expect(settingsProblems(s).map((p) => p.path)).toEqual([ "night_limits.caps_iii.consecutive", "night_limits.caps_iii.window_days",
      "night_limits.caps_ad_iii.window_days", "night_limits.caps_ad_iv.total", "care_plan_review_days" ]);
    expect(settingsProblems(psySettings({ care_plan_review_days: 366 })).map((p) => p.path)).toEqual([ "care_plan_review_days" ]);
    expect(settingsProblems(psySettings({ care_plan_review_days: 30 }))).toEqual([]);
  });

  it("textos e motivos medem sem os espaços das pontas", () => {
    expect(reasonProblem("  123456789  ")).toBe(REASON_TEXT);
    expect(reasonProblem("1234567890")).toBeNull();
    expect(reasonProblem("x".repeat(501))).toBe(REASON_TEXT);
    expect(reasonProblem("x".repeat(2000), 10, 2000)).toBeNull();
    expect(reasonProblem("x".repeat(2001), 10, 2000)).toBe("o motivo tem de 10 a 2000 caracteres");
    expect(textProblem("  ab ", 3, 120, "nome do familiar")).toBe("nome do familiar: de 3 a 120 caracteres");
    expect(textProblem("Ana", 3, 120, "nome do familiar")).toBeNull();
  });

  it("prescritor é CBO 2251, 2252 ou 2253 (P50)", () => {
    expect(isPrescriber("225133")).toBe(true);
    expect(isPrescriber("225270")).toBe(true);
    expect(isPrescriber("225320")).toBe(true);
    expect(isPrescriber("225410")).toBe(false);
    expect(isPrescriber("251510")).toBe(false);
    expect(isPrescriber(null)).toBe(false);
  });
});

describe("usuários do CAPS: edição, encerramento e PTS (Task 6)", () => {
  const base = enrollment();
  const draft = () => enrollmentDraftOf(base);

  it("PATCH só com o que mudou: CID com ou sem ponto, substâncias em outra ordem e próximo atendimento igual não vão", () => {
    expect(enrollmentPatch(draft(), nextVisitInput(base.next_visit_at), base)).toEqual({});
    const d = { ...draft(), cidMain: { code: "F32.2", label: "Episódio depressivo grave" } };
    expect(enrollmentPatch(d, nextVisitInput(base.next_visit_at), base)).toEqual({});
    const two = enrollment({ substances: [ "01", "02" ] });
    expect(enrollmentPatch({ ...enrollmentDraftOf(two), substances: [ "02", "01" ] }, nextVisitInput(two.next_visit_at), two)).toEqual({});
    expect(enrollmentPatch(draft(), "", base)).toEqual({ next_visit_at: null });
    expect(enrollmentPatch({ ...draft(), cidSecondary: [ { code: "F41.1", label: "" } ] }, nextVisitInput(base.next_visit_at), base))
      .toEqual({ cid_secondary: [ "F41.1" ] });
  });

  it("ESF: tirar a cobertura manda só esf_covered; trocar o CNES manda o CNES aparado", () => {
    const visit = nextVisitInput(base.next_visit_at);
    expect(enrollmentPatch({ ...draft(), esfCovered: false, esfCnes: "" }, visit, base)).toEqual({ esf_covered: false });
    expect(enrollmentPatch({ ...draft(), esfCnes: " 1234567 " }, visit, base)).toEqual({ esf_cnes: "1234567" });
  });

  it("o piso do início só vale para início novo", () => {
    const old = enrollment({ started_on: "2025-06-01" });
    expect(enrollmentEditProblems(enrollmentDraftOf(old), "", old, TODAY31)).toEqual([]);
    expect(enrollmentEditProblems({ ...enrollmentDraftOf(old), startedOn: "2025-07-01" }, "", old, TODAY31).map((p) => p.path)).toEqual([ "started_on" ]);
    expect(enrollmentEditProblems(enrollmentDraftOf(old), "2026-11-10", old, TODAY31)).toEqual([ { path: "next_visit_at", text: NEXT_VISIT_TEXT } ]);
  });

  it("encerramento: destino e data conferidos de uma vez", () => {
    expect(closeProblems({ destination: "00", closedOn: "2026-11-05" }, TODAY31, "2026-09-10")).toEqual([
      { path: "destination", text: PSY_ERRORS.destination_is_permanence }, { path: "closed_on", text: PSY_ERRORS.closed_on_in_future }
    ]);
    expect(closeProblems({ destination: "", closedOn: "2026-09-01" }, TODAY31, "2026-09-10")).toEqual([
      { path: "destination", text: CLOSE_DESTINATION_TEXT }, { path: "closed_on", text: CLOSE_BEFORE_START }
    ]);
    expect(closeProblems({ destination: "01", closedOn: TODAY31 }, TODAY31, "2026-09-10")).toEqual([]);
  });

  it("vencido calculado na tela; título da versão; nome sem acento e sem caixa", () => {
    expect(carePlanOverdue("2026-11-03", TODAY31)).toBe(true);
    expect(carePlanOverdue(TODAY31, TODAY31)).toBe(false);
    expect(carePlanOverdue(null, TODAY31)).toBe(false);
    expect(carePlanTitle(2, "2026-11-01", true)).toBe("Versão 2 · revisão vencida em 01/11/2026");
    expect(carePlanTitle(1, "2026-12-01", false)).toBe("Versão 1");
    expect(foldName(" JOSÉ ")).toBe("jose");
    expect(cidKey("f32.2")).toBe("F322");
  });
});
