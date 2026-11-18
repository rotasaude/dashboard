// src/modules/VectorTransmission.test.tsx
// "Bloqueio de transmissão" da coordenação de endemias (módulo 35a, Task 15; F-35.7; contrato §8, §17; Q8, Q9, Q13(6)(9), Q26,
// Q28): lista por status (propostos primeiro) sem paciente; o detalhe com os casos só como "caso N · doença · data"; a área
// (sugeridos pré-marcados), o quarteirão do caso e a confirmação com step-up e `seen_case_ids` (Q26(4)); o descarte com motivo;
// o fechamento; os ciclos de UBV; juntar um caso a outro bloqueio; o endereço do caso só no diálogo (step-up, nunca no cache nem
// em storage); o mapa da área só por clique. 409/404 e 422 seen_case_ids → a frase e UMA releitura, sem reenvio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), listTransmissionBlocks: vi.fn(), getTransmissionBlock: vi.fn(),
    confirmTransmissionBlock: vi.fn(), dismissTransmissionBlock: vi.fn(), closeTransmissionBlock: vi.fn(), addTransmissionCycle: vi.fn(),
    moveTransmissionCase: vi.fn(), getTransmissionCaseAddress: vi.fn(), listCityBlocks: vi.fn(), listPanelNeighborhoods: vi.fn(),
    getVectorParameters: vi.fn(), listVectorMapPoints: vi.fn(), getVectorDomains: vi.fn(), getVectorDiseases: vi.fn()
  };
});
const handle = vi.hoisted(() => ({
  setPoints: vi.fn(), fitTo: vi.fn(), onPointClick: vi.fn(), startCorrection: vi.fn(), stopCorrection: vi.fn(), destroy: vi.fn()
}));
vi.mock("./territory/map/fieldMap", () => ({ createFieldMap: vi.fn(() => handle) }));

import * as api from "../lib/api";
import { ApiError, type TransmissionBlock } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { FROZEN_TEXT_NOTICE } from "../components/FrozenTextNotice";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { MAP_MANIFEST } from "../test/territoryMapFixtures";
import { VC_DISEASES, VC_FEATURES, cityBlock, parameterVersion, transmissionBlock, vcUser } from "../test/vectorControlFixtures";
import { VectorTransmission } from "./VectorTransmission";
import {
  BLOCK_CLOSED, BLOCK_CONFIRMED, CASES_REREAD, CASE_MOVED, CENTER_INACTIVE, CYCLE_SAVED, NEED_AREA, NEED_CENTER, NO_CASE, NO_CASE_ACK, PROPOSAL_DISMISSED
} from "./vectorControl/BlockDetail";
import { ADDRESS_DESCRIPTION } from "./vectorControl/CaseAddressDialog";

const ALL = [
  api.fetchCurrentSession, api.stepUpMfa, api.listTransmissionBlocks, api.getTransmissionBlock, api.confirmTransmissionBlock,
  api.dismissTransmissionBlock, api.closeTransmissionBlock, api.addTransmissionCycle, api.moveTransmissionCase, api.getTransmissionCaseAddress,
  api.listCityBlocks, api.listPanelNeighborhoods, api.getVectorParameters, api.listVectorMapPoints, api.getVectorDomains, api.getVectorDiseases
];
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const tick = () => new Promise((r) => setTimeout(r, 20));
const err = (status: number, body: Record<string, unknown>) => new ApiError(status, body, "x");
const TAB: Record<string, string> = { proposed: "Propostos", active: "Ativos", closed: "Fechados", dismissed: "Descartados" };

// O api: lista por status pedido; o detalhe, a última versão de cada id.
let blocks: TransmissionBlock[] = [];
afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); });
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  blocks = [];
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
  mocked(api.listTransmissionBlocks).mockImplementation(async (q: { status?: string[] }) =>
    ({ items: blocks.filter((b) => !q.status || q.status.includes(b.status)), next_before: null }));
  mocked(api.getTransmissionBlock).mockImplementation(async (id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) throw err(404, { error: "not_found" });
    return b;
  });
  mocked(api.getVectorParameters).mockResolvedValue(parameterVersion());
  // Sem rótulos por padrão: o código cru (os testes dos nomes, Q38, no fim).
  mocked(api.getVectorDiseases).mockResolvedValue({ items: [], groups: [] });
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Centro", active: true } ]);
  mocked(api.listCityBlocks).mockResolvedValue([
    cityBlock({ id: "cb7", number: "40" }), cityBlock({ id: "cb8", number: "41" }), cityBlock({ id: "cb9", number: "42", active: false })
  ]);
  mocked(api.listVectorMapPoints).mockResolvedValue({ map: MAP_MANIFEST, points: [ { id: "h1", latitude: -25.4, longitude: -49.2, category: "area", label: "area" } ] });
});

