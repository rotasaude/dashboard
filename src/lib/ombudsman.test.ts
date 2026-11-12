import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  ACTIONS_BY_STATE, ANONYMOUS_INTERNAL, COLOR_TONE, EXTRACT_NOTICE, MANIFESTATION_CHANGED, OMBUDSMAN_DISABLED, OMBUDSMAN_ERRORS,
  OMBUDSMAN_NO_ROLE, OMB_LIST_KEY, NOMINAL_QUERY, STATIC_QUERY, archiveProblems, archiveReasonLabel, attachmentProblems, availableActions,
  blockedReason, canIssueReceipt, canSeeIdentityButton, canUseOmbudsman, colorLabel, destinationLabel, eventKindLabel, finalResponseProblems,
  forwardProblems, isChanged, kindLabel, nameProblem, needsResolution, newManifestationProblems, ombudsmanError, ombudsmanRefusals,
  ombudsmanRoles, reportTextProblems, settingsProblems, textActionProblems, type NewDraft
} from "./ombudsman";
import { manifestation, ombudsmanUser, options, preserved, settings33 } from "../test/ombudsmanFixtures";

// A lista do api (api-shapes §4); `invalid_request` sem path cai na frase genérica.
const EVERY_CODE = [
  "feature_disabled", "missing_role", "not_found", "link_expired", "manifestation_changed", "forwarding_changed", "already_decided",
  "name_taken", "already_responder", "report_published", "already_published", "too_many_requests", "invalid_request", "invalid_transition",
  "subject_not_leaf", "destination_without_responder", "complement_not_allowed", "complement_already_used", "already_extended",
  "not_allowed_anonymous", "forwarding_pending", "no_identity", "too_many_attachments", "invalid_file", "invalid_cpf", "invalid_cursor",
  "invalid_period", "too_deep", "missing_responder_role", "year_not_closed", "json_required", "unauthenticated"
];
const err = (status: number, body: unknown) => new ApiError(status, body, "x");

