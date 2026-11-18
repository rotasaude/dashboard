// src/modules/VectorLiraa.test.tsx
// "LIRAa" da coordenação de endemias (módulo 35a, Task 14; F-35.6; contrato §7, §10, §17; Q16, Q17, Q20, Q24, Q25, Q30): lista de
// levantamentos e "Novo levantamento"; no rascunho, os estratos (nome, tipo, quarteirões por bairro; o N vem do api, sem PE) com a
// faixa do tipo ao vivo; o sorteio e o fechamento com step-up (um envio; 409 → a frase e UMA releitura); sorteado/fechado: N, n,
// intervalo e início por estrato, os itens (com "substituto de …"), os índices (provisório) e os downloads CSV/PDF pelo saveFile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), listLiraaSurveys: vi.fn(), createLiraaSurvey: vi.fn(), updateLiraaSurvey: vi.fn(),
    drawLiraaSurvey: vi.fn(), closeLiraaSurvey: vi.fn(), listLiraaItems: vi.fn(), getVectorReport: vi.fn(), fetchVectorReportFile: vi.fn(),
    getVectorParameters: vi.fn(), listCityBlocks: vi.fn(), listPanelNeighborhoods: vi.fn()
  };
});
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));

import * as api from "../lib/api";
import { ApiError, type LiraaSurvey, type VectorReport } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { saveFile } from "./lab/saveFile";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { VC_FEATURES, cityBlock, liraaItem, liraaSurvey, parameterVersion, report, vcUser } from "../test/vectorControlFixtures";
import {
  CLOSED, DETAILS_SAVED, DRAWN, DRAW_DESCRIPTION, END_BEFORE_START, FIX_TO_DRAW, INACTIVE_CHOSEN, NAME_PROBLEM, NOTHING_CHANGED, N_ON_SAVE, PROVISIONAL, SAVE_FIRST, STRATA_SAVED, SURVEY_CREATED, VectorLiraa
} from "./VectorLiraa";

const ALL = [
  api.fetchCurrentSession, api.stepUpMfa, api.listLiraaSurveys, api.createLiraaSurvey, api.updateLiraaSurvey, api.drawLiraaSurvey, api.closeLiraaSurvey,
  api.listLiraaItems, api.getVectorReport, api.fetchVectorReportFile, api.getVectorParameters, api.listCityBlocks, api.listPanelNeighborhoods, saveFile
];
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const tick = () => new Promise((r) => setTimeout(r, 20));

// Rascunho: um estrato "Padrão" com N = 8.099 (o api conta sem PE) — fora da faixa por um.
const stratum = (o: Partial<LiraaSurvey["strata"][number]> = {}) => ({
  id: "st1", name: "Centro-norte", mode: "standard" as const, block_ids: [ "cb1", "cb2" ], households_count: 8099, sample_target: null,
  block_interval: null, random_start: null, ...o
});
const DRAFT = liraaSurvey({ strata: [ stratum() ] });
const DRAWN_SURVEY = liraaSurvey({
  status: "drawn", parameters_version: 3, drawn_at: "2026-11-16T13:00:00Z",
  strata: [ stratum({ mode: "half", sample_target: 433, block_interval: 2, random_start: 1 }) ]
});
const CLOSED_SURVEY = { ...DRAWN_SURVEY, status: "closed", closed_at: "2026-11-30T13:00:00Z" };
const BLOCKS = [
  cityBlock({ id: "cb1", number: "12", households_count: 4000 }), cityBlock({ id: "cb2", number: "13", households_count: 4099 }),
  cityBlock({ id: "cb3", number: "14", households_count: 300 }), cityBlock({ id: "cb4", number: "15", households_count: 20, active: false })
];
const LIRAA_REPORT: VectorReport = report({
  name: "liraa", provisional: true,
  columns: [
    { key: "stratum", label: "Estrato", kind: "text" }, { key: "inspected", label: "Inspecionados", kind: "count" },
    { key: "iip", label: "IIP %", kind: "percent" }, { key: "iip_class", label: "Classe do IIP", kind: "text" }, { key: "ib", label: "IB %", kind: "percent" },
    { key: "provisional", label: "Provisório", kind: "text" }
  ],
  rows: [
    { stratum: "Centro-norte", inspected: 120, iip: "3.3", iip_class: "Alerta", ib: "4.2", provisional: "sim" },
    { stratum: "Município", inspected: 120, iip: "3.3", iip_class: "Alerta", ib: "4.2", provisional: "sim" }
  ]
});

afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); });
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
  mocked(api.listLiraaSurveys).mockResolvedValue([ DRAFT ]);
  mocked(api.getVectorParameters).mockResolvedValue(parameterVersion());
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Centro", active: true }, { id: "nb2", name: "Vila Nova", active: true } ]);
  mocked(api.listCityBlocks).mockResolvedValue(BLOCKS);
  mocked(api.listLiraaItems).mockResolvedValue({ items: [], next_before: null });
  mocked(api.getVectorReport).mockResolvedValue(LIRAA_REPORT);
});

