// src/lib/lab.test.ts
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  BARCODE_INVALID, EMPTY_CRITICAL, EMPTY_REQUISITION, LAB_DISABLED, canUseLab, criticalBody, criticalProblem, entryProblem, flagLabel,
  flagTone, labError, labRoles, normalizeBarcode, normalizeNumber, normalizeRequisitionNumber, displayValue, lookupKind, onlyIcp, reportStatusLabel, reportStatusTone, sectorLabel, parseTemperature, previewFlag, rectifyProblem,
  refreshLab, requisitionBody, requisitionProblem, type PaperDraft, requisitionStatusLabel, sampleStatusLabel, temperatureProblem, totpProblem
} from "./lab";
import { glucoseEntry, labUser } from "../test/labFixtures";

const GLU = glucoseEntry().analytes[0];
const err = (status: number, body: unknown) => new ApiError(status, body, "x");

describe("rótulos", () => {
  it("situação da requisição na ordem da spec §5.11; desconhecida crua", () => {
    expect([ "open", "in_analysis", "typed", "released", "delivered" ].map(requisitionStatusLabel))
      .toEqual([ "recebida", "em análise", "digitada", "liberada", "entregue" ]);
    expect(requisitionStatusLabel("archived")).toBe("archived");
  });

  it("amostra aguardando: antes e depois da coleta", () => {
    expect(sampleStatusLabel({ status: "awaiting", collected_at: null })).toBe("aguardando coleta");
    expect(sampleStatusLabel({ status: "awaiting", collected_at: "2026-10-15T08:00:00-03:00" })).toBe("coletada");
    expect(sampleStatusLabel({ status: "not_received", collected_at: "x" })).toBe("não chegou");
  });

  it("marca: crítico em vermelho, alto/baixo em alerta, normal sem rótulo", () => {
    expect(flagLabel("critical_high")).toBe("crítico alto");
    expect(flagTone("critical_low")).toBe("down");
    expect(flagTone("high")).toBe("warn");
    expect(flagLabel("normal")).toBe("");
  });

  it("B2/B13: setores em inglês com rótulo em português; laudo retirado", () => {
    expect([ "biochemistry", "hematology", "immunology", "urinalysis", "parasitology", "microbiology" ].map(sectorLabel))
      .toEqual([ "Bioquímica", "Hematologia", "Imunologia", "Urinálise", "Parasitologia", "Microbiologia" ]);
    expect(sectorLabel("bioquimica")).toBe("bioquimica");
    expect(reportStatusLabel("withdrawn")).toBe("devolvido — assinatura digital desligada; libere de novo");
    expect(reportStatusTone("withdrawn")).toBe("down");
    expect(reportStatusTone("released")).toBe("ok");
  });
});

describe("papéis e interruptor", () => {
  it("lab_staff, lab_releaser e admin; operador nunca", () => {
    expect(labRoles(labUser([ "lab_staff" ]))).toEqual({ staff: true, releaser: false, admin: false, professional: false });
    expect(labRoles(labUser([ "lab_releaser", "health_professional" ]))).toEqual({ staff: false, releaser: true, admin: false, professional: true });
    expect(labRoles({ operator: true, memberships: [ { role: "lab_staff" } ] }).staff).toBe(false);
  });

  it("sem municipal_lab na sessão, nada do laboratório", () => {
    expect(canUseLab(labUser())).toBe(true);
    expect(canUseLab(labUser([ "lab_staff" ], { features: [ "exam_tracking" ] }))).toBe(false);
  });
});