describe("frases de erro", () => {
  it("todo código do api tem frase própria; código novo aparece cru", () => {
    for (const code of EVERY_CODE) {
      expect(OMBUDSMAN_ERRORS[code], code).toBeTruthy();
      expect(ombudsmanError(err(422, { error: code })), code).toBe(OMBUDSMAN_ERRORS[code]);
    }
    expect(ombudsmanError(err(422, { error: "brand_new" }))).toBe("recusado pelo servidor (brand_new)");
    expect(ombudsmanError(err(422, { error: "Brand New!" }))).toBe("recusado pelo servidor");
    expect(ombudsmanError(err(403, { error: "feature_disabled", feature: "ombudsman" }))).toBe(OMBUDSMAN_DISABLED);
    expect(ombudsmanError(err(404, { error: "feature_disabled" }))).toBe(OMBUDSMAN_DISABLED);
    expect(ombudsmanError(err(403, { error: "feature_disabled", feature: "pharmacy" }))).toBe("Farmácia e almoxarifado está desligado nesta cidade");
    expect(ombudsmanError(err(403, { error: "missing_role" }))).toBe(OMBUDSMAN_NO_ROLE);
    expect(ombudsmanError(err(401, {}))).toBe("sessão expirada — entre de novo");
    expect(ombudsmanError(err(404, {}))).toBe(OMBUDSMAN_ERRORS.not_found);
    expect(ombudsmanError(new Error("boom"))).toBe("não foi possível falar com o servidor — tente de novo");
  });
  it("frases fixas dos códigos que mudam a tela", () => {
    expect(OMBUDSMAN_ERRORS.manifestation_changed).toBe(MANIFESTATION_CHANGED);
    expect(OMBUDSMAN_ERRORS.destination_without_responder).toBe("este destino não tem respondente ativo — cadastre um na Configuração da ouvidoria");
    expect(OMBUDSMAN_ERRORS.forwarding_pending).toBe("há encaminhamento pendente — cancele ou aguarde a resposta");
    expect(OMBUDSMAN_ERRORS.complement_already_used).toBe("o complemento já foi pedido neste ciclo");
    expect(OMBUDSMAN_ERRORS.already_extended).toBe("a prorrogação já foi usada neste ciclo");
    expect(OMBUDSMAN_ERRORS.no_identity).toBe("não há dados de quem fez esta manifestação");
    expect(OMBUDSMAN_ERRORS.not_allowed_anonymous).toBe("a denúncia anônima não recebe resposta intermediária");
    expect(OMBUDSMAN_ERRORS.already_decided).toBe("este pedido de reabertura já foi decidido");
    expect(OMBUDSMAN_ERRORS.year_not_closed).toBe("o relatório só se publica depois que o ano termina");
    expect(OMBUDSMAN_ERRORS.already_published).toBe(OMBUDSMAN_ERRORS.report_published);
    expect(OMBUDSMAN_ERRORS.invalid_file).toBe("o anexo tem de ser PDF, JPEG ou PNG, de até 10 MB");
    expect(OMBUDSMAN_ERRORS.too_many_attachments).toBe("até 3 anexos");
    expect(EXTRACT_NOTICE).toBe("Não escreva o nome nem dados de quem fez a manifestação.");
    expect(ANONYMOUS_INTERNAL).toBe("Denúncia anônima: a conclusão fica interna e não vai a ninguém.");
  });
  it("invalid_request é traduzido pelo path; path desconhecido aparece cru", () => {
    const body = (path: string) => ({ error: "invalid_request", path, problems: [ { error: "invalid_request", path } ] });
    expect(ombudsmanError(err(422, body("extract")))).toBe("o extrato tem de ter de 20 a 4000 caracteres");
    expect(ombudsmanError(err(422, body("text")))).toBe("o texto tem de ter de 10 a 4000 caracteres");
    expect(ombudsmanError(err(422, body("resolution")))).toBe("informe se foi resolvida (só em reclamação, solicitação e denúncia)");
    expect(ombudsmanError(err(422, body("citizen_id")))).toBe("este cidadão não pode ser ligado — registre nome e contato na manifestação");
    expect(ombudsmanError(err(422, body("duplicate_of_protocol")))).toBe("protocolo da manifestação original não encontrado");
    expect(ombudsmanError(err(422, body("duplicate_of_id")))).toBe("protocolo da manifestação original não encontrado");
    expect(ombudsmanError(err(422, body("q")))).toBe("use o protocolo AAAA-NNNNNN ou só o ano AAAA-");
    expect(ombudsmanError(err(422, body("zzz_new")))).toBe("recusado pelo servidor (invalid_request)");
    expect(ombudsmanError(err(422, body("response_days")))).toBe("o prazo vai de 1 a 120 dias");
    expect(ombudsmanError(err(422, body("notes")))).toBe(reportTextProblems({ recurring_problems: "", actions_taken: "", notes: "x".repeat(8001) })[0].text);
  });
  it("frases por campo podem ser trocadas pela tela (responder e cancelar usam body/reason de outro jeito)", () => {
    const reply = err(422, { error: "invalid_request", path: "body", problems: [ { error: "invalid_request", path: "body" } ] });
    const reason = err(422, { error: "invalid_request", path: "reason", problems: [ { error: "invalid_request", path: "reason" } ] });
    // sem contexto, as frases são neutras (não falam em manifestação nem em arquivamento)
    expect(ombudsmanError(reply)).toMatch(/10 a 4000/);
    expect(ombudsmanError(reason)).toMatch(/10 a 4000/);
    expect(ombudsmanRefusals(reply, { fields: { body: "a resposta tem de ter de 10 a 4000 caracteres" } })[0].text).toBe("a resposta tem de ter de 10 a 4000 caracteres");
    expect(ombudsmanRefusals(reason, { fields: { reason: "o motivo tem de ter de 10 a 4000 caracteres" } })[0].text).toBe("o motivo tem de ter de 10 a 4000 caracteres");
    expect(ombudsmanRefusals(reason, { fields: { body: "x" } })[0].text).toBe(ombudsmanError(reason));
    expect(ombudsmanError(err(422, { error: "invalid_request", path: "health_unit_id" }))).toMatch(/só um destino/);
  });
  it("ombudsmanRefusals: todas de uma vez, com path; sem problems, a do topo; sem eco de texto", () => {
    const r = ombudsmanRefusals(err(422, { error: "invalid_request", path: "text", problems: [
      { error: "invalid_request", path: "text" }, { code: "invalid_cpf", path: "manifestant_cpf" }, { error: "weird text with spaces", path: "x" }
    ] }));
    expect(r.map((x) => [ x.path, x.code ])).toEqual([ [ "text", "invalid_request" ], [ "manifestant_cpf", "invalid_cpf" ], [ "x", "" ] ]);
    expect(r[1].text).toBe("CPF inválido");
    expect(r[2].text).toBe("recusado pelo servidor");
    const top = ombudsmanRefusals(err(409, { error: "forwarding_changed" }));
    expect(top).toEqual([ { path: "", code: "forwarding_changed", text: OMBUDSMAN_ERRORS.forwarding_changed } ]);
    expect(ombudsmanRefusals(err(403, { error: "feature_disabled" }))[0].text).toBe(OMBUDSMAN_DISABLED);
    expect(ombudsmanRefusals(err(422, { error: "subject_not_leaf", path: "subject_id" }))[0].path).toBe("subject_id");
  });
  it("isChanged: 409 manifestation_changed, forwarding_changed e 422 invalid_transition", () => {
    expect(isChanged(err(409, { error: "manifestation_changed" }))).toBe(true);
    expect(isChanged(err(409, { error: "forwarding_changed" }))).toBe(true);
    expect(isChanged(err(422, { error: "invalid_transition" }))).toBe(true);
    expect(isChanged(err(422, { error: "invalid_request" }))).toBe(false);
    expect(isChanged(new Error("x"))).toBe(false);
  });
});