const mount = (onGoToSecurity?: () => void) => renderWithProviders(<VectorLiraa today="2026-11-16" onGoToSecurity={onGoToSecurity} />);
async function open(name = "LIRAa novembro") {
  fireEvent.click(await screen.findByRole("button", { name: `Abrir ${name}` }));
}
async function mountDraft(onGoToSecurity?: () => void) {
  mount(onGoToSecurity);
  await open();
  await screen.findByRole("group", { name: "Estrato 1" });
}
const group = (n: number) => within(screen.getByRole("group", { name: `Estrato ${n}` }));
const button = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const blocked = (name: string) => button(name).getAttribute("aria-disabled") === "true";
// O bairro só depois de a lista de bairros chegar (antes, a opção não existe e o select fica vazio).
async function pickNeighborhood(n: number, id = "nb1") {
  await group(n).findByRole("option", { name: "Centro" });
  fireEvent.change(group(n).getByLabelText("Bairro"), { target: { value: id } });
}
// Abre a ação pelo botão, informa o código quando a janela do step-up está fechada e confirma.
async function confirmStepUp(label: string, code?: string) {
  fireEvent.click(await screen.findByRole("button", { name: label }));
  if (code) fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: code } });
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
}

describe("portão e lista", () => {
  it("só a coordenação: laboratório e admin veem a frase do papel e nada é lido", async () => {
    for (const roles of [ [ "vector_lab" ], [ "municipal_admin" ], [ "health_professional" ] ]) {
      mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      mount();
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      cleanup();
    }
    expect(api.listLiraaSurveys).not.toHaveBeenCalled();
    expect(api.getVectorParameters).not.toHaveBeenCalled();
  });

  it("lista: nome, período e status; nada mais lido antes de abrir", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY, liraaSurvey({ id: "s0", name: "LIRAa agosto", starts_on: "2026-08-03", ends_on: "2026-08-07", status: "closed" }) ]);
    mount();
    const table = within(await screen.findByRole("table", { name: "Levantamentos" }));
    expect(table.getByText("LIRAa novembro")).not.toBeNull();
    expect(table.getByText("23/11/2026 a 27/11/2026")).not.toBeNull();
    expect(table.getByText("sorteado")).not.toBeNull();
    expect(table.getByText("fechado")).not.toBeNull();
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(1);
    for (const f of [ api.getVectorParameters, api.listLiraaItems, api.getVectorReport, api.listCityBlocks, api.listPanelNeighborhoods ]) expect(f).not.toHaveBeenCalled();
  });

  it("novo levantamento: nome 1–80 e início ≤ fim recusados sem chamar; um envio no duplo clique; abre o criado", async () => {
    const created = liraaSurvey({ id: "s2", name: "LIRAa dezembro", starts_on: "2026-12-07", ends_on: "2026-12-07", strata: [] });
    let resolve!: (s: LiraaSurvey) => void;
    mocked(api.createLiraaSurvey).mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo levantamento" }));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type("Nome", "   ");
    type("Início", "2026-12-08");
    type("Fim", "2026-12-07");
    fireEvent.click(button("Criar levantamento"));
    expect(await screen.findByText(NAME_PROBLEM)).not.toBeNull();
    expect(screen.getByText("o fim vem no dia do início ou depois")).not.toBeNull();
    type("Nome", "x".repeat(81));
    fireEvent.click(button("Criar levantamento"));
    await tick();
    expect(screen.getByText(NAME_PROBLEM)).not.toBeNull();
    expect(api.createLiraaSurvey).not.toHaveBeenCalled();
    // 80 caracteres e o mesmo dia valem.
    type("Nome", "x".repeat(80));
    type("Nome", "  LIRAa dezembro ");
    type("Início", "2026-12-07");
    fireEvent.click(button("Criar levantamento"));
    fireEvent.click(button("Criar levantamento"));
    await waitFor(() => expect(api.createLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(mocked(api.createLiraaSurvey).mock.calls[0][0]).toEqual({ name: "LIRAa dezembro", starts_on: "2026-12-07", ends_on: "2026-12-07" });
    mocked(api.listLiraaSurveys).mockResolvedValue([ created, DRAFT ]);
    resolve(created);
    expect(await screen.findByText(SURVEY_CREATED("LIRAa dezembro"))).not.toBeNull();
    // O criado abre no rascunho, sem estratos: sortear pede um estrato.
    expect(await screen.findByText("adicione ao menos um estrato")).not.toBeNull();
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
  });
});

