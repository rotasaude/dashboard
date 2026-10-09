import { describe, expect, it } from "vitest";
import { ApiError, type EvaluatedProblem, type PatientProblem } from "./api";
import {
  addExam, addProblem, addendumChanges, addendumProblem, ageLabel, blockedReason, changesLines, checkDraft, cid10Problem,
  codedLabel, consultationError, correctOnset, draftFrom, examsProblem, existingConsultationId, finalizeProblems, markProblem,
  normalizeCid10, onsetInputValue, onsetLabel, parseOnset, problemKey, removeItem, setItemOnset, setJustification
} from "./consultation";
import { consultation, finalized, options, problem } from "../test/consultationFixtures";

const T90 = problem();
const K86 = problem({ id: "pp2", code: "K86", label: "Hipertensão sem complicações", onset_on: null, onset_precision: null });
const err = (status: number, body: unknown) => new ApiError(status, body, String(status));

describe("rascunho ↔ corpo do PATCH", () => {
  it("draftFrom e checkDraft fazem o caminho de volta, com vírgula decimal e tipo vazio como null", () => {
    const d = draftFrom(consultation({ subjective: null, vitals: { temperature_c: 37.8 }, care_type: null }));
    expect(d.soap.subjective).toBe("");
    expect(d.vitals.temperature_c).toBe("37,8");
    const check = checkDraft(d);
    expect(check.input.vitals).toEqual({ temperature_c: 37.8 });
    expect(check.input.care_type).toBeNull();
    expect(check.tooLong).toEqual([]);
  });

  it("sinal fora do plausível fica fora do corpo e aparece em vitalsProblems", () => {
    const d = draftFrom(consultation());
    const check = checkDraft({ ...d, vitals: { ...d.vitals, systolic: "400", diastolic: "90" } });
    expect(check.input.vitals.systolic).toBeUndefined();
    expect(check.vitalsProblems.systolic).toBe("use de 50 a 300 mmHg");
  });

  it("texto acima de 20.000 bloqueia o salvamento e diz qual campo", () => {
    const d = draftFrom(consultation());
    const check = checkDraft({ ...d, soap: { ...d.soap, plan: "x".repeat(20_001) } });
    expect(check.tooLong).toEqual([ "plan" ]);
    expect(blockedReason(check)).toBe("Plano (P) passa de 20.000 caracteres");
    expect(blockedReason(checkDraft(d))).toBeNull();
  });

  it("justificativa do exame vai normalizada; vazia sai do corpo", () => {
    const d = draftFrom(consultation({ exam_requests: [
      { sigtap_code: "0202010503", label: "HbA1c", cid10_justification: "e11.9" },
      { sigtap_code: "0202010295", label: "Glicose", cid10_justification: "" }
    ] }));
    expect(checkDraft(d).input.exam_requests).toEqual([
      { sigtap_code: "0202010503", label: "HbA1c", cid10_justification: "E119" },
      { sigtap_code: "0202010295", label: "Glicose" }
    ]);
  });
});

describe("o que falta para finalizar (espelho dos 422)", () => {
  it("rascunho vazio pede problema, conduta e A ou P, nessa ordem", () => {
    expect(finalizeProblems(checkDraft(draftFrom(consultation())))).toEqual([
      "avalie, inclua ou resolva ao menos um problema",
      "marque ao menos uma conduta",
      "escreva a avaliação (A) ou o plano (P)"
    ]);
  });

  it("só o plano basta; sinais com problema e CID-10 inválido também travam", () => {
    const base = draftFrom(consultation({ plan: "retorno em 30 dias", conducts: [ "9" ],
      evaluated_problems: [ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: "Diabetes", action: "evaluate" } ] }));
    expect(finalizeProblems(checkDraft(base))).toEqual([]);
    const bad = { ...base, vitals: { ...base.vitals, systolic: "150" },
      exams: [ { sigtap_code: "0202010503", label: "HbA1c", cid10_justification: "E1" } ] };
    expect(finalizeProblems(checkDraft(bad))).toEqual([
      "corrija os sinais vitais marcados", "confira o CID-10 da justificativa do exame 0202010503"
    ]);
  });
});