describe("portões e papéis", () => {
  it("o ouvidor é também técnico; respondente só responde", () => {
    expect(ombudsmanRoles(ombudsmanUser([ "ombudsman" ]))).toEqual({ lead: true, staff: true, responder: false, admin: false });
    expect(ombudsmanRoles(ombudsmanUser([ "ombudsman_staff" ]))).toEqual({ lead: false, staff: true, responder: false, admin: false });
    expect(ombudsmanRoles(ombudsmanUser([ "ombudsman_responder" ])).staff).toBe(false);
    expect(ombudsmanRoles(ombudsmanUser([ "ombudsman_responder" ])).responder).toBe(true);
    expect(ombudsmanRoles(ombudsmanUser([ "municipal_admin" ])).admin).toBe(true);
    expect(ombudsmanRoles(null)).toEqual({ lead: false, staff: false, responder: false, admin: false });
    expect(canUseOmbudsman(ombudsmanUser([ "ombudsman" ], []))).toBe(false);
    expect(canUseOmbudsman(ombudsmanUser([ "ombudsman" ]))).toBe(true);
    expect(canUseOmbudsman({ ...ombudsmanUser([ "ombudsman" ]), operator: true })).toBe(false);
    expect(canUseOmbudsman(null)).toBe(false);
  });
});