describe("estratos do rascunho", () => {
  it("estrato fora da faixa trava salvar e sortear (N 8.099 em padrão)", async () => {
    mocked(api.updateLiraaSurvey).mockResolvedValue(liraaSurvey({ strata: [ stratum({ mode: "half" }) ] }));
    await mountDraft();
    expect(await screen.findByText("Padrão vale de 8.100 a 12.000 imóveis — este estrato tem 8.099")).not.toBeNull();
    // A faixa trava só o sorteio (o SaveSurvey não a confere, e salvar é a recontagem — Q24); salvar fica livre.
    expect(blocked("Sortear")).toBe(true);
    expect(screen.getByText(FIX_TO_DRAW)).not.toBeNull();
    expect(blocked("Salvar estratos")).toBe(false);
    // Os rótulos do tipo saem dos parâmetros vigentes.
    fireEvent.change(group(1).getByLabelText("Tipo"), { target: { value: "half" } });
    expect(screen.queryByText(/Padrão vale/)).toBeNull();
    expect(group(1).getByRole("option", { name: "Reduzido (2.000 a 8.099)" })).not.toBeNull();
    expect(blocked("Salvar estratos")).toBe(false);
    // O tipo mudou e não foi salvo: o sorteio pede salvar antes.
    expect(blocked("Sortear")).toBe(true);
    expect(screen.getByText(SAVE_FIRST)).not.toBeNull();
    mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ strata: [ stratum({ mode: "half" }) ] }) ]);
    fireEvent.click(button("Salvar estratos"));
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLiraaSurvey).mock.calls[0]).toEqual([ "s1", { strata: [ { name: "Centro-norte", mode: "half", block_ids: [ "cb1", "cb2" ] } ], expected_version: 1 } ]);
    expect(await screen.findByText(STRATA_SAVED)).not.toBeNull();
    await waitFor(() => expect(blocked("Sortear")).toBe(false));
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    expect(api.getVectorParameters).toHaveBeenCalledTimes(1);
  });

  it("fora da faixa salva sem mudança para recontar: o N novo do api libera o sorteio (sem impasse)", async () => {
    // A base mudou desde a gravação: o api reconta 8.100 (estrato recriado, id novo).
    const recounted = liraaSurvey({ strata: [ stratum({ id: "st9", households_count: 8100 }) ] });
    mocked(api.updateLiraaSurvey).mockResolvedValue(recounted);
    await mountDraft();
    expect(blocked("Sortear")).toBe(true);
    mocked(api.listLiraaSurveys).mockResolvedValue([ recounted ]);
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLiraaSurvey).mock.calls[0]).toEqual([ "s1", { strata: [ { name: "Centro-norte", mode: "standard", block_ids: [ "cb1", "cb2" ] } ], expected_version: 1 } ]);
    expect(await screen.findByText(/N = 8\.100 imóveis/)).not.toBeNull();
    expect(screen.queryByText(/Padrão vale/)).toBeNull();
    await waitFor(() => expect(blocked("Sortear")).toBe(false));
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
  });

  it.each([
    [ "standard", 8099, false ], [ "standard", 8100, true ], [ "standard", 12000, true ], [ "standard", 12001, false ],
    [ "half", 1999, false ], [ "half", 2000, true ], [ "half", 8099, true ], [ "half", 8100, false ],
    [ "census", 0, true ], [ "census", 1999, true ], [ "census", 2000, false ]
  ] as const)("faixa do tipo %s com N %d: sorteia = %s; salvar sempre livre", async (mode, n, ok) => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ strata: [ stratum({ mode, households_count: n }) ] }) ]);
    await mountDraft();
    expect(blocked("Sortear")).toBe(!ok);
    expect(screen.queryByText(/vale (de|até) /) === null).toBe(ok);
    expect(blocked("Salvar estratos")).toBe(false);
  });

  it("os dois lados da faixa: 8.100 em padrão sorteia; estrato sem quarteirão e nome vazio travam", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ strata: [ stratum({ households_count: 8100 }) ] }) ]);
    await mountDraft();
    expect(screen.getByText(/N = 8\.100 imóveis/)).not.toBeNull();
    expect(screen.queryByText(/Padrão vale/)).toBeNull();
    expect(blocked("Salvar estratos")).toBe(false);
    expect(blocked("Sortear")).toBe(false);
    // Desmarcar e remarcar o mesmo quarteirão (a ordem muda) não é mudança: o sorteio segue livre.
    await pickNeighborhood(1);
    fireEvent.click(await group(1).findByLabelText("Quarteirão 12"));
    expect(screen.getByText(SAVE_FIRST)).not.toBeNull();
    fireEvent.click(group(1).getByLabelText("Quarteirão 12"));
    expect(screen.queryByText(SAVE_FIRST)).toBeNull();
    expect(blocked("Sortear")).toBe(false);
    fireEvent.click(button("Adicionar estrato"));
    expect(group(2).getByText("escolha ao menos um quarteirão para o estrato")).not.toBeNull();
    expect(blocked("Salvar estratos")).toBe(true);
    fireEvent.click(button("Remover estrato 2"));
    fireEvent.change(group(1).getByLabelText("Nome do estrato"), { target: { value: "   " } });
    expect(group(1).getByText("o nome do estrato tem de 1 a 60 caracteres")).not.toBeNull();
    expect(blocked("Salvar estratos")).toBe(true);
    fireEvent.change(group(1).getByLabelText("Nome do estrato"), { target: { value: "y".repeat(61) } });
    expect(blocked("Salvar estratos")).toBe(true);
    fireEvent.change(group(1).getByLabelText("Nome do estrato"), { target: { value: "y".repeat(60) } });
    expect(blocked("Salvar estratos")).toBe(false);
    expect(api.updateLiraaSurvey).not.toHaveBeenCalled();
  });

  it("quarteirão novo: o N vem do api ao salvar (estratos recriados), não da soma dos quarteirões", async () => {
    // A soma dos quarteirões (contando PE) daria 8.399; o api conta 8.390 sem PE e recria o estrato com outro id.
    const recounted = liraaSurvey({ strata: [ stratum({ id: "st9", block_ids: [ "cb1", "cb2", "cb3" ], households_count: 8390 }) ] });
    mocked(api.updateLiraaSurvey).mockResolvedValue(recounted);
    await mountDraft();
    await pickNeighborhood(1);
    fireEvent.click(await group(1).findByLabelText("Quarteirão 14"));
    expect(group(1).getByText(N_ON_SAVE)).not.toBeNull();
    expect(screen.queryByText(/Padrão vale/)).toBeNull();
    expect(screen.queryByText(/8\.399/)).toBeNull();
    expect(blocked("Salvar estratos")).toBe(false);
    expect(blocked("Sortear")).toBe(true);
    mocked(api.listLiraaSurveys).mockResolvedValue([ recounted ]);
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLiraaSurvey).mock.calls[0][1]).toEqual({ strata: [ { name: "Centro-norte", mode: "standard", block_ids: [ "cb1", "cb2", "cb3" ] } ], expected_version: 1 });
    expect(await screen.findByText(/N = 8\.390 imóveis/)).not.toBeNull();
    // Remontado com os estratos gravados: o bairro aberto continua, e o foco está na mensagem.
    expect((group(1).getByLabelText("Bairro") as HTMLSelectElement).value).toBe("nb1");
    expect((await group(1).findByLabelText("Quarteirão 14") as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement?.textContent).toBe(STRATA_SAVED);
    await waitFor(() => expect(blocked("Sortear")).toBe(false));
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
    expect(api.getVectorParameters).toHaveBeenCalledTimes(1);
  });

  it.each([
    [ "409 survey_not_draft", new ApiError(409, { error: "survey_not_draft" }, "x"), VECTOR_ERRORS.survey_not_draft ],
    [ "404", new ApiError(404, { error: "not_found" }, "x"), null ]
  ])("salvar com a tela velha (%s): a frase e UMA releitura, sem reenvio", async (_, err, text) => {
    mocked(api.updateLiraaSurvey).mockRejectedValue(err);
    await mountDraft();
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    const shown = await screen.findByRole("alert");
    if (text) expect(shown.textContent).toBe(text);
    expect(shown.textContent).not.toMatch(/not_found|survey_not_draft/);
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
    expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1);
  });

  it("quarteirão inativo já escolhido: marcado no estrato, trava salvar até sair; a recusa do api cai no estrato", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ strata: [ stratum({ block_ids: [ "cb1", "cb4" ], households_count: 4010 }) ] }) ]);
    mocked(api.updateLiraaSurvey).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "strata[0].block_ids[1]" }, "x"));
    await mountDraft();
    // Com o bairro fechado, a tela não sabe: salvar livre, e a recusa do api vai ao estrato com a frase do inativo.
    fireEvent.click(button("Salvar estratos"));
    expect(await group(1).findByText(INACTIVE_CHOSEN)).not.toBeNull();
    expect(screen.queryByText(/recarregue/)).toBeNull();
    await pickNeighborhood(1);
    const cb4 = (await group(1).findByLabelText("Quarteirão 15")) as HTMLInputElement;
    expect(cb4.checked).toBe(true);
    expect(cb4.disabled).toBe(false);
    expect(group(1).getByText("inativo — tire-o")).not.toBeNull();
    await waitFor(() => expect(blocked("Salvar estratos")).toBe(true));
    fireEvent.click(cb4);
    await waitFor(() => expect(blocked("Salvar estratos")).toBe(false));
    expect(group(1).queryByText(INACTIVE_CHOSEN)).toBeNull();
    expect(cb4.disabled).toBe(true);
    expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1);
  });

  it("quarteirão de outro estrato fica desabilitado", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ strata: [
      stratum({ mode: "census", block_ids: [ "cb1" ], households_count: 1500 }),
      stratum({ id: "st2", name: "Centro-sul", mode: "census", block_ids: [ "cb2" ], households_count: 900 })
    ] }) ]);
    mocked(api.updateLiraaSurvey).mockRejectedValue(new ApiError(422, { error: "stratum_overlap", path: "strata[1].block_ids[0]" }, "x"));
    await mountDraft();
    expect(api.listCityBlocks).not.toHaveBeenCalled();
    await pickNeighborhood(1);
    const cb = async (n: number, number: string) => (await group(n).findByLabelText(`Quarteirão ${number}`)) as HTMLInputElement;
    expect((await cb(1, "12")).checked).toBe(true);
    expect((await cb(1, "13")).disabled).toBe(true);
    expect(group(1).getByText("já em Centro-sul")).not.toBeNull();
    expect((await cb(1, "15")).disabled).toBe(true);
    expect(group(1).getByText("4.000 imóveis")).not.toBeNull();
    // Escolher outro quarteirão: o N vem do api ao salvar (sem PE), não da soma.
    fireEvent.click(await cb(1, "14"));
    expect(group(1).getByText(N_ON_SAVE)).not.toBeNull();
    expect(group(1).getByText("2 quarteirões escolhidos")).not.toBeNull();
    expect(screen.getByText(SAVE_FIRST)).not.toBeNull();
    // O mesmo bairro no outro estrato: a lista já lida serve (uma leitura por bairro).
    await pickNeighborhood(2);
    expect((await cb(2, "12")).disabled).toBe(true);
    expect((await cb(2, "14")).disabled).toBe(true);
    expect((await cb(2, "13")).checked).toBe(true);
    expect(api.listCityBlocks).toHaveBeenCalledTimes(1);
    expect(api.listCityBlocks).toHaveBeenCalledWith("nb1");
    // A recusa do api cai no estrato do path, sem releitura.
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLiraaSurvey).mock.calls[0][1]).toEqual({ strata: [
      { name: "Centro-norte", mode: "census", block_ids: [ "cb1", "cb3" ] }, { name: "Centro-sul", mode: "census", block_ids: [ "cb2" ] }
    ], expected_version: 1 });
    expect(await group(2).findByText(VECTOR_ERRORS.stratum_overlap)).not.toBeNull();
    expect(group(1).queryByText(VECTOR_ERRORS.stratum_overlap)).toBeNull();
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(1);
  });
});

