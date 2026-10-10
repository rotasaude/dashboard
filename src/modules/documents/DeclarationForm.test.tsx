import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyDeclaration } from "../../lib/clinicalDocuments";
import { DeclarationForm } from "./DeclarationForm";
import { TODAY19C } from "../../test/documentFixtures";

afterEach(cleanup);

describe("DeclarationForm", () => {
  it("período: manda o dia e o período", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<DeclarationForm initial={emptyDeclaration(TODAY19C)} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o período");
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "morning" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ period: "morning" }));
    expect(screen.queryByLabelText("Sua matrícula (sai no papel)")).toBeNull();
  });

  it("horário: chegada obrigatória, saída não antes da chegada, dica sob Saída", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<DeclarationForm initial={emptyDeclaration(TODAY19C, "08:15")} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("Chegada") as HTMLInputElement).value).toBe("08:15");
    expect(screen.getByText("em branco, sai a hora de encerramento do atendimento (se for no mesmo dia)")).not.toBeNull();
    expect(screen.getByLabelText("Saída").getAttribute("aria-describedby")).toBe(screen.getByText(/em branco, sai a hora/).id);
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a saída não pode ser antes da chegada");
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "10:30" } });
    fireEvent.change(screen.getByLabelText("Acompanhante (opcional)"), { target: { value: "Marcos Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      arrived_at: "08:15", left_at: "10:30", companion_name: "Marcos Lima"
    }));
  });

  it("saída em branco: não manda left_at", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<DeclarationForm initial={emptyDeclaration(TODAY19C, "08:15")} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ arrived_at: "08:15" }));
  });

  it("recepção: a matrícula de quem emite vai junto; showIssuerRegistration=false a esconde", async () => {
    const onSubmit = vi.fn(async () => {});
    const { unmount } = render(<DeclarationForm initial={emptyDeclaration(TODAY19C)} showIssuerRegistration onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "full_day" } });
    fireEvent.change(screen.getByLabelText("Sua matrícula (sai no papel)"), { target: { value: "4521" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir declaração" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ period: "full_day", issuer_registration: "4521" }));
    unmount();
    render(<DeclarationForm initial={emptyDeclaration(TODAY19C)} showIssuerRegistration={false} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Sua matrícula (sai no papel)")).toBeNull();
  });

  it("em voo: botões travados e o segundo envio síncrono é ignorado", async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<DeclarationForm initial={emptyDeclaration(TODAY19C)} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "morning" } });
    const form = screen.getByRole("form", { name: "Declaração de comparecimento" });
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Emitir declaração" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: "Emitir declaração" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prop busy do contêiner trava os botões e o envio", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<DeclarationForm initial={emptyDeclaration(TODAY19C)} busy onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "morning" } });
    expect((screen.getByRole("button", { name: "Emitir declaração" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.submit(screen.getByRole("form", { name: "Declaração de comparecimento" })); });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