describe("matriz de ações", () => {
  const staff = ombudsmanRoles(ombudsmanUser([ "ombudsman_staff" ]));
  const lead = ombudsmanRoles(ombudsmanUser([ "ombudsman" ]));
  it("estado × papel do §2 (a matriz decide o que aparece)", () => {
    expect(availableActions(manifestation({ state: "received" }), staff)).toEqual([ "classify", "interim_response" ]);
    expect(availableActions(manifestation({ state: "in_analysis" }), staff))
      .toEqual([ "classify", "forward", "request_complement", "interim_response", "final_response" ]);
    expect(availableActions(manifestation({ state: "in_analysis" }), lead))
      .toEqual([ "classify", "forward", "request_complement", "extend", "interim_response", "final_response", "archive" ]);
    // F-7: em `forwarded` a conclusiva aparece (bloqueada por forwarding_pending)
    expect(availableActions(manifestation({ state: "forwarded", pending_forwardings: 1 }), staff)).toEqual([ "forward", "interim_response", "final_response" ]);
    expect(availableActions(manifestation({ state: "awaiting_complement" }), lead)).toEqual([ "complement", "extend", "interim_response", "archive" ]);
    expect(availableActions(manifestation({ state: "answered" }), lead)).toEqual([ "reopen", "change_resolution" ]);
    expect(availableActions(manifestation({ state: "answered", kind: "praise" }), lead)).toEqual([ "reopen" ]);
    expect(availableActions(manifestation({ state: "archived" }), lead)).toEqual([ "reopen" ]);
    expect(availableActions(manifestation({ state: "archived" }), staff)).toEqual([]);
    expect(availableActions(manifestation({ state: "in_analysis" }), ombudsmanRoles(ombudsmanUser([ "ombudsman_responder" ])))).toEqual([]);
    expect(availableActions(preserved({ identification_mode: "anonymous", state: "in_analysis" }), staff)).toEqual([ "classify", "forward", "final_response" ]);
    expect(Object.keys(ACTIONS_BY_STATE).sort()).toEqual([ "answered", "archived", "awaiting_complement", "forwarded", "in_analysis", "received" ]);
  });
  it("motivos de bloqueio (a matriz mostra, o `can` habilita)", () => {
    expect(blockedReason(manifestation({ pending_forwardings: 1 }), "final_response")).toBe(OMBUDSMAN_ERRORS.forwarding_pending);
    expect(blockedReason(manifestation({ state: "forwarded", pending_forwardings: 1 }), "final_response")).toBe(OMBUDSMAN_ERRORS.forwarding_pending);
    expect(blockedReason(manifestation({ complement_used: true }), "request_complement")).toBe(OMBUDSMAN_ERRORS.complement_already_used);
    expect(blockedReason(manifestation({ extended: true }), "extend")).toBe(OMBUDSMAN_ERRORS.already_extended);
    expect(blockedReason(manifestation(), "final_response")).toBeNull();
    const m = manifestation();
    expect(blockedReason({ ...m, can: { ...m.can, classify: false } }, "classify")).toBe("esta ação não está disponível agora");
  });
  it("identidade, comprovante e resolutividade", () => {
    expect(canSeeIdentityButton(manifestation(), lead)).toBe(true); // Q50: também no identificado
    expect(canSeeIdentityButton(preserved(), lead)).toBe(true);
    expect(canSeeIdentityButton(preserved(), staff)).toBe(false);
    expect(canSeeIdentityButton(preserved({ identity_available: false, can: { ...manifestation().can, open_identity: false } }), lead)).toBe(false);
    expect(canIssueReceipt(manifestation())).toBe(true);
    expect(canIssueReceipt(preserved({ identification_mode: "anonymous" }))).toBe(false);
    expect(([ "complaint", "request", "report" ] as const).every(needsResolution)).toBe(true);
    expect(needsResolution("praise") || needsResolution("suggestion")).toBe(false);
  });
});

