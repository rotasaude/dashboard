import { describe, expect, it } from "vitest";
import type { QuickPatient } from "./api";
import { COLLECTIVE_DOMAINS, TODAY24B, options } from "../test/homeVisitFixtures";
import {
  IDENTIFIER_WARNING, TYPE_5_6_NOT_GENERATED, activityBody, activityProblems, activityWarnings, alteredCount, emptyActivityDraft, fieldRule,
  healthTopicsAllowed, needsProcedure, offeredHealthTopics, offeredPractices, participantWithoutId, pruneActivityDraft, smokingAllowed, type ActivityDraft,
  type ParticipantDraft
} from "./collectiveActivities";

const base = (o: Partial<ActivityDraft> = {}): ActivityDraft => ({ ...emptyActivityDraft(TODAY24B), teamId: "t1", shift: 1, ...o });
const ctx = (o = options()) => ({ options: o, today: TODAY24B });
const paths = (d: ActivityDraft, o = options()) => activityProblems(d, ctx(o)).map((x) => x.path);
const maria: ParticipantDraft = { kind: "patient", patientId: "pa1", displayName: "Maria Lima", hasCpf: true, hasCns: false, altered: true, weight: "72,5", height: "160", smoking: null };
const anon: ParticipantDraft = { kind: "patient", patientId: "pa8", displayName: "Ana Prado", hasCpf: false, hasCns: false, altered: false, weight: "", height: "", smoking: null };
const ok = (o: Partial<ActivityDraft> = {}): ActivityDraft =>
  base({ activityType: 4, place: { kind: "unit", unitId: "u1" }, participantsCount: "10", targetAudience: [ 10 ], healthTopics: [ 4 ], ...o });

describe("regras lidas do dado", () => {
  it("a regra vem do dado: trocar o by_type muda o que a tela pede", () => {
    const d = COLLECTIVE_DOMAINS;
    expect(fieldRule(d, 1, "meeting_topics")).toBe("required");
    expect(fieldRule(d, 5, "participants")).toBe("required");
    expect(fieldRule(d, 9, "participants")).toBe("optional");
    const changed = { ...d, rules: { ...d.rules, by_type: { ...d.rules.by_type, "4": { ...d.rules.by_type["4"], participants: "required" as const } } } };
    expect(fieldRule(changed, 4, "participants")).toBe("required");
    expect(paths(ok(), options())).toEqual([]);
    expect(paths(ok(), options({ domains: changed }))).toEqual([ "participants" ]);
    const noAudience = { ...d, rules: { ...d.rules, by_type: { ...d.rules.by_type, "4": { ...d.rules.by_type["4"], target_audience: "forbidden" as const } } } };
    expect(paths(ok(), options({ domains: noAudience }))).toEqual([ "target_audience" ]);
  });
  it("temas para saúde nas reuniões só com o tema de reunião da exceção; tema 18 nunca", () => {
    const d = COLLECTIVE_DOMAINS;
    expect(healthTopicsAllowed(d, base({ activityType: 1, meetingTopics: [ 1 ] }))).toBe("forbidden");
    expect(healthTopicsAllowed(d, base({ activityType: 1, meetingTopics: [ 6 ] }))).toBe("optional");
    const with18 = { ...d, health_topics: [ ...d.health_topics, { code: 18, label: "Semana saúde na escola" } ] };
    expect(offeredHealthTopics(with18, base({ activityType: 4 })).map((t) => t.code)).not.toContain(18);
    expect(paths(ok({ healthTopics: [ 18 ] }), options({ domains: with18 }))).toEqual([ "health_topics[0]" ]);
  });
  it("práticas: só do tipo 6 ficam fora dos outros; 30 pede SIGTAP; tabagismo só nas práticas da regra", () => {
    const d = COLLECTIVE_DOMAINS;
    expect(offeredPractices(d, 5).map((p) => p.code)).not.toContain(2);
    expect(offeredPractices(d, 6).map((p) => p.code)).toContain(2);
    expect(needsProcedure(d, [ 20, 30 ])).toBe(true);
    expect(smokingAllowed(d, [ 20 ])).toBe(false);
    expect(smokingAllowed(d, [ 25 ])).toBe(true);
    const swapped = { ...d, rules: { ...d.rules, smoking_practices: [ 20 ] } };
    expect(smokingAllowed(swapped, [ 20 ])).toBe(true);
    expect(smokingAllowed(swapped, [ 25 ])).toBe(false);
  });
});

