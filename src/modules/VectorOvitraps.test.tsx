// src/modules/VectorOvitraps.test.tsx
// "Ovitrampas" da coordenação e do laboratório (módulo 35a, Task 12; F-35.5; contrato §6, §10, §17; Q9, Q23): as palhetas a contar
// e as contadas (contar e corrigir, a nota só na correção), as ovitrampas do bairro e os índices da semana com o mapa. Tela velha
// relê UMA vez; nunca morador; leituras mínimas (a lista por bairro grava a trilha territory_registry).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listOvitraps: vi.fn(), listOvitrapReadings: vi.fn(), countOvitrapReading: vi.fn(),
    getVectorReport: vi.fn(), listPanelNeighborhoods: vi.fn(), listVectorMapPoints: vi.fn(), getVectorDomains: vi.fn(), getVectorParameters: vi.fn()
  };
});

const handle = vi.hoisted(() => ({
  setPoints: vi.fn(), fitTo: vi.fn(), onPointClick: vi.fn(), startCorrection: vi.fn(), stopCorrection: vi.fn(), destroy: vi.fn()
}));
vi.mock("./territory/map/fieldMap", () => ({ createFieldMap: vi.fn(() => handle) }));

import * as api from "../lib/api";
import { ApiError, type OvitrapReading } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { createFieldMap } from "./territory/map/fieldMap";
import { renderWithProviders } from "../test/campaignFixtures";
import { expectFrozenNotice } from "../test/frozenNotice";
import { TODAY35, mapPoints, ovitrap, reading, report, vcUser } from "../test/vectorControlFixtures";
import { VectorOvitraps } from "./VectorOvitraps";
import { COUNT_RACED, COUNT_STALE_REREAD, COUNT_UNCERTAIN } from "./vectorControl/CountForm";
import { PICK_OVITRAP_NEIGHBORHOOD } from "./VectorOvitraps";

const ALL = [ api.fetchCurrentSession, api.listOvitraps, api.listOvitrapReadings, api.countOvitrapReading, api.getVectorReport,
  api.listPanelNeighborhoods, api.listVectorMapPoints, api.getVectorDomains, api.getVectorParameters, createFieldMap, ...Object.values(handle) ];
const RD1 = reading({ id: "rd1" });
const RD9 = reading({ id: "rd9", ovitrap: { id: "ov9", number: "OV-09" } });
const COUNTED = reading({ id: "rd2", ovitrap: { id: "ov2", number: "OV-08" }, egg_count: 42, counted_at: "2026-11-12T14:00:00Z" });
const OVITRAPS_REPORT = report({
  name: "ovitraps",
  columns: [
    { key: "neighborhood", label: "Bairro", kind: "text" }, { key: "epi_week", label: "Semana epidemiológica", kind: "text" },
    { key: "examined", label: "Examinadas", kind: "count" }, { key: "positive", label: "Positivas", kind: "count" },
    { key: "eggs", label: "Ovos", kind: "count" }, { key: "ipo", label: "IPO %", kind: "percent" }, { key: "ido", label: "IDO", kind: "decimal" },
    { key: "idv", label: "IDV", kind: "decimal" }, { key: "lost", label: "Perdidas", kind: "count" }, { key: "damaged", label: "Avariadas", kind: "count" }
  ],
  rows: [ { neighborhood: "Centro", epi_week: "2026-45", examined: 8, positive: 3, eggs: 150, ipo: "37.5", ido: "50.0", idv: "18.8", lost: 1, damaged: 0 } ]
});

afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); });
beforeEach(() => {
  for (const f of ALL) vi.mocked(f as ReturnType<typeof vi.fn>).mockReset();
  vi.mocked(createFieldMap).mockImplementation(() => handle as never);
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "vector_lab" ]));
  vi.mocked(api.listOvitrapReadings).mockImplementation(async (q) => ({ items: q.state === "to_count" ? [ RD1 ] : [ COUNTED ], next_before: null }));
  vi.mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Centro", active: true }, { id: "nb2", name: "Vila Nova", active: true } ]);
  vi.mocked(api.listOvitraps).mockResolvedValue({ items: [ ovitrap() ], next_before: null });
  vi.mocked(api.getVectorReport).mockResolvedValue(OVITRAPS_REPORT);
  vi.mocked(api.listVectorMapPoints).mockResolvedValue(mapPoints({ points: [ { id: "ov1", latitude: -25.4, longitude: -49.2, category: "positive", label: "OV-07 · 42" } ] }));
});

