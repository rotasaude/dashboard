// src/modules/VectorCycles.test.tsx — "Ciclos e cadência" da coordenação de endemias (módulo 35a, F-35.4; contrato §5, §12; Q22).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), listCycles: vi.fn(), createCycle: vi.fn(), updateCycle: vi.fn(),
    getCycleSummary: vi.fn(), listCadences: vi.fn(), putCadences: vi.fn(), listPanelNeighborhoods: vi.fn(), getVectorDomains: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type CycleSummary, type VectorCadence, type VectorCycle } from "../lib/api";
import { HOME_VISIT_ERRORS } from "../lib/homeVisits";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { TODAY35, VC_DOMAINS, VC_FEATURES, vcUser } from "../test/vectorControlFixtures";
import { CYCLE_NUMBER_REFUSED, SUMMARY_NOTICE, VectorCycles } from "./VectorCycles";
import { CADENCE_DAYS_TEXT, CADENCE_NEIGHBORHOOD_GONE, CADENCE_ORDER, CADENCE_SAVED, cadenceProblems } from "./vectorControl/CadencesPanel";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const C1: VectorCycle = { id: "cy1", year: 2026, number: 1, starts_on: "2026-01-05", ends_on: "2026-02-28" };
const C2: VectorCycle = { id: "cy2", year: 2026, number: 2, starts_on: "2026-03-01", ends_on: "2026-04-30" };
const NB = [ { id: "nb-agua", name: "Água Verde", active: true }, { id: "nb-batel", name: "Batel", active: true }, { id: "nb-old", name: "Cajuru", active: false } ];
const row = (o: Partial<CycleSummary["neighborhoods"][number]> = {}): CycleSummary["neighborhoods"][number] => ({
  neighborhood: { id: "nb-agua", name: "Água Verde" }, to_visit: 120, visited: 16, worked: 14, closed: 1, refused: 1, vacant: 0, recovered: 3,
  pending_percent: 12.5, registered_households: 130, ...o
});
const SUMMARY: CycleSummary = {
  cycle: C1,
  neighborhoods: [ row(), row({ neighborhood: { id: "nb-batel", name: "Batel" }, to_visit: 40, visited: 0, worked: 0, closed: 0, refused: 0, recovered: 0, pending_percent: null, registered_households: 41 }) ]
};

const mount = () => renderWithProviders(<VectorCycles today={TODAY35} />);
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? id.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" ") : "";
};
const rowOf = (tableName: string, text: string) => {
  const table = screen.getByRole("table", { name: tableName });
  const found = within(table).getAllByRole("row").find((r) => within(r).queryAllByText(text).length > 0);
  if (!found) throw new Error(`sem a linha ${text}`);
  return within(found);
};
const later = () => new Promise((r) => setTimeout(r, 20));

// Salvar e esperar o botão voltar (a regra local corre dentro do ActionButton, que fica ocupado até a promessa acabar).
async function save() {
  fireEvent.click(screen.getByRole("button", { name: /^Salvar ciclo/ }));
  // Gravado, o formulário fecha: sem botão também é "acabou".
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Salvar ciclo/ })?.getAttribute("aria-busy") ?? null).toBeNull());
}

async function newCycle(start: string, end: string, number = "") {
  fireEvent.click(await screen.findByRole("button", { name: "Novo ciclo" }));
  if (number) type("Número (opcional)", number);
  type("Início", start);
  type("Fim", end);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === "function" && "mockReset" in fn) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  mocked(api.listCycles).mockResolvedValue([ C1, C2 ]);
  mocked(api.listCadences).mockResolvedValue([]);
  mocked(api.listPanelNeighborhoods).mockResolvedValue(NB);
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  mocked(api.getCycleSummary).mockResolvedValue(SUMMARY);
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
});

describe("portão", () => {
  it("só a coordenação: laboratório, agente e municipal_admin (Q31 lê o index, mas a tela escreve) veem a frase e nada é lido", async () => {
    for (const roles of [ [ "vector_lab" ], [ "health_professional" ], [ "municipal_admin" ] ]) {
      mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      mount();
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      cleanup();
    }
    expect(api.listCycles).not.toHaveBeenCalled();
    expect(api.listCadences).not.toHaveBeenCalled();
    expect(api.getCycleSummary).not.toHaveBeenCalled();
  });
});

