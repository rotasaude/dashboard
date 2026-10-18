// src/modules/qc/RulesPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listQcMaterials: vi.fn(), listLabInstruments: vi.fn(), getQcRules: vi.fn(), saveQcRules: vi.fn() };
});

import * as api from "../../lib/api";
import { RulesPanel } from "./RulesPanel";
import { RT_ONLY } from "../../lib/qc";
import { renderWithProviders } from "../../test/campaignFixtures";
import { GLU_EXAM, instrument, qcMaterial, qcRules, qcUser } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listQcMaterials, api.listLabInstruments, api.getQcRules, api.saveQcRules ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
  mocked(api.listQcMaterials).mockResolvedValue([ qcMaterial() ]);
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.getQcRules).mockResolvedValue(qcRules());
  mocked(api.saveQcRules).mockResolvedValue(qcRules({ is_default: false, rules: { ...qcRules().rules, "4_1s": false } }));
});

async function choose(lead: boolean) {
  renderWithProviders(<RulesPanel providerId="pv9" lead={lead} exams={[ GLU_EXAM ]} />);
  const panel = await screen.findByRole("region", { name: "Regras de Westgard" });
  await within(panel).findByRole("option", { name: "BS-200" });
  fireEvent.change(within(panel).getByLabelText("Aparelho"), { target: { value: "in1" } });
  fireEvent.change(within(panel).getByLabelText("Analito"), { target: { value: "glicose" } });
  await within(panel).findByText("padrão: todas as regras ligadas");
  return panel;
}

describe("RulesPanel", () => {
  it("RT desliga 4-1s: sem justificativa recusa; com, salva", async () => {
    const panel = await choose(true);
    expect(api.getQcRules).toHaveBeenCalledWith("in1", "glicose");
    fireEvent.click(within(panel).getByLabelText("4-1s"));
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e salvar regras" }));
    expect(within(panel).getByRole("alert").textContent).toBe("escreva a justificativa para desligar 4-1s (ao menos 10 caracteres)");
    expect(api.saveQcRules).not.toHaveBeenCalled();
    fireEvent.change(within(panel).getByLabelText("Justificativa"), { target: { value: "aparelho em validação, 4-1s gera falso alarme" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e salvar regras" }));
    expect(api.saveQcRules).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Salvar regras" }));
    await waitFor(() => expect(api.saveQcRules).toHaveBeenCalledWith({
      instrument_id: "in1", analyte_key: "glicose", rules: { "1_2s": true, "1_3s": true, "2_2s": true, "R_4s": true, "4_1s": false, "10x": true },
      justification: "aparelho em validação, 4-1s gera falso alarme"
    }));
    expect(await within(panel).findByText("Regras salvas.")).not.toBeNull();
  });

  it("quem não é RT só lê", async () => {
    const panel = await choose(false);
    expect((within(panel).getByLabelText("4-1s") as HTMLInputElement).disabled).toBe(true);
    expect(within(panel).queryByRole("button", { name: "Revisar e salvar regras" })).toBeNull();
    expect(within(panel).getByText(RT_ONLY)).not.toBeNull();
  });

  it("religar uma regra desligada salva sem justificativa", async () => {
    mocked(api.getQcRules).mockResolvedValue(qcRules({ is_default: false, rules: { ...qcRules().rules, "4_1s": false }, justification: "validação", changed_by: "Bia" }));
    renderWithProviders(<RulesPanel providerId="pv9" lead exams={[ GLU_EXAM ]} />);
    const panel = await screen.findByRole("region", { name: "Regras de Westgard" });
    await within(panel).findByRole("option", { name: "BS-200" });
    fireEvent.change(within(panel).getByLabelText("Aparelho"), { target: { value: "in1" } });
    fireEvent.change(within(panel).getByLabelText("Analito"), { target: { value: "glicose" } });
    fireEvent.click(await within(panel).findByLabelText("4-1s"));
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e salvar regras" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar regras" }));
    await waitFor(() => expect(api.saveQcRules).toHaveBeenCalledWith(expect.objectContaining({ justification: "" })));
  });

  it("justificativa acima de 1000 é recusada antes do envio", async () => {
    const panel = await choose(true);
    fireEvent.change(within(panel).getByLabelText("Justificativa"), { target: { value: "x".repeat(1001) } });
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar e salvar regras" }));
    expect(within(panel).getByRole("alert").textContent).toBe("a justificativa: no máximo 1000 caracteres");
    expect(api.saveQcRules).not.toHaveBeenCalled();
  });
});
