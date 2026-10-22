// src/modules/attendance/DemographicsForm.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../../lib/api";
import { DEMOGRAPHICS_INCENTIVE } from "../../lib/demographics";
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
    await waitFor(() => expect(save).toHaveBeenCalledWith({ race_color: "03" }));
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
});
