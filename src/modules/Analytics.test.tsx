import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Analytics } from "./Analytics";
import {
  NOW, calibrationData, demandData, envelope, epidemiologyData, paramsOf, qualityData, renderWithQuery, stubAnalyticsApi
} from "../test/analyticsFixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function stubAll() {
  return stubAnalyticsApi({
    "/analytics/demand": envelope<"demand">(demandData()),
    "/analytics/quality": envelope<"quality">(qualityData()),
    "/analytics/calibration": envelope<"calibration">(calibrationData()),
    "/analytics/epidemiology": envelope<"epidemiology">(epidemiologyData())
  });
}

describe("Analytics", () => {
  it("abre na Demanda, com as quatro abas", async () => {
    const fn = stubAll();
    renderWithQuery(<Analytics />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([ "Demanda", "Qualidade", "Calibração", "Epidemiologia" ]);
    expect(screen.getByRole("tab", { name: "Demanda" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("region", { name: "Triagens" })).toBeTruthy();
    expect(paramsOf(fn, "/analytics/quality")).toHaveLength(0);
  });

  it("cada aba pede a sua frente", async () => {
    const fn = stubAll();
    renderWithQuery(<Analytics />);
    fireEvent.click(screen.getByRole("tab", { name: "Qualidade" }));
    expect(await screen.findByRole("region", { name: "Espera até a chamada" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Calibração" }));
    expect(await screen.findByRole("region", { name: "arbovirose · versão 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Epidemiologia" }));
    expect(await screen.findByRole("region", { name: "Teve febre?" })).toBeTruthy();
    expect(paramsOf(fn, "/analytics/calibration")[0].has("granularity")).toBe(false);
  });

  it("o intervalo vale para todas as abas", async () => {
    const fn = stubAll();
    renderWithQuery(<Analytics />);
    fireEvent.change(screen.getByLabelText("Agrupar por"), { target: { value: "month" } });
    await waitFor(() => expect(paramsOf(fn, "/analytics/demand").at(-1)!.get("from")).toBe("2025-10-01"));
    fireEvent.click(screen.getByRole("tab", { name: "Qualidade" }));
    await waitFor(() => expect(paramsOf(fn, "/analytics/quality").at(-1)!.get("granularity")).toBe("month"));
    expect(paramsOf(fn, "/analytics/quality").at(-1)!.get("from")).toBe("2025-10-01");
  });
});