describe("registro pela equipe", () => {
  const base = { kind: "complaint", mode: "identified", channel: "in_person", ouvidorsusNumber: "", person: null, manual: { name: "", contact: "", cpf: "" },
    body: "curto", healthUnitId: null, files: [] } as NewDraft;
  const ok = "x".repeat(20);
  const paths = (d: NewDraft) => newManifestationProblems(d).map((p) => p.path);
  it("todos os problemas de uma vez; anônima só denúncia e sem pessoa; OuvidorSUS com número", () => {
    expect(paths(base)).toEqual([ "person", "body" ]);
    expect(paths({ ...base, mode: "anonymous", body: ok })).toEqual([ "kind" ]);
    expect(paths({ ...base, kind: "report", mode: "anonymous", body: ok, manual: { name: "Ana", contact: "", cpf: "" } })).toEqual([ "manifestant_name" ]);
    expect(paths({ ...base, kind: "report", mode: "anonymous", body: ok, person: { citizen_id: "c1", name: "A", cpf_masked: "***" } })).toEqual([ "citizen_id" ]);
    expect(paths({ ...base, channel: "ouvidorsus", manual: { name: "Ana Reis", contact: "41 3333-0000", cpf: "" }, body: ok })).toEqual([ "ouvidorsus_number" ]);
    expect(newManifestationProblems({ ...base, channel: "ouvidorsus", body: ok, manual: { name: "Ana Reis", contact: "", cpf: "" } })[0].text)
      .toBe("informe o número do OuvidorSUS (até 40 caracteres)");
    expect(paths({ ...base, channel: "ouvidorsus", ouvidorsusNumber: "x".repeat(41), manual: { name: "Ana Reis", contact: "", cpf: "" }, body: ok })).toEqual([ "ouvidorsus_number" ]);
    expect(paths({ ...base, channel: "ouvidorsus", ouvidorsusNumber: "123", manual: { name: "Ana Reis", contact: "", cpf: "" }, body: ok })).toEqual([]);
    expect(paths({ ...base, manual: { name: "Ana Reis", contact: "", cpf: "123" }, body: ok })).toEqual([ "manifestant_cpf" ]);
    expect(paths({ ...base, manual: { name: "Ana Reis", contact: "", cpf: "529.982.247-25" }, body: ok })).toEqual([]);
    expect(paths({ ...base, manual: { name: "A", contact: "c".repeat(121), cpf: "" }, body: ok })).toEqual([ "manifestant_name", "manifestant_contact" ]);
    expect(paths({ ...base, person: { citizen_id: "c1", name: "Maria", cpf_masked: "***" }, body: "x".repeat(4001) })).toEqual([ "body" ]);
    expect(paths({ ...base, person: { citizen_id: "c1", name: "Maria", cpf_masked: "***" }, body: ok })).toEqual([]);
  });
});