describe("activityProblems", () => {
  it("tipo 5 sem participante, sem público, SIGTAP sem a 30, contagem e local", () => {
    const p = paths(base({ activityType: 5, place: { kind: "text", text: "" }, participantsCount: "0", healthTopics: [ 4 ], procedureCode: "0101050046", participants: [] }));
    expect(p.sort()).toEqual([ "participants", "participants_count", "place_text", "procedure_code", "target_audience" ]);
  });
  it("sem equipe, turno e tipo", () => {
    expect(paths(emptyActivityDraft(TODAY24B)).sort()).toEqual([ "activity_type", "place_health_unit_id", "participants_count", "shift", "team_id" ].sort());
  });
  it("a prática 30 pede o procedimento da lista; fora da lista é recusado", () => {
    expect(paths(ok({ healthPractices: [ 30 ] }), options({ domains: COLLECTIVE_DOMAINS }))).toContain("procedure_code");
  });
  it("procedimento: só um da lista; sem a 30 vazio", () => {
    const base5 = { activityType: 5 as const, place: { kind: "unit" as const, unitId: "u1" }, participantsCount: "1", targetAudience: [ 10 ], healthTopics: [ 4 ], participants: [ maria ] };
    expect(paths(base({ ...base5, healthPractices: [ 30 ], procedureCode: "0101050046" }))).toEqual([]);
    const bad = activityProblems(base({ ...base5, healthPractices: [ 30 ], procedureCode: "9999999999" }), ctx());
    expect(bad).toEqual([ { path: "procedure_code", text: "escolha o procedimento da lista" } ]);
  });
  it("práticas só do tipo 6 fora do 6", () => {
    expect(paths(ok({ activityType: 5, healthPractices: [ 2 ], participants: [ maria ], participantsCount: "1" }))).toEqual([ "health_practices[0]" ]);
  });
  it("lista mais longa que list_max e código repetido ou fora do domínio", () => {
    expect(paths(ok({ targetAudience: Array.from({ length: 18 }, (_, i) => i + 1) }))).toContain("target_audience");
    expect(paths(ok({ targetAudience: [ 10, 10 ] }))).toEqual([ "target_audience[1]" ]);
    expect(paths(ok({ targetAudience: [ 10, 99 ] }))).toEqual([ "target_audience[1]" ]);
  });
  it("contagem de participantes: 1–999 e não menor que a lista", () => {
    expect(paths(ok({ participantsCount: "1000" }))).toEqual([ "participants_count" ]);
    expect(paths(ok({ participantsCount: "abc" }))).toEqual([ "participants_count" ]);
    expect(paths(ok({ participantsCount: "1", participants: [ maria, { ...maria, patientId: "pa2" } ] }))).toEqual([ "participants_count" ]);
  });
  it("data fora de min_date..hoje, unidade sem CNES, profissional sem CNS, local longo", () => {
    expect(paths(ok({ heldOn: "2026-09-30" }))).toEqual([ "held_on" ]);
    expect(paths(ok({ heldOn: "2026-11-13" }))).toEqual([ "held_on" ]);
    expect(paths(ok({ place: { kind: "unit", unitId: "u2" } }))).toEqual([ "place_health_unit_id" ]);
    expect(paths(ok({ professionals: [ "p-acs", "p-sem" ] }))).toEqual([ "professionals[1]" ]);
    expect(paths(ok({ place: { kind: "text", text: "x".repeat(251) } }))).toEqual([ "place_text" ]);
  });
  it("reunião: tema obrigatório e público proibido, pela regra", () => {
    expect(paths(base({ activityType: 1, place: { kind: "text", text: "Sala" }, participantsCount: "5" }))).toEqual([ "meeting_topics" ]);
    expect(paths(base({ activityType: 1, place: { kind: "text", text: "Sala" }, participantsCount: "5", meetingTopics: [ 1 ], targetAudience: [ 10 ] }))).toEqual([ "target_audience" ]);
  });
  it("participante repetido: mesmo paciente, mesmo CPF ou CNS — nunca por nome e nascimento", () => {
    expect(paths(ok({ participantsCount: "2", participants: [ maria, { ...maria } ] }))).toEqual([ "participants[1]" ]);
    const fresh = (cpf: string, cns = "", name = "Beto Souza"): ParticipantDraft =>
      ({ kind: "new", duplicatesReviewed: false, altered: false, weight: "", height: "", smoking: null,
        patient: { full_name: name, birth_date: "1990-01-01", sex: "male", cpf, cns } as unknown as QuickPatient });
    // mesmo CPF (com e sem máscara), nome diferente → repetido
    expect(paths(ok({ participantsCount: "2", participants: [ fresh("529.982.247-25"), fresh("52998224725", "", "Outro Nome") ] }))).toEqual([ "participants[1]" ]);
    // mesmo CNS
    expect(paths(ok({ participantsCount: "2", participants: [ fresh("52998224725", "700000000000005"), fresh("11144477735", "700 0000 0000 0005", "Outro Nome") ] }))).toEqual([ "participants[1]" ]);
    // mesmo nome e nascimento, CPF diferente → quem decide é o api
    expect(paths(ok({ participantsCount: "2", participants: [ fresh("52998224725"), fresh("11144477735") ] }))).toEqual([]);
  });
  it("medidas do participante: faixa e casas (vírgula), e tabagismo só nas práticas da regra", () => {
    expect(paths(ok({ participantsCount: "1", participants: [ { ...maria, weight: "600" } ] }))).toEqual([ "participants[0].measurements.weight_kg" ]);
    expect(paths(ok({ participantsCount: "1", participants: [ { ...maria, weight: "72,12345" } ] }))).toEqual([ "participants[0].measurements.weight_kg" ]);
    expect(paths(ok({ participantsCount: "1", participants: [ { ...maria, height: "160,55" } ] }))).toEqual([ "participants[0].measurements.height_cm" ]);
    const smoker = { ...maria, smoking: { quit: true, dropped_out: false } };
    expect(paths(ok({ participantsCount: "1", participants: [ smoker ] }))).toEqual([ "participants[0].smoking" ]);
    expect(paths(ok({ activityType: 5, participantsCount: "1", healthPractices: [ 25 ], participants: [ smoker ] }))).toEqual([]);
  });
  it("participante novo: problemas do cadastro rápido sob participants[i].new_patient", () => {
    const bad: ParticipantDraft = { kind: "new", duplicatesReviewed: false, altered: false, weight: "", height: "", smoking: null,
      patient: { full_name: "", birth_date: "1990-01-01", sex: "male", cpf: "52998224725" } as unknown as QuickPatient };
    expect(paths(ok({ participantsCount: "1", participants: [ bad ] }))).toEqual([ "participants[0].new_patient.full_name" ]);
  });
});