const mount = (onGoToSecurity?: () => void) => renderWithProviders(<VectorTransmission onGoToSecurity={onGoToSecurity} />);
// Monta a tela, abre a aba do status e o bloqueio; devolve quando o detalhe chegou.
async function mountDetail(block: TransmissionBlock, o: { others?: TransmissionBlock[]; onGoToSecurity?: () => void } = {}) {
  blocks = [ block, ...(o.others ?? []) ];
  const r = mount(o.onGoToSecurity);
  if (block.status !== "proposed") fireEvent.click(await screen.findByRole("tab", { name: TAB[block.status] }));
  const panel = within(await screen.findByRole("tabpanel", { name: TAB[block.status] }));
  fireEvent.click(await panel.findByRole("button", { name: /^Abrir o bloqueio/ }));
  await screen.findByText("Ciclos de UBV");
  return r;
}
// Abre a ação pelo botão, informa o código quando a janela do step-up está fechada e confirma.
async function confirmStepUp(label: string, code?: string) {
  fireEvent.click(await screen.findByRole("button", { name: label }));
  if (code) fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: code } });
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const blocked = (name: string | RegExp) => button(name).getAttribute("aria-disabled") === "true";
const checkbox = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const cacheText = (client: ReturnType<typeof mount>["client"]) =>
  JSON.stringify([ client.getQueryCache().getAll().map((q) => q.state.data), client.getMutationCache().getAll().map((m) => m.state.data) ]);
const storageText = () => JSON.stringify([ { ...window.localStorage }, { ...window.sessionStorage } ]);

const ACTIVE = transmissionBlock({
  id: "tb1", status: "active", confirmed_at: "2026-11-15T13:00:00Z",
  area: [ { id: "cb1", number: "12", suggested: true }, { id: "cb2", number: "13", suggested: true } ],
  cycles: [ { number: 1, starts_on: "2026-11-08", ends_on: "2026-11-10" } ]
});

