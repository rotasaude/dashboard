// src/lib/screening.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  EMPTY_VITALS_FORM, alertField, alertLabel, bmiOf, colorProblem, defaultDueDays, destinationPayload, destinationProblem,
  emptyDestination, needsColorReason, parseVitals, screeningError, vitalsFormFrom, waitLabel, waitedMinutes, type VitalsForm
} from "./screening";

const form = (over: Partial<VitalsForm>): VitalsForm => ({ ...EMPTY_VITALS_FORM, ...over });

describe("sinais vitais", () => {
  it("vazio é válido e não manda nada", () => {
    expect(parseVitals(EMPTY_VITALS_FORM)).toEqual({ vitals: {}, problems: {} });
  });

  it.each([
    [ "systolic", "300", 300 ], [ "systolic", "50", 50 ], [ "spo2", "100", 100 ], [ "temperature_c", "37,8", 37.8 ],
    [ "weight_kg", "0,5", 0.5 ], [ "weight_kg", "72,35", 72.35 ], [ "temperature_c", "37,80", 37.8 ],
    [ "weight_kg", "72,350", 72.35 ], [ "heart_rate", "88,0", 88 ], [ "pain_score", "0", 0 ], [ "capillary_glucose", "800", 800 ]
  ] as const)("%s = %s nas bordas é aceito", (key, text, value) => {
    const extra = key === "systolic" ? { diastolic: "40" } : key === "capillary_glucose" ? { glucose_moment: "random" as const } : {};
    const out = parseVitals(form({ [key]: text, ...extra }));
    expect(out.problems).toEqual({});
    expect(out.vitals[key]).toBe(value);
  });

  it.each([
    [ "systolic", "301", "use de 50 a 300 mmHg" ], [ "heart_rate", "19", "use de 20 a 250 bpm" ],
    [ "spo2", "101", "use de 50 a 100 %" ], [ "temperature_c", "45,1", "use de 30 a 45 °C" ],
    [ "weight_kg", "0,4", "use de 0,5 a 400 kg" ], [ "pain_score", "11", "use de 0 a 10" ],
    [ "capillary_glucose", "801", "use de 10 a 800 mg/dL" ],
    [ "heart_rate", "88,5", "use um número inteiro" ], [ "temperature_c", "37,85", "use até 1 casa decimal" ],
    [ "weight_kg", "70,125", "use até 2 casas decimais" ], [ "height_cm", "1,70m", "use só números" ]
  ] as const)("%s = %s é recusado com a frase", (key, text, problem) => {
    const out = parseVitals(form({ [key]: text }));
    expect(out.problems[key]).toBe(problem);
    expect(key in out.vitals).toBe(false);
  });

  it("pressão: as duas juntas, e a diastólica menor", () => {
    expect(parseVitals(form({ systolic: "120" })).problems.bp).toBe("informe a sistólica e a diastólica juntas");
    expect(parseVitals(form({ systolic: "120" })).vitals).toEqual({});
    const out = parseVitals(form({ systolic: "120", diastolic: "120" }));
    expect(out.problems.diastolic).toBe("a diastólica precisa ser menor que a sistólica");
    expect(out.vitals).toEqual({ systolic: 120 });
    expect(parseVitals(form({ systolic: "185", diastolic: "110" })).vitals).toEqual({ systolic: 185, diastolic: 110 });
  });

  it("glicemia pede o momento; momento sozinho não vai", () => {
    expect(parseVitals(form({ capillary_glucose: "250" })).problems.glucose_moment).toBe("informe o momento da glicemia");
    expect(parseVitals(form({ capillary_glucose: "250", glucose_moment: "fasting" })).vitals)
      .toEqual({ capillary_glucose: 250, glucose_moment: "fasting" });
    expect(parseVitals(form({ glucose_moment: "fasting" })).vitals).toEqual({});
  });

  it("revisão volta ao formulário com vírgula decimal", () => {
    const f = vitalsFormFrom({ systolic: 185, diastolic: 110, temperature_c: 37.8, capillary_glucose: 90, glucose_moment: "random", bmi: 27.7 });
    expect(f.systolic).toBe("185");
    expect(f.temperature_c).toBe("37,8");
    expect(f.glucose_moment).toBe("random");
    expect(f.weight_kg).toBe("");
  });
});

describe("IMC e alertas", () => {
  it("IMC com uma casa; sem peso ou altura, nada", () => {
    expect(bmiOf(80, 170)).toBe(27.7);
    expect(bmiOf(80, undefined)).toBeNull();
    expect(bmiOf(undefined, 170)).toBeNull();
  });

  it("alerta aponta o campo e diz acima ou abaixo; código desconhecido aparece como veio", () => {
    expect(alertField("systolic_high")).toBe("systolic");
    expect(alertField("heart_rate_low")).toBe("heart_rate");
    expect(alertField("glucose_low")).toBe("capillary_glucose");
    expect(alertField("temperature_high")).toBe("temperature_c");
    expect(alertField("pain_severe")).toBe("pain_score");
    expect(alertField("pregnancy_flag")).toBeNull();
    expect(alertField("weird_high")).toBeNull();
    expect(alertLabel("spo2_low")).toBe("Saturação (SpO2): abaixo da faixa de alerta");
    expect(alertLabel("temperature_high")).toBe("Temperatura: acima da faixa de alerta");
    expect(alertLabel("pain_severe")).toBe("Dor (0 a 10): acima da faixa de alerta");
    expect(alertLabel("pregnancy_flag")).toBe("pregnancy_flag");
  });
});

