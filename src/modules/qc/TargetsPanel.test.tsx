// src/modules/qc/TargetsPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listQcLots: vi.fn(), listQcMaterials: vi.fn(), listLabInstruments: vi.fn(), getQcTargets: vi.fn(),
    listQcSuggestions: vi.fn(), createQcTarget: vi.fn(), acceptQcSuggestion: vi.fn() };
});

import * as api from "../../lib/api";
import { TargetsPanel } from "./TargetsPanel";
import { DOT_IN_NUMBER } from "../../lib/lab";
import { renderWithProviders } from "../../test/campaignFixtures";
import { GLU_EXAM, instrument, qcLot, qcMaterial, qcSuggestion, qcTarget, qcUser } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listQcLots, api.listQcMaterials, api.listLabInstruments, api.getQcTargets, api.listQcSuggestions,
  api.createQcTarget, api.acceptQcSuggestion ];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
  mocked(api.listQcLots).mockResolvedValue([ qcLot() ]);
  mocked(api.listQcMaterials).mockResolvedValue([ qcMaterial() ]);
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.getQcTargets).mockResolvedValue({ current: [ qcTarget() ], history: [ qcTarget() ] });
  mocked(api.listQcSuggestions).mockResolvedValue([ qcSuggestion() ]);
  mocked(api.createQcTarget).mockResolvedValue(qcTarget({ id: "qt2", level: "patológico", mean: "250", sd: "6" }));
  mocked(api.acceptQcSuggestion).mockResolvedValue(qcTarget({ id: "qt3", version: 2, source: "laboratory", mean: "97.6", sd: "2.1", based_on_runs: 20 }));
});

const render = (lead = true, admin = false) => renderWithProviders(<TargetsPanel providerId="pv9" lotId="ql1" lead={lead} admin={admin} exams={[ GLU_EXAM ]} />);

async function fill(form: HTMLElement, level: string, mean: string, sd: string) {
  await within(form).findByRole("option", { name: "BS-200" });
  await within(form).findByRole("option", { name: level });
  fireEvent.change(within(form).getByLabelText("Nível"), { target: { value: level } });
  fireEvent.change(within(form).getByLabelText("Analito"), { target: { value: "glicose" } });
  fireEvent.change(within(form).getByLabelText("Aparelho"), { target: { value: "in1" } });
  fireEvent.change(within(form).getByLabelText("Média"), { target: { value: mean } });
  fireEvent.change(within(form).getByLabelText("Desvio-padrão"), { target: { value: sd } });
}

