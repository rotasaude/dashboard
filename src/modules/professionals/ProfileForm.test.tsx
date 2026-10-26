import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProfileForm } from "./ProfileForm";
import { councilText } from "../../lib/professionals";

afterEach(cleanup);
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ProfileForm — sem conselho (módulo 24a, F-24.2)", () => {
  it("ACS: sem conselho esconde UF e número e manda nulos; CNS continua obrigatório", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm submitLabel="Criar perfil" onSubmit={onSubmit} />);
    typeIn("Nome profissional", "Ana Prado");
    fireEvent.change(screen.getByLabelText("Conselho"), { target: { value: "none" } });
    expect(screen.queryByLabelText("UF do conselho")).toBeNull();
    expect(screen.queryByLabelText("Número do registro")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Criar perfil" }));
    expect(screen.getByRole("alert").textContent).toBe("CNS inválido: confira os 15 dígitos");
    typeIn("CNS", "700000000000005");
    fireEvent.click(screen.getByRole("button", { name: "Criar perfil" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      professional_name: "Ana Prado", council: null, council_state: null, registration_number: null, cns: "700000000000005" })));
  });

  it("perfil sem conselho abre com a opção marcada; texto do conselho", () => {
    render(<ProfileForm submitLabel="Salvar" initial={{ id: "p1", council: null, council_state: null, registration_number: null }} onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Conselho") as HTMLSelectElement).value).toBe("none");
    expect(councilText({ council: null, council_state: null, registration_number: null })).toBe("sem conselho (ACS ou agente de endemias)");
    expect(councilText({ council: "COREN", council_state: "PR", registration_number: "123456" })).toBe("COREN-PR 123456");
  });

  it("perfil com conselho segue mostrando UF e número; voltar de 'sem conselho' manda os três campos", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm submitLabel="Salvar" initial={{ id: "p1", professional_name: "Dra. Helena", council: "CRM", council_state: "PR", registration_number: "45678" }} onSubmit={onSubmit} />);
    expect((screen.getByLabelText("Conselho") as HTMLSelectElement).value).toBe("CRM");
    expect(screen.getByLabelText("UF do conselho")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Conselho"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Conselho"), { target: { value: "CRM" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      council: "CRM", council_state: "PR", registration_number: "45678" })));
  });
});