describe("participante sem CPF e sem CNS", () => {
  const five = (): ActivityDraft => base({ activityType: 5, place: { kind: "unit", unitId: "u1" }, participantsCount: "1", targetAudience: [ 10 ], healthTopics: [ 4 ], participants: [ anon ] });
  it("não bloqueia em nenhum tipo; avisa", () => {
    expect(paths(five())).toEqual([]);
    expect(paths(ok({ participantsCount: "1", participants: [ anon ] }))).toEqual([]);
    expect(participantWithoutId(anon)).toBe(true);
    expect(participantWithoutId(maria)).toBe(false);
  });
  it("aviso por participante e, nos tipos 5 e 6, o de ficha não gerada", () => {
    expect(activityWarnings(five())).toEqual([
      { path: "participants[0]", text: IDENTIFIER_WARNING },
      { path: "participants", text: TYPE_5_6_NOT_GENERATED }
    ]);
    expect(activityWarnings(ok({ participantsCount: "1", participants: [ anon ] }))).toEqual([ { path: "participants[0]", text: IDENTIFIER_WARNING } ]);
    expect(activityWarnings(five()).map((w) => w.text).join(" ")).toContain("nos tipos 5 e 6, a ficha desta atividade não será gerada enquanto algum participante estiver sem CPF e sem CNS");
    expect(activityWarnings(ok({ participantsCount: "1", participants: [ maria ] }))).toEqual([]);
  });
});

describe("activityBody", () => {
  it("forbidden vai como lista vazia; sem altered_count; local é um só", () => {
    const body = activityBody(base({ heldOn: TODAY24B, activityType: 5, place: { kind: "unit", unitId: "u1" },
      participantsCount: "12", targetAudience: [ 10 ], healthTopics: [ 4 ], meetingTopics: [ 6 ], professionals: [ "p-acs" ], participants: [ maria ] }), COLLECTIVE_DOMAINS);
    expect(body).toEqual({ team_id: "t1", held_on: TODAY24B, shift: 1, activity_type: 5, place_health_unit_id: "u1", participants_count: 12,
      meeting_topics: [], target_audience: [ 10 ], health_topics: [ 4 ], health_practices: [], professionals: [ { professional_id: "p-acs" } ],
      participants: [ { patient_id: "pa1", altered_evaluation: true, measurements: { weight_kg: 72.5, height_cm: 160 } } ] });
    expect(body).not.toHaveProperty("altered_count");
    expect(alteredCount(base({ participants: [ maria, { ...maria, altered: false } ] }))).toBe(1);
    expect(alteredCount(base())).toBe(0);
  });
  it("texto, procedimento com a 30, tabagismo nas práticas da regra, novo participante", () => {
    const fresh: ParticipantDraft = { kind: "new", duplicatesReviewed: true, altered: false, weight: "", height: "", smoking: { quit: false, dropped_out: true },
      patient: { full_name: "Beto Souza", birth_date: "1990-01-01", sex: "male", cpf: "52998224725" } as unknown as QuickPatient };
    const body = activityBody(base({ activityType: 6, place: { kind: "text", text: " Praça " }, participantsCount: "3", targetAudience: [ 10 ],
      healthPractices: [ 25, 30 ], procedureCode: "0101050046", participants: [ fresh ] }), COLLECTIVE_DOMAINS);
    expect(body.place_text).toBe("Praça");
    expect(body).not.toHaveProperty("place_health_unit_id");
    expect(body.procedure_code).toBe("0101050046");
    expect(body.participants).toEqual([ { new_patient: fresh.kind === "new" ? fresh.patient : null, duplicates_reviewed: true, smoking: { quit: false, dropped_out: true } } ]);
    const noProc = activityBody(base({ activityType: 6, place: { kind: "text", text: "x" }, participantsCount: "3", targetAudience: [ 10 ], healthPractices: [ 20 ], procedureCode: "0101050046" }), COLLECTIVE_DOMAINS);
    expect(noProc).not.toHaveProperty("procedure_code");
  });
});

