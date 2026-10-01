import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, requestErasure: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ErasureRequest } from "./ErasureRequest";

afterEach(cleanup);
const requestErasure = api.requestErasure as unknown as ReturnType<typeof vi.fn>;
const submit = () => screen.getByRole("button", { name: "Registrar pedido" }) as HTMLButtonElement;
const fill = (cpf: string, check = true) => {
  fireEvent.change(screen.getByLabelText("CPF do cidadão (exclusão)"), { target: { value: cpf } });
  if (check) fireEvent.click(screen.getByLabelText("Conferi o documento com foto"));
};

describe("ErasureRequest", () => {
  beforeEach(() => { requestErasure.mockReset(); });

  it("o campo de CPF (de terceiro) não é guardado pelo navegador", () => {
    render(<ErasureRequest />);
    expect(screen.getByLabelText("CPF do cidadão (exclusão)").getAttribute("autocomplete")).toBe("off");
  });

  it("CPF inválido desabilita o botão", () => {
    render(<ErasureRequest />);
    fill("111.111.111-11");
    expect(submit().disabled).toBe(true);
  });

  it("sem conferir o documento o botão fica desabilitado", () => {
    render(<ErasureRequest />);
    fill("529.982.247-25", false);
    expect(submit().disabled).toBe(true);
  });

  it("pending: envia só dígitos e mostra o aviso", async () => {
    requestErasure.mockResolvedValue({ request: { id: "e1", status: "pending", created_at: "2026-10-01T10:00:00Z" } });
    render(<ErasureRequest />);
    fill("529.982.247-25");
    fireEvent.click(submit());
    expect(await screen.findByText("Pedido registrado. Um administrador precisa confirmar.")).not.toBeNull();
    expect(requestErasure).toHaveBeenCalledWith("52998224725", true);
  });

  it("retained: mostra a retenção por base legal", async () => {
    requestErasure.mockResolvedValue({ request: { id: "e1", status: "retained", created_at: "2026-10-01T10:00:00Z" } });
    render(<ErasureRequest />);
    fill("529.982.247-25");
    fireEvent.click(submit());
    expect(await screen.findByText("Cadastro retido por base legal: há registro de atendimento. Nada foi apagado.")).not.toBeNull();
  });

  async function expectError(status: number, code: string, text: string) {
    requestErasure.mockRejectedValue(new ApiError(status, { error: code }, "x"));
    render(<ErasureRequest />);
    fill("529.982.247-25");
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(text));
  }

  it("409 already_pending", () => expectError(409, "already_pending", "Já existe um pedido pendente para este CPF."));
  it("404 citizen_not_found", () => expectError(404, "citizen_not_found", "Nenhum cadastro com este CPF."));
});
