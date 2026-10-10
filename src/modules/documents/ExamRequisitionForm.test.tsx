import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../lib/api";
import { ExamRequisitionForm } from "./ExamRequisitionForm";

afterEach(cleanup);

describe("ExamRequisitionForm", () => {
  it("manda a observação; sem exames na consulta a frase diz o que fazer", async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new ApiError(422, { error: "no_exam_requests" }, "422"))
      .mockResolvedValueOnce(undefined);
    render(<ExamRequisitionForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByText(/exames pedidos na consulta FINALIZADA \(e nos adendos\)/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Emitir requisição" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("esta consulta não tem exames pedidos — finalize a consulta com os exames pedidos (ou inclua-os num adendo) antes de emitir a requisição");
    expect(onSubmit).toHaveBeenLastCalledWith({});
    fireEvent.change(screen.getByLabelText("Observação (opcional)"), { target: { value: "jejum de 8 h" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir requisição" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith({ note: "jejum de 8 h" }));
  });

  it("a observação é limitada a 500 caracteres", () => {
    render(<ExamRequisitionForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("Observação (opcional)") as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it("em voo: botões travados e o segundo envio síncrono é ignorado", async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ExamRequisitionForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Requisição de exames" });
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Emitir requisição" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: "Emitir requisição" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prop busy do contêiner trava os botões e o envio", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<ExamRequisitionForm busy onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Emitir requisição" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.submit(screen.getByRole("form", { name: "Requisição de exames" })); });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