describe("leitura do código de barras", () => {
  it("apara espaços e o Enter; recusa vazio, espaço no meio e caractere de controle", () => {
    expect(normalizeBarcode("  0000012301\r\n")).toBe("0000012301");
    expect(normalizeBarcode("")).toBeNull();
    expect(normalizeBarcode("00000 12301")).toBeNull();
    expect(normalizeBarcode("00000\u000712301")).toBeNull();
  });

  it("B16: código de barras tem 10 dígitos, número da requisição 8; a busca decide pelo tamanho", () => {
    expect(normalizeBarcode("00000123")).toBeNull();
    expect(normalizeBarcode("LB00012301")).toBeNull();
    expect(normalizeBarcode("000001230100")).toBeNull();
    expect(normalizeRequisitionNumber(" 00000123\n")).toBe("00000123");
    expect(normalizeRequisitionNumber("0000012301")).toBeNull();
    expect(lookupKind("0000012301")).toBe("barcode");
    expect(lookupKind("00000123")).toBe("number");
    expect(lookupKind("123")).toBeNull();
    expect(BARCODE_INVALID).toBe("código ilegível — leia a etiqueta de novo");
  });
});

describe("número com vírgula e limite de digitação", () => {
  it("valor do api aparece com vírgula; texto de escolha fica como veio", () => {
    expect(displayValue("4.50")).toBe("4,50");
    expect(displayValue("-2.0")).toBe("-2,0");
    expect(displayValue("98")).toBe("98");
    expect(displayValue("positivo")).toBe("positivo");
    expect(displayValue("1.2.3")).toBe("1.2.3");
  });

  it("vírgula vira ponto; texto não numérico é recusado", () => {
    expect(normalizeNumber("13,5")).toBe("13.5");
    expect(normalizeNumber(" 98 ")).toBe("98");
    expect(normalizeNumber("-2,0")).toBe("-2.0");
    expect(normalizeNumber("1.234,5")).toBeNull();
    expect(normalizeNumber("150.000")).toBeNull();
    expect(normalizeNumber("4.5")).toBeNull();
    expect(normalizeNumber("150000")).toBe("150000");
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber("")).toBeNull();
  });

  it("fora de entry_min/entry_max bloqueia com o limite na frase", () => {
    expect(entryProblem(GLU, "98")).toBeNull();
    expect(entryProblem(GLU, "98,0")).toBeNull();
    expect(entryProblem(GLU, "98,5")).toBe("este exame não usa casas decimais — confira o valor");
    expect(entryProblem({ ...GLU, decimals: 1 }, "98,55")).toBe("este exame usa no máximo 1 casa decimal — confira o valor");
    expect(entryProblem({ ...GLU, decimals: 1 }, "98,5")).toBeNull();
    expect(entryProblem(GLU, "1600")).toBe("fora do limite de digitação (10 a 1500 mg/dL) — confira o valor");
    expect(entryProblem(GLU, "5")).toBe("fora do limite de digitação (10 a 1500 mg/dL) — confira o valor");
    expect(entryProblem(GLU, "nove")).toBe("valor numérico inválido — use dígitos e vírgula");
    expect(entryProblem(GLU, "")).toBeNull();
    const DOT = "use vírgula para decimais e não use ponto de milhar (ex.: 150000 ou 4,5)";
    expect(entryProblem(GLU, "150.000")).toBe(DOT);
    expect(entryProblem({ ...GLU, decimals: 1 }, "4.5")).toBe(DOT);
    expect(entryProblem({ ...GLU, entry_max: null }, "150000")).toBeNull();
    expect(entryProblem({ ...GLU, decimals: 2 }, "20,25")).toBeNull();
  });

  it("escolha precisa estar entre as opções; texto livre passa", () => {
    const choice = { ...GLU, value_type: "choice", choices: [ "negativo", "positivo" ], entry_min: null, entry_max: null };
    expect(entryProblem(choice, "positivo")).toBeNull();
    expect(entryProblem(choice, "talvez")).toBe("escolha uma das opções");
    expect(entryProblem({ ...GLU, value_type: "text", entry_min: null, entry_max: null }, "amarelo citrino")).toBeNull();
  });

  it("prévia da marca: crítico antes de alto/baixo; sem faixa, nada", () => {
    expect(previewFlag(GLU, "98")).toBe("normal");
    expect(previewFlag(GLU, "120")).toBe("high");
    expect(previewFlag(GLU, "65")).toBe("low");
    expect(previewFlag(GLU, "450")).toBe("critical_high");
    expect(previewFlag(GLU, "30")).toBe("critical_low");
    expect(previewFlag({ ...GLU, reference: null, critical_low: null, critical_high: null }, "120")).toBeNull();
    expect(previewFlag(GLU, "")).toBeNull();
  });

  it("B27: crítico é inclusivo e os limites da faixa pertencem a ela", () => {
    expect(previewFlag(GLU, "40")).toBe("critical_low");
    expect(previewFlag(GLU, "400")).toBe("critical_high");
    expect(previewFlag(GLU, "41")).toBe("low");
    expect(previewFlag(GLU, "399")).toBe("high");
    expect(previewFlag(GLU, "70")).toBe("normal");
    expect(previewFlag(GLU, "99")).toBe("normal");
    expect(previewFlag(GLU, "99,5")).toBe("high");
    expect(previewFlag(GLU, "69,9")).toBe("low");
  });
});