describe("lista de problemas", () => {
  it("avaliar e resolver trocam a ação do mesmo problema, sem duplicar", () => {
    let items = markProblem([], T90, "evaluate");
    items = markProblem(items, T90, "resolve");
    expect(items).toEqual([ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: T90.label, action: "resolve" } ]);
  });

  it("corrigir início leva a data e a precisão", () => {
    const items = correctOnset([], K86, { onset_on: "2018-01-01", onset_precision: "year" });
    expect(items[0]).toMatchObject({ problem_id: "pp2", action: "correct_onset", onset_on: "2018-01-01", onset_precision: "year" });
  });

  it("incluir código novo vira add", () => {
    const out = addProblem([], [ T90 ], "ciap2", { code: "K86", label: "Hipertensão sem complicações" });
    expect(out.notice).toBeNull();
    expect(out.items).toEqual([ { problem_id: null, terminology: "ciap2", code: "K86", label: "Hipertensão sem complicações", action: "add" } ]);
  });

  it("incluir código já ativo marca avaliado e avisa", () => {
    const out = addProblem([], [ T90 ], "ciap2", { code: "T90", label: "Diabetes não insulino-dependente" });
    expect(out.items).toEqual([ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: T90.label, action: "evaluate" } ]);
    expect(out.notice).toBe("T90 já está na lista do paciente — marcado como avaliado");
    const again = addProblem(out.items, [ T90 ], "ciap2", { code: "T90", label: T90.label });
    expect(again.items).toBe(out.items);
    expect(again.notice).toBe("T90 já está na lista do paciente e já foi marcado nesta consulta");
  });

  it("mesmo código em outra terminologia, ou resolvido, entra como add; repetido na consulta não duplica", () => {
    expect(addProblem([], [ T90 ], "cid10", { code: "T90", label: "Sequelas de traumatismo" }).items[0].action).toBe("add");
    const resolved = problem({ status: "resolved" });
    expect(addProblem([], [ resolved ], "ciap2", { code: "T90", label: T90.label }).items[0].action).toBe("add");
    const once = addProblem([], [], "ciap2", { code: "K86", label: "Hipertensão" }).items;
    const twice = addProblem(once, [], "ciap2", { code: "K86", label: "Hipertensão" });
    expect(twice.items).toBe(once);
    expect(twice.notice).toBe("K86 já foi incluído nesta consulta");
  });

  it("chave, início do incluído e remover", () => {
    const items: EvaluatedProblem[] = [
      ...markProblem([], T90, "evaluate"),
      { problem_id: null, terminology: "ciap2", code: "K86", label: "Hipertensão", action: "add" }
    ];
    expect(items.map(problemKey)).toEqual([ "pp1", "ciap2:K86" ]);
    const withOnset = setItemOnset(items, "ciap2:K86", { onset_on: "2020-05-01", onset_precision: "month" });
    expect(withOnset[1]).toMatchObject({ action: "add", onset_on: "2020-05-01", onset_precision: "month" });
    expect(removeItem(withOnset, "pp1").map(problemKey)).toEqual([ "ciap2:K86" ]);
  });
});