describe("portão e lista", () => {
  it("só a coordenação: laboratório, admin e profissional veem a frase do papel e nada é lido", async () => {
    for (const roles of [ [ "vector_lab" ], [ "municipal_admin" ], [ "health_professional" ] ]) {
      mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      mount();
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      cleanup();
    }
    expect(api.listTransmissionBlocks).not.toHaveBeenCalled();
    expect(api.getTransmissionBlock).not.toHaveBeenCalled();
  });

  it("propostos primeiro: doença, casos, quarteirão do caso e criado em; sem paciente; nada mais lido antes de abrir", async () => {
    blocks = [
      transmissionBlock({ cases: [
        { id: "tc1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: true },
        { id: "tc2", number: 2, disease: "chikungunya", case_on: "2026-11-13", has_place: true }
      ] }),
      transmissionBlock({ id: "tb3", center_block: null, area: [], cases: [ { id: "tc3", number: 3, disease: "dengue", case_on: "2026-11-14", has_place: false } ] }),
      { ...ACTIVE, id: "tb9" }
    ];
    mount();
    const table = within(await screen.findByRole("table", { name: "Bloqueios propostos" }));
    expect(table.getByText("dengue, chikungunya")).not.toBeNull();
    expect(table.getByText("2 casos")).not.toBeNull();
    expect(table.getByText("1 caso")).not.toBeNull();
    expect(table.getByText("12")).not.toBeNull();
    expect(table.getByText("sem quarteirão")).not.toBeNull();
    expect(table.getAllByText(/14\/11\/2026/).length).toBe(2);
    await tick();
    expect(api.listTransmissionBlocks).toHaveBeenCalledTimes(1);
    expect(mocked(api.listTransmissionBlocks).mock.calls[0][0]).toEqual({ status: [ "proposed" ], before: null });
    for (const f of [ api.getTransmissionBlock, api.getTransmissionCaseAddress, api.listVectorMapPoints, api.getVectorParameters ]) expect(f).not.toHaveBeenCalled();
    // A aba dos ativos lê ao abrir; voltar aos propostos não relê.
    fireEvent.click(screen.getByRole("tab", { name: "Ativos" }));
    await screen.findByRole("table", { name: "Bloqueios ativos" });
    fireEvent.click(screen.getByRole("tab", { name: "Propostos" }));
    await tick();
    expect(api.listTransmissionBlocks).toHaveBeenCalledTimes(2);
  });
});

describe("detalhe", () => {
  it("endereço do caso: step-up, só no diálogo, nada no cache; lista sem paciente", async () => {
    vi.mocked(api.getTransmissionCaseAddress).mockResolvedValue({ patient_address: "Rua Secreta, 99", household_address: null });
    const { client, container } = await mountDetail(transmissionBlock({ cases: [ { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: false } ] }));
    expect(container.textContent).toMatch(/caso 1 · dengue · 12\/11\/2026/);
    expect(container.textContent).toMatch(/sem quarteirão/);
    expect(api.getTransmissionCaseAddress).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Ver endereço do caso" }));
    expect(await screen.findByText(ADDRESS_DESCRIPTION)).not.toBeNull();
    fireEvent.click(button("Cancelar"));
    expect(api.getTransmissionCaseAddress).not.toHaveBeenCalled();
    await confirmStepUp("Ver endereço do caso");
    expect(await screen.findByText("Rua Secreta, 99")).not.toBeNull();
    expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(1);
    expect(api.getTransmissionCaseAddress).toHaveBeenCalledWith("tb1", "c1");
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toMatch(/Rua Secreta/);
    expect(cacheText(client)).not.toMatch(/Rua Secreta/);
    expect(storageText()).not.toMatch(/Rua Secreta/);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(container.textContent).not.toMatch(/Rua Secreta/);
    expect(cacheText(client)).not.toMatch(/Rua Secreta/);
    expect(storageText()).not.toMatch(/Rua Secreta/);
    // Nenhuma chave com o caso: só ids de bloqueio e status.
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.queryKey))).not.toMatch(/c1|address/);
    expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(1);
  });

  it("endereço nunca no console; trocar de bloqueio com o diálogo aberto o apaga; resposta depois do desmonte não fica", async () => {
    const spies = [ "log", "info", "warn", "error", "debug" ].map((k) => vi.spyOn(console, k as "log").mockImplementation(() => undefined));
    try {
      mocked(api.getTransmissionCaseAddress).mockResolvedValue({ patient_address: "Rua Secreta, 99", household_address: "Travessa Oculta, 7" });
      const unplaced = { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: false };
      blocks = [ transmissionBlock({ cases: [ unplaced ] }), transmissionBlock({ id: "tb2", created_at: "2026-11-15T13:00:00Z", cases: [ { ...unplaced, id: "c2", number: 2 } ] }) ];
      const { client, container } = mount();
      const opens = await screen.findAllByRole("button", { name: /^Abrir o bloqueio/ });
      fireEvent.click(opens.find((b) => /14\/11/.test(b.getAttribute("aria-label") ?? "")) as HTMLElement);
      await screen.findByText("Ciclos de UBV");
      await confirmStepUp("Ver endereço do caso");
      expect(await screen.findByText("Rua Secreta, 99")).not.toBeNull();
      expect(screen.getByRole("dialog", { name: "Endereço do caso 1" })).not.toBeNull();
      // Outro bloqueio: o detalhe remonta e o diálogo some com o estado.
      fireEvent.click(screen.getAllByRole("button", { name: /^Abrir o bloqueio/ }).find((b) => /15\/11/.test(b.getAttribute("aria-label") ?? "")) as HTMLElement);
      await screen.findByText(/caso 2 · dengue/);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(container.textContent).not.toMatch(/Rua Secreta|Travessa Oculta/);
      expect(cacheText(client)).not.toMatch(/Rua Secreta|Travessa Oculta/);
      expect(storageText()).not.toMatch(/Rua Secreta|Travessa Oculta/);
      expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(1);

      // A resposta chega depois do desmonte: nada no DOM nem no cache.
      let resolve!: (a: api.CaseAddress) => void;
      mocked(api.getTransmissionCaseAddress).mockImplementation(() => new Promise((r) => { resolve = r; }));
      await confirmStepUp("Ver endereço do caso");
      await waitFor(() => expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(2));
      cleanup();
      resolve({ patient_address: "Rua Secreta, 99", household_address: null });
      await tick();
      expect(document.body.textContent).not.toMatch(/Rua Secreta/);
      expect(cacheText(client)).not.toMatch(/Rua Secreta/);
      expect(storageText()).not.toMatch(/Rua Secreta/);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Rua Secreta|Travessa Oculta/);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("endereço: janela fechada pede o código; sem autenticador leva à segurança; caso com quarteirão não oferece", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_verified_at: null }));
    mocked(api.getTransmissionCaseAddress).mockResolvedValue({ patient_address: "Rua Secreta, 99", household_address: "Rua das Flores, 120" });
    await mountDetail(transmissionBlock({ cases: [
      { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: false },
      { id: "c2", number: 2, disease: "dengue", case_on: "2026-11-13", has_place: true }
    ] }));
    expect(screen.getAllByRole("button", { name: "Ver endereço do caso" }).length).toBe(1);
    await confirmStepUp("Ver endereço do caso", "123456");
    expect(await screen.findByText("Rua Secreta, 99")).not.toBeNull();
    expect(screen.getByText("Rua das Flores, 120")).not.toBeNull();
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(1);
    cleanup();

    const goTo = vi.fn();
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_enrolled: false, mfa_verified_at: null }));
    await mountDetail(transmissionBlock({ cases: [ { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: false } ] }), { onGoToSecurity: goTo });
    fireEvent.click(await screen.findByRole("button", { name: "Ver endereço do caso" }));
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(1);
  });

  it("endereço em bloqueio que fechou no meio: 409 invalid_transition → a frase, uma releitura, nada mostrado", async () => {
    const block = transmissionBlock({ cases: [ { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: false } ] });
    mocked(api.getTransmissionCaseAddress).mockRejectedValue(err(409, { error: "invalid_transition", path: "status" }));
    await mountDetail(block);
    blocks = [ { ...block, status: "dismissed" } ];
    await confirmStepUp("Ver endereço do caso");
    expect(await screen.findByText(VECTOR_ERRORS.invalid_transition)).not.toBeNull();
    await waitFor(() => expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
    expect(api.getTransmissionCaseAddress).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Ver endereço do caso" })).toBeNull();
  });

  it("confirmar: área sugerida pré-marcada, quarteirão do caso obrigatório, step-up, corpo com os ids", async () => {
    let resolve!: (b: TransmissionBlock) => void;
    mocked(api.confirmTransmissionBlock).mockImplementation(() => new Promise((r) => { resolve = r; }));
    const block = transmissionBlock({ area: [
      { id: "cb1", number: "12", suggested: true }, { id: "cb2", number: "13", suggested: true }, { id: "cb3", number: "14", suggested: false }
    ] });
    await mountDetail(block);
    expect(checkbox(/^quarteirão 12/).checked).toBe(true);
    expect(checkbox(/^quarteirão 13/).checked).toBe(true);
    expect(checkbox(/^quarteirão 14/).checked).toBe(false);
    expect(checkbox(/^quarteirão 12 \(sugerido\)$/)).not.toBeNull();
    expect(checkbox(/^quarteirão 14$/)).not.toBeNull();
    const center = screen.getByLabelText("Quarteirão do caso") as HTMLSelectElement;
    expect(center.value).toBe("cb1");
    fireEvent.change(center, { target: { value: "" } });
    expect(blocked("Confirmar bloqueio")).toBe(true);
    expect(screen.getByText(NEED_CENTER)).not.toBeNull();
    fireEvent.change(center, { target: { value: "cb1" } });
    fireEvent.click(checkbox(/^quarteirão 12/));
    fireEvent.click(checkbox(/^quarteirão 13/));
    expect(blocked("Confirmar bloqueio")).toBe(true);
    expect(screen.getByText(NEED_AREA)).not.toBeNull();
    fireEvent.click(checkbox(/^quarteirão 12/));
    fireEvent.click(checkbox(/^quarteirão 13/));
    expect(blocked("Confirmar bloqueio")).toBe(false);
    await confirmStepUp("Confirmar bloqueio");
    fireEvent.click(button("Confirmar"));
    await tick();
    expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(1);
    expect(api.confirmTransmissionBlock).toHaveBeenCalledWith("tb1", { center_block_id: "cb1", block_ids: [ "cb1", "cb2" ], seen_case_ids: [ "tc1" ] });
    const done = { ...block, status: "active", confirmed_at: "2026-11-16T13:00:00Z", area: block.area.slice(0, 2) };
    blocks = [ done ];
    resolve(done);
    expect(await screen.findByText(BLOCK_CONFIRMED)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar bloqueio" })).toBeNull();
    await tick();
    // A resposta vai à tela; o detalhe não é relido; a aba montada (propostos) é relida UMA vez.
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(1);
    expect(api.listTransmissionBlocks).toHaveBeenCalledTimes(2);
  });

  it("centro inativo (fora da área sugerida): não vem escolhido, aparece marcado e o bairro abre", async () => {
    mocked(api.confirmTransmissionBlock).mockResolvedValue(transmissionBlock({ status: "active" }));
    await mountDetail(transmissionBlock({ center_block: { id: "cb6", number: "20" }, area: [
      { id: "cb1", number: "12", suggested: true }, { id: "cb2", number: "13", suggested: true }
    ] }));
    const center = screen.getByLabelText("Quarteirão do caso") as HTMLSelectElement;
    expect(center.value).toBe("");
    const inactive = within(center).getByRole("option", { name: "quarteirão 20 (inativo)" }) as HTMLOptionElement;
    expect(inactive.disabled).toBe(true);
    expect(screen.getByText(CENTER_INACTIVE("20"))).not.toBeNull();
    expect(screen.queryByLabelText(/^quarteirão 20/)).toBeNull();
    expect(screen.getByLabelText("Bairro")).not.toBeNull();
    expect(blocked("Confirmar bloqueio")).toBe(true);
    expect(screen.getByText(NEED_CENTER)).not.toBeNull();
    fireEvent.change(center, { target: { value: "cb1" } });
    expect(blocked("Confirmar bloqueio")).toBe(false);
    await confirmStepUp("Confirmar bloqueio");
    await waitFor(() => expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(1));
    expect(api.confirmTransmissionBlock).toHaveBeenCalledWith("tb1", { center_block_id: "cb1", block_ids: [ "cb1", "cb2" ], seen_case_ids: [ "tc1" ] });
  });

  it("proposta sem caso (o api aceita): só com a marca explícita; corpo com seen_case_ids vazio", async () => {
    mocked(api.confirmTransmissionBlock).mockResolvedValue(transmissionBlock({ status: "active", cases: [] }));
    await mountDetail(transmissionBlock({ cases: [] }));
    expect(screen.getByText("nenhum caso neste bloqueio")).not.toBeNull();
    expect(blocked("Confirmar bloqueio")).toBe(true);
    expect(screen.getByText(NO_CASE)).not.toBeNull();
    fireEvent.click(screen.getByLabelText(NO_CASE_ACK));
    expect(blocked("Confirmar bloqueio")).toBe(false);
    fireEvent.click(button("Confirmar bloqueio"));
    expect(await screen.findByText(/^Confirma o bloqueio sem caso e 2 quarteirões na área/)).not.toBeNull();
    fireEvent.click(button("Confirmar"));
    await waitFor(() => expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(1));
    expect(api.confirmTransmissionBlock).toHaveBeenCalledWith("tb1", { center_block_id: "cb1", block_ids: [ "cb1", "cb2" ], seen_case_ids: [] });
    expect(await screen.findByText(BLOCK_CONFIRMED)).not.toBeNull();
  });

  it("confirmar proposta sem quarteirão: escolhe bairro, quarteirão do caso e área; janela fechada pede o código", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_verified_at: null }));
    mocked(api.confirmTransmissionBlock).mockResolvedValue(transmissionBlock({ status: "active" }));
    await mountDetail(transmissionBlock({ center_block: null, area: [], cases: [ { id: "tc5", number: 5, disease: "zika", case_on: "2026-11-15", has_place: false } ] }));
    expect(blocked("Confirmar bloqueio")).toBe(true);
    await screen.findByRole("option", { name: "Centro" });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nb1" } });
    await screen.findByLabelText(/^quarteirão 40/);
    expect(screen.queryByLabelText(/^quarteirão 42/)).toBeNull();
    expect(api.listCityBlocks).toHaveBeenCalledWith("nb1");
    fireEvent.change(screen.getByLabelText("Quarteirão do caso"), { target: { value: "cb7" } });
    expect(blocked("Confirmar bloqueio")).toBe(true);
    fireEvent.click(checkbox(/^quarteirão 40/));
    fireEvent.click(checkbox(/^quarteirão 41/));
    await confirmStepUp("Confirmar bloqueio", "654321");
    await waitFor(() => expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(1));
    expect(api.stepUpMfa).toHaveBeenCalledWith("654321");
    expect(api.confirmTransmissionBlock).toHaveBeenCalledWith("tb1", { center_block_id: "cb7", block_ids: [ "cb7", "cb8" ], seen_case_ids: [ "tc5" ] });
    expect(api.listCityBlocks).toHaveBeenCalledTimes(1);
  });

  it("confirmar sem autenticador: leva à segurança e nada é enviado", async () => {
    const goTo = vi.fn();
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_enrolled: false, mfa_verified_at: null }));
    await mountDetail(transmissionBlock(), { onGoToSecurity: goTo });
    fireEvent.click(button("Confirmar bloqueio"));
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(api.confirmTransmissionBlock).not.toHaveBeenCalled();
  });

  it("proposal_changed: a frase, exatamente uma releitura, e o novo envio leva os casos relidos", async () => {
    const block = transmissionBlock();
    mocked(api.confirmTransmissionBlock).mockRejectedValueOnce(err(409, { error: "proposal_changed" }));
    await mountDetail(block);
    const late = { ...block, cases: [ ...block.cases, { id: "tc2", number: 2, disease: "dengue", case_on: "2026-11-15", has_place: true } ] };
    blocks = [ late ];
    await confirmStepUp("Confirmar bloqueio");
    expect(await screen.findByText(VECTOR_ERRORS.proposal_changed)).not.toBeNull();
    expect(await screen.findByText(/caso 2 · dengue · 15\/11\/2026/)).not.toBeNull();
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
    expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(1);
    // O escolhido fica; o envio seguinte é do usuário.
    expect((screen.getByLabelText("Quarteirão do caso") as HTMLSelectElement).value).toBe("cb1");
    mocked(api.confirmTransmissionBlock).mockResolvedValueOnce({ ...late, status: "active" });
    await confirmStepUp("Confirmar bloqueio");
    await waitFor(() => expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(2));
    expect(mocked(api.confirmTransmissionBlock).mock.calls[1][1]).toEqual({ center_block_id: "cb1", block_ids: [ "cb1", "cb2" ], seen_case_ids: [ "tc1", "tc2" ] });
  });

  it("422 seen_case_ids também relê uma vez; 422 block_ids só diz a frase", async () => {
    mocked(api.confirmTransmissionBlock).mockRejectedValueOnce(err(422, { error: "invalid_request", path: "seen_case_ids" }));
    await mountDetail(transmissionBlock());
    await confirmStepUp("Confirmar bloqueio");
    await waitFor(() => expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(CASES_REREAD)).not.toBeNull();
    mocked(api.confirmTransmissionBlock).mockRejectedValueOnce(err(422, { error: "invalid_request", path: "block_ids" }));
    await confirmStepUp("Confirmar bloqueio");
    await waitFor(() => expect(api.confirmTransmissionBlock).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
  });

  it("ciclo de UBV com 4 dias de intervalo não envia; com 5 envia", async () => {
    let resolve!: (b: TransmissionBlock) => void;
    mocked(api.addTransmissionCycle).mockImplementation(() => new Promise((r) => { resolve = r; }));
    await mountDetail(ACTIVE);
    expect(screen.getByText("ciclo 1 · 08/11/2026 a 10/11/2026")).not.toBeNull();
    expect(api.getVectorParameters).not.toHaveBeenCalled();
    fireEvent.click(button("Novo ciclo"));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await screen.findByLabelText("Início do ciclo");
    type("Início do ciclo", "2026-11-14");
    type("Fim do ciclo", "2026-11-16");
    fireEvent.click(button(/^Gravar ciclo/));
    expect(await screen.findByText("o ciclo começa ao menos 5 dias depois do fim do anterior")).not.toBeNull();
    expect(api.addTransmissionCycle).not.toHaveBeenCalled();
    type("Início do ciclo", "2026-11-15");
    type("Fim do ciclo", "2026-11-17");
    fireEvent.click(button(/^Gravar ciclo/));
    fireEvent.click(button(/^Gravar ciclo/));
    await tick();
    expect(api.addTransmissionCycle).toHaveBeenCalledTimes(1);
    expect(api.addTransmissionCycle).toHaveBeenCalledWith("tb1", { starts_on: "2026-11-15", ends_on: "2026-11-17" });
    resolve({ ...ACTIVE, cycles: [ ...ACTIVE.cycles, { number: 2, starts_on: "2026-11-15", ends_on: "2026-11-17" } ] });
    expect(await screen.findByText(CYCLE_SAVED(2))).not.toBeNull();
    expect(screen.getByText("ciclo 2 · 15/11/2026 a 17/11/2026")).not.toBeNull();
    expect(api.getVectorParameters).toHaveBeenCalledTimes(1);
  });

  it("ciclo: 422 cycle_invalid do api vai ao campo; 409 invalid_transition relê uma vez", async () => {
    mocked(api.addTransmissionCycle).mockRejectedValueOnce(err(422, { error: "cycle_invalid", path: "ends_on" }));
    await mountDetail(ACTIVE);
    fireEvent.click(button("Novo ciclo"));
    fireEvent.change(await screen.findByLabelText("Início do ciclo"), { target: { value: "2026-11-15" } });
    fireEvent.change(screen.getByLabelText("Fim do ciclo"), { target: { value: "2026-11-17" } });
    fireEvent.click(button(/^Gravar ciclo/));
    const field = await screen.findByText(VECTOR_ERRORS.cycle_invalid);
    expect(screen.getByLabelText("Fim do ciclo").getAttribute("aria-describedby")).toBe(field.id);
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(1);
    mocked(api.addTransmissionCycle).mockRejectedValueOnce(err(409, { error: "invalid_transition", path: "status" }));
    fireEvent.click(button(/^Gravar ciclo/));
    expect(await screen.findByText(VECTOR_ERRORS.invalid_transition)).not.toBeNull();
    await waitFor(() => expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
    expect(api.addTransmissionCycle).toHaveBeenCalledTimes(2);
  });

  it("descartar exige motivo de 10 a 500; 409 invalid_transition relê uma vez", async () => {
    mocked(api.dismissTransmissionBlock).mockRejectedValueOnce(err(409, { error: "invalid_transition", path: "status" }));
    await mountDetail(transmissionBlock());
    fireEvent.click(button("Descartar"));
    const reason = screen.getByLabelText("Motivo do descarte");
    expect(screen.getByText(FROZEN_TEXT_NOTICE)).not.toBeNull();
    fireEvent.change(reason, { target: { value: "   curto   " } });
    fireEvent.click(button(/^Descartar proposta/));
    expect(await screen.findByText(/de 10 a 500/)).not.toBeNull();
    fireEvent.change(reason, { target: { value: "x".repeat(501) } });
    fireEvent.click(button(/^Descartar proposta/));
    await tick();
    expect(api.dismissTransmissionBlock).not.toHaveBeenCalled();
    blocks = [ transmissionBlock({ status: "active" }) ];
    fireEvent.change(reason, { target: { value: "  Caso descartado pela vigilância  " } });
    fireEvent.click(button(/^Descartar proposta/));
    expect(await screen.findByText(VECTOR_ERRORS.invalid_transition)).not.toBeNull();
    expect(api.dismissTransmissionBlock).toHaveBeenCalledTimes(1);
    expect(api.dismissTransmissionBlock).toHaveBeenCalledWith("tb1", "Caso descartado pela vigilância");
    await waitFor(() => expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
    expect(api.dismissTransmissionBlock).toHaveBeenCalledTimes(1);
  });

  it("descartar: um envio no duplo clique; o motivo nunca vai ao cache", async () => {
    let resolve!: (b: TransmissionBlock) => void;
    mocked(api.dismissTransmissionBlock).mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { client } = await mountDetail(transmissionBlock());
    fireEvent.click(button("Descartar"));
    fireEvent.change(screen.getByLabelText("Motivo do descarte"), { target: { value: "Caso descartado pela vigilância" } });
    fireEvent.click(button(/^Descartar proposta/));
    fireEvent.click(button(/^Descartar proposta/));
    await tick();
    expect(api.dismissTransmissionBlock).toHaveBeenCalledTimes(1);
    resolve(transmissionBlock({ status: "dismissed" }));
    expect(await screen.findByText(PROPOSAL_DISMISSED)).not.toBeNull();
    expect(cacheText(client)).not.toMatch(/descartado pela/);
    expect(screen.queryByLabelText("Motivo do descarte")).toBeNull();
  });

  it("fechar: só no ativo, com confirmação; um envio", async () => {
    mocked(api.closeTransmissionBlock).mockResolvedValue({ ...ACTIVE, status: "closed", closed_at: "2026-11-16T13:00:00Z" });
    await mountDetail(ACTIVE);
    expect(screen.queryByRole("button", { name: "Confirmar bloqueio" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
    fireEvent.click(button("Fechar bloqueio"));
    fireEvent.click(button(/^Confirmar/));
    expect(await screen.findByText(BLOCK_CLOSED)).not.toBeNull();
    expect(api.closeTransmissionBlock).toHaveBeenCalledTimes(1);
    expect(api.closeTransmissionBlock).toHaveBeenCalledWith("tb1");
    expect(screen.queryByRole("button", { name: "Fechar bloqueio" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Novo ciclo" })).toBeNull();
    await tick();
    // Detalhe pela resposta (sem releitura); as duas abas montadas (propostos e ativos) relidas UMA vez cada.
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(1);
    expect(api.listTransmissionBlocks).toHaveBeenCalledTimes(4);
  });

  it("juntar caso a outro bloqueio manda o destino no corpo", async () => {
    const block = transmissionBlock({ cases: [ { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: true } ] });
    const target = { ...ACTIVE, id: "tb2", center_block: { id: "cb5", number: "30" } };
    const closed = { ...ACTIVE, id: "tb4", status: "closed" };
    mocked(api.moveTransmissionCase).mockResolvedValue({ ...target, cases: [ ...target.cases, block.cases[0] ] });
    await mountDetail(block, { others: [ target, closed ] });
    expect(api.listTransmissionBlocks).toHaveBeenCalledTimes(1);
    fireEvent.click(button("Juntar o caso 1 a outro bloqueio"));
    const select = await screen.findByLabelText("Bloqueio de destino") as HTMLSelectElement;
    await within(select).findByRole("option", { name: /quarteirão 30/ });
    expect(mocked(api.listTransmissionBlocks).mock.calls[1][0]).toEqual({ status: [ "proposed", "active" ], before: null });
    // Nem o próprio bloqueio nem o fechado.
    expect(within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([ "", "tb2" ]);
    expect(blocked(/^Juntar caso 1/)).toBe(true);
    fireEvent.change(select, { target: { value: "tb2" } });
    blocks = [ { ...block, cases: [] }, target ];
    fireEvent.click(button(/^Juntar caso 1/));
    fireEvent.click(button(/^Juntar caso 1/));
    expect(await screen.findByText(CASE_MOVED(1))).not.toBeNull();
    expect(api.moveTransmissionCase).toHaveBeenCalledTimes(1);
    expect(api.moveTransmissionCase).toHaveBeenCalledWith("tb1", "c1", "tb2");
    await waitFor(() => expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/caso 1 · dengue/)).toBeNull();
  });

  it("juntar: destino fechado no meio → 409 invalid_transition, a frase e uma releitura", async () => {
    const target = { ...ACTIVE, id: "tb2" };
    mocked(api.moveTransmissionCase).mockRejectedValue(err(409, { error: "invalid_transition", path: "status" }));
    await mountDetail(transmissionBlock(), { others: [ target ] });
    fireEvent.click(button("Juntar o caso 1 a outro bloqueio"));
    const select = await screen.findByLabelText("Bloqueio de destino");
    await within(select).findByRole("option", { name: /ativo/ });
    fireEvent.change(select, { target: { value: "tb2" } });
    fireEvent.click(button(/^Juntar caso 1/));
    expect(await screen.findByText(VECTOR_ERRORS.invalid_transition)).not.toBeNull();
    await waitFor(() => expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2));
    await tick();
    expect(api.getTransmissionBlock).toHaveBeenCalledTimes(2);
    expect(api.moveTransmissionCase).toHaveBeenCalledTimes(1);
  });

  it("fechado e descartado: só leitura, sem endereço, sem juntar, sem ciclo novo", async () => {
    await mountDetail({ ...ACTIVE, status: "closed", closed_at: "2026-11-16T13:00:00Z", cases: [ { id: "c1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: false } ] });
    for (const name of [ "Ver endereço do caso", "Juntar o caso 1 a outro bloqueio", "Novo ciclo", "Fechar bloqueio", "Confirmar bloqueio", "Descartar" ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByText(/quarteirões da área: 12, 13/)).not.toBeNull();
  });

  it("mapa da área só por clique, na camada do bloqueio; sem caso nem quarteirão no ponto", async () => {
    await mountDetail(transmissionBlock());
    await tick();
    expect(api.listVectorMapPoints).not.toHaveBeenCalled();
    fireEvent.click(button("Ver mapa da área"));
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1));
    expect(api.listVectorMapPoints).toHaveBeenCalledWith({ layer: "transmission", transmissionBlockId: "tb1" });
    fireEvent.click(button("Esconder mapa"));
    fireEvent.click(button("Ver mapa da área"));
    await tick();
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1);
  });
});

describe("nomes das doenças (Q38)", () => {
  const CASES = [
    { id: "tc1", number: 1, disease: "dengue", case_on: "2026-11-12", has_place: true },
    { id: "tc2", number: 2, disease: "agravo_novo", case_on: "2026-11-13", has_place: true }
  ];
  it("lista e detalhe mostram o nome e o grupo; código sem nome sai cru; uma leitura só", async () => {
    mocked(api.getVectorDiseases).mockResolvedValue(VC_DISEASES);
    await mountDetail(transmissionBlock({ cases: CASES }));
    const table = within(screen.getByRole("table", { name: "Bloqueios propostos" }));
    expect(table.getByText("Dengue (casos), agravo_novo")).not.toBeNull();
    expect(await screen.findByText(/caso 1 · Dengue \(casos\) · 12\/11\/2026/)).not.toBeNull();
    expect(screen.getByText(/caso 2 · agravo_novo · 13\/11\/2026/)).not.toBeNull();
    expect(screen.getByText(/Arboviroses \(dengue, chikungunya, zika\)/)).not.toBeNull();
    await tick();
    expect(api.getVectorDiseases).toHaveBeenCalledTimes(1);
  });

  it("a leitura falha: códigos crus, nenhum aviso de erro, sem nova tentativa ao abrir o detalhe", async () => {
    mocked(api.getVectorDiseases).mockRejectedValue(err(500, { error: "internal" }));
    await mountDetail(transmissionBlock({ cases: CASES }));
    expect(screen.getByText(/caso 1 · dengue · 12\/11\/2026/)).not.toBeNull();
    expect(screen.getByText(/arbovirus/)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await tick();
    expect(api.getVectorDiseases).toHaveBeenCalledTimes(1);
  });
});