describe("requisição", () => {
  const ok = { ...EMPTY_REQUISITION, patientId: "pa1", biologicalSex: "female" as const, motherName: "Maria Lima", orderIds: [ "eo1" ] };

  it("exige paciente, sexo, nome da mãe e ao menos um exame", () => {
    expect(requisitionProblem({ ...ok, patientId: null })).toBe("busque o paciente pelo CPF");
    expect(requisitionProblem({ ...ok, biologicalSex: "" })).toBe("informe o sexo biológico (a referência depende dele)");
    expect(requisitionProblem({ ...ok, motherName: "  " })).toBe("informe o nome da mãe (identificação da amostra)");
    expect(requisitionProblem({ ...ok, orderIds: [] })).toBe("escolha ao menos um exame");
    expect(requisitionProblem(ok)).toBeNull();
  });

  it("pedido em papel: exame e quem pediu (da rede ou digitado com CNS válido)", () => {
    const paper = (requester: Omit<PaperDraft, "sigtapCode">) => ({ ...ok, orderIds: [], paper: [ { sigtapCode: "0202010473", ...requester } ] });
    expect(requisitionProblem(paper({ mode: "typed", userId: "", name: "Dr. Externo", cns: "123" }))).toBe("pedido em papel 1: CNS de quem pediu inválido");
    expect(requisitionProblem(paper({ mode: "linked", userId: "", name: "", cns: "" }))).toBe("pedido em papel 1: escolha o profissional que pediu");
    expect(requisitionProblem({ ...ok, paper: [ { sigtapCode: "", mode: "linked", userId: "us1", name: "", cns: "" } ] })).toBe("pedido em papel 1: escolha o exame");
  });

  it("corpo: só dígitos no CNS, nome aparado, sem clinical_info vazio", () => {
    const body = requisitionBody({
      ...ok, clinicalInfo: "  ", paper: [ { sigtapCode: "0202010473", mode: "typed", userId: "", name: " Dr. Externo ", cns: "702 0028 8742 9583" } ]
    }, { providerId: "pv9", originUnitId: "u1", place: "ubs" });
    expect(body).toEqual({
      patient_id: "pa1", provider_id: "pv9", origin_unit_id: "u1", collection_place: "ubs", biological_sex: "female",
      mother_name: "Maria Lima", urgent: false, exam_order_ids: [ "eo1" ],
      paper_orders: [ { sigtap_code: "0202010473", requester: { name: "Dr. Externo", cns: "702002887429583" } } ]
    });
  });
});