const mount = () => renderWithProviders(<VectorOvitraps today={TODAY35} />);
const tick = () => new Promise((r) => setTimeout(r, 20));
const table = (name: string) => within(screen.getByRole("table", { name }));
async function openCount(button: RegExp, list = "Palhetas a contar") {
  await screen.findByRole("table", { name: list });
  fireEvent.click(table(list).getByRole("button", { name: button }));
  await screen.findByLabelText("Ovos");
}
const eggs = (v: string) => fireEvent.change(screen.getByLabelText("Ovos"), { target: { value: v } });
const note = (v: string) => fireEvent.change(screen.getByLabelText("Nota da correção"), { target: { value: v } });
// A releitura traz OV-09: esperar a linha nova é esperar a releitura; depois, a contagem exata (uma terceira leitura reprova).
function rereadBrings(state: "to_count" | "counted" = "to_count") {
  let first = true;
  vi.mocked(api.listOvitrapReadings).mockImplementation(async (q) => {
    if (q.state !== state) return { items: [ COUNTED ], next_before: null };
    const items = first ? [ state === "to_count" ? RD1 : COUNTED ] : [ state === "to_count" ? RD1 : COUNTED, RD9 ];
    first = false;
    return { items, next_before: null };
  });
}
async function settledReads(n: number) {
  await screen.findByText("OV-09");
  await tick();
  expect(api.listOvitrapReadings).toHaveBeenCalledTimes(n);
}
const noOtherReads = () => {
  expect(api.listOvitraps).not.toHaveBeenCalled();
  expect(api.getVectorReport).not.toHaveBeenCalled();
  expect(api.listVectorMapPoints).not.toHaveBeenCalled();
  expect(api.getVectorDomains).not.toHaveBeenCalled();
  expect(api.getVectorParameters).not.toHaveBeenCalled();
};

