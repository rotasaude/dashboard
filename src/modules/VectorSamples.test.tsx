// src/modules/VectorSamples.test.tsx
// "Amostras de larvas" da coordenação e do laboratório (módulo 35a, Task 13; F-35.8; contrato §9, §17; Q9, Q23, Q27, Q32): a fila
// "Sem resultado" (por dia da visita, a mais antiga primeiro, como o api manda) e "Com resultado" (result_at decrescente), cada
// uma com o próprio cursor; lançar e corrigir o resultado (a nota só na correção). Depois de gravar, a fila é relida UMA vez; tela
// velha relê UMA vez e não reenvia; nunca morador; o grupo sai do /domains (código cru só se ele falhar).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listVectorSamples: vi.fn(), recordSampleResult: vi.fn(), getVectorDomains: vi.fn(),
    getVectorParameters: vi.fn(), listPanelNeighborhoods: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type VectorSample } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { expectFrozenNotice } from "../test/frozenNotice";
import { VC_DOMAINS, sample, vcUser } from "../test/vectorControlFixtures";
import {
  DONE_EMPTY, PENDING_EMPTY, RESULT_SAVED, SAMPLE_CHANGED, SAMPLE_CORRECTION_UNCERTAIN, SAMPLE_NOTE_REPEATED, SAMPLE_RACED, SAMPLE_STALE_REREAD, SAMPLE_UNCERTAIN, VectorSamples
} from "./VectorSamples";

const ALL = [ api.fetchCurrentSession, api.listVectorSamples, api.recordSampleResult, api.getVectorDomains, api.getVectorParameters, api.listPanelNeighborhoods ];
const SA1 = sample({ id: "sa1", label: "3F2A9C1E-01", visit_on: "2026-11-10", deposit_group: "A2", larvae_collected: 8, city_block: { id: "cb1", number: "12" } });
const SA2 = sample({ id: "sa2", label: "3F2A9C1E-02", visit_on: "2026-11-12", deposit_group: "B", larvae_collected: 3, city_block: null });
const SA9 = sample({ id: "sa9", label: "9C9C9C9C-01", visit_on: "2026-11-14", deposit_group: "C", larvae_collected: 2 });
const DONE1 = sample({
  id: "sd1", label: "AB12CD34-01", visit_on: "2026-11-09", deposit_group: "B", larvae_collected: 6,
  result: { examined_larvae: 6, aegypti_larvae: 4, albopictus_larvae: 1, result_at: "2026-11-13T14:00:00Z", corrected: false }
});
const DONE2 = sample({
  id: "sd2", label: "AB12CD34-02", visit_on: "2026-11-08", deposit_group: "A1", larvae_collected: 5,
  result: { examined_larvae: 5, aegypti_larvae: 5, albopictus_larvae: 0, result_at: "2026-11-12T10:00:00Z", corrected: true }
});
const page = (items: VectorSample[], next_before: string | null = null) => ({ items, next_before });

afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); });
beforeEach(() => {
  for (const f of ALL) vi.mocked(f as ReturnType<typeof vi.fn>).mockReset();
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "vector_lab" ]));
  vi.mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  vi.mocked(api.listVectorSamples).mockImplementation(async (q) => (q.state === "pending" ? page([ SA1, SA2 ]) : page([ DONE1, DONE2 ])));
});

const mount = () => renderWithProviders(<VectorSamples />);
const tick = () => new Promise((r) => setTimeout(r, 20));
const PENDING = "Amostras sem resultado";
const DONE = "Amostras com resultado";
const table = (name: string) => within(screen.getByRole("table", { name }));
async function openForm(button: RegExp, list = PENDING) {
  await screen.findByRole("table", { name: list });
  fireEvent.click(table(list).getByRole("button", { name: button }));
  await screen.findByLabelText("Larvas examinadas");
}
function fill(examined: string, aegypti: string, albopictus: string) {
  fireEvent.change(screen.getByLabelText("Larvas examinadas"), { target: { value: examined } });
  fireEvent.change(screen.getByLabelText("Ae. aegypti"), { target: { value: aegypti } });
  fireEvent.change(screen.getByLabelText("Ae. albopictus"), { target: { value: albopictus } });
}
const note = (v: string) => fireEvent.change(screen.getByLabelText("Nota da correção"), { target: { value: v } });
// A releitura da aba traz SA9: esperar a linha nova é esperar a releitura; depois, a contagem exata (uma leitura a mais reprova).
function rereadBrings(state: "pending" | "done" = "pending") {
  let first = true;
  vi.mocked(api.listVectorSamples).mockImplementation(async (q) => {
    if (q.state !== state) return state === "pending" ? page([ DONE1, DONE2 ]) : page([ SA1, SA2 ]);
    const base = state === "pending" ? [ SA1, SA2 ] : [ DONE1, DONE2 ];
    const items = first ? base : [ ...base, SA9 ];
    first = false;
    return page(items);
  });
}
async function settledReads(n: number) {
  await screen.findByText("9C9C9C9C-01");
  await tick();
  expect(api.listVectorSamples).toHaveBeenCalledTimes(n);
}
const states = () => vi.mocked(api.listVectorSamples).mock.calls.map(([ q ]) => q.state);