describe("remessa, crítico, retificação e assinatura", () => {
  it("temperatura em °C com vírgula, de -30 a 60", () => {
    expect(parseTemperature("4,5")).toBe(4.5);
    expect(temperatureProblem("")).toBe("informe a temperatura da caixa em °C");
    expect(temperatureProblem("80")).toBe("temperatura fora do esperado (-30 a 60 °C) — confira o termômetro");
    expect(temperatureProblem("8")).toBeNull();
  });

  it("comunicação do crítico: pessoa, função, canal e hora não futura", () => {
    const now = "2026-10-15T10:00:00-03:00";
    const d = { ...EMPTY_CRITICAL, person: "Dra. Ana", role: "médica da UBS", channel: "telefone" as const, at: "2026-10-15T09:40" };
    expect(criticalProblem({ ...d, person: "" }, now)).toBe("informe quem foi avisado");
    expect(criticalProblem({ ...d, at: "2026-10-15T11:00" }, now)).toBe("a hora do aviso não pode ser no futuro");
    expect(criticalProblem(d, now)).toBeNull();
    expect(criticalBody("res1", d)).toEqual({
      result_id: "res1", notified_person: "Dra. Ana", notified_role: "médica da UBS", channel: "telefone", notified_at: "2026-10-15T09:40:00-03:00"
    });
  });

  it("retificação: motivo de 10+ caracteres e ao menos um contato completo", () => {
    const now = "2026-10-15T10:00:00-03:00";
    const c = { person: "Dra. Ana", channel: "telefone" as const, at: "2026-10-15T09:00" };
    expect(rectifyProblem("erro", [ c ], now)).toBe("escreva o motivo da retificação (ao menos 10 caracteres)");
    expect(rectifyProblem("valor digitado trocado", [], now)).toBe("registre quem foi avisado da retificação");
    expect(rectifyProblem("valor digitado trocado", [ { ...c, person: "" } ], now)).toBe("contato 1: informe quem foi avisado");
    expect(rectifyProblem("valor digitado trocado", [ c ], now)).toBeNull();
  });

  it("TOTP de 6 dígitos; CRM só ICP", () => {
    expect(totpProblem("12345")).toBe("digite os 6 dígitos do autenticador");
    expect(totpProblem("123456")).toBeNull();
    expect(onlyIcp("CRM")).toBe(true);
    expect(onlyIcp("CRF")).toBe(false);
    expect(onlyIcp(null)).toBe(false);
  });
});

describe("recusas", () => {
  it("interruptor do laboratório, do rastreamento e códigos do contrato", () => {
    expect(labError(err(403, { error: "feature_disabled", feature: "municipal_lab" }))).toBe(LAB_DISABLED);
    expect(labError(err(403, { error: "feature_disabled", feature: "exam_tracking" }))).toBe("o rastreamento de exames está desligado nesta cidade");
    expect(labError(err(422, { error: "icp_required" }))).toBe("médico libera só com ICP-Brasil — escolha ICP");
    expect(labError(err(422, { error: "out_of_entry_range", analyte_key: "glicose" }))).toBe("valor fora do limite de digitação — confira");
    expect(labError(err(404, { error: "not_found" }))).toBe("etiqueta ou requisição não encontrada — confira o código");
    expect(labError(err(401, { error: "mfa_required" }))).toBe("o código do autenticador não valeu — digite o código atual");
    expect(labError(err(500, { error: "boom" }))).toBe("não foi possível concluir (500: boom) — tente de novo");
    expect(labError(err(422, { error: "laboratory_incomplete" }))).toBe(
      "o laboratório está sem endereço ou telefone — complete o cadastro do prestador antes de liberar");
    expect(labError(err(422, { error: "technical_lead_missing" }))).toBe(
      "o laboratório não tem responsável técnico — marque um liberador como responsável técnico");
    expect(labError(err(422, { error: "signature_unavailable" }))).toBe(
      "a assinatura ICP-Brasil não está disponível nesta cidade — peça ao administrador para ativá-la");
    expect(labError(err(422, { error: "invalid_signature" }))).toBe("tipo de assinatura inválido para este laudo");
    expect(labError(err(422, { error: "council_missing" }))).toContain("conselho");
    expect(labError(err(409, { error: "invalid_transition" }))).toBe("a situação mudou — a tela foi atualizada");
    expect(labError(err(409, { error: "gal_already_registered" }))).toBe("este pedido já tem a requisição do GAL registrada");
    expect(labError(err(422, { error: "filter_required" }))).toBe("escolha a unidade de origem para listar as requisições");
    expect(labError(err(422, { error: "not_applicable" }))).toBe("esta ação não se aplica a este laudo");
    for (const code of [ "invalid_version", "choices_required", "invalid_template", "invalid_provider" ]) {
      const msg = labError(err(422, { error: code }));
      expect(msg).not.toContain(code);
      expect(msg).toMatch(/[a-z]{4,} /);
    }
    expect(labError(err(422, { error: "invalid_provider" }))).toBe("prestador inválido — escolha um laboratório municipal");
    for (const code of [ "laboratory_incomplete", "technical_lead_missing", "signature_unavailable", "invalid_signature", "mfa_required" ]) {
      expect(labError(err(422, { error: code }))).not.toContain(code);
    }
    expect(labError(new Error("offline"))).toBe("sem conexão com o servidor — tente de novo");
  });
});