describe("início com precisão", () => {
  const today = "2026-10-07";
  it.each([
    [ "year", "2019", { onset_on: "2019-01-01", onset_precision: "year" } ],
    [ "month", "2019-03", { onset_on: "2019-03-01", onset_precision: "month" } ],
    [ "day", "2019-03-12", { onset_on: "2019-03-12", onset_precision: "day" } ],
    [ "month", "2026-10", { onset_on: "2026-10-01", onset_precision: "month" } ],
    [ "day", "2026-10-07", { onset_on: "2026-10-07", onset_precision: "day" } ]
  ] as const)("%s %s é aceito", (precision, text, expected) => {
    expect(parseOnset(precision, text, today)).toEqual(expected);
  });

  it.each([
    [ "year", "19", "informe o ano com 4 dígitos" ],
    [ "year", "1899", "use um ano a partir de 1900" ],
    [ "year", "2027", "o início não pode ser no futuro" ],
    [ "month", "2026-11", "o início não pode ser no futuro" ],
    [ "month", "2019-13", "informe o mês e o ano" ],
    [ "day", "2026-10-08", "o início não pode ser no futuro" ],
    [ "day", "2026-02-30", "informe uma data válida" ],
    [ "day", "", "informe uma data válida" ]
  ] as const)("%s %s é recusado: %s", (precision, text, message) => {
    expect(parseOnset(precision, text, today)).toEqual({ problem: message });
  });

  it("rótulo e valor do campo por precisão", () => {
    expect(onsetLabel("2019-03-12", "day")).toBe("desde 12/03/2019");
    expect(onsetLabel("2019-03-01", "month")).toBe("desde 03/2019");
    expect(onsetLabel("2019-01-01", "year")).toBe("desde 2019");
    expect(onsetLabel(null, null)).toBe("início não informado");
    expect(onsetInputValue("2019-03-01", "month")).toBe("2019-03");
    expect(onsetInputValue("2019-01-01", "year")).toBe("2019");
    expect(onsetInputValue("2019-03-12", "day")).toBe("2019-03-12");
  });
});

describe("exames", () => {
  it("não repete exame e guarda a justificativa como digitada", () => {
    const once = addExam([], { code: "0202010503", label: "HbA1c" });
    expect(addExam(once, { code: "0202010503", label: "HbA1c" })).toBe(once);
    expect(setJustification(once, "0202010503", "e11")[0].cid10_justification).toBe("e11");
  });

  it("CID-10: normaliza e confere o formato", () => {
    expect(normalizeCid10(" e11.9 ")).toBe("E119");
    expect(cid10Problem("E11")).toBeNull();
    expect(cid10Problem("e11.9")).toBeNull();
    expect(cid10Problem("")).toBeNull();
    expect(cid10Problem("E1")).toBe("use um código CID-10, ex.: E11 ou E119");
    expect(examsProblem([ { sigtap_code: "X", label: "x", cid10_justification: "11E" } ])).toBe("confira o CID-10 da justificativa do exame X");
  });
});

