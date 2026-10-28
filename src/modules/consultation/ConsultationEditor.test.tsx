// src/modules/consultation/ConsultationEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, saveConsultationDraft: vi.fn(), finalizeConsultation: vi.fn(), searchTerminology: vi.fn(), searchSigtap: vi.fn(),
    getNotificationSuggestions: vi.fn(), createConsultationNotification: vi.fn(), listSurveillanceDiseases: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationEditor } from "./ConsultationEditor";
import { NOW19, consultation, finalized, options, record } from "../../test/consultationFixtures";
import { DENGUE } from "../../test/surveillanceFixtures";
import { SUGGESTION_PENDING_NOTE } from "./NotificationSuggestions";

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

describe("ConsultationEditor — prioridade do exame (módulo 21a)", () => {
  const withExam = consultation({ exam_requests: [ { sigtap_code: "0202020380", label: "Hemograma completo" } ] });
  const mount = (examPriority?: boolean) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ConsultationEditor consultation={withExam} record={record()} options={options()} unit={unit} units={units}
      examPriority={examPriority} autosaveDelayMs={0} searchDelayMs={0} onFinalized={vi.fn()} onLocked={vi.fn()} /></QueryClientProvider>);
  };

  it("com examPriority: o exame tem o seletor de prioridade; sem: não", () => {
    mount(true);
    expect(screen.getByLabelText("Prioridade (0202020380)")).not.toBeNull();
    cleanup();
    mount();
    expect(screen.queryByLabelText("Prioridade (0202020380)")).toBeNull();
  });
});

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
      .toBe("avalie ao menos um problema em CIAP-2 — a ficha de quem não é médico não leva CID-10");
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

describe("ConsultationEditor — à vista (AT-07)", () => {
  it("abre rolando até o editor, com o foco no título", () => {
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    renderEditor();
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Consulta — rascunho" }));
  });
});