describe("VectorSamples", () => {
  it("a fila mostra a etiqueta \"3F2A9C1E-01\" e nenhum morador, na ordem do api, com o grupo do /domains", async () => {
    mount();
    for (const name of [ "Sem resultado", "Com resultado" ]) expect(await screen.findByRole("tab", { name })).not.toBeNull();
    await screen.findByRole("table", { name: PENDING });
    const t = table(PENDING);
    const label = t.getByText("3F2A9C1E-01");
    expect(label.className).toContain("mono");
    expect(t.getByText("10/11/2026")).not.toBeNull();
    expect(await t.findByText("A2 — Depósito de armazenamento ao nível do solo")).not.toBeNull();
    expect(t.getByText("B — Depósito móvel")).not.toBeNull();
    expect(t.getByText("8")).not.toBeNull();
    expect(t.getByText("12")).not.toBeNull();
    // A ordem é a do api (dia da visita, a mais antiga primeiro): a tela não reordena.
    const text = screen.getByRole("table", { name: PENDING }).textContent ?? "";
    expect(text.indexOf("3F2A9C1E-01")).toBeLessThan(text.indexOf("3F2A9C1E-02"));
    expect(api.listVectorSamples).toHaveBeenCalledTimes(1);
    expect(api.listVectorSamples).toHaveBeenCalledWith({ state: "pending" });
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);
    expect(api.getVectorParameters).not.toHaveBeenCalled();
    expect(api.listPanelNeighborhoods).not.toHaveBeenCalled();
    // Sem imóvel nem morador, nada em URL ou storage.
    expect(document.body.textContent).not.toMatch(/Rua das Flores|José|Maria|household|morador/);
    expect(window.location.search).toBe("");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("lança: examined 9 > 8 não envia (sample_result_invalid); recordSampleResult(\"sa1\", { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 0 }) uma vez no duplo clique", async () => {
    rereadBrings();
    let resolve!: (s: VectorSample) => void;
    vi.mocked(api.recordSampleResult).mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount();
    await openForm(/^Lançar resultado — amostra 3F2A9C1E-01/);
    // O primeiro resultado não tem nota (a nota só existe na correção; o api recusaria em result_note).
    expect(screen.queryByLabelText("Nota da correção")).toBeNull();

    fill("9", "5", "0");
    fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
    expect(await screen.findByText(VECTOR_ERRORS.sample_result_invalid)).not.toBeNull();
    expect(screen.getByLabelText("Larvas examinadas").getAttribute("aria-invalid")).toBe("true");
    fill("8", "5", "4");
    fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
    await waitFor(() => expect(screen.getByLabelText("Ae. aegypti").getAttribute("aria-invalid")).toBe("true"));
    fill("8", "x", "0");
    fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
    expect(await screen.findByText("número inteiro, 0 ou mais")).not.toBeNull();
    expect(api.recordSampleResult).not.toHaveBeenCalled();

    fill("8", "5", "0");
    const submit = screen.getByRole("button", { name: "Registrar resultado" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
    expect(api.recordSampleResult).toHaveBeenCalledWith("sa1", { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 0 });
    expect(JSON.stringify(vi.mocked(api.recordSampleResult).mock.calls[0][1])).toBe('{"examined_larvae":8,"aegypti_larvae":5,"albopictus_larvae":0}');
    resolve(sample({ ...SA1, result: { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 0, result_at: "2026-11-16T13:00:00Z", corrected: false } }));
    expect(await screen.findByText(RESULT_SAVED)).not.toBeNull();
    expect(RESULT_SAVED).toBe("Resultado lançado. O índice do LIRAa usa o resultado novo.");
    // A fila é relida uma vez; a aba "Com resultado" nunca foi aberta e não lê.
    await settledReads(2);
    expect(states()).toEqual([ "pending", "pending" ]);
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Larvas examinadas")).toBeNull();
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);
  });

  it("correção exige result_note; a mesma contagem só com a nota não é correção; com nota manda result_note sem as pontas", async () => {
    rereadBrings("done");
    vi.mocked(api.recordSampleResult).mockResolvedValue(sample({ ...DONE1, result: { ...DONE1.result!, aegypti_larvae: 3, albopictus_larvae: 2, corrected: true } }));
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Com resultado" }));
    await screen.findByRole("table", { name: DONE });
    const t = table(DONE);
    // result_at decrescente, como o api manda (Q27); a correção anterior aparece como tag, a nota nunca.
    const text = screen.getByRole("table", { name: DONE }).textContent ?? "";
    expect(text.indexOf("AB12CD34-01")).toBeLessThan(text.indexOf("AB12CD34-02"));
    expect(t.getByText("corrigido")).not.toBeNull();
    expect(t.getByText("13/11/2026, 11:00")).not.toBeNull();
    await openForm(/^Corrigir resultado — amostra AB12CD34-01/, DONE);
    expect(screen.getByText(/resultado atual: 6 examinadas · 4 Ae\. aegypti · 1 Ae\. albopictus/)).not.toBeNull();
    const field = screen.getByLabelText("Nota da correção");
    expectFrozenNotice(field);

    fill("6", "3", "2");
    fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
    expect(await screen.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.getByLabelText("Nota da correção").getAttribute("aria-invalid")).toBe("true");
    expect(api.recordSampleResult).not.toHaveBeenCalled();

    fill("6", "4", "1");
    note("Revisão na lupa do laboratório");
    fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
    expect(await screen.findByText("a correção muda algum número — os mesmos números com outra nota não são correção")).not.toBeNull();
    expect(api.recordSampleResult).not.toHaveBeenCalled();

    fill("6", "3", "2");
    note("  Revisão na lupa do laboratório  ");
    const submit = screen.getByRole("button", { name: "Registrar correção" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
    expect(api.recordSampleResult).toHaveBeenCalledWith("sd1", {
      examined_larvae: 6, aegypti_larvae: 3, albopictus_larvae: 2, result_note: "Revisão na lupa do laboratório"
    });
    expect(await screen.findByText(RESULT_SAVED)).not.toBeNull();
    // Sem resultado (ao abrir), Com resultado (ao trocar) e uma releitura de Com resultado.
    await settledReads(3);
    expect(states()).toEqual([ "pending", "done", "done" ]);
    expect(document.body.textContent).not.toContain("Revisão na lupa");
    // A correção não muda "Sem resultado": voltar a ela não relê.
    fireEvent.click(screen.getByRole("tab", { name: "Sem resultado" }));
    await tick();
    expect(api.listVectorSamples).toHaveBeenCalledTimes(3);
  });

  it("recusa do api na correção (a mesma nota da anterior → 422 result_note) vai ao campo, sem releitura", async () => {
    vi.mocked(api.recordSampleResult).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "result_note" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Com resultado" }));
    await openForm(/^Corrigir resultado — amostra AB12CD34-01/, DONE);
    fill("6", "3", "2");
    note("Revisão na lupa do laboratório");
    fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
    expect(await screen.findByText(SAMPLE_NOTE_REPEATED)).not.toBeNull();
    expect(screen.getByLabelText("Nota da correção").getAttribute("aria-invalid")).toBe("true");
    await tick();
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
    expect(api.listVectorSamples).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/invalid_request|422/)).toBeNull();
  });

  it("sample_result_invalid do api vai ao campo do path, sem releitura", async () => {
    vi.mocked(api.recordSampleResult).mockRejectedValueOnce(new ApiError(422, { error: "sample_result_invalid", path: "aegypti_larvae" }, "x"));
    mount();
    await openForm(/^Lançar resultado — amostra 3F2A9C1E-01/);
    fill("8", "5", "0");
    fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
    await waitFor(() => expect(screen.getByLabelText("Ae. aegypti").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(VECTOR_ERRORS.sample_result_invalid)).not.toBeNull();
    await tick();
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
    expect(api.listVectorSamples).toHaveBeenCalledTimes(1);
  });

  it("tela velha: 404, resultado que outra pessoa já lançou, correção que outra pessoa já fez, rede e 5xx — uma releitura, nenhum reenvio", async () => {
    const cases: [ unknown, string, "pending" | "done" ][] = [
      [ new ApiError(404, { error: "not_found" }, "x"), SAMPLE_STALE_REREAD, "pending" ],
      [ new ApiError(422, { error: "invalid_request", path: "result_note" }, "x"), SAMPLE_RACED, "pending" ],
      [ new ApiError(422, { error: "invalid_request", path: "examined_larvae" }, "x"), SAMPLE_CHANGED, "done" ],
      [ new TypeError("Failed to fetch"), SAMPLE_UNCERTAIN, "pending" ],
      [ new TypeError("Failed to fetch"), SAMPLE_CORRECTION_UNCERTAIN, "done" ],
      [ new ApiError(503, {}, "x"), SAMPLE_UNCERTAIN, "pending" ]
    ];
    for (const [ err, text, state ] of cases) {
      vi.mocked(api.listVectorSamples).mockClear();
      rereadBrings(state);
      vi.mocked(api.recordSampleResult).mockReset().mockRejectedValueOnce(err);
      mount();
      if (state === "done") {
        fireEvent.click(await screen.findByRole("tab", { name: "Com resultado" }));
        await openForm(/^Corrigir resultado — amostra AB12CD34-01/, DONE);
        fill("6", "3", "2");
        note("Revisão na lupa do laboratório");
        fireEvent.click(screen.getByRole("button", { name: "Registrar correção" }));
      } else {
        await openForm(/^Lançar resultado — amostra 3F2A9C1E-01/);
        fill("8", "5", "0");
        fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
      }
      expect(await screen.findByText(new RegExp(text))).not.toBeNull();
      // pending: uma leitura e a releitura; done: a da fila ao abrir, a de Com resultado e a releitura.
      await settledReads(state === "done" ? 3 : 2);
      expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText("Larvas examinadas")).toBeNull();
      expect(screen.queryByText(/not_found|invalid_request|404|503/)).toBeNull();
      cleanup();
    }
  });

  it("cada aba tem o próprio cursor; voltar a uma aba não relê; depois de lançar, Com resultado lê uma vez ao ser aberta", async () => {
    vi.mocked(api.listVectorSamples).mockImplementation(async (q) => {
      if (q.state === "pending") return q.before ? page([ SA9 ]) : page([ SA1, SA2 ], "cur-pending");
      return page([ DONE1, DONE2 ], null);
    });
    vi.mocked(api.recordSampleResult).mockResolvedValue(sample({ ...SA1, result: { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 0, result_at: "2026-11-16T13:00:00Z", corrected: false } }));
    mount();
    await screen.findByRole("table", { name: PENDING });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("9C9C9C9C-01")).not.toBeNull();
    expect(api.listVectorSamples).toHaveBeenNthCalledWith(2, { state: "pending", before: "cur-pending" });

    // O cursor de "Sem resultado" nunca vai a "Com resultado" (o api recusaria com invalid_cursor).
    fireEvent.click(screen.getByRole("tab", { name: "Com resultado" }));
    await screen.findByRole("table", { name: DONE });
    expect(api.listVectorSamples).toHaveBeenNthCalledWith(3, { state: "done" });
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    for (const name of [ "Sem resultado", "Com resultado", "Sem resultado" ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      await tick();
    }
    expect(api.listVectorSamples).toHaveBeenCalledTimes(3);
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);

    // Lançar em "Sem resultado": ela relê uma vez (as duas páginas); "Com resultado" fica velha e lê uma vez ao ser aberta.
    fireEvent.click(table(PENDING).getByRole("button", { name: /^Lançar resultado — amostra 3F2A9C1E-01/ }));
    fill("8", "5", "0");
    fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
    expect(await screen.findByText(RESULT_SAVED)).not.toBeNull();
    await waitFor(() => expect(api.listVectorSamples).toHaveBeenCalledTimes(5));
    await tick();
    expect(states()).toEqual([ "pending", "pending", "done", "pending", "pending" ]);
    fireEvent.click(screen.getByRole("tab", { name: "Com resultado" }));
    await waitFor(() => expect(api.listVectorSamples).toHaveBeenCalledTimes(6));
    expect(api.listVectorSamples).toHaveBeenLastCalledWith({ state: "done" });
    for (const name of [ "Sem resultado", "Com resultado" ]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      await tick();
    }
    expect(api.listVectorSamples).toHaveBeenCalledTimes(6);
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
  });

  it("coordenação: a mesma fila e o mesmo lançamento (o api deixa os dois lançarem)", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    vi.mocked(api.recordSampleResult).mockResolvedValue(sample({ ...SA2, result: { examined_larvae: 3, aegypti_larvae: 0, albopictus_larvae: 3, result_at: "2026-11-16T13:00:00Z", corrected: false } }));
    rereadBrings();
    mount();
    await openForm(/^Lançar resultado — amostra 3F2A9C1E-02/);
    // Amostra sem quarteirão: "—", nunca o imóvel.
    expect(screen.getByText(/sem quarteirão/)).not.toBeNull();
    fill("3", "0", "3");
    fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
    expect(await screen.findByText(RESULT_SAVED)).not.toBeNull();
    expect(api.recordSampleResult).toHaveBeenCalledWith("sa2", { examined_larvae: 3, aegypti_larvae: 0, albopictus_larvae: 3 });
    await settledReads(2);
    expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
    expect(api.getVectorDomains).toHaveBeenCalledTimes(1);
  });

  it("municipal_admin e o agente: a frase do papel e nenhuma leitura", async () => {
    for (const roles of [ [ "municipal_admin" ], [ "health_professional" ] ]) {
      vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      mount();
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      await tick();
      expect(api.listVectorSamples).not.toHaveBeenCalled();
      expect(api.getVectorDomains).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("/domains falhou: o grupo sai em código cru; recusa na leitura da fila: a frase do 35a, nunca o código", async () => {
    vi.mocked(api.getVectorDomains).mockRejectedValue(new ApiError(503, {}, "x"));
    mount();
    await screen.findByRole("table", { name: PENDING });
    await waitFor(() => expect(api.getVectorDomains).toHaveBeenCalledTimes(1));
    await tick();
    expect(table(PENDING).getByText("A2")).not.toBeNull();
    expect(table(PENDING).getByText("B")).not.toBeNull();
    cleanup();

    vi.mocked(api.listVectorSamples).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    mount();
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByText(/missing_role|403/)).toBeNull();
  });

  it("envio em voo e troca para Com resultado: ela relê exatamente uma vez quando está (ou fica) à vista", async () => {
    const saved = sample({ ...SA1, result: { examined_larvae: 8, aegypti_larvae: 5, albopictus_larvae: 0, result_at: "2026-11-16T13:00:00Z", corrected: false } });
    for (const backToPending of [ false, true ]) {
      vi.mocked(api.listVectorSamples).mockClear();
      let resolve!: (s: VectorSample) => void;
      vi.mocked(api.recordSampleResult).mockReset().mockImplementation(() => new Promise((r) => { resolve = r; }));
      mount();
      await openForm(/^Lançar resultado — amostra 3F2A9C1E-01/);
      fill("8", "5", "0");
      fireEvent.click(screen.getByRole("button", { name: "Registrar resultado" }));
      // Com o envio em voo, "Com resultado" monta e lê a fila antiga.
      fireEvent.click(screen.getByRole("tab", { name: "Com resultado" }));
      await screen.findByRole("table", { name: DONE });
      expect(states()).toEqual([ "pending", "done" ]);
      if (backToPending) fireEvent.click(screen.getByRole("tab", { name: "Sem resultado" }));
      resolve(saved);
      expect(await screen.findByText(RESULT_SAVED)).not.toBeNull();
      await waitFor(() => expect(api.listVectorSamples).toHaveBeenCalledTimes(backToPending ? 3 : 4));
      await tick();
      if (backToPending) {
        // Escondida, ela não lê; ao ficar à vista, relê uma vez.
        expect(states()).toEqual([ "pending", "done", "pending" ]);
        fireEvent.click(screen.getByRole("tab", { name: "Com resultado" }));
        await waitFor(() => expect(api.listVectorSamples).toHaveBeenCalledTimes(4));
      } else {
        expect([ ...states() ].sort()).toEqual([ "done", "done", "pending", "pending" ]);
      }
      for (const name of [ "Sem resultado", "Com resultado", "Sem resultado", "Com resultado" ]) {
        fireEvent.click(screen.getByRole("tab", { name }));
        await tick();
      }
      expect(api.listVectorSamples).toHaveBeenCalledTimes(4);
      expect(api.recordSampleResult).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("fila vazia: a frase", async () => {
    vi.mocked(api.listVectorSamples).mockResolvedValue(page([]));
    mount();
    expect(await screen.findByText(PENDING_EMPTY)).not.toBeNull();
    expect(api.listVectorSamples).toHaveBeenCalledTimes(1);
  });

  it("aba vazia: a frase", async () => {
    vi.mocked(api.listVectorSamples).mockResolvedValue(page([]));
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Com resultado" }));
    expect(await screen.findByText(DONE_EMPTY)).not.toBeNull();
  });
});