describe("adendo", () => {
  it("motivo com 10 caracteres e texto obrigatório", () => {
    expect(addendumProblem("curto", "texto")).toBe("o motivo do adendo precisa de pelo menos 10 caracteres");
    expect(addendumProblem("correção do plano", "  ")).toBe("escreva o texto do adendo");
    expect(addendumProblem("correção do plano", "x".repeat(20_001))).toBe("Texto do adendo passa de 20.000 caracteres");
    expect(addendumProblem("correção do plano", "Retorno em 15 dias.")).toBeNull();
  });

  it("só manda o que mudou", () => {
    const base = finalized();
    expect(addendumChanges(base, { problems: [], conducts: [ "9" ], exams: base.exam_requests })).toBeUndefined();
    expect(addendumChanges(base, { problems: [], conducts: [ "12" ], exams: base.exam_requests })).toEqual({ conducts: [ "12" ] });
    expect(addendumChanges(base, { problems: markProblem([], problem(), "resolve"), conducts: [ "9" ], exams: [] })).toEqual({
      evaluated_problems: [ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: problem().label, action: "resolve" } ],
      exam_requests: []
    });
  });

  it("mantém a justificativa existente e trata chaves ausentes como null", () => {
    const base = finalized();
    const kept = addendumChanges(base, { problems: [], conducts: [ "9" ], exams: [ ...base.exam_requests, { sigtap_code: "1", label: "x" } ] });
    expect(kept?.exam_requests?.[0]).toEqual({ sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E119" });
    expect(kept?.exam_requests?.[1]).toEqual({ sigtap_code: "1", label: "x" });
    const bare = { id: "pp9", terminology: "ciap2", code: "K86", label: "Hipertensão", status: "active" } as PatientProblem;
    expect(onsetLabel(bare.onset_on, bare.onset_precision)).toBe("início não informado");
    expect(correctOnset([], bare, { onset_on: "2018-01-01", onset_precision: "year" })[0].action).toBe("correct_onset");
    expect(examsProblem([ { sigtap_code: "X", label: "x" } ])).toBeNull();
  });

  it("resumo das mudanças só com códigos e rótulos", () => {
    const label = (code: string) => codedLabel(options().conducts, code);
    expect(changesLines({ evaluated_problems: markProblem([], problem(), "resolve"), conducts: [ "12" ], exam_requests: [] }, label))
      .toEqual([ "Problemas: T90 resolvido", "Condutas: Alta do episódio", "Exames: nenhum" ]);
    expect(changesLines(null, label)).toEqual([]);
  });
});

describe("rótulos e recusas", () => {
  it("idade e rótulo de código", () => {
    expect(ageLabel(1)).toBe("1 ano");
    expect(ageLabel(54)).toBe("54 anos");
    expect(codedLabel(options().care_types, "5")).toBe("Consulta no dia");
    expect(codedLabel(options().care_types, "99")).toBe("99");
    expect(codedLabel(undefined, null)).toBe("—");
  });

  it.each([
    [ 409, { error: "citizen_not_verified" }, "o cadastro desta pessoa não foi validado no balcão — a consulta exige a validação presencial; encerre o atendimento só com o desfecho" ],
    [ 409, { error: "not_caller" }, "só quem chamou o atendimento registra a consulta" ],
    [ 403, { error: "cbo_not_allowed" }, "sua ocupação (CBO) não registra consulta" ],
    [ 403, { error: "feature_disabled", feature: "clinical_record" }, "o prontuário está desligado nesta cidade" ],
    [ 403, { error: "out_of_context" }, "este atendimento não está com você — para ler o prontuário fora do atendimento, use Prontuário com o motivo" ],
    [ 409, { error: "not_draft" }, "esta consulta já foi finalizada — a tela foi atualizada" ],
    [ 422, { error: "patient_name_missing" }, "falta o nome completo do paciente — peça à recepção para completar os nomes no check-in e tente de novo" ],
    [ 422, { error: "cid10_not_allowed_for_cbo" }, "sua ocupação não pode usar CID-10 — troque o problema por um código CIAP-2" ],
    [ 422, { error: "text_too_long", field: "assessment" }, "Avaliação (A) passa de 20.000 caracteres" ],
    [ 422, { error: "implausible_vital", field: "systolic" }, "Pressão sistólica: valor fora do plausível — confira" ],
    [ 403, { error: "opening_required" }, "a abertura justificada terminou ou não existe — abra o prontuário de novo com o motivo" ],
    [ 503, { error: "terminology_unavailable" }, "a terminologia não está disponível agora — tente de novo em instantes" ],
    [ 422, { error: "ciap2_required_for_cbo" }, "Avalie ao menos um problema em CIAP-2 para finalizar: a ficha de quem não é médico não leva CID-10." ],
    [ 409, { error: "consultation_in_progress" }, "Há uma consulta em andamento neste atendimento: finalize-a pela Consulta para encerrar." ],
    [ 422, { error: "referral_required" }, "informe a unidade de destino ou a descrição do encaminhamento" ],
    [ 500, "boom", "não foi possível concluir — tente de novo" ]
  ])("%s %j → frase", (status, body, phrase) => {
    expect(consultationError(err(status, body))).toBe(phrase);
  });

  it("already_exists com o id retoma; sem id (api sem a D1), não", () => {
    expect(existingConsultationId(err(409, { error: "already_exists", consultation_id: "cs1" }))).toBe("cs1");
    expect(existingConsultationId(err(409, { error: "already_exists" }))).toBeNull();
    expect(existingConsultationId(err(409, { error: "not_caller" }))).toBeNull();
    expect(existingConsultationId(new Error("x"))).toBeNull();
  });
});
