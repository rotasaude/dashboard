// src/lib/campaigns.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Criterion } from "./api";
import {
  CRITERION_KINDS, addDays, audienceProblem, buildAudience, campaignError, campaignErrorCode, campaignErrorOrNull,
  draftFromAudience, emptyAudienceDraft, isEditable, newCriterion, todayInCity, validateCampaignFields,
  validateCriterion, validateGeo, validateSendAt, type AudienceDraft
} from "./campaigns";

const TODAY = "2026-09-29";
const draftOf = (geo: AudienceDraft["geo"], criteria: Criterion[] = []): AudienceDraft =>
  ({ geo, criteria: criteria.map((criterion, i) => ({ key: `k${i}`, criterion })) });

describe("hoje na cidade", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: [ "Date" ] }));
  afterEach(() => vi.useRealTimers());

  it("hoje é o dia da cidade, mesmo às 23h30 (já é amanhã em UTC)", () => {
    vi.setSystemTime(new Date("2026-09-29T23:30:00-03:00"));
    expect(todayInCity()).toBe("2026-09-29");
    expect(validateCriterion({ kind: "appointment_no_show", from: "2026-09-29", to: "2026-09-30" }, todayInCity()))
      .toBe("o período não pode terminar no futuro");
  });

  it("addDays atravessa mês sem depender do fuso", () => {
    expect(addDays("2026-09-29", -29)).toBe("2026-08-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("newCriterion", () => {
  it("os 7 tipos, na ordem do menu", () => {
    expect(CRITERION_KINDS).toEqual([
      "protocol_period", "triage_tier", "triage_incomplete", "attendance_outcome",
      "triaged_not_attended", "appointment_no_show", "appointment_request_open"
    ]);
  });

  it("período padrão: os últimos 30 dias, terminando hoje", () => {
    expect(newCriterion("appointment_no_show", TODAY)).toEqual({ kind: "appointment_no_show", from: "2026-08-31", to: TODAY });
    expect(newCriterion("protocol_period", TODAY)).toEqual({ kind: "protocol_period", protocol_name: "", from: "2026-08-31", to: TODAY });
    expect(newCriterion("triage_tier", TODAY)).toMatchObject({ tiers: [] });
    expect(newCriterion("attendance_outcome", TODAY)).toMatchObject({ outcomes: [] });
  });

  it("pedido de agendamento aberto não tem período", () => {
    expect(newCriterion("appointment_request_open", TODAY)).toEqual({ kind: "appointment_request_open" });
  });
});

describe("validateCriterion", () => {
  it("período: vazio, invertido e no futuro", () => {
    expect(validateCriterion({ kind: "triage_incomplete", from: "", to: TODAY }, TODAY)).toBe("informe o período (de e até)");
    expect(validateCriterion({ kind: "triage_incomplete", from: "2026-09-10", to: "2026-09-01" }, TODAY))
      .toBe("a data inicial é depois da final");
    expect(validateCriterion({ kind: "triage_incomplete", from: "2026-09-01", to: "2026-09-30" }, TODAY))
      .toBe("o período não pode terminar no futuro");
    expect(validateCriterion({ kind: "triage_incomplete", from: TODAY, to: TODAY }, TODAY)).toBeNull();
  });

  it("campos obrigatórios de cada tipo", () => {
    expect(validateCriterion(newCriterion("protocol_period", TODAY), TODAY)).toBe("escolha o protocolo");
    expect(validateCriterion(newCriterion("triage_tier", TODAY), TODAY)).toBe("marque ao menos uma faixa");
    expect(validateCriterion(newCriterion("attendance_outcome", TODAY), TODAY)).toBe("marque ao menos um desfecho");
    expect(validateCriterion(newCriterion("appointment_request_open", TODAY), TODAY)).toBeNull();
  });
});

describe("validateGeo e audienceProblem", () => {
  it("unidade sem escolha e bairros vazios ou demais", () => {
    expect(validateGeo({ scope: "city" })).toBeNull();
    expect(validateGeo({ scope: "unit", health_unit_id: "" })).toBe("escolha a unidade de referência");
    expect(validateGeo({ scope: "neighborhoods", neighborhood_ids: [] })).toBe("escolha ao menos um bairro");
    const many = Array.from({ length: 51 }, (_, i) => `b${i}`);
    expect(validateGeo({ scope: "neighborhoods", neighborhood_ids: many })).toBe("no máximo 50 bairros");
  });

  it("diz qual cartão está incompleto", () => {
    expect(audienceProblem(draftOf({ scope: "city" }, [ newCriterion("triage_tier", TODAY) ]), TODAY))
      .toBe("Faixa da triagem: marque ao menos uma faixa");
    expect(audienceProblem(emptyAudienceDraft(), TODAY)).toBeNull();
  });

  it("mais de 7 critérios", () => {
    const eight = Array.from({ length: 8 }, () => newCriterion("appointment_no_show", TODAY));
    expect(audienceProblem(draftOf({ scope: "city" }, eight), TODAY)).toBe("no máximo 7 critérios");
  });
});

describe("buildAudience", () => {
  it("monta a versão 1 sem as chaves dos cartões", () => {
    const draft = draftOf({ scope: "neighborhoods", neighborhood_ids: [ "n1", "n2", "n1" ] },
      [ { kind: "appointment_no_show", from: "2026-07-01", to: "2026-09-29" } ]);
    expect(buildAudience(draft)).toEqual({
      version: 1,
      geo: { scope: "neighborhoods", neighborhood_ids: [ "n1", "n2" ] },
      clinical: { all: [ { kind: "appointment_no_show", from: "2026-07-01", to: "2026-09-29" } ] }
    });
  });

  it("campo opcional em branco sai do JSON (o schema recusa campo inválido)", () => {
    const draft = draftOf({ scope: "city" }, [
      { kind: "attendance_outcome", outcomes: [ "referred" ], health_unit_id: undefined, from: TODAY, to: TODAY },
      { kind: "appointment_request_open", kinds: [], target_unit_id: undefined }
    ]);
    const json = JSON.parse(JSON.stringify(buildAudience(draft)));
    expect(json.clinical.all[0]).toEqual({ kind: "attendance_outcome", outcomes: [ "referred" ], from: TODAY, to: TODAY });
    expect(json.clinical.all[1]).toEqual({ kind: "appointment_request_open" });
    expect("health_unit_id" in json.clinical.all[0]).toBe(false);
  });

  it("opcional preenchido vai junto", () => {
    const draft = draftOf({ scope: "unit", health_unit_id: "u1" }, [
      { kind: "appointment_request_open", kinds: [ "return" ], target_unit_id: "u2" }
    ]);
    expect(buildAudience(draft).clinical.all[0]).toEqual({ kind: "appointment_request_open", kinds: [ "return" ], target_unit_id: "u2" });
  });

  it("draftFromAudience ida e volta, com chaves únicas", () => {
    const audience = buildAudience(draftOf({ scope: "city" }, [
      newCriterion("appointment_no_show", TODAY), newCriterion("triage_incomplete", TODAY)
    ]));
    const draft = draftFromAudience(audience);
    expect(new Set(draft.criteria.map((d) => d.key)).size).toBe(2);
    expect(buildAudience(draft)).toEqual(audience);
  });
});

describe("campos da campanha e estado", () => {
  it("título de 3 a 120 e texto de 10 a 2000, aparados", () => {
    expect(validateCampaignFields("  ab ", "texto suficiente")).toBe("o título precisa ter de 3 a 120 caracteres");
    expect(validateCampaignFields("a".repeat(121), "texto suficiente")).toBe("o título precisa ter de 3 a 120 caracteres");
    expect(validateCampaignFields("Vacina", " curto    ")).toBe("o texto precisa ter de 10 a 2000 caracteres");
    expect(validateCampaignFields("Vacina", "x".repeat(2001))).toBe("o texto precisa ter de 10 a 2000 caracteres");
    expect(validateCampaignFields(" Vacina ", "Vacinação no sábado.")).toBeNull();
  });

  it("só rascunho é editável", () => {
    expect(isEditable("draft")).toBe(true);
    for (const s of [ "scheduled", "sending", "sent", "cancelled", "failed" ] as const) expect(isEditable(s)).toBe(false);
  });
});

describe("validateSendAt", () => {
  const now = new Date("2026-09-29T10:00:00-03:00");

  it("hora de parede da cidade vira instante", () => {
    expect(validateSendAt("2026-09-29T14:30", now)).toEqual({ ok: true, iso: "2026-09-29T17:30:00.000Z" });
  });

  it("de 5 minutos a 90 dias", () => {
    expect(validateSendAt("2026-09-29T10:04", now)).toEqual({ ok: false, message: "agende para pelo menos 5 minutos a partir de agora" });
    expect(validateSendAt("2026-09-29T10:05", now).ok).toBe(true);
    expect(validateSendAt("2026-12-28T10:00", now).ok).toBe(true);
    expect(validateSendAt("2026-12-28T10:01", now)).toEqual({ ok: false, message: "agende para no máximo 90 dias a partir de agora" });
  });

  it("vazio", () => {
    expect(validateSendAt("", now)).toEqual({ ok: false, message: "informe data e hora do envio" });
  });
});

describe("recusas", () => {
  const err = (status: number, body: unknown) => new ApiError(status, body, String(status));

  it("traduz os códigos do contrato", () => {
    expect(campaignError(err(422, { error: "below_minimum" }))).toBe("o público tem menos de 5 telefones — ajuste o público");
    expect(campaignError(err(422, { error: "not_editable" }))).toBe("esta campanha não é mais rascunho — volte à lista e abra de novo");
    expect(campaignError(err(422, { error: "invalid_transition" })))
      .toBe("a campanha mudou de estado enquanto você decidia — volte à lista e abra de novo");
    expect(campaignError(err(422, { error: "invalid_send_at" })))
      .toBe("horário fora da janela: agende de 5 minutos a 90 dias a partir de agora");
    expect(campaignError(err(422, { error: "invalid_campaign", details: [] })))
      .toBe("confira o título (3 a 120 caracteres) e o texto (10 a 2000)");
    expect(campaignError(err(404, { error: "not_found" }))).toBe("campanha não encontrada — volte à lista");
    expect(campaignError(err(403, { error: "missing_role" }))).toBe("seu papel não permite esta ação");
  });

  it("invalid_audience: bairro ou unidade inativa, sem imprimir o ponteiro", () => {
    const text = campaignError(err(422, { error: "invalid_audience", details: [ { path: "/geo/neighborhood_ids/1", message: "inactive_or_unknown" } ] }));
    expect(text).toBe("há bairro ou unidade inativa no recorte — desmarque ou troque");
    expect(text).not.toContain("/geo");
  });

  it("invalid_audience: outros códigos dão o texto genérico, sem o ponteiro", () => {
    const text = campaignError(err(422, { error: "invalid_audience", details: [ { path: "/clinical/all/0/from", message: "invalid_date" } ] }));
    expect(text).toBe("público inválido — confira o recorte e os critérios");
    expect(text).not.toContain("/clinical");
    expect(campaignError(err(422, { error: "invalid_audience" }))).toBe("público inválido — confira o recorte e os critérios");
  });

  it("HTML: validação local e recusa html_not_allowed do api", () => {
    const msg = "não use HTML no título nem no texto";
    expect(validateCampaignFields("<b>Vacina</b>", "texto suficiente")).toBe(msg);
    expect(validateCampaignFields("Vacina", "veja <a href=x>aqui</a> agora")).toBe(msg);
    expect(validateCampaignFields("Vacina", "2 < 3 e 5 > 4 sempre")).toBeNull();
    expect(campaignError(err(422, { error: "invalid_campaign", details: [ { path: "/body", message: "html_not_allowed" } ] }))).toBe(msg);
    expect(campaignError(err(422, { error: "invalid_campaign", details: [ { path: "/title", message: "length" } ] })))
      .toBe("confira o título (3 a 120 caracteres) e o texto (10 a 2000)");
  });

  it("chave de SMS: invalid_setting e city_profile_missing", () => {
    expect(campaignError(err(422, { error: "invalid_setting" }))).toBe("valor inválido para a chave de SMS");
    expect(campaignError(err(409, { error: "city_profile_missing" })))
      .toBe("a cidade ainda não tem perfil configurado; fale com o suporte");
  });

  it("401, rede e código desconhecido", () => {
    expect(campaignError(err(401, {}))).toBe("sessão expirada — entre de novo");
    expect(campaignError(new Error("rede"))).toBe("não foi possível concluir — tente de novo");
    expect(campaignError(err(500, "boom"))).toBe("não foi possível concluir — tente de novo");
  });

  it("variante do SensitiveAction devolve null para o que ela não conhece", () => {
    expect(campaignErrorOrNull(err(401, { error: "mfa_required" }))).toBeNull();
    expect(campaignErrorOrNull(new Error("rede"))).toBeNull();
    expect(campaignErrorOrNull(err(422, { error: "outra_coisa" }))).toBeNull();
    expect(campaignErrorOrNull(err(422, { error: "below_minimum" }))).toBe("o público tem menos de 5 telefones — ajuste o público");
  });

  it("campaignErrorCode lê o código do corpo", () => {
    expect(campaignErrorCode(err(422, { error: "below_minimum" }))).toBe("below_minimum");
    expect(campaignErrorCode(new Error("x"))).toBeNull();
  });
});