describe("sorteio", () => {
  const READY = liraaSurvey({ strata: [ stratum({ households_count: 9000 }) ] });
  beforeEach(() => { mocked(api.listLiraaSurveys).mockResolvedValue([ READY ]); });

  it("sorteio: step-up, um envio; 409 relê uma vez", async () => {
    vi.mocked(api.drawLiraaSurvey).mockRejectedValueOnce(new ApiError(409, { error: "survey_not_draft" }, "x"));
    await mountDraft();
    await confirmStepUp("Sortear");
    expect(await screen.findByText(VECTOR_ERRORS.survey_not_draft)).not.toBeNull();
    expect(api.drawLiraaSurvey).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.drawLiraaSurvey).toHaveBeenCalledTimes(1);
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(DRAW_DESCRIPTION)).toBeNull();
  });

  it("step-up exigido: código pedido, a descrição antes; o botão some enquanto envia; duplo clique → um envio; sorteado abre itens e índices", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_verified_at: null }));
    let resolve!: (s: LiraaSurvey) => void;
    mocked(api.drawLiraaSurvey).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await mountDraft();
    fireEvent.click(button("Sortear"));
    expect(screen.getByText(DRAW_DESCRIPTION)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Sortear/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.drawLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(mocked(api.drawLiraaSurvey).mock.calls[0]).toEqual([ "s1" ]);
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY ]);
    resolve(DRAWN_SURVEY);
    expect(await screen.findByText(DRAWN)).not.toBeNull();
    expect(await screen.findByRole("table", { name: "Índices do LIRAa" })).not.toBeNull();
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.drawLiraaSurvey).toHaveBeenCalledTimes(1);
    expect(api.listLiraaItems).toHaveBeenCalledTimes(1);
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^Salvar estratos/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Sortear/ })).toBeNull();
  });

  it("sem autenticador: o sorteio não sai e leva à segurança", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_enrolled: false, mfa_verified_at: null }));
    const toSecurity = vi.fn();
    await mountDraft(toSecurity);
    fireEvent.click(button("Sortear"));
    expect(await screen.findByText("Esta ação exige um autenticador cadastrado.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "cadastre seu autenticador" }));
    expect(toSecurity).toHaveBeenCalledTimes(1);
    expect(api.drawLiraaSurvey).not.toHaveBeenCalled();
  });

  it("estrato fora da faixa no sorteio (o api reconta): a frase cai no estrato, sem releitura", async () => {
    mocked(api.drawLiraaSurvey).mockRejectedValue(new ApiError(422, { error: "stratum_out_of_range", path: "strata[0]" }, "x"));
    await mountDraft();
    await confirmStepUp("Sortear");
    expect(await group(1).findByText(new RegExp(VECTOR_ERRORS.stratum_out_of_range))).not.toBeNull();
    await tick();
    expect(api.drawLiraaSurvey).toHaveBeenCalledTimes(1);
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(1);
    // Sortear fica travado até salvar de novo (a recontagem); salvar sem mudança libera com o N novo.
    expect(blocked("Sortear")).toBe(true);
    expect(screen.getByText(SAVE_FIRST)).not.toBeNull();
    const recounted = liraaSurvey({ strata: [ stratum({ id: "st9", households_count: 9100 }) ] });
    mocked(api.updateLiraaSurvey).mockResolvedValue(recounted);
    mocked(api.listLiraaSurveys).mockResolvedValue([ recounted ]);
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(blocked("Sortear")).toBe(false));
    expect(group(1).queryByText(new RegExp(VECTOR_ERRORS.stratum_out_of_range))).toBeNull();
  });

  it("quarteirão desativado depois de salvar (invalid_request strata[i] no sorteio): a frase do inativo no estrato, não o pedido inválido", async () => {
    mocked(api.drawLiraaSurvey).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "strata[0]" }, "x"));
    await mountDraft();
    await confirmStepUp("Sortear");
    expect(await group(1).findByText(INACTIVE_CHOSEN)).not.toBeNull();
    expect(screen.queryByText(/recarregue/)).toBeNull();
    expect(blocked("Sortear")).toBe(true);
    expect(api.drawLiraaSurvey).toHaveBeenCalledTimes(1);
  });
});