describe("TargetsPanel", () => {
  it("vigentes com versão e origem; referência da bula nova com vírgula", async () => {
    render();
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    expect(await within(panel).findByText("v1 · bula")).not.toBeNull();
    const form = within(panel).getByRole("group", { name: "Referência da bula" });
    await fill(form, "patológico", "250,0", "6,0");
    expect(within(form).queryByLabelText("Motivo da troca")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar referência" }));
    expect(api.createQcTarget).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Salvar referência da bula" }));
    await waitFor(() => expect(api.createQcTarget).toHaveBeenCalledWith({
      lot_id: "ql1", level: "patológico", analyte_key: "glicose", instrument_id: "in1", mean: "250.0", sd: "6.0"
    }));
    expect(await within(panel).findByText("Referência da bula salva.")).not.toBeNull();
  });

  it("trocar a vigente pede o motivo; ponto é recusado", async () => {
    render();
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    await within(panel).findByText("v1 · bula");
    const form = within(panel).getByRole("group", { name: "Referência da bula" });
    await fill(form, "normal", "98.5", "2,4");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar referência" }));
    expect(within(form).getByRole("alert").textContent).toBe(DOT_IN_NUMBER);
    fireEvent.change(within(form).getByLabelText("Média"), { target: { value: "98,5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar referência" }));
    expect(within(form).getByRole("alert").textContent).toBe("escreva o motivo da troca da referência (ao menos 10 caracteres)");
    fireEvent.change(within(form).getByLabelText("Motivo da troca"), { target: { value: "bula revisada pelo fabricante" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar referência" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar referência da bula" }));
    await waitFor(() => expect(api.createQcTarget).toHaveBeenCalledWith(expect.objectContaining({ mean: "98.5", sd: "2.4", reason: "bula revisada pelo fabricante" })));
  });

  it("RT aceita a sugestão com motivo; vira versão nova do laboratório", async () => {
    render(true);
    const box = await screen.findByRole("group", { name: "Sugestões do laboratório" });
    expect(await within(box).findByText("20 corridas aprovadas")).not.toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Aceitar" }));
    fireEvent.click(within(box).getByRole("button", { name: "Revisar aceite" }));
    expect(within(box).getByRole("alert").textContent).toBe("escreva o motivo do aceite (ao menos 10 caracteres)");
    fireEvent.change(within(box).getByLabelText("Motivo do aceite"), { target: { value: "20 corridas estáveis no lote" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar aceite" }));
    expect(api.acceptQcSuggestion).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar aceite" }));
    await waitFor(() => expect(api.acceptQcSuggestion).toHaveBeenCalledWith({
      lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1", reason: "20 corridas estáveis no lote"
    }));
    expect(await screen.findByText("Referência do laboratório aceita — vale para as próximas corridas.")).not.toBeNull();
  });

  it("quem não é RT vê a sugestão sem o botão", async () => {
    render(false);
    const box = await screen.findByRole("group", { name: "Sugestões do laboratório" });
    await within(box).findByText("20 corridas aprovadas");
    expect(within(box).queryByRole("button", { name: "Aceitar" })).toBeNull();
    expect(within(box).getByText("aceitar sugestão: só o RT ou o substituto")).not.toBeNull();
  });

  it("motivo e justificativa acima de 1000 são recusados antes do envio", async () => {
    render();
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    await within(panel).findByText("v1 · bula");
    const form = within(panel).getByRole("group", { name: "Referência da bula" });
    await fill(form, "normal", "98,5", "2,4");
    fireEvent.change(within(form).getByLabelText("Motivo da troca"), { target: { value: "x".repeat(1001) } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar referência" }));
    expect(within(form).getByRole("alert").textContent).toBe("o motivo da troca da referência: no máximo 1000 caracteres");
    expect(api.createQcTarget).not.toHaveBeenCalled();
  });

  it("mais de 4 casas decimais é recusado antes do envio", async () => {
    render();
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    await within(panel).findByText("v1 · bula");
    const form = within(panel).getByRole("group", { name: "Referência da bula" });
    await fill(form, "patológico", "250,12345", "6,0");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar referência" }));
    expect(within(form).getByRole("alert").textContent).toContain("no máximo 9 dígitos");
    expect(api.createQcTarget).not.toHaveBeenCalled();
  });

  it("aceite que volta 404 not_found vira frase própria e relê as sugestões", async () => {
    mocked(api.acceptQcSuggestion).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    render(true);
    const box = await screen.findByRole("group", { name: "Sugestões do laboratório" });
    fireEvent.click(await within(box).findByRole("button", { name: "Aceitar" }));
    fireEvent.change(within(box).getByLabelText("Motivo do aceite"), { target: { value: "20 corridas estáveis no lote" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar aceite" }));
    const before = mocked(api.listQcSuggestions).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar aceite" }));
    expect(await screen.findByText("não encontrado neste laboratório — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(mocked(api.listQcSuggestions).mock.calls.length).toBeGreaterThan(before));
  });

  it("admin que não é RT cadastra a bula, mas não aceita sugestão", async () => {
    render(false, true);
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    expect(await within(panel).findByRole("group", { name: "Referência da bula" })).not.toBeNull();
    const box = within(panel).getByRole("group", { name: "Sugestões do laboratório" });
    await within(box).findByText("20 corridas aprovadas");
    expect(within(box).queryByRole("button", { name: "Aceitar" })).toBeNull();
  });

  it("quem não é RT nem admin não vê o formulário da bula", async () => {
    render(false, false);
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    await within(panel).findByText("v1 · bula");
    expect(within(panel).queryByRole("group", { name: "Referência da bula" })).toBeNull();
  });

  it("lote encerrado: sem formulário da bula nem Aceitar, só a frase", async () => {
    mocked(api.listQcLots).mockResolvedValue([ qcLot({ status: "closed", closed_on: "2026-10-17" }) ]);
    render(true);
    const panel = await screen.findByRole("region", { name: "Referências do lote L2026A" });
    const box = await within(panel).findByRole("group", { name: "Sugestões do laboratório" });
    await within(box).findByText("20 corridas aprovadas");
    expect(within(panel).queryByRole("group", { name: "Referência da bula" })).toBeNull();
    expect(within(box).queryByRole("button", { name: "Aceitar" })).toBeNull();
    expect(within(panel).getAllByText("lote encerrado: a referência não muda mais").length).toBeGreaterThan(0);
  });
});