describe("correções da rodada 1", () => {
  it("recusas do catálogo: motivos, prazo e bancada", () => {
    expect(labError(err(422, { error: "invalid_name" }))).toBe("nome inválido — preencha o nome");
    expect(labError(err(422, { error: "invalid_active" }))).toBe("situação (ativo ou inativo) inválida");
    expect(labError(err(422, { error: "duplicate_name" }))).toBe("já existe um motivo com este nome");
    expect(labError(err(422, { error: "invalid_delivery_days" }))).toBe("prazo de entrega inválido — use de 1 a 90 dias");
    expect(labError(err(422, { error: "invalid_bench" }))).toBe("bancada inválida — use até 60 caracteres");
  });

  it("limites exatos de digitação e de temperatura", () => {
    expect(entryProblem(GLU, "10")).toBeNull();
    expect(entryProblem(GLU, "1500")).toBeNull();
    expect(entryProblem(GLU, "9,9")).not.toBeNull();
    expect(entryProblem(GLU, "1500,1")).not.toBeNull();
    expect(temperatureProblem("-30")).toBeNull();
    expect(temperatureProblem("60")).toBeNull();
    expect(temperatureProblem("-30,1")).toBe("temperatura fora do esperado (-30 a 60 °C) — confira o termômetro");
    expect(temperatureProblem("60,1")).toBe("temperatura fora do esperado (-30 a 60 °C) — confira o termômetro");
  });

  it("refreshLab invalida toda chave do laboratório", async () => {
    const client = new QueryClient();
    const keys = [ "labRequisitions", "labRequisition", "labCandidates", "labExams", "labShipments", "labUnitPending",
      "labWorklist", "labEntry", "labReleases", "labCriticals", "labCriticalCount", "labReasons", "labAdminExams", "labTemplates",
      "labReleasers", "labReports" ];
    for (const k of keys) client.setQueryData([ k, "x" ], 1);
    await refreshLab(client);
    for (const k of keys) expect(client.getQueryState([ k, "x" ])?.isInvalidated, k).toBe(true);
  });

  it("refreshLab não invalida o contexto do laboratório (I1)", async () => {
    const client = new QueryClient();
    client.setQueryData([ "labContext", "x" ], 1);
    await refreshLab(client);
    expect(client.getQueryState([ "labContext", "x" ])?.isInvalidated).toBe(false);
  });

  it("invalid_values tem frase própria (I3)", () => {
    const err = new ApiError(422, { error: "invalid_values", analyte_key: "ldl" }, "x");
    expect(labError(err)).toBe("falta um valor que entra no cálculo de um componente calculado — digite os componentes da conta juntos");
  });
});