describe("ações com texto", () => {
  it("encaminhar", () => {
    expect(forwardProblems({ destination: null, extract: "x".repeat(19) }, options()).map((p) => p.path)).toEqual([ "destination", "extract" ]);
    expect(forwardProblems({ destination: { kind: "department", id: "dep2" }, extract: "x".repeat(20) }, options())[0].text)
      .toBe(OMBUDSMAN_ERRORS.destination_without_responder);
    expect(forwardProblems({ destination: { kind: "health_unit", id: "ubs1" }, extract: "x".repeat(20) }, options())).toEqual([]);
    expect(forwardProblems({ destination: { kind: "health_unit", id: "gone" }, extract: "x".repeat(20) }, options())[0].text).toBe(OMBUDSMAN_ERRORS.destination_inactive);
  });
  it("texto das ações: 10–4000 para todas", () => {
    for (const a of [ "request_complement", "complement", "extend", "interim_response" ] as const) {
      expect(textActionProblems(a, { text: "x".repeat(9) }).map((p) => p.path), a).toEqual([ "text" ]);
      expect(textActionProblems(a, { text: "x".repeat(4001) }).map((p) => p.path), a).toEqual([ "text" ]);
      expect(textActionProblems(a, { text: " ".repeat(5) + "x".repeat(10) + " ".repeat(5) }), a).toEqual([]);
    }
    expect(textActionProblems("change_resolution", { text: "x".repeat(10), resolution: null }).map((p) => p.path)).toEqual([ "resolution" ]);
    expect(textActionProblems("change_resolution", { text: "x".repeat(10), resolution: "resolved" })).toEqual([]);
  });
  it("reabrir: o texto é opcional; se vier, 10–4000", () => {
    expect(textActionProblems("reopen", { text: "" })).toEqual([]);
    expect(textActionProblems("reopen", { text: "   " })).toEqual([]);
    expect(textActionProblems("reopen", { text: "x".repeat(9) }).map((p) => p.path)).toEqual([ "text" ]);
    expect(textActionProblems("reopen", { text: "x".repeat(4001) }).map((p) => p.path)).toEqual([ "text" ]);
    expect(textActionProblems("reopen", { text: "x".repeat(10) })).toEqual([]);
  });
  it("contam-se code points, não unidades UTF-16 (Q8)", () => {
    const e = "😀";
    expect(textActionProblems("extend", { text: e.repeat(10) })).toEqual([]);
    expect(textActionProblems("extend", { text: e.repeat(9) }).map((p) => p.path)).toEqual([ "text" ]);
    expect(textActionProblems("extend", { text: e.repeat(4000) })).toEqual([]);
    expect(textActionProblems("extend", { text: e.repeat(4001) }).map((p) => p.path)).toEqual([ "text" ]);
    expect(archiveProblems({ reason: "forwarded_elsewhere", duplicateOfId: null, externalBodyName: e.repeat(120) })).toEqual([]);
    expect(archiveProblems({ reason: "forwarded_elsewhere", duplicateOfId: null, externalBodyName: e.repeat(121) }).map((p) => p.path)).toEqual([ "external_body_name" ]);
    expect(nameProblem(e.repeat(2))).toBeNull();
    expect(nameProblem(e.repeat(80))).toBeNull();
  });
  it("conclusiva: resolutividade só onde cabe", () => {
    expect(finalResponseProblems({ text: "x".repeat(20), resolution: null }, "complaint").map((p) => p.path)).toEqual([ "resolution" ]);
    expect(finalResponseProblems({ text: "x".repeat(20), resolution: "resolved" }, "praise").map((p) => p.path)).toEqual([ "resolution" ]);
    expect(finalResponseProblems({ text: "x".repeat(9), resolution: null }, "request").map((p) => p.path)).toEqual([ "text", "resolution" ]);
    expect(finalResponseProblems({ text: "x".repeat(10), resolution: "not_resolved" }, "report")).toEqual([]);
    expect(finalResponseProblems({ text: "x".repeat(10), resolution: null }, "suggestion")).toEqual([]);
  });
  it("arquivar: no_complement nunca é oferecido; external_body_name 1–120", () => {
    expect(archiveProblems({ reason: "", duplicateOfId: null, externalBodyName: "" }).map((p) => p.path)).toEqual([ "reason" ]);
    expect(archiveProblems({ reason: "no_complement", duplicateOfId: null, externalBodyName: "" }).map((p) => p.path)).toEqual([ "reason" ]);
    expect(archiveProblems({ reason: "duplicate", duplicateOfId: null, externalBodyName: "" }).map((p) => p.path)).toEqual([ "duplicate_of_id" ]);
    expect(archiveProblems({ reason: "duplicate", duplicateOfId: "m9", externalBodyName: "" })).toEqual([]);
    expect(archiveProblems({ reason: "forwarded_elsewhere", duplicateOfId: null, externalBodyName: "" }).map((p) => p.path)).toEqual([ "external_body_name" ]);
    expect(archiveProblems({ reason: "forwarded_elsewhere", duplicateOfId: null, externalBodyName: "M" })).toEqual([]);
    expect(archiveProblems({ reason: "forwarded_elsewhere", duplicateOfId: null, externalBodyName: "M".repeat(121) }).map((p) => p.path)).toEqual([ "external_body_name" ]);
    expect(archiveProblems({ reason: "improper", duplicateOfId: null, externalBodyName: "" })).toEqual([]);
  });
});