describe("VectorOvitraps", () => {
  it("laboratório vê as três abas e conta: countOvitrapReading(\"rd1\", { egg_count: 0 }) (zero vale, sem count_note)", async () => {
    rereadBrings();
    let resolve!: (r: OvitrapReading) => void;
    vi.mocked(api.countOvitrapReading).mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount();
    for (const name of [ "A contar", "Ovitrampas", "Índices e mapa" ]) expect(await screen.findByRole("tab", { name })).not.toBeNull();
    await openCount(/^Contar/);
    expect(api.listOvitrapReadings).toHaveBeenCalledWith({ state: "to_count" });
    // A primeira contagem não tem nota (a nota só existe na correção).
    expect(screen.queryByLabelText("Nota da correção")).toBeNull();
    eggs("0");
    const submit = screen.getByRole("button", { name: "Registrar contagem" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);
    expect(api.countOvitrapReading).toHaveBeenCalledWith("rd1", { egg_count: 0 });
    expect(JSON.stringify(vi.mocked(api.countOvitrapReading).mock.calls[0][1])).toBe('{"egg_count":0}');
    resolve(reading({ id: "rd1", egg_count: 0, counted_at: "2026-11-16T13:00:00Z" }));
    expect(await screen.findByText("contagem da ovitrampa OV-07 registrada: 0 ovos")).not.toBeNull();
    await settledReads(2);
    expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);
    noOtherReads();
  });

  it("recusa antes de enviar: ovos fora de 0–9999 ou não inteiros", async () => {
    mount();
    await openCount(/^Contar/);
    for (const v of [ "", "-1", "3,5", "10000" ]) {
      eggs(v);
      fireEvent.click(screen.getByRole("button", { name: "Registrar contagem" }));
      expect(await screen.findByText("ovos: número inteiro de 0 a 9.999")).not.toBeNull();
      expect(screen.getByLabelText("Ovos").getAttribute("aria-invalid")).toBe("true");
    }
    expect(api.countOvitrapReading).not.toHaveBeenCalled();
  });

  it("correção sem nota não envia, com nota manda count_note", async () => {
    rereadBrings("counted");
    vi.mocked(api.countOvitrapReading).mockResolvedValue(reading({ id: "rd2", ovitrap: { id: "ov2", number: "OV-08" }, egg_count: 40, corrected: true }));
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Contadas" }));
    await openCount(/^Corrigir contagem/, "Palhetas contadas");
    expect(screen.getByText(/contagem atual: 42 ovos/)).not.toBeNull();
    const field = screen.getByLabelText("Nota da correção");
    expectFrozenNotice(field);

    eggs("40");
    fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
    expect(await screen.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.getByLabelText("Nota da correção").getAttribute("aria-invalid")).toBe("true");
    expect(api.countOvitrapReading).not.toHaveBeenCalled();

    // Q23: a mesma contagem só com a nota não é correção (o api recusaria em egg_count).
    eggs("42");
    note("Recontagem com lupa");
    fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
    expect(await screen.findByText("a correção muda a contagem — a mesma contagem com outra nota não é correção")).not.toBeNull();
    expect(api.countOvitrapReading).not.toHaveBeenCalled();

    eggs("40");
    note("  Recontagem com lupa  ");
    const submit = screen.getByRole("button", { name: "Registrar correção" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);
    expect(api.countOvitrapReading).toHaveBeenCalledWith("rd2", { egg_count: 40, count_note: "Recontagem com lupa" });
    expect(await screen.findByText("contagem da ovitrampa OV-08 corrigida: 40 ovos")).not.toBeNull();
    // a contar (ao abrir), contadas (ao trocar) e uma releitura das contadas.
    await settledReads(3);
    expect(vi.mocked(api.listOvitrapReadings).mock.calls.map(([ q ]) => q.state)).toEqual([ "to_count", "counted", "counted" ]);
    // A nota nunca aparece fora do campo (a resposta não a traz; a tela não a guarda).
    expect(document.body.textContent).not.toContain("Recontagem com lupa");
  });

  it("recusa do api na correção vai ao campo (a mesma nota da anterior → count_note), sem releitura", async () => {
    vi.mocked(api.countOvitrapReading).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "count_note" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Contadas" }));
    await openCount(/^Corrigir contagem/, "Palhetas contadas");
    eggs("40");
    note("Recontagem com lupa");
    fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
    await waitFor(() => expect(screen.getByLabelText("Nota da correção").getAttribute("aria-invalid")).toBe("true"));
    await tick();
    expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);
    // Uma leitura de cada lista aberta (a contar, depois contadas), nenhuma releitura.
    expect(api.listOvitrapReadings).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/invalid_request|422/)).toBeNull();
  });

  it("reading_not_countable → frase e listOvitrapReadings 2×", async () => {
    rereadBrings();
    vi.mocked(api.countOvitrapReading).mockRejectedValueOnce(new ApiError(422, { error: "reading_not_countable" }, "x"));
    mount();
    await openCount(/^Contar/);
    eggs("12");
    fireEvent.click(screen.getByRole("button", { name: "Registrar contagem" }));
    expect(await screen.findByText(`${VECTOR_ERRORS.reading_not_countable} — ${COUNT_STALE_REREAD}`)).not.toBeNull();
    await settledReads(2);
    expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Ovos")).toBeNull();
    expect(screen.queryByText(/reading_not_countable/)).toBeNull();
  });

  it("tela velha: 404, contagem que outra pessoa já fez (422 count_note na primeira) e rede — uma releitura, nenhum reenvio", async () => {
    const cases: [ unknown, string ][] = [
      [ new ApiError(404, { error: "not_found" }, "x"), COUNT_STALE_REREAD ],
      [ new ApiError(422, { error: "invalid_request", path: "count_note" }, "x"), COUNT_RACED ],
      [ new TypeError("Failed to fetch"), COUNT_UNCERTAIN ],
      [ new ApiError(503, {}, "x"), COUNT_UNCERTAIN ]
    ];
    for (const [ err, text ] of cases) {
      vi.mocked(api.listOvitrapReadings).mockClear();
      rereadBrings();
      vi.mocked(api.countOvitrapReading).mockReset().mockRejectedValueOnce(err);
      mount();
      await openCount(/^Contar/);
      eggs("12");
      fireEvent.click(screen.getByRole("button", { name: "Registrar contagem" }));
      expect(await screen.findByText(new RegExp(text))).not.toBeNull();
      await settledReads(2);
      expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText("Ovos")).toBeNull();
      cleanup();
    }
  });

  it("a aba \"Índices e mapa\" chama o relatório com a semana anterior a TODAY35 (\"2026-45\") e o mapa com a mesma semana", async () => {
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Índices e mapa" }));
    expect(await screen.findByText(PICK_OVITRAP_NEIGHBORHOOD)).not.toBeNull();
    expect(api.getVectorReport).not.toHaveBeenCalled();
    expect(api.listVectorMapPoints).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("option", { name: "Centro" })).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nb1" } });

    expect(await screen.findByText("37,5")).not.toBeNull();
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    expect(api.getVectorReport).toHaveBeenCalledWith("ovitraps", { epi_weeks: [ "2026-45" ], neighborhood_ids: [ "nb1" ] });
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1));
    expect(api.listVectorMapPoints).toHaveBeenCalledWith({ layer: "ovitraps", neighborhoodId: "nb1", epiWeek: "2026-45" });
    expect(within(screen.getByRole("tabpanel", { name: "Índices e mapa" })).getByText("semana 45/2026 (08/11 a 14/11)")).not.toBeNull();
    const t = table("Índices de ovitrampa");
    for (const h of [ "Examinadas", "Positivas", "IPO %", "IDO", "IDV" ]) expect(t.getByText(h)).not.toBeNull();
    expect(t.getByText("150")).not.toBeNull();
    expect(await screen.findByText("positiva: 1")).not.toBeNull();
    const nextWeek = () => screen.getByRole("button", { name: "Semana seguinte" }) as HTMLButtonElement;
    expect(nextWeek().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(2));
    expect(api.getVectorReport).toHaveBeenLastCalledWith("ovitraps", { epi_weeks: [ "2026-44" ], neighborhood_ids: [ "nb1" ] });
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledTimes(2));
    expect(api.listVectorMapPoints).toHaveBeenLastCalledWith({ layer: "ovitraps", neighborhoodId: "nb1", epiWeek: "2026-44" });

    // Até a semana corrente (2026-46) e não além: na corrente, "Semana seguinte" fica desabilitada e nada mais é pedido.
    fireEvent.click(nextWeek());
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(3));
    fireEvent.click(nextWeek());
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(4));
    expect(api.getVectorReport).toHaveBeenLastCalledWith("ovitraps", { epi_weeks: [ "2026-46" ], neighborhood_ids: [ "nb1" ] });
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledTimes(4));
    expect(api.listVectorMapPoints).toHaveBeenLastCalledWith({ layer: "ovitraps", neighborhoodId: "nb1", epiWeek: "2026-46" });
    expect(nextWeek().disabled).toBe(true);
    fireEvent.click(nextWeek());
    await tick();
    expect(api.getVectorReport).toHaveBeenCalledTimes(4);
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(4);

    // Semana digitada inválida ou no futuro: a frase, nenhuma leitura.
    fireEvent.change(screen.getByLabelText("Semana (AAAA-SS)"), { target: { value: "2026-48" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver semana" }));
    expect(await screen.findByText("semana no futuro")).not.toBeNull();
    await tick();
    expect(api.getVectorReport).toHaveBeenCalledTimes(4);
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(4);
    expect(api.listOvitrapReadings).toHaveBeenCalledTimes(1);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(api.listOvitraps).not.toHaveBeenCalled();
    expect(api.getVectorDomains).not.toHaveBeenCalled();
  });

  it("a lista não mostra morador: ovitrampas do bairro por status, com número, quarteirão, status e última leitura", async () => {
    vi.mocked(api.listOvitraps).mockResolvedValue({
      items: [
        ovitrap(), ovitrap({ id: "ov3", number: "OV-03", status: "removed", removed_on: "2026-11-10", open_reading: null, last_reading: null }),
        ovitrap({ id: "ov5", number: "OV-05", last_reading: { id: "or5", collected_on: "2026-11-09", condition: "ok", egg_count: 1, epi_week: "2026-45" } }),
        ovitrap({ id: "ov6", number: "OV-06", last_reading: { id: "or6", collected_on: "2026-11-09", condition: "ok", egg_count: 1234, epi_week: "2026-45" } })
      ],
      next_before: null
    });
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Ovitrampas" }));
    expect(await screen.findByText(PICK_OVITRAP_NEIGHBORHOOD)).not.toBeNull();
    expect(api.listOvitraps).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("option", { name: "Centro" })).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nb1" } });

    await screen.findByRole("table", { name: "Ovitrampas do bairro" });
    const t = table("Ovitrampas do bairro");
    expect(t.getByText("OV-07")).not.toBeNull();
    expect(t.getAllByText("ativa")).toHaveLength(3);
    expect(t.getByText("retirada")).not.toBeNull();
    expect(t.getByText("09/11/2026 · em bom estado · 42 ovos")).not.toBeNull();
    expect(t.getByText("sem leitura")).not.toBeNull();
    expect(t.getByText("09/11/2026 · em bom estado · 1 ovo")).not.toBeNull();
    expect(t.getByText("09/11/2026 · em bom estado · 1.234 ovos")).not.toBeNull();
    expect(api.listOvitraps).toHaveBeenCalledTimes(1);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(api.listOvitraps).toHaveBeenCalledWith({ neighborhoodId: "nb1" });
    // Sem morador e sem o endereço do imóvel (a lista da coordenação é por quarteirão).
    expect(document.body.textContent).not.toMatch(/Rua das Flores|José|Maria/);

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "removed" } });
    await waitFor(() => expect(api.listOvitraps).toHaveBeenCalledTimes(2));
    expect(api.listOvitraps).toHaveBeenLastCalledWith({ neighborhoodId: "nb1", status: "removed" });
    await tick();
    expect(api.listOvitraps).toHaveBeenCalledTimes(2);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    expect(api.getVectorDomains).not.toHaveBeenCalled();
  });

  it("coordenação: as mesmas três abas e a mesma contagem (o api deixa os dois contarem); o mapa só pede a camada ovitraps", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    vi.mocked(api.countOvitrapReading).mockResolvedValue(reading({ id: "rd1", egg_count: 7 }));
    rereadBrings();
    mount();
    for (const name of [ "A contar", "Ovitrampas", "Índices e mapa" ]) expect(await screen.findByRole("tab", { name })).not.toBeNull();
    await openCount(/^Contar/);
    eggs("7");
    fireEvent.click(screen.getByRole("button", { name: "Registrar contagem" }));
    expect(await screen.findByText("contagem da ovitrampa OV-07 registrada: 7 ovos")).not.toBeNull();
    expect(api.countOvitrapReading).toHaveBeenCalledWith("rd1", { egg_count: 7 });
    await settledReads(2);
    expect(api.countOvitrapReading).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Índices e mapa" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Centro" })).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nb1" } });
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1));
    await screen.findByText("37,5");
    await tick();
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1);
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(api.listOvitrapReadings).toHaveBeenCalledTimes(2);
    expect(api.listOvitraps).not.toHaveBeenCalled();
    for (const [ q ] of vi.mocked(api.listVectorMapPoints).mock.calls) expect(q.layer).toBe("ovitraps");
  });

  it("voltar a uma aba não relê a lista nominal nem o mapa; a aba escondida não lê ao trocar o bairro", async () => {
    mount();
    await screen.findByRole("table", { name: "Palhetas a contar" });
    fireEvent.click(screen.getByRole("tab", { name: "Ovitrampas" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Centro" })).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nb1" } });
    await screen.findByRole("table", { name: "Ovitrampas do bairro" });

    fireEvent.click(screen.getByRole("tab", { name: "Índices e mapa" }));
    await screen.findByText("37,5");
    await waitFor(() => expect(createFieldMap).toHaveBeenCalledTimes(1));
    for (const name of [ "Ovitrampas", "A contar", "Índices e mapa", "Ovitrampas", "Índices e mapa" ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      await tick();
    }
    expect(api.listOvitrapReadings).toHaveBeenCalledTimes(1);
    expect(api.listOvitraps).toHaveBeenCalledTimes(1);
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(1);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(createFieldMap).toHaveBeenCalledTimes(1);
    expect(handle.destroy).not.toHaveBeenCalled();

    // Outro bairro com "Índices e mapa" aberta: só ela lê; "Ovitrampas" lê o bairro novo ao ser aberta, uma vez.
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "nb2" } });
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.listVectorMapPoints).toHaveBeenCalledTimes(2));
    expect(api.getVectorReport).toHaveBeenLastCalledWith("ovitraps", { epi_weeks: [ "2026-45" ], neighborhood_ids: [ "nb2" ] });
    await tick();
    expect(api.listOvitraps).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "Ovitrampas" }));
    await waitFor(() => expect(api.listOvitraps).toHaveBeenCalledTimes(2));
    expect(api.listOvitraps).toHaveBeenLastCalledWith({ neighborhoodId: "nb2" });
    fireEvent.click(screen.getByRole("tab", { name: "Índices e mapa" }));
    fireEvent.click(screen.getByRole("tab", { name: "Ovitrampas" }));
    await tick();
    expect(api.listOvitraps).toHaveBeenCalledTimes(2);
    expect(api.getVectorReport).toHaveBeenCalledTimes(2);
    expect(api.listVectorMapPoints).toHaveBeenCalledTimes(2);
    expect(api.listOvitrapReadings).toHaveBeenCalledTimes(1);
  });

  it("municipal_admin e o agente: a frase do papel e nenhuma leitura", async () => {
    for (const roles of [ [ "municipal_admin" ], [ "health_professional" ] ]) {
      vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      mount();
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      await tick();
      expect(api.listOvitrapReadings).not.toHaveBeenCalled();
      noOtherReads();
      expect(api.listPanelNeighborhoods).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("recusa na leitura das palhetas: a frase do 35a, nunca o código", async () => {
    vi.mocked(api.listOvitrapReadings).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mount();
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByText(/missing_role|403/)).toBeNull();
  });
});
