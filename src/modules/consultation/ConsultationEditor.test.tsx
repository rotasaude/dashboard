// src/modules/consultation/ConsultationEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, saveConsultationDraft: vi.fn(), finalizeConsultation: vi.fn(), searchTerminology: vi.fn(), searchSigtap: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationEditor } from "./ConsultationEditor";
import { NOW19, consultation, finalized, options, record } from "../../test/consultationFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const units = [ unit, { id: "u2", name: "Ambulatório de Especialidades", kind: "other" } ];

function renderEditor(autosaveDelayMs = 0) {
  const onFinalized = vi.fn();
  const onLocked = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { unmount } = render(<ConsultationEditor consultation={consultation()} record={record()} options={options()} unit={unit} units={units}
    autosaveDelayMs={autosaveDelayMs} searchDelayMs={0} onFinalized={onFinalized} onLocked={onLocked} />, { wrapper });
  return { onFinalized, onLocked, unmount };
}
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fillMinimum() {
  fireEvent.click(screen.getByRole("button", { name: "Avaliar T90" }));
  fireEvent.click(screen.getByLabelText("Retorno para consulta agendada"));
  text("Plano (P)", "Ajuste de dose; retorno em 30 dias.");
}

describe("ConsultationEditor", () => {
  beforeEach(() => {
    for (const fn of [ api.saveConsultationDraft, api.finalizeConsultation, api.searchTerminology, api.searchSigtap ]) mocked(fn).mockReset();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19));
    mocked(api.saveConsultationDraft).mockImplementation(async () => consultation());
    mocked(api.finalizeConsultation).mockResolvedValue(finalized());
  });

  it("escrever no Subjetivo salva sozinho e mostra a hora", async () => {
    renderEditor();
    expect(screen.getByRole("status").textContent).toBe("rascunho");
    text("Subjetivo (S)", "Refere sede e cansaço há duas semanas.");
    await waitFor(() => expect(api.saveConsultationDraft).toHaveBeenCalledWith("cs1",
      expect.objectContaining({ subjective: "Refere sede e cansaço há duas semanas.", care_type: "5" })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("salvo às 10:00"));
  });

  it("Finalizar lista o que falta e não chama a API", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    const section = screen.getByRole("region", { name: "Finalizar consulta" });
    const missing = within(section).getByRole("list", { name: "o que falta para finalizar" });
    expect(within(missing).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "avalie, inclua ou resolva ao menos um problema", "marque ao menos uma conduta", "escreva a avaliação (A) ou o plano (P)"
    ]);
    expect((within(section).getByRole("button", { name: "Confirmar finalização" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.finalizeConsultation).not.toHaveBeenCalled();
  });

  it("Finalizar espera o salvamento pendente e manda o rascunho mais novo antes", async () => {
    const { onFinalized } = renderEditor(60_000);
    fillMinimum();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    await waitFor(() => expect(onFinalized).toHaveBeenCalledWith(finalized()));
    expect(api.saveConsultationDraft).toHaveBeenCalledTimes(1);
    expect(mocked(api.saveConsultationDraft).mock.calls[0][1]).toMatchObject({
      plan: "Ajuste de dose; retorno em 30 dias.", conducts: [ "9" ],
      evaluated_problems: [ { problem_id: "pp1", action: "evaluate" } ]
    });
    expect(mocked(api.saveConsultationDraft).mock.invocationCallOrder[0])
      .toBeLessThan(mocked(api.finalizeConsultation).mock.invocationCallOrder[0]);
    expect(api.finalizeConsultation).toHaveBeenCalledWith("cs1", { outcome: "discharged" });
  });

  it("o desfecho vai como no Encerrar: encaminhamento com a unidade", async () => {
    renderEditor(60_000);
    fillMinimum();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    const section = screen.getByRole("region", { name: "Finalizar consulta" });
    fireEvent.change(within(section).getByLabelText("Desfecho"), { target: { value: "referred" } });
    expect(within(section).getByRole("list", { name: "o que falta para finalizar" }).textContent)
      .toBe("informe a unidade de destino ou a descrição do encaminhamento");
    fireEvent.change(within(section).getByLabelText("Unidade de destino"), { target: { value: "u2" } });
    fireEvent.click(within(section).getByRole("button", { name: "Confirmar finalização" }));
    await waitFor(() => expect(api.finalizeConsultation).toHaveBeenCalledWith("cs1", { outcome: "referred", referral_unit_id: "u2" }));
  });

  it("422 patient_name_missing vira a frase com o caminho", async () => {
    mocked(api.finalizeConsultation).mockRejectedValue(new ApiError(422, { error: "patient_name_missing" }, "422"));
    const { onFinalized } = renderEditor(60_000);
    fillMinimum();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("falta o nome completo do paciente — peça à recepção para completar os nomes no check-in e tente de novo");
    expect(onFinalized).not.toHaveBeenCalled();
  });

  it("not_draft no salvamento trava o editor e avisa", async () => {
    mocked(api.saveConsultationDraft).mockRejectedValue(new ApiError(409, { error: "not_draft" }, "409"));
    const { onLocked } = renderEditor();
    text("Objetivo (O)", "Bom estado geral.");
    await waitFor(() => expect(onLocked).toHaveBeenCalledWith("esta consulta já foi finalizada — a tela foi atualizada"));
    expect((screen.getByLabelText("Objetivo (O)") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("sinal vital fora do plausível não vai no rascunho e trava a finalização", async () => {
    renderEditor();
    text("Pressão sistólica (mmHg)", "400");
    fillMinimum();
    await waitFor(() => expect(api.saveConsultationDraft).toHaveBeenCalled());
    const last = mocked(api.saveConsultationDraft).mock.calls.at(-1)?.[1];
    expect(last.vitals.systolic).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    expect(screen.getByRole("list", { name: "o que falta para finalizar" }).textContent).toContain("corrija os sinais vitais marcados");
  });

  it("422 ciap2_required_for_cbo mostra a frase do CIAP-2 e o editor segue editável", async () => {
    mocked(api.finalizeConsultation).mockRejectedValue(new ApiError(422, { error: "ciap2_required_for_cbo" }, "422"));
    const { onFinalized, onLocked } = renderEditor(60_000);
    fillMinimum();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("Avalie ao menos um problema em CIAP-2 para finalizar: a ficha de quem não é médico não leva CID-10.");
    expect(onFinalized).not.toHaveBeenCalled();
    expect(onLocked).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Plano (P)") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("falha ao salvar: Confirmar mostra a frase e não chama finalize", async () => {
    mocked(api.saveConsultationDraft).mockRejectedValue(new ApiError(500, { error: "boom" }, "500"));
    renderEditor(60_000);
    fillMinimum();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("o rascunho não foi salvo — veja o aviso no topo da consulta e tente de novo");
    expect(api.finalizeConsultation).not.toHaveBeenCalled();
  });

  it("durante a finalização o editor fica selado; depois de finalizar, desmontar não salva nem avisa", async () => {
    let resolveFinalize: (c: ReturnType<typeof finalized>) => void = () => {};
    mocked(api.finalizeConsultation).mockImplementation(() => new Promise((r) => { resolveFinalize = r; }));
    const { onFinalized, onLocked, unmount } = renderEditor(0);
    fillMinimum();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar finalização" }));
    await waitFor(() => expect(api.finalizeConsultation).toHaveBeenCalled());
    const saves = mocked(api.saveConsultationDraft).mock.calls.length;
    expect((screen.getByLabelText("Plano (P)") as HTMLTextAreaElement).disabled).toBe(true);
    text("Plano (P)", "digitado durante a finalização");
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.saveConsultationDraft).mock.calls.length).toBe(saves);
    resolveFinalize(finalized());
    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocked(api.saveConsultationDraft).mock.calls.length).toBe(saves);
    expect(onLocked).not.toHaveBeenCalled();
  });

  it("texto acima de 20.000 não é salvo e diz qual campo", async () => {
    renderEditor();
    text("Plano (P)", "x".repeat(20_001));
    expect(screen.getByRole("status").textContent).toBe("não salvo — Plano (P) passa de 20.000 caracteres");
    await new Promise((r) => setTimeout(r, 20));
    expect(api.saveConsultationDraft).not.toHaveBeenCalled();
  });
});