describe("prazos, nomes, relatório e anexos", () => {
  it("prazos 1–120 inteiros; teto 1–1000", () => {
    expect(settingsProblems(settings33({ response_days: 0, anonymous_daily_cap: 1001, warning_days: 2.5 })).map((p) => p.path))
      .toEqual([ "response_days", "warning_days", "anonymous_daily_cap" ]);
    expect(settingsProblems(settings33())).toEqual([]);
    expect(settingsProblems(settings33({ urgent_days: 121 })).map((p) => p.path)).toEqual([ "urgent_days" ]);
  });
  it("nome 2–80", () => {
    expect(nameProblem("A")).not.toBeNull();
    expect(nameProblem(" A ")).not.toBeNull();
    expect(nameProblem("Ab")).toBeNull();
    expect(nameProblem("x".repeat(81))).not.toBeNull();
    expect(nameProblem("x".repeat(80))).toBeNull();
  });
  it("relatório: até 8000 por texto", () => {
    expect(reportTextProblems({ recurring_problems: "x".repeat(8001), actions_taken: "", notes: "x".repeat(8001) }).map((p) => p.path))
      .toEqual([ "recurring_problems", "notes" ]);
    expect(reportTextProblems({ recurring_problems: "x".repeat(8000), actions_taken: "", notes: "" })).toEqual([]);
  });
  it("anexos: tipo, 10 MB, até 3", () => {
    const big = new File([ new Uint8Array(10 * 1024 * 1024 + 1) ], "a.pdf", { type: "application/pdf" });
    const gif = new File([ "x" ], "a.gif", { type: "image/gif" });
    expect(attachmentProblems([ big, gif ]).map((p) => p.text)).toEqual([ OMBUDSMAN_ERRORS.attachment_too_large, OMBUDSMAN_ERRORS.attachment_type ]);
    const pdf = () => new File([ "x" ], "a.pdf", { type: "application/pdf" });
    expect(attachmentProblems([ pdf(), pdf(), pdf(), pdf() ])[0].text).toBe(OMBUDSMAN_ERRORS.attachment_limit);
    expect(attachmentProblems([ pdf(), new File([ "x" ], "a.png", { type: "image/png" }), new File([ "x" ], "a.jpg", { type: "image/jpeg" }) ])).toEqual([]);
  });
});

describe("rótulos", () => {
  it("cru para código desconhecido; mapas do catálogo", () => {
    expect(kindLabel("simplification")).toBe("simplification");
    expect(eventKindLabel("ledger_rewritten")).toBe("ledger_rewritten");
    expect(colorLabel("yellow")).toBe("perto do prazo");
    expect(colorLabel("paused")).toBe("prazo suspenso");
    expect(archiveReasonLabel("lack_of_civility")).toBe("Falta de urbanidade");
    expect(COLOR_TONE).toEqual({ green: "ok", yellow: "warn", red: "down", paused: "info" });
    expect(destinationLabel({ kind: "department", id: "d", name: "Regulação" })).toBe("Setor: Regulação");
    expect(destinationLabel({ kind: "health_unit", id: "u", name: "UBS Centro" })).toBe("Unidade: UBS Centro");
    for (const k of [ "received", "classified", "forwarded", "forwarding_cancelled", "forwarding_replied", "forwarding_declined", "forwarding_extended",
      "complement_requested", "complement_received", "extended", "interim_response", "final_response", "archived", "reopen_requested",
      "reopen_rejected", "reopened", "resolution_changed", "identity_consent_recorded" ]) expect(eventKindLabel(k), k).not.toBe(k);
  });
  it("chaves e reexportações", () => {
    expect(OMB_LIST_KEY).toBe("ombudsmanList");
    expect(NOMINAL_QUERY).toBeTruthy();
    expect(STATIC_QUERY).toBeTruthy();
  });
});