describe("ciclos de trabalho", () => {
  it("lista do ano de hoje (número e período); trocar o ano relê com o ano", async () => {
    mount();
    expect(await screen.findByRole("table", { name: "Ciclos do ano" })).not.toBeNull();
    expect(api.listCycles).toHaveBeenCalledWith(2026);
    expect(rowOf("Ciclos do ano", "ciclo 1").getByText("05/01/2026 a 28/02/2026")).not.toBeNull();
    expect(rowOf("Ciclos do ano", "ciclo 2").getByText("01/03/2026 a 30/04/2026")).not.toBeNull();
    mocked(api.listCycles).mockResolvedValue([]);
    type("Ano dos ciclos", "2025");
    await waitFor(() => expect(api.listCycles).toHaveBeenCalledWith(2025));
    expect(await screen.findByText("nenhum ciclo em 2025")).not.toBeNull();
    // Ano incompleto não vai ao api (o index recusa o que não tem 4 dígitos).
    type("Ano dos ciclos", "202");
    await later();
    expect(mocked(api.listCycles).mock.calls.map((c) => c[0])).toEqual([ 2026, 2025 ]);
  });

  it("ciclo novo com fim antes do início não envia; no mesmo dia envia, sem número (o api dá o próximo), e um envio no duplo clique", async () => {
    let resolve: (c: VectorCycle) => void = () => {};
    mocked(api.createCycle).mockImplementation(() => new Promise<VectorCycle>((r) => { resolve = r; }));
    mount();
    await newCycle("2026-05-10", "2026-05-09");
    await save();
    expect(field("Fim").getAttribute("aria-invalid")).toBe("true");
    expect(describedText(field("Fim"))).toBe("o fim do ciclo vem depois do início");
    expect(api.createCycle).not.toHaveBeenCalled();

    type("Fim", "2026-05-10");
    expect(field("Fim").getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar ciclo" }));
    fireEvent.click(screen.getByRole("button", { name: /^Salvar ciclo/ }));
    await waitFor(() => expect(api.createCycle).toHaveBeenCalledTimes(1));
    expect(mocked(api.createCycle).mock.calls[0][0]).toEqual({ year: 2026, starts_on: "2026-05-10", ends_on: "2026-05-10" });
    resolve({ id: "cy3", year: 2026, number: 3, starts_on: "2026-05-10", ends_on: "2026-05-10" });
    expect(await screen.findByText("ciclo 3/2026 salvo")).not.toBeNull();
    await waitFor(() => expect(api.listCycles).toHaveBeenCalledTimes(2));
    expect(api.createCycle).toHaveBeenCalledTimes(1);
  });

  it("ano do ciclo (Q22): o civil ou o epidemiológico do início — 2026-01-02 aceita 2025 e recusa 2024", async () => {
    mocked(api.createCycle).mockResolvedValue({ id: "cy9", year: 2025, number: 1, starts_on: "2026-01-02", ends_on: "2026-01-03" });
    mocked(api.listCycles).mockResolvedValue([]);
    mount();
    await newCycle("2026-01-02", "2026-01-03");
    type("Ano", "2024");
    await save();
    expect(field("Ano").getAttribute("aria-invalid")).toBe("true");
    expect(describedText(field("Ano"))).toBe("o ano do ciclo é o ano civil ou o epidemiológico da data de início");
    expect(api.createCycle).not.toHaveBeenCalled();
    type("Ano", "2025");
    await save();
    await waitFor(() => expect(api.createCycle).toHaveBeenCalledTimes(1));
    expect(mocked(api.createCycle).mock.calls[0][0]).toEqual({ year: 2025, starts_on: "2026-01-02", ends_on: "2026-01-03" });
    // O ciclo gravado é de 2025: a lista passa a esse ano.
    await waitFor(() => expect(api.listCycles).toHaveBeenCalledWith(2025));
    expect(field("Ano dos ciclos").value).toBe("2025");
  });

  it("número: 1–12 dos dois lados; número já usado no ano recusado antes de enviar", async () => {
    mount();
    await newCycle("2026-05-01", "2026-05-31", "13");
    await save();
    expect(describedText(field("Número (opcional)"))).toBe("número do ciclo de 1 a 12");
    type("Número (opcional)", "0");
    await save();
    expect(describedText(field("Número (opcional)"))).toBe("número do ciclo de 1 a 12");
    type("Número (opcional)", "2");
    await save();
    expect(describedText(field("Número (opcional)"))).toBe(CYCLE_NUMBER_REFUSED);
    expect(api.createCycle).not.toHaveBeenCalled();
    mocked(api.createCycle).mockResolvedValue({ id: "cy12", year: 2026, number: 12, starts_on: "2026-05-01", ends_on: "2026-05-31" });
    type("Número (opcional)", "12");
    await save();
    await waitFor(() => expect(api.createCycle).toHaveBeenCalledTimes(1));
    expect(mocked(api.createCycle).mock.calls[0][0]).toEqual({ year: 2026, number: 12, starts_on: "2026-05-01", ends_on: "2026-05-31" });
  });

  it("422 cycle_overlap no campo do início; invalid_request path number no número; nada é reenviado", async () => {
    mocked(api.createCycle).mockRejectedValueOnce(new ApiError(422, { error: "cycle_overlap", path: "starts_on" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "number" }, "x"));
    mount();
    await newCycle("2026-02-28", "2026-04-30");
    await save();
    await waitFor(() => expect(field("Início").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(field("Início"))).toBe(VECTOR_ERRORS.cycle_overlap);
    expect(api.createCycle).toHaveBeenCalledTimes(1);
    // Mexer no campo limpa a marca; o 422 do número duplicado (corrida com outra pessoa) cai no número.
    type("Início", "2026-06-01");
    type("Fim", "2026-06-30");
    expect(field("Início").getAttribute("aria-invalid")).toBeNull();
    await save();
    await waitFor(() => expect(field("Número (opcional)").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(field("Número (opcional)"))).toBe(CYCLE_NUMBER_REFUSED);
    await later();
    expect(api.createCycle).toHaveBeenCalledTimes(2);
    expect(api.listCycles).toHaveBeenCalledTimes(1);
  });

  it("editar manda só o que mudou; sem mudança não envia; 404 (ciclo sumiu) → a frase e UMA releitura, sem reenvio", async () => {
    mount();
    await screen.findByRole("table", { name: "Ciclos do ano" });
    fireEvent.click(rowOf("Ciclos do ano", "ciclo 1").getByRole("button", { name: "Editar ciclo 1" }));
    expect(field("Início").value).toBe("2026-01-05");
    expect(field("Número").value).toBe("1");
    await save();
    expect(await screen.findByText("nada mudou")).not.toBeNull();
    expect(api.updateCycle).not.toHaveBeenCalled();

    mocked(api.updateCycle).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    type("Fim", "2026-02-20");
    await save();
    await waitFor(() => expect(api.updateCycle).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateCycle).mock.calls[0]).toEqual([ "cy1", { ends_on: "2026-02-20" } ]);
    expect(await screen.findByText(HOME_VISIT_ERRORS.not_found)).not.toBeNull();
    await waitFor(() => expect(api.listCycles).toHaveBeenCalledTimes(2));
    await later();
    expect(api.listCycles).toHaveBeenCalledTimes(2);
    expect(api.updateCycle).toHaveBeenCalledTimes(1);
  });

  it("editar: número vazio recusado (o PATCH não aceita nulo); gravar relê a lista e o resumo do ciclo", async () => {
    mocked(api.updateCycle).mockResolvedValue({ ...C1, ends_on: "2026-02-20" });
    mount();
    await screen.findByRole("table", { name: "Ciclos do ano" });
    fireEvent.click(rowOf("Ciclos do ano", "ciclo 1").getByRole("button", { name: "Ver resumo do ciclo 1" }));
    await screen.findByRole("table", { name: "Resumo por bairro" });
    fireEvent.click(rowOf("Ciclos do ano", "ciclo 1").getByRole("button", { name: "Editar ciclo 1" }));
    type("Número", "");
    await save();
    expect(describedText(field("Número"))).toBe("número do ciclo de 1 a 12");
    type("Número", "1");
    type("Fim", "2026-02-20");
    await save();
    expect(await screen.findByText("ciclo 1/2026 salvo")).not.toBeNull();
    await waitFor(() => expect(api.listCycles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getCycleSummary).toHaveBeenCalledTimes(2));
  });
});

describe("resumo por bairro", () => {
  it("resumo mostra \"12,5%\" e \"—\" para null, os números, os imóveis cadastrados e o aviso do cadastro", async () => {
    mount();
    await screen.findByRole("table", { name: "Ciclos do ano" });
    // Nada é lido antes de escolher o ciclo.
    expect(api.getCycleSummary).not.toHaveBeenCalled();
    fireEvent.click(rowOf("Ciclos do ano", "ciclo 1").getByRole("button", { name: "Ver resumo do ciclo 1" }));
    expect(await screen.findByRole("table", { name: "Resumo por bairro" })).not.toBeNull();
    expect(api.getCycleSummary).toHaveBeenCalledWith("cy1");
    const agua = rowOf("Resumo por bairro", "Água Verde");
    for (const v of [ "120", "16", "14", "3", "12,5%", "130" ]) expect(agua.getByText(v)).not.toBeNull();
    const batel = rowOf("Resumo por bairro", "Batel");
    expect(batel.getByText("—")).not.toBeNull();
    expect(batel.getByText("41")).not.toBeNull();
    expect(screen.getByText(SUMMARY_NOTICE)).not.toBeNull();
    expect(SUMMARY_NOTICE).toBe("os números contam só os imóveis do cadastro territorial");
    const headers = within(screen.getByRole("table", { name: "Resumo por bairro" })).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([ "Bairro", "A visitar", "Visitados", "Trabalhados", "Fechados", "Recusados", "Desocupados", "Recuperados", "Pendência", "Imóveis cadastrados" ]);
  });

  it("o que não aparece: nenhuma pessoa ou endereço, nada em storage, nenhuma releitura sozinha", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mount();
    await screen.findByRole("table", { name: "Ciclos do ano" });
    fireEvent.click(rowOf("Ciclos do ano", "ciclo 1").getByRole("button", { name: "Ver resumo do ciclo 1" }));
    const table = await screen.findByRole("table", { name: "Resumo por bairro" });
    expect(within(table).queryByText(/endereço|morador|rua/i)).toBeNull();
    await later();
    expect(setItem).not.toHaveBeenCalled();
    expect(api.getCycleSummary).toHaveBeenCalledTimes(1);
    expect(api.listCycles).toHaveBeenCalledTimes(1);
    expect(api.listCadences).toHaveBeenCalledTimes(1);
  });
});

describe("cadência", () => {
  async function openCadences() {
    mount();
    return screen.findByRole("button", { name: "Adicionar linha" });
  }

  it("cadência: step-up, corpo com a lista inteira; a ordem de aplicação explicada em uma linha", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_verified_at: null }));
    const saved: VectorCadence[] = [ { neighborhood_id: null, risk_class: "red", strategic_point: false, days: 30 } ];
    mocked(api.putCadences).mockResolvedValue(saved);
    fireEvent.click(await openCadences());
    expect(screen.getByText(CADENCE_ORDER)).not.toBeNull();
    expect((screen.getByLabelText("Bairro da linha 1") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Risco da linha 1"), { target: { value: "red" } });
    type("Dias da linha 1", "30");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
    type("Código do autenticador", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.putCadences).toHaveBeenCalledTimes(1));
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(mocked(api.putCadences).mock.calls[0][0]).toEqual([ { neighborhood_id: null, risk_class: "red", strategic_point: false, days: 30 } ]);
    expect(await screen.findByText(CADENCE_SAVED)).not.toBeNull();
    await waitFor(() => expect(api.listCadences).toHaveBeenCalledTimes(2));
    expect(api.putCadences).toHaveBeenCalledTimes(1);
  });

  it("a lista inteira vai junto: linhas lidas, editadas e a nova; ponto estratégico sem risco; bairro inativo marcado", async () => {
    mocked(api.listCadences).mockResolvedValue([
      { neighborhood_id: null, risk_class: null, strategic_point: false, days: 60 },
      { neighborhood_id: "nb-agua", risk_class: "yellow", strategic_point: false, days: 45 }
    ]);
    mocked(api.putCadences).mockImplementation(async (items: VectorCadence[]) => items);
    await openCadences();
    expect((screen.getByLabelText("Bairro da linha 2") as HTMLSelectElement).value).toBe("nb-agua");
    expect(field("Dias da linha 2").value).toBe("45");
    expect(await within(screen.getByLabelText("Bairro da linha 1")).findByText("Cajuru (inativo)")).not.toBeNull();
    type("Dias da linha 2", "40");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    fireEvent.change(screen.getByLabelText("Bairro da linha 3"), { target: { value: "nb-batel" } });
    fireEvent.change(screen.getByLabelText("Risco da linha 3"), { target: { value: "red" } });
    fireEvent.click(screen.getByLabelText("Ponto estratégico da linha 3"));
    // PE não tem risco (o api recusa PE com risco): o seletor trava em "qualquer".
    expect((screen.getByLabelText("Risco da linha 3") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Risco da linha 3") as HTMLSelectElement).value).toBe("");
    type("Dias da linha 3", "15");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.putCadences).toHaveBeenCalledTimes(1));
    expect(mocked(api.putCadences).mock.calls[0][0]).toEqual([
      { neighborhood_id: null, risk_class: null, strategic_point: false, days: 60 },
      { neighborhood_id: "nb-agua", risk_class: "yellow", strategic_point: false, days: 40 },
      { neighborhood_id: "nb-batel", risk_class: null, strategic_point: true, days: 15 }
    ]);
  });

  it("linha repetida (bairro, risco, PE) recusada antes de enviar; remover a linha libera", async () => {
    mocked(api.listCadences).mockResolvedValue([ { neighborhood_id: null, risk_class: "red", strategic_point: false, days: 30 } ]);
    await openCadences();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    fireEvent.change(screen.getByLabelText("Risco da linha 2"), { target: { value: "red" } });
    type("Dias da linha 2", "20");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
    expect(screen.getByLabelText("Risco da linha 2").getAttribute("aria-invalid")).toBe("true");
    expect(describedText(screen.getByLabelText("Risco da linha 2"))).toBe("linha repetida: mesmo bairro, risco e ponto estratégico da linha 1");
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    // Mesmo bairro e risco, mas ponto estratégico diferente: outra tripla.
    expect(cadenceProblems([
      { neighborhood_id: "", risk_class: "", strategic_point: false, days: "30" }, { neighborhood_id: "", risk_class: "", strategic_point: true, days: "30" }
    ])).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Remover linha 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
    expect(await screen.findByRole("button", { name: "Confirmar" })).not.toBeNull();
    expect(api.putCadences).not.toHaveBeenCalled();
  });

  it("dias 6 e 366 recusados; 7 e 365 passam", async () => {
    await openCadences();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    for (const bad of [ "6", "366", "30,5", "" ]) {
      type("Dias da linha 1", bad);
      fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
      expect(field("Dias da linha 1").getAttribute("aria-invalid")).toBe("true");
      expect(describedText(field("Dias da linha 1"))).toBe(CADENCE_DAYS_TEXT);
      expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    }
    for (const ok of [ "7", "365" ]) {
      type("Dias da linha 1", ok);
      fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
      expect(field("Dias da linha 1").getAttribute("aria-invalid")).toBeNull();
      expect(await screen.findByRole("button", { name: "Confirmar" })).not.toBeNull();
    }
    expect(api.putCadences).not.toHaveBeenCalled();
  });

  it("422 no bairro (apagado entre a leitura e o envio): a frase na linha e UMA releitura dos bairros; nada é reenviado", async () => {
    mocked(api.listCadences).mockResolvedValue([ { neighborhood_id: "nb-agua", risk_class: null, strategic_point: false, days: 45 } ]);
    mocked(api.putCadences).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "items[0].neighborhood_id" }, "x"));
    await openCadences();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByLabelText("Bairro da linha 1").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(screen.getByLabelText("Bairro da linha 1"))).toBe(CADENCE_NEIGHBORHOOD_GONE);
    await waitFor(() => expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(2));
    await later();
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(2);
    expect(api.putCadences).toHaveBeenCalledTimes(1);
    expect(api.listCadences).toHaveBeenCalledTimes(1);
  });

  it("422 dos dias ou da linha repetida vindo do api cai na linha certa", async () => {
    mocked(api.listCadences).mockResolvedValue([
      { neighborhood_id: null, risk_class: null, strategic_point: false, days: 60 }, { neighborhood_id: null, risk_class: "red", strategic_point: false, days: 30 }
    ]);
    mocked(api.putCadences).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "items[1].days" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "items[1]" }, "x"));
    await openCadences();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadência" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(field("Dias da linha 2").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(field("Dias da linha 2"))).toBe(CADENCE_DAYS_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByLabelText("Risco da linha 2").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(screen.getByLabelText("Risco da linha 2"))).toBe("linha repetida: mesmo bairro, risco e ponto estratégico de outra linha");
    expect(api.putCadences).toHaveBeenCalledTimes(2);
  });
});
