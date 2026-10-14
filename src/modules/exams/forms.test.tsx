// src/modules/exams/forms.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, uploadExamFile: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ResultForm } from "./ResultForm";
import { ScheduleForm } from "./ScheduleForm";
import { ReasonForm } from "./ReasonForm";
import { HEMOGRAM_FIELDS, TODAY21, pdfFile } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("ResultForm", () => {
  beforeEach(() => { mocked(api.uploadExamFile).mockReset(); mocked(api.uploadExamFile).mockResolvedValue("up1"); });

  it("exige o laudo; manda data, laboratório, valores preenchidos e crítico", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ResultForm fields={HEMOGRAM_FIELDS} today={TODAY21} submitLabel="Registrar resultado" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Registrar resultado" });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("anexe o laudo");

    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"), { target: { files: [ pdfFile() ] } });
    await within(form).findByText("anexado: laudo.pdf");
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Laboratório Simulado" } });
    fireEvent.change(within(form).getByLabelText("Hemoglobina (g/dL)"), { target: { value: "6.9" } });
    fireEvent.click(within(form).getByLabelText("Resultado crítico (vai direto para a fila da equipe)"));
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      upload_id: "up1", released_on: TODAY21, laboratory_name: "Laboratório Simulado", critical: true,
      values: [ { key: "hemoglobina", value: "6.9" } ]
    }));
  });

  it("data de liberação no futuro não envia", async () => {
    const onSubmit = vi.fn();
    render(<ResultForm fields={[]} today={TODAY21} submitLabel="Registrar resultado" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Registrar resultado" });
    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"), { target: { files: [ pdfFile() ] } });
    await within(form).findByText("anexado: laudo.pdf");
    fireEvent.change(within(form).getByLabelText("Data de liberação"), { target: { value: "2026-10-14" } });
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Lab" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("a data de liberação não pode ser no futuro");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(form).getByText("este exame não tem campos no catálogo — o laudo basta")).not.toBeNull();
  });

  it("resultado externo: sem a marca de crítico; a recusa do api aparece no formulário", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, { error: "result_already_registered" }, "x"));
    render(<ResultForm fields={[]} today={TODAY21} submitLabel="Registrar resultado externo" allowCritical={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Registrar resultado externo" });
    expect(within(form).queryByLabelText("Resultado crítico (vai direto para a fila da equipe)")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"), { target: { files: [ pdfFile() ] } });
    await within(form).findByText("anexado: laudo.pdf");
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Lab Externo" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado externo" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o resultado deste exame já foi registrado");
  });
});

describe("ScheduleForm", () => {
  it("com lista: exige o prestador; manda o rascunho", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleForm providers={[ { id: "pv1", name: "Laboratório Simulado" } ]} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Agendar exame" });
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-20T08:30" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Rua XV, 100" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("escolha o prestador");
    fireEvent.change(within(form).getByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ providerId: "pv1", at: "2026-10-20T08:30", place: "Rua XV, 100" }));
  });

  it("remarcar: botão e lista funcionam igual com prestador trocável", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(422, { error: "provider_not_enabled_for_exam" }, "x"));
    render(<ScheduleForm providers={[ { id: "pv2", name: "Outro Lab" } ]} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Agendar exame" });
    fireEvent.change(within(form).getByLabelText("Prestador"), { target: { value: "pv2" } });
    fireEvent.change(within(form).getByLabelText("Data e hora"), { target: { value: "2026-10-21T09:00" } });
    fireEvent.change(within(form).getByLabelText("Local"), { target: { value: "Rua A" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar agendamento" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("este prestador não faz este exame — escolha outro ou habilite-o no cadastro");
  });

  it("prestador já definido: sem seletor; lista vazia explica o que fazer", () => {
    render(<ScheduleForm providers={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Prestador")).toBeNull();
    cleanup();
    render(<ScheduleForm providers={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("nenhum prestador ativo faz este exame — cadastre em Catálogo e prestadores");
  });
});

describe("ReasonForm", () => {
  it("motivo acima de 500 caracteres não envia", async () => {
    const onSubmit = vi.fn();
    render(<ReasonForm label="Motivo" submitLabel="Negar" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Motivo" });
    expect((within(form).getByLabelText("Motivo") as HTMLTextAreaElement).maxLength).toBe(500);
    fireEvent.change(within(form).getByLabelText("Motivo"), { target: { value: "a".repeat(501) } });
    fireEvent.click(within(form).getByRole("button", { name: "Negar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("o motivo passa de 500 caracteres");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("motivo curto não envia; o motivo vai sem espaços nas pontas", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReasonForm label="Motivo do cancelamento" submitLabel="Cancelar exame" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Motivo do cancelamento" });
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar exame" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("escreva o motivo (ao menos 5 caracteres)");
    fireEvent.change(within(form).getByLabelText("Motivo do cancelamento"), { target: { value: "  pedido em duplicidade " } });
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar exame" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("pedido em duplicidade"));
    expect(within(form).getByRole("button", { name: "Voltar" })).not.toBeNull();
  });
});