describe("ConsultationEditor — notificação (módulo 25)", () => {
  // Módulo 25 (ADR 0043): a notificação nunca bloqueia a finalização — a peça fica fora de `missing`.
  beforeEach(() => {
    for (const fn of [ api.saveConsultationDraft, api.finalizeConsultation, api.getNotificationSuggestions, api.createConsultationNotification ]) mocked(fn).mockReset();
    mocked(api.saveConsultationDraft).mockImplementation(async () => consultation());
    mocked(api.finalizeConsultation).mockResolvedValue(finalized());
    mocked(api.listSurveillanceDiseases).mockResolvedValue([]);
  });
  const mount = (over: { notifications?: boolean; consultation?: ReturnType<typeof consultation>; delay?: number } = {}) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConsultationEditor consultation={over.consultation ?? consultation()} record={record()} options={options()} unit={unit} units={units}
        notifications={over.notifications ?? true} autosaveDelayMs={over.delay ?? 0} searchDelayMs={0} onFinalized={vi.fn()} onLocked={vi.fn()} />
    </QueryClientProvider>);
  const pending = () => mocked(api.getNotificationSuggestions).mockResolvedValue([ { disease: DENGUE, matched_code: "A90" } ]);
  const addedDengue = () => consultation({ evaluated_problems: [ { problem_id: null, terminology: "cid10", code: "A90", label: "Dengue", action: "add" } ] });

  // A leitura das sugestões termina ANTES de finalizar: o botão é conferido com a peça já resolvida.
  const NOTICE = "CID de notificação obrigatória (A90): notificar suspeita de Dengue";
  it.each([
    [ "pendente", pending, () => screen.findByText(NOTICE), true ],
    [ "leitura que falha", () => mocked(api.getNotificationSuggestions).mockRejectedValue(new ApiError(500, {}, "x")), () => screen.findByRole("alert"), false ],
    [ "leitura sem rede", () => mocked(api.getNotificationSuggestions).mockRejectedValue(new TypeError("Failed to fetch")), () => screen.findByRole("alert"), false ]
  ])("sugestão %s: a finalização segue igual", async (_, arrange, settle, hasNote) => {
    arrange();
    mount();
    fillMinimum();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    const box = screen.getByRole("region", { name: "Finalizar consulta" });
    if (hasNote) expect(await within(box).findByText(SUGGESTION_PENDING_NOTE)).not.toBeNull();
    else expect(within(box).queryByText(SUGGESTION_PENDING_NOTE)).toBeNull();
    const confirm = within(box).getByRole("button", { name: "Confirmar finalização" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(within(box).queryByRole("list", { name: "o que falta para finalizar" })).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocked(api.finalizeConsultation)).toHaveBeenCalledTimes(1));
  });

  it("finalizando com sugestão pendente: o aviso aparece DENTRO da caixa de finalizar, ao lado do botão", async () => {
    pending();
    mount();
    fillMinimum();
    await screen.findByText("CID de notificação obrigatória (A90): notificar suspeita de Dengue");
    expect(screen.queryByText(SUGGESTION_PENDING_NOTE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    const box = screen.getByRole("region", { name: "Finalizar consulta" });
    expect(await within(box).findByText(SUGGESTION_PENDING_NOTE)).not.toBeNull();
    expect(screen.getAllByText(SUGGESTION_PENDING_NOTE)).toHaveLength(1);
    // O botão da peça continua à mão e a caixa continua finalizando.
    expect(screen.getByRole("button", { name: "Notificar suspeita de Dengue" })).not.toBeNull();
    expect((within(box).getByRole("button", { name: "Confirmar finalização" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("finalizando com a leitura falha: sem o aviso de pendência", async () => {
    mocked(api.getNotificationSuggestions).mockRejectedValue(new ApiError(500, {}, "x"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(SUGGESTION_PENDING_NOTE)).toBeNull();
  });

  it("a falha da leitura aparece só na peça, não na caixa de finalizar", async () => {
    mocked(api.getNotificationSuggestions).mockRejectedValue(new ApiError(500, {}, "x"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar consulta" }));
    const alert = await screen.findByRole("alert");
    expect(within(screen.getByRole("region", { name: "Finalizar consulta" })).queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Notificação de doença ou agravo" })).getByRole("alert")).toBe(alert);
  });

  it("sem a prop: nem a peça nem a leitura", () => {
    pending();
    mount({ notifications: false });
    expect(screen.queryByRole("region", { name: "Notificação de doença ou agravo" })).toBeNull();
    expect(mocked(api.getNotificationSuggestions)).not.toHaveBeenCalled();
  });

  it("a peça vem depois dos exames", async () => {
    pending();
    mount();
    await screen.findByRole("region", { name: "Notificação de doença ou agravo" });
    const exams = screen.getByText("Exames solicitados");
    const piece = screen.getByRole("region", { name: "Notificação de doença ou agravo" });
    const finalize = screen.getByRole("button", { name: "Finalizar consulta" });
    expect(exams.compareDocumentPosition(piece) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(piece.compareDocumentPosition(finalize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("escrever no rascunho não relê as sugestões; remover o CID só relê depois que o salvamento assenta", async () => {
    pending();
    let settle: (c: ReturnType<typeof consultation>) => void = () => {};
    mocked(api.saveConsultationDraft).mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    mount({ consultation: addedDengue() });
    await screen.findByRole("button", { name: "Notificar suspeita de Dengue" });
    expect(mocked(api.getNotificationSuggestions)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Remover A90" }));
    await waitFor(() => expect(mocked(api.saveConsultationDraft)).toHaveBeenCalledTimes(1));
    // Salvando: a chave que o api lê ainda é a do rascunho antigo.
    expect(mocked(api.getNotificationSuggestions)).toHaveBeenCalledTimes(1);
    mocked(api.getNotificationSuggestions).mockResolvedValue([]);
    settle(consultation());
    await waitFor(() => expect(mocked(api.getNotificationSuggestions)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Notificar suspeita de Dengue" })).toBeNull());
  });

  it("texto que não mexe nos problemas não relê as sugestões", async () => {
    pending();
    mount({ consultation: addedDengue() });
    await screen.findByRole("button", { name: "Notificar suspeita de Dengue" });
    text("Plano (P)", "Hidratação e retorno.");
    await waitFor(() => expect(mocked(api.saveConsultationDraft)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/^salvo às/)).not.toBeNull());
    expect(mocked(api.getNotificationSuggestions)).toHaveBeenCalledTimes(1);
  });
});