describe("cor", () => {
  it("prazo padrão pela cor; vermelho sem padrão", () => {
    expect([ "red", "yellow", "green", "blue" ].map((c) => defaultDueDays(c as "red"))).toEqual([ null, 7, 15, 30 ]);
    expect(defaultDueDays(null)).toBeNull();
  });

  it("justificativa só quando muda a cor sugerida", () => {
    expect(needsColorReason("red", "red")).toBe(false);
    expect(needsColorReason("red", "yellow")).toBe(true);
    expect(needsColorReason(null, "green")).toBe(false);
    expect(colorProblem(null, null, "")).toBe("escolha a cor final");
    expect(colorProblem("red", "yellow", "curta")).toBe("explique por que a cor final é diferente da sugerida (pelo menos 10 caracteres)");
    expect(colorProblem("red", "yellow", "PA confirmada 150/95")).toBeNull();
    expect(colorProblem(null, "green", "")).toBeNull();
  });
});

describe("destino", () => {
  it("cada destino pede o seu campo", () => {
    const base = emptyDestination("green");
    expect(base.dueDays).toBe("15");
    expect(destinationProblem(base)).toBe("escolha o destino");
    expect(destinationProblem({ ...base, destination: "same_day" })).toBeNull();
    expect(destinationProblem({ ...base, destination: "oriented" })).toBe("escreva a orientação dada");
    expect(destinationProblem({ ...base, destination: "oriented", orientationNote: "x".repeat(501) })).toBe("a orientação passa de 500 caracteres");
    expect(destinationProblem({ ...base, destination: "schedule" })).toBe("escolha o tipo de atendimento");
    expect(destinationProblem({ ...base, destination: "schedule", typeKey: "consulta_medica", dueDays: "0" })).toBe("informe o prazo (1 a 365 dias)");
    expect(destinationProblem({ ...base, destination: "referred" })).toBe("informe a unidade de destino ou a descrição do encaminhamento");
    expect(destinationProblem({ ...base, destination: "referred", referralNote: "CAPS" })).toBeNull();
  });

  it("vermelho começa sem prazo", () => {
    expect(emptyDestination("red").dueDays).toBe("");
  });

  it("o corpo leva só o destino escolhido", () => {
    const base = { ...emptyDestination("yellow"), orientationNote: "rascunho", referralNote: "rascunho" };
    expect(destinationPayload({ ...base, destination: "same_day" })).toEqual({ destination: "same_day" });
    expect(destinationPayload({ ...base, destination: "schedule", typeKey: "consulta_medica", priority: "priority" })).toEqual({
      destination: "schedule", schedule: { appointment_type_key: "consulta_medica", priority: "priority", due_in_days: 7 }
    });
    expect(destinationPayload({ ...base, destination: "oriented", orientationNote: " hidratação " }))
      .toEqual({ destination: "oriented", orientation_note: "hidratação" });
    expect(destinationPayload({ ...base, destination: "referred", referralUnitId: "u2", referralNote: "" }))
      .toEqual({ destination: "referred", referral: { referral_unit_id: "u2" } });
  });
});

describe("espera e erros", () => {
  const now = new Date("2026-10-07T10:00:00-03:00");
  it("minutos desde a chegada, nunca negativo", () => {
    expect(waitedMinutes("2026-10-07T09:20:00-03:00", now)).toBe(40);
    expect(waitedMinutes("2026-10-07T10:05:00-03:00", now)).toBe(0);
    expect(waitLabel(40)).toBe("40 min");
    expect(waitLabel(65)).toBe("1 h 05 min");
  });

  it("implausible_vital diz qual campo; o resto passa por attendanceError", () => {
    expect(screeningError(new ApiError(422, { error: "implausible_vital", field: "spo2" }, "x")))
      .toBe("Saturação (SpO2): valor fora do plausível — confira");
    expect(screeningError(new ApiError(422, { error: "implausible_vital" }, "x")))
      .toBe("um sinal vital está fora do plausível — confira os valores");
    expect(screeningError(new ApiError(409, { error: "already_screening" }, "x")))
      .toBe("outra pessoa já começou a escuta deste atendimento — a fila foi atualizada");
  });

  it.each([
    [ "glucose_moment", "Informe o momento da glicemia." ],
    [ "vitals", "Confira os sinais vitais." ],
    [ "heart_rate", "Frequência cardíaca: valor fora do plausível — confira" ]
  ])("implausible_vital field=%s", (field, phrase) => {
    expect(screeningError(new ApiError(422, { error: "implausible_vital", field }, "x"))).toBe(phrase);
  });

  it.each([
    [ "complaint_note", "A queixa passa de 500 caracteres." ],
    [ "orientation_note", "A orientação passa de 500 caracteres." ],
    [ "color_change_reason", "A justificativa passa de 500 caracteres." ],
    [ "outro", "o texto passa de 500 caracteres" ],
    [ undefined, "o texto passa de 500 caracteres" ]
  ])("note_too_long field=%s", (field, phrase) => {
    expect(screeningError(new ApiError(422, { error: "note_too_long", field }, "x"))).toBe(phrase);
  });
});
