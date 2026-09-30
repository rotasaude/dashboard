import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { NeighborhoodSelect, ProtocolSelect, RangeControls, UnitSelect } from "./Filters";
import { DEFAULT_RANGE } from "../../lib/analytics";
import { NB1, U1, U2, UNITS, renderWithQuery, stubAnalyticsApi } from "../../test/analyticsFixtures";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const optionTexts = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

describe("RangeControls", () => {
  it("lista os intervalos da granularidade e troca de granularidade sem sair dos limites", () => {
    const onChange = vi.fn();
    renderWithQuery(<RangeControls value={DEFAULT_RANGE} onChange={onChange} />);
    expect(optionTexts(screen.getByLabelText("Intervalo"))).toEqual([
      "últimas 12 semanas", "últimas 26 semanas", "últimas 52 semanas", "últimas 104 semanas"
    ]);
    fireEvent.change(screen.getByLabelText("Agrupar por"), { target: { value: "month" } });
    expect(onChange).toHaveBeenCalledWith({ granularity: "month", count: 12 });
    fireEvent.change(screen.getByLabelText("Intervalo"), { target: { value: "52" } });
    expect(onChange).toHaveBeenLastCalledWith({ granularity: "week", count: 52 });
  });
});

describe("NeighborhoodSelect", () => {
  it("Todos, Sem bairro e os bairros da cidade, com inativo marcado", async () => {
    stubAnalyticsApi({});
    const onChange = vi.fn();
    renderWithQuery(<NeighborhoodSelect value={null} onChange={onChange} />);
    expect(await screen.findByRole("option", { name: "Xaxim (inativo)" })).toBeTruthy();
    expect(optionTexts(screen.getByLabelText("Bairro"))).toEqual([ "Todos", "Sem bairro", "Boqueirão", "Xaxim (inativo)" ]);

    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: NB1 } });
    expect(onChange).toHaveBeenLastCalledWith(NB1);
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "none" } });
    expect(onChange).toHaveBeenLastCalledWith("none");
  });

  it("voltar para Todos manda null, não string vazia", async () => {
    stubAnalyticsApi({});
    const onChange = vi.fn();
    renderWithQuery(<NeighborhoodSelect value={NB1} onChange={onChange} />);
    await screen.findByRole("option", { name: "Boqueirão" });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("UnitSelect", () => {
  it("unidade inativa aparece marcada, na ordem de data.units", () => {
    const onChange = vi.fn();
    renderWithQuery(<UnitSelect value={null} units={UNITS} onChange={onChange} />);
    expect(optionTexts(screen.getByLabelText("Unidade"))).toEqual([ "Todas", "UBS Antiga (inativa)", "UBS Centro", "UPA Boqueirão" ]);
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: U1 } });
    expect(onChange).toHaveBeenLastCalledWith(U1);
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("antes da resposta chegar, a escolhida continua visível", () => {
    renderWithQuery(<UnitSelect value={U2} units={[]} onChange={vi.fn()} />);
    expect(optionTexts(screen.getByLabelText("Unidade"))).toEqual([ "Todas", "unidade selecionada" ]);
  });
});

describe("ProtocolSelect", () => {
  it("protocolos sem rascunho; sem versão quando withVersion é false", async () => {
    stubAnalyticsApi({});
    renderWithQuery(<ProtocolSelect name={null} version={null} withVersion={false} onChange={vi.fn()} />);
    expect(await screen.findByRole("option", { name: "respiratorio" })).toBeTruthy();
    expect(optionTexts(screen.getByLabelText("Protocolo"))).toEqual([ "Todos", "arbovirose", "respiratorio" ]);
    expect(screen.queryByLabelText("Versão")).toBeNull();
  });

  it("versão travada sem protocolo; trocar o protocolo zera a versão", async () => {
    stubAnalyticsApi({});
    const onChange = vi.fn();
    const { rerender } = renderWithQuery(<ProtocolSelect name={null} version={null} withVersion onChange={onChange} />);
    await screen.findByRole("option", { name: "arbovirose" });
    expect((screen.getByLabelText("Versão") as HTMLSelectElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "arbovirose" } });
    expect(onChange).toHaveBeenLastCalledWith("arbovirose", null);

    rerender(<ProtocolSelect name="arbovirose" version={2} withVersion onChange={onChange} />);
    expect(optionTexts(screen.getByLabelText("Versão"))).toEqual([ "Todas", "versão 2", "versão 1" ]);
    fireEvent.change(screen.getByLabelText("Versão"), { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith("arbovirose", 1);

    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "respiratorio" } });
    expect(onChange).toHaveBeenLastCalledWith("respiratorio", null);
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });
});
