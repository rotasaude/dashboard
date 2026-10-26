// src/modules/attendance/DemographicsForm.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../../lib/api";
import { ADDRESS_FROM_HOUSEHOLD, DEMOGRAPHICS_INCENTIVE } from "../../lib/demographics";
import { DemographicsForm } from "./DemographicsForm";

afterEach(cleanup);

function open(save = vi.fn().mockResolvedValue(undefined), onSaved = vi.fn()) {
  render(<DemographicsForm title="Completar dados do paciente" missing={[ "race_color", "address" ]} save={save} onSaved={onSaved} />);
  return { form: screen.getByRole("region", { name: "Completar dados do paciente" }), save, onSaved };
}

describe("DemographicsForm", () => {
  it("incentiva com o que falta; etnia só para indígena", () => {
    const { form } = open();
    expect(within(form).getByRole("note").textContent).toBe(`Falta: raça/cor; CEP e endereço. ${DEMOGRAPHICS_INCENTIVE}`);
    expect(within(form).queryByLabelText("Etnia (código)")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "05" } });
    expect(within(form).getByLabelText("Etnia (código)")).not.toBeNull();
    expect(within(form).queryByRole("option", { name: /sem informação/i })).toBeNull();
  });

  it("vazio não salva; salva só o preenchido e avisa", async () => {
    const { form, save, onSaved } = open();
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    expect(within(form).getByRole("alert").textContent).toBe("preencha a raça/cor ou o endereço");
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ race_color: "03", ethnicity: "" }));
    expect((await within(form).findByRole("status")).textContent).toBe("Dados do paciente salvos.");
    expect(onSaved).toHaveBeenCalled();
  });

  it("logradouro longo é recusado antes do envio; 422 do api vira frase e o que foi digitado fica", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(422, { error: "invalid_zip" }, "x"));
    const { form } = open(save);
    fireEvent.change(within(form).getByLabelText("CEP"), { target: { value: "80010-000" } });
    fireEvent.change(within(form).getByLabelText("Logradouro"), { target: { value: "x".repeat(31) } });
    fireEvent.change(within(form).getByLabelText("Bairro"), { target: { value: "CENTRO" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    expect(within(form).getByRole("alert").textContent).toBe("logradouro com até 30 caracteres (largura do arquivo BPA) — abrevie");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Logradouro"), { target: { value: "RUA XV DE NOVEMBRO" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("CEP inválido — confira os 8 dígitos");
    expect((within(form).getByLabelText("Logradouro") as HTMLInputElement).value).toBe("RUA XV DE NOVEMBRO");
  });

  it("duplo clique síncrono salva uma vez só", async () => {
    const save = vi.fn().mockReturnValue(new Promise(() => {}));
    const { form } = open(save);
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "03" } });
    const button = within(form).getByRole("button", { name: "Salvar dados do paciente" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("DemographicsForm — endereço do cadastro domiciliar (módulo 24a)", () => {
  it("com cadastro ativo: sem campos de endereço, com a nota; salva só a raça/cor", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<DemographicsForm title="Completar dados" missing={[ "race_color" ]} addressLocked save={save} />);
    expect(screen.queryByLabelText("CEP")).toBeNull();
    expect(screen.queryByLabelText("Logradouro")).toBeNull();
    expect(screen.getByText(ADDRESS_FROM_HOUSEHOLD)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados do paciente" }));
    // Etnia vazia fora de 05 é o comportamento do 22 (o api apaga a gravada); endereço nunca vai.
    await waitFor(() => expect(save).toHaveBeenCalledWith({ race_color: "03", ethnicity: "" }));
  });

  it("com cadastro ativo e nada escolhido: pede só a raça/cor", () => {
    const save = vi.fn();
    render(<DemographicsForm title="Completar dados" addressLocked save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados do paciente" }));
    expect(screen.getByRole("alert").textContent).toBe("preencha a raça/cor");
    expect(save).not.toHaveBeenCalled();
  });

  it("sem cadastro: continua como hoje (campos de endereço)", () => {
    render(<DemographicsForm title="Completar dados" save={vi.fn()} />);
    expect(screen.getByLabelText("CEP")).not.toBeNull();
    expect(screen.queryByText(ADDRESS_FROM_HOUSEHOLD)).toBeNull();
  });

  it("422 address_from_household vira a frase do cadastro domiciliar", async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(422, { error: "address_from_household", field: "address_zip" }, "422"));
    render(<DemographicsForm title="Completar dados" save={save} />);
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "81020000" } });
    fireEvent.change(screen.getByLabelText("Logradouro"), { target: { value: "Rua das Flores" } });
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "Vila Verde" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados do paciente" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ADDRESS_FROM_HOUSEHOLD);
    // Reserva do L26: o endereço trava (sem campos, com a nota) e a próxima tentativa não o manda.
    expect(screen.queryByLabelText("CEP")).toBeNull();
    expect(screen.getAllByText(ADDRESS_FROM_HOUSEHOLD).length).toBe(2);
    save.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados do paciente" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ race_color: "03", ethnicity: "" }));
  });
});
