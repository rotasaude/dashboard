// src/modules/analytics/CalibrationTab.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { CalibrationTab } from "./CalibrationTab";
import { DEFAULT_RANGE } from "../../lib/analytics";
import {
  NOW, calibrationData, envelope, paramsOf, renderWithQuery, rowWith, stubAnalyticsApi
} from "../../test/analyticsFixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(NOW);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const lastParams = (fn: ReturnType<typeof stubAnalyticsApi>) => paramsOf(fn, "/analytics/calibration").at(-1)!;

describe("CalibrationTab", () => {
  it("período inteiro, sem granularity no pedido", async () => {
    const fn = stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData()) });
    renderWithQuery(<CalibrationTab range={DEFAULT_RANGE} />);
    await screen.findByText("dados até 29/09");
    expect(Object.fromEntries(paramsOf(fn, "/analytics/calibration")[0])).toEqual({ from: "2026-07-13", to: "2026-09-29" });
  });

  it("tier × desfecho com a proporção por linha, uma tabela por versão", async () => {
    stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData()) });
    renderWithQuery(<CalibrationTab range={DEFAULT_RANGE} />);
    const v2 = await screen.findByRole("region", { name: "arbovirose · versão 2" });
    expect(rowWith(v2, "vermelho")).toBe("vermelho2010 (50,0%)5 (25,0%)0 (0,0%)5 (25,0%)0 (0,0%)");
    const v1 = screen.getByRole("region", { name: "arbovirose · versão 1" });
    expect(rowWith(v1, "verde")).toBe("verdeocultooculto (oculto)0 (oculto)0 (oculto)0 (oculto)0 (oculto)");
  });

  it("desfecho oculto esconde o total e todas as proporções da linha", async () => {
    stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData()) });
    renderWithQuery(<CalibrationTab range={DEFAULT_RANGE} />);
    const v2 = await screen.findByRole("region", { name: "arbovirose · versão 2" });
    // 10 e 6 são visíveis, mas as proporções deles (e o total) somem com o "left" e "none" ocultos.
    expect(rowWith(v2, "amarelo")).toBe("amarelooculto10 (oculto)6 (oculto)0 (oculto)oculto (oculto)oculto (oculto)");
  });

  it("cabeçalho com os cinco desfechos, incluindo 'sem atendimento encerrado'", async () => {
    stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData()) });
    renderWithQuery(<CalibrationTab range={DEFAULT_RANGE} />);
    const v2 = await screen.findByRole("region", { name: "arbovirose · versão 2" });
    expect(Array.from(v2.querySelectorAll('[role="columnheader"]')).map((h) => h.textContent)).toEqual([
      "Tier", "Triagens", "Atendido e liberado", "Encaminhado", "Retorno", "Saiu sem atendimento", "Sem atendimento encerrado"
    ]);
  });

  it("versão vai com o protocolo; trocar o protocolo tira a versão do pedido", async () => {
    const fn = stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData()) });
    renderWithQuery(<CalibrationTab range={DEFAULT_RANGE} />);
    await screen.findByRole("option", { name: "arbovirose" });
    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "arbovirose" } });
    await screen.findByRole("option", { name: "versão 2" });
    fireEvent.change(screen.getByLabelText("Versão"), { target: { value: "2" } });
    await waitFor(() => expect(lastParams(fn).get("protocol_version")).toBe("2"));
    expect(lastParams(fn).get("protocol_name")).toBe("arbovirose");

    fireEvent.change(screen.getByLabelText("Protocolo"), { target: { value: "respiratorio" } });
    await waitFor(() => expect(lastParams(fn).get("protocol_name")).toBe("respiratorio"));
    expect(lastParams(fn).has("protocol_version")).toBe(false);
  });

  it("sem versões no período: estado vazio", async () => {
    stubAnalyticsApi({ "/analytics/calibration": envelope<"calibration">(calibrationData({ versions: [] })) });
    renderWithQuery(<CalibrationTab range={DEFAULT_RANGE} />);
    expect(await screen.findByText("nenhuma triagem concluída no período")).toBeTruthy();
  });
});