// Revisão da Task 3: o limite e a regra vêm do dado; tipo sem regra; corpo com participantes proibidos.
describe("regras trocadas no dado", () => {
  const d = COLLECTIVE_DOMAINS;
  it("list_max trocado: o limite segue o dado", () => {
    const tight = { ...d, rules: { ...d.rules, list_max: { ...d.rules.list_max, target_audience: 1 } } };
    expect(paths(ok({ targetAudience: [ 10, 12 ] }))).toEqual([]);
    expect(paths(ok({ targetAudience: [ 10, 12 ] }), options({ domains: tight }))).toEqual([ "target_audience" ]);
  });
  it("tipo sem regra no by_type: tudo opcional", () => {
    const { "4": _four, ...rest } = d.rules.by_type;
    const noFour = { ...d, rules: { ...d.rules, by_type: rest } };
    expect(fieldRule(noFour, 4, "target_audience")).toBe("optional");
    expect(paths(ok({ targetAudience: [], healthTopics: [] }), options({ domains: noFour }))).toEqual([]);
    expect(paths(ok({ targetAudience: [], healthTopics: [] }))).toEqual([ "target_audience", "health_topics" ]);
  });
  it("tipo que proíbe participantes: o corpo vai sem a lista", () => {
    const noList = { ...d, rules: { ...d.rules, by_type: { ...d.rules.by_type, "4": { ...d.rules.by_type["4"], participants: "forbidden" as const } } } };
    expect(activityBody(ok({ participantsCount: "1", participants: [ maria ] }), noList).participants).toEqual([]);
    expect(paths(ok({ participantsCount: "1", participants: [ maria ] }), options({ domains: noList }))).toEqual([ "participants" ]);
  });
});

describe("pruneActivityDraft", () => {
  const d = COLLECTIVE_DOMAINS;
  it("trocar o tipo limpa o que ficou proibido ou fora do tipo", () => {
    const six = base({ activityType: 6, targetAudience: [ 10 ], healthTopics: [ 4 ], healthPractices: [ 2, 25, 30 ], procedureCode: "0101050046",
      participants: [ { ...maria, smoking: { quit: true, dropped_out: false } } ] });
    const toOne = pruneActivityDraft(d, { ...six, activityType: 1 });
    expect(toOne).toMatchObject({ targetAudience: [], healthTopics: [], healthPractices: [], procedureCode: "" });
    expect(toOne.participants[0].smoking).toBeNull();
    const toFive = pruneActivityDraft(d, { ...six, activityType: 5 });
    expect(toFive).toMatchObject({ targetAudience: [ 10 ], healthTopics: [ 4 ], healthPractices: [ 25, 30 ], procedureCode: "0101050046" });
    expect(toFive.participants[0].smoking).toEqual({ quit: true, dropped_out: false });
  });
  it("tirar o tema de reunião da exceção limpa os temas para saúde; sem a 30, o procedimento", () => {
    const meeting = base({ activityType: 1, meetingTopics: [ 6 ], healthTopics: [ 4 ] });
    expect(pruneActivityDraft(d, meeting).healthTopics).toEqual([ 4 ]);
    expect(pruneActivityDraft(d, { ...meeting, meetingTopics: [ 1 ] }).healthTopics).toEqual([]);
    expect(pruneActivityDraft(d, base({ activityType: 5, healthPractices: [ 20 ], procedureCode: "0101050046" })).procedureCode).toBe("");
  });
  it("participantes proibidos pela regra saem do rascunho", () => {
    const noList = { ...d, rules: { ...d.rules, by_type: { ...d.rules.by_type, "4": { ...d.rules.by_type["4"], participants: "forbidden" as const } } } };
    expect(pruneActivityDraft(noList, ok({ participants: [ maria ] })).participants).toEqual([]);
    expect(pruneActivityDraft(d, ok({ participants: [ maria ] })).participants).toEqual([ maria ]);
  });
});