describe("sorteado e fechado", () => {
  it("sorteado: itens com substituição e índice provisório; PDF e CSV baixam pelo saveFile", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY ]);
    mocked(api.listLiraaItems).mockResolvedValue({ next_before: null, items: [
      liraaItem({ id: "lit1", position: 3, status: "substituted", household: { id: "h1", address_short: "Rua das Flores, 120" } }),
      liraaItem({ id: "lit2", position: 8, status: "inspected", household: { id: "h2", address_short: "Rua das Acácias, 7" } }),
      liraaItem({ id: "lit3", position: 2, status: "pending", substitute_of_id: "lit1", household: { id: "h3", address_short: "Rua das Flores, 118" } })
    ] });
    const pdf = { blob: new Blob([ "%PDF" ]), filename: "liraa-2026.pdf" };
    const csv = { blob: new Blob([ "a;b" ]), filename: null };
    mocked(api.fetchVectorReportFile).mockImplementation(async (_n, _f, fmt) => (fmt === "pdf" ? pdf : csv));
    mount();
    await open();
    const strata = within(await screen.findByRole("table", { name: "Estratos sorteados" }));
    for (const t of [ "Centro-norte", "Reduzido", "8.099", "433", "2", "1" ]) expect(strata.getAllByText(t).length).toBeGreaterThan(0);
    const items = within(await screen.findByRole("table", { name: "Imóveis sorteados" }));
    expect(items.getByText("substituído")).not.toBeNull();
    expect(items.getByText("inspecionado")).not.toBeNull();
    expect(items.getByText("substituto de Rua das Flores, 120")).not.toBeNull();
    expect(items.getAllByText("12").length).toBe(3);
    expect(await screen.findByText(PROVISIONAL)).not.toBeNull();
    const index = within(screen.getByRole("table", { name: "Índices do LIRAa" }));
    expect(index.getAllByText("3,3").length).toBe(2);
    expect(index.getByText("Município")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    fireEvent.click(screen.getByRole("button", { name: /^PDF/ }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(mocked(saveFile).mock.calls[0]).toEqual([ pdf, "liraa-2026.pdf" ]);
    expect(mocked(api.fetchVectorReportFile).mock.calls[0]).toEqual([ "liraa", { survey_id: "s1" }, "pdf" ]);
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));
    expect(mocked(saveFile).mock.calls[1]).toEqual([ csv, "liraa-s1.csv" ]);
    expect(api.fetchVectorReportFile).toHaveBeenCalledTimes(2);
    // Leituras mínimas: os itens (com trilha) uma vez, o índice uma vez; nada do rascunho.
    await tick();
    expect(mocked(api.listLiraaItems).mock.calls).toEqual([ [ "s1", null ] ]);
    expect(mocked(api.getVectorReport).mock.calls).toEqual([ [ "liraa", { survey_id: "s1" } ] ]);
    for (const f of [ api.getVectorParameters, api.listCityBlocks, api.listPanelNeighborhoods ]) expect(f).not.toHaveBeenCalled();
    // O que não aparece: id de domicílio, editor e sorteio; nada na URL nem em storage.
    expect(screen.queryByText(/\bh[123]\b/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Sortear/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Salvar estratos/ })).toBeNull();
    expect(window.location.search).toBe("");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("índice sem amostra pendente: sem o aviso de provisório; download recusado mostra a frase do 35a", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY ]);
    mocked(api.getVectorReport).mockResolvedValue({ ...LIRAA_REPORT, provisional: false });
    mocked(api.fetchVectorReportFile).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mount();
    await open();
    await screen.findByRole("table", { name: "Índices do LIRAa" });
    expect(screen.queryByText(PROVISIONAL)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(api.fetchVectorReportFile).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByText(/missing_role/)).toBeNull();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("Atualizar: relê o índice e só a primeira página dos itens (uma trilha por clique); sem clique, nada", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY ]);
    mocked(api.listLiraaItems).mockImplementation(async (_id, before) => (before
      ? { items: [ liraaItem({ id: "lit2", position: 8, household: { id: "h2", address_short: "Rua das Acácias, 7" } }) ], next_before: null }
      : { items: [ liraaItem() ], next_before: "cur-2" }));
    mocked(api.getVectorReport).mockResolvedValue({ ...LIRAA_REPORT, notes: [ "Provisório: há amostra sem resultado de laboratório.", "1 imóvel(is) substituído(s) sem candidato." ] });
    mount();
    await open();
    await screen.findByRole("table", { name: "Imóveis sorteados" });
    // O aviso de provisório aparece uma vez (a nota do api que diz o mesmo sai); as outras notas ficam.
    expect(await screen.findByText(PROVISIONAL)).not.toBeNull();
    expect(screen.queryByText(/^Provisório:/)).toBeNull();
    expect(screen.getByText("1 imóvel(is) substituído(s) sem candidato.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Rua das Acácias, 7")).not.toBeNull();
    await tick();
    expect(api.listLiraaItems).toHaveBeenCalledTimes(2);
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    fireEvent.click(button("Atualizar"));
    fireEvent.click(button("Atualizar"));
    await waitFor(() => expect(api.listLiraaItems).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(2));
    await tick();
    expect(mocked(api.listLiraaItems).mock.calls).toEqual([ [ "s1", null ], [ "s1", "cur-2" ], [ "s1", null ] ]);
    expect(api.getVectorReport).toHaveBeenCalledTimes(2);
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(1);
  });

  it("fechar: só de sorteado, com step-up", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ CLOSED_SURVEY ]);
    mount();
    await open();
    await screen.findByRole("table", { name: "Estratos sorteados" });
    expect(screen.queryByRole("button", { name: /^Fechar levantamento/ })).toBeNull();
    cleanup();

    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_verified_at: null }));
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY ]);
    mocked(api.closeLiraaSurvey).mockResolvedValue(CLOSED_SURVEY);
    mount();
    await open();
    await screen.findByRole("table", { name: "Estratos sorteados" });
    mocked(api.listLiraaSurveys).mockResolvedValue([ CLOSED_SURVEY ]);
    await confirmStepUp("Fechar levantamento", "123456");
    // Duplo clique no Confirmar: um envio.
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.closeLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(mocked(api.closeLiraaSurvey).mock.calls[0]).toEqual([ "s1" ]);
    expect(await screen.findByText(CLOSED)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Fechar levantamento/ })).toBeNull();
    // Depois de fechar: a lista, o índice e os itens (reset: só a primeira página) relidos uma vez cada.
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(api.listLiraaItems).toHaveBeenCalledTimes(3));
    await tick();
    expect(api.closeLiraaSurvey).toHaveBeenCalledTimes(1);
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(3);
    expect(api.getVectorReport).toHaveBeenCalledTimes(3);
    expect(mocked(api.listLiraaItems).mock.calls).toEqual([ [ "s1", null ], [ "s1", null ], [ "s1", null ] ]);
  });

  it("fechar com a tela velha: 409 invalid_transition → a frase e UMA releitura, sem reenvio", async () => {
    mocked(api.listLiraaSurveys).mockResolvedValue([ DRAWN_SURVEY ]);
    mocked(api.closeLiraaSurvey).mockRejectedValue(new ApiError(409, { error: "invalid_transition", path: "status" }, "x"));
    mount();
    await open();
    await screen.findByRole("table", { name: "Estratos sorteados" });
    await confirmStepUp("Fechar levantamento");
    expect(await screen.findByText(VECTOR_ERRORS.invalid_transition)).not.toBeNull();
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.closeLiraaSurvey).toHaveBeenCalledTimes(1);
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
    expect(api.listLiraaItems).toHaveBeenCalledTimes(1);
  });
});

