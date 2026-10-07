// src/modules/attendance/ScreeningForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchCiap2: vi.fn(), suggestScreening: vi.fn(), completeScreening: vi.fn(), reassessScreening: vi.fn(),
    abandonScreening: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type ScreeningSuggestion } from "../../lib/api";
import { ScreeningForm, type ScreeningFormProps } from "./ScreeningForm";
import { revision, screening, suggestion } from "../../test/screeningFixtures";
import { TYPES } from "../../test/schedulingFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const other = { id: "u2", name: "UPA Norte", kind: "upa" };

function renderForm(over: Partial<ScreeningFormProps> = {}) {
  const props: ScreeningFormProps = {
    mode: "complete", screening: screening(), citizenLabel: "***.982.247-**", unit, units: [ unit, other ], types: TYPES,
    suggestDelayMs: 0, onDone: vi.fn(), onClosed: vi.fn(), onCancel: vi.fn(), ...over
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<ScreeningForm {...props} />, { wrapper });
  return props;
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const conclude = () => screen.getByRole("button", { name: "Concluir escuta" }) as HTMLButtonElement;

async function pickK86() {
  type("Queixa (CIAP-2)", "hipertensão");
  fireEvent.click(await screen.findByRole("button", { name: "K86 — Hipertensão sem complicações" }));
}
async function fillRedSameDay() {
  await pickK86();
  type("Pressão sistólica (mmHg)", "185");
  type("Pressão diastólica (mmHg)", "110");
  await screen.findByText("Pressão sistólica: acima da faixa de alerta");
  type("Destino", "same_day");
}

describe("ScreeningForm — concluir", () => {
  beforeEach(() => {
    for (const fn of [ api.searchCiap2, api.suggestScreening, api.completeScreening, api.reassessScreening, api.abandonScreening ]) {
      mocked(fn).mockReset();
    }
    mocked(api.searchCiap2).mockResolvedValue([ { code: "K86", label: "Hipertensão sem complicações" } ]);
    mocked(api.suggestScreening).mockResolvedValue(suggestion());
    mocked(api.completeScreening).mockResolvedValue(screening({ status: "completed", destination: "same_day" }));
  });

  it("queixa e pressão pedem a sugestão; a cor sugerida vira a final e conclui no dia", async () => {
    const props = renderForm();
    expect(conclude().disabled).toBe(true);
    await fillRedSameDay();
    expect(api.suggestScreening).toHaveBeenLastCalledWith({ ciap2_code: "K86", vitals: { systolic: 185, diastolic: 110 }, attendance_id: "a1" });
    expect((screen.getByRole("radio", { name: /vermelho/ }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(conclude().disabled).toBe(false));
    fireEvent.click(conclude());
    await waitFor(() => expect(api.completeScreening).toHaveBeenCalledWith("sc1", {
      ciap2_code: "K86", vitals: { systolic: 185, diastolic: 110 }, final_color: "red", destination: "same_day"
    }));
    expect(props.onDone).toHaveBeenCalled();
  });

  it("mudar a cor pede justificativa, que vai no corpo", async () => {
    renderForm();
    await fillRedSameDay();
    fireEvent.click(screen.getByRole("radio", { name: /amarelo/ }));
    expect(conclude().disabled).toBe(true);
    const reason = screen.getByLabelText("Justificativa da mudança de cor");
    expectFrozenNotice(reason);
    fireEvent.change(reason, { target: { value: "PA confirmada em repouso 150/95" } });
    await waitFor(() => expect(conclude().disabled).toBe(false));
    fireEvent.click(conclude());
    await waitFor(() => expect(api.completeScreening).toHaveBeenCalledWith("sc1", expect.objectContaining({
      final_color: "yellow", color_change_reason: "PA confirmada em repouso 150/95"
    })));
  });

  it("agendar: prazo padrão pela cor final, e vermelho começa sem prazo", async () => {
    renderForm();
    await fillRedSameDay();
    type("Destino", "schedule");
    expect((screen.getByLabelText("Prazo (dias)") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("radio", { name: /verde/ }));
    expect((screen.getByLabelText("Prazo (dias)") as HTMLInputElement).value).toBe("15");
    type("Justificativa da mudança de cor", "sem sinal de gravidade agora");
    type("Tipo de atendimento", "consulta_medica");
    await waitFor(() => expect(conclude().disabled).toBe(false));
    fireEvent.click(conclude());
    await waitFor(() => expect(api.completeScreening).toHaveBeenCalledWith("sc1", expect.objectContaining({
      destination: "schedule", schedule: { appointment_type_key: "consulta_medica", priority: "routine", due_in_days: 15 }
    })));
  });

  it("orientação exige o texto, com o aviso de texto congelado", async () => {
    renderForm();
    await fillRedSameDay();
    type("Destino", "oriented");
    expect(conclude().disabled).toBe(true);
    expect(screen.getByText("escreva a orientação dada")).not.toBeNull();
    expectFrozenNotice(screen.getByLabelText("Orientação dada"));
    type("Orientação dada", "hidratação e retorno se piorar");
    await waitFor(() => expect(conclude().disabled).toBe(false));
  });

  it("resposta velha da sugestão é descartada", async () => {
    let releaseOld: (s: ScreeningSuggestion) => void = () => {};
    mocked(api.suggestScreening)
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockResolvedValueOnce(suggestion({ suggested_color: "yellow", matched_rules: [ { index: 1, text: "temperatura a partir de 39 °C" } ], alerts: [] }));
    renderForm();
    await pickK86();
    await waitFor(() => expect(api.suggestScreening).toHaveBeenCalledTimes(1));
    type("Temperatura (°C)", "39,2");
    expect(await screen.findByText("temperatura a partir de 39 °C")).not.toBeNull();
    releaseOld(suggestion());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole("status").textContent).toContain("amarelo");
    expect(screen.queryByText("pressão sistólica a partir de 180 mmHg")).toBeNull();
  });

  it("422 color_change_reason_required mostra a justificativa e pede nova sugestão", async () => {
    mocked(api.completeScreening).mockRejectedValueOnce(new ApiError(422, { error: "color_change_reason_required" }, "x"));
    renderForm();
    await fillRedSameDay();
    const calls = mocked(api.suggestScreening).mock.calls.length;
    await waitFor(() => expect(conclude().disabled).toBe(false));
    fireEvent.click(conclude());
    expect(await screen.findByLabelText("Justificativa da mudança de cor")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("explique por que a cor final é diferente da sugerida");
    await waitFor(() => expect(mocked(api.suggestScreening).mock.calls.length).toBeGreaterThan(calls));
  });

  it("atendimento que saiu da espera fecha o formulário com a frase", async () => {
    mocked(api.completeScreening).mockRejectedValueOnce(new ApiError(409, { error: "attendance_not_waiting" }, "x"));
    const props = renderForm();
    await fillRedSameDay();
    await waitFor(() => expect(conclude().disabled).toBe(false));
    fireEvent.click(conclude());
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledWith("o atendimento não está mais aguardando — a escuta não foi concluída"));
  });

  it("justificativa com mais de 500 caracteres bloqueia, sem chamar o api", async () => {
    renderForm();
    await fillRedSameDay();
    fireEvent.click(screen.getByRole("radio", { name: /amarelo/ }));
    type("Justificativa da mudança de cor", "x".repeat(501));
    expect(conclude().disabled).toBe(true);
    expect(screen.getByText("a justificativa passa de 500 caracteres")).not.toBeNull();
    fireEvent.click(conclude());
    expect(api.completeScreening).not.toHaveBeenCalled();
    expect(api.reassessScreening).not.toHaveBeenCalled();
  });

  it("422 note_too_long da justificativa mostra a frase e mantém o formulário", async () => {
    mocked(api.completeScreening).mockRejectedValueOnce(new ApiError(422, { error: "note_too_long", field: "color_change_reason" }, "x"));
    const props = renderForm();
    await fillRedSameDay();
    fireEvent.click(screen.getByRole("radio", { name: /amarelo/ }));
    type("Justificativa da mudança de cor", "PA confirmada em repouso 150/95");
    await waitFor(() => expect(conclude().disabled).toBe(false));
    fireEvent.click(conclude());
    expect((await screen.findByRole("alert")).textContent).toBe("A justificativa passa de 500 caracteres.");
    expect(props.onClosed).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Justificativa da mudança de cor") as HTMLTextAreaElement).value).toBe("PA confirmada em repouso 150/95");
  });

  it("abandonar devolve o atendimento à fila do acolhimento", async () => {
    mocked(api.abandonScreening).mockResolvedValue(screening({ status: "abandoned" }));
    const props = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Abandonar escuta" }));
    await waitFor(() => expect(api.abandonScreening).toHaveBeenCalledWith("sc1"));
    expect(props.onClosed).toHaveBeenCalledWith("Escuta abandonada: o atendimento voltou para a fila do acolhimento.");
  });
});

describe("ScreeningForm — reavaliar", () => {
  beforeEach(() => {
    for (const fn of [ api.searchCiap2, api.suggestScreening, api.completeScreening, api.reassessScreening, api.abandonScreening ]) {
      mocked(fn).mockReset();
    }
    mocked(api.suggestScreening).mockResolvedValue(suggestion({ suggested_color: "yellow", alerts: [] }));
    mocked(api.reassessScreening).mockResolvedValue(screening({ status: "completed", destination: "same_day", revisions_count: 2 }));
  });
  const completed = () => screening({ status: "completed", destination: "same_day", current_revision: revision(), revisions_count: 1 });

  it("começa da revisão corrente, sem destino, e salva só a revisão", async () => {
    const props = renderForm({ mode: "reassess", screening: completed() });
    expect(screen.getByText("Hipertensão sem complicações")).not.toBeNull();
    expect((screen.getByLabelText("Pressão sistólica (mmHg)") as HTMLInputElement).value).toBe("185");
    expect(screen.queryByLabelText("Destino")).toBeNull();
    type("Pressão sistólica (mmHg)", "160");
    type("Pressão diastólica (mmHg)", "100");
    const save = screen.getByRole("button", { name: "Salvar reavaliação" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(api.reassessScreening).toHaveBeenCalledWith("sc1", {
      ciap2_code: "K86", complaint_note: "cefaleia desde ontem",
      vitals: { systolic: 160, diastolic: 100, heart_rate: 88, weight_kg: 80, height_cm: 170 }, final_color: "yellow"
    }));
    expect(props.onDone).toHaveBeenCalled();
  });

  it("not_reassessable fecha e avisa", async () => {
    mocked(api.reassessScreening).mockRejectedValueOnce(new ApiError(409, { error: "not_reassessable" }, "x"));
    const props = renderForm({ mode: "reassess", screening: completed() });
    const save = screen.getByRole("button", { name: "Salvar reavaliação" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledWith("esta escuta não pode mais ser reavaliada — a fila foi atualizada"));
  });
});