describe("Q37: nome, período e version do rascunho", () => {
  const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("nome e período: só o que mudou, com a version mostrada; a segunda edição leva a version devolvida; a recusa do api no campo", async () => {
    const v2 = liraaSurvey({ name: "LIRAa novembro 2", version: 2 });
    mocked(api.updateLiraaSurvey).mockResolvedValueOnce(v2)
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "ends_on" }, "x"));
    await mountDraft();
    expect((screen.getByLabelText("Nome do levantamento") as HTMLInputElement).value).toBe("LIRAa novembro");
    // Sem mudança: nada vai (o api recusaria a edição vazia).
    fireEvent.click(button("Salvar nome e período"));
    expect(await screen.findByText(NOTHING_CHANGED)).not.toBeNull();
    // As regras do SaveSurvey, sem chamar: 81 caracteres e o fim antes do início.
    typeIn("Nome do levantamento", "x".repeat(81));
    typeIn("Fim do período", "2026-11-22");
    fireEvent.click(button("Salvar nome e período"));
    expect(await screen.findByText(NAME_PROBLEM)).not.toBeNull();
    expect(screen.getByText(END_BEFORE_START)).not.toBeNull();
    expect(api.updateLiraaSurvey).not.toHaveBeenCalled();
    typeIn("Nome do levantamento", " LIRAa novembro 2 ");
    typeIn("Fim do período", "2026-11-23");
    mocked(api.listLiraaSurveys).mockResolvedValue([ v2 ]);
    fireEvent.click(button("Salvar nome e período"));
    fireEvent.click(button("Salvar nome e período"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLiraaSurvey).mock.calls[0]).toEqual([ "s1", { name: "LIRAa novembro 2", ends_on: "2026-11-23", expected_version: 1 } ]);
    expect(await screen.findByText(DETAILS_SAVED)).not.toBeNull();
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    // A segunda edição: a version devolvida (2); a recusa do api cai no campo do path.
    typeIn("Fim do período", "2026-11-30");
    fireEvent.click(button("Salvar nome e período"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateLiraaSurvey).mock.calls[1]).toEqual([ "s1", { ends_on: "2026-11-30", expected_version: 2 } ]);
    const end = screen.getByLabelText("Fim do período");
    await waitFor(() => expect(end.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(END_BEFORE_START)).not.toBeNull();
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
  });

  it("estratos: salvar duas vezes leva a version devolvida pela primeira", async () => {
    const v2 = liraaSurvey({ version: 2, strata: [ stratum({ id: "st5", mode: "half" }) ] });
    const v3 = liraaSurvey({ version: 3, strata: [ stratum({ id: "st6", mode: "census", households_count: 1800 }) ] });
    mocked(api.updateLiraaSurvey).mockResolvedValueOnce(v2).mockResolvedValueOnce(v3);
    await mountDraft();
    fireEvent.change(group(1).getByLabelText("Tipo"), { target: { value: "half" } });
    mocked(api.listLiraaSurveys).mockResolvedValue([ v2 ]);
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(blocked("Sortear")).toBe(false));
    fireEvent.change(group(1).getByLabelText("Tipo"), { target: { value: "census" } });
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateLiraaSurvey).mock.calls.map((c) => c[1].expected_version)).toEqual([ 1, 2 ]);
  });

  it("409 survey_changed nos estratos: a frase, UMA releitura, o digitado fica e o próximo envio leva a version relida", async () => {
    // Outra pessoa gravou (estratos recriados com outro id, version 5).
    const theirs = liraaSurvey({ version: 5, strata: [ stratum({ id: "st7", name: "Deles", block_ids: [ "cb1" ], households_count: 4000 }) ] });
    mocked(api.updateLiraaSurvey).mockRejectedValueOnce(new ApiError(409, { error: "survey_changed" }, "x")).mockResolvedValueOnce(theirs);
    await mountDraft();
    fireEvent.change(group(1).getByLabelText("Tipo"), { target: { value: "half" } });
    await pickNeighborhood(1);
    fireEvent.click(await group(1).findByLabelText("Quarteirão 14"));
    mocked(api.listLiraaSurveys).mockResolvedValue([ theirs ]);
    fireEvent.click(button("Salvar estratos"));
    expect(await screen.findByText(VECTOR_ERRORS.survey_changed)).not.toBeNull();
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
    expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(1);
    // O digitado fica: o tipo, o bairro aberto e o quarteirão escolhido; o N é o do salvar.
    expect((group(1).getByLabelText("Tipo") as HTMLSelectElement).value).toBe("half");
    expect((group(1).getByLabelText("Nome do estrato") as HTMLInputElement).value).toBe("Centro-norte");
    expect(((await group(1).findByLabelText("Quarteirão 14")) as HTMLInputElement).checked).toBe(true);
    expect(group(1).getByText(N_ON_SAVE)).not.toBeNull();
    expect(blocked("Sortear")).toBe(true);
    fireEvent.click(button("Salvar estratos"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateLiraaSurvey).mock.calls[1]).toEqual([ "s1", {
      strata: [ { name: "Centro-norte", mode: "half", block_ids: [ "cb1", "cb2", "cb3" ] } ], expected_version: 5
    } ]);
  });

  it("409 survey_changed no nome: a frase, UMA releitura, o nome digitado fica; o próximo envio leva a version relida", async () => {
    mocked(api.updateLiraaSurvey).mockRejectedValueOnce(new ApiError(409, { error: "survey_changed" }, "x"))
      .mockResolvedValueOnce(liraaSurvey({ name: "Meu nome", version: 5 }));
    await mountDraft();
    typeIn("Nome do levantamento", "Meu nome");
    mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ name: "Nome deles", version: 4 }) ]);
    fireEvent.click(button("Salvar nome e período"));
    expect(await screen.findByText(VECTOR_ERRORS.survey_changed)).not.toBeNull();
    await waitFor(() => expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText("Nome do levantamento") as HTMLInputElement).value).toBe("Meu nome");
    fireEvent.click(button("Salvar nome e período"));
    await waitFor(() => expect(api.updateLiraaSurvey).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateLiraaSurvey).mock.calls.map((c) => c[1])).toEqual([
      { name: "Meu nome", expected_version: 1 }, { name: "Meu nome", expected_version: 4 }
    ]);
    expect(await screen.findByText(DETAILS_SAVED)).not.toBeNull();
  });
});
