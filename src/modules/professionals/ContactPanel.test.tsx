import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getProfessionalContact: vi.fn(), saveProfessionalContact: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ContactPanel } from "./ContactPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { contact, controlledUser } from "../../test/controlledFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const FORM = { name: "Endereço e telefone do prescritor" };
const LINE = "Rua Ouvidor Pardinho, 28 · Rebouças · Curitiba/PR · 80230-040";

function fillForm(phone = "(41) 3350-1234") {
  const form = screen.getByRole("form", FORM);
  const w = within(form);
  fireEvent.change(w.getByLabelText("Logradouro"), { target: { value: "Rua Ouvidor Pardinho" } });
  fireEvent.change(w.getByLabelText("Número"), { target: { value: "28" } });
  fireEvent.change(w.getByLabelText("Bairro"), { target: { value: "Rebouças" } });
  fireEvent.change(w.getByLabelText("Cidade"), { target: { value: "Curitiba" } });
  fireEvent.change(w.getByLabelText("UF"), { target: { value: "PR" } });
  fireEvent.change(w.getByLabelText("CEP"), { target: { value: "80230040" } });
  fireEvent.change(w.getByLabelText("Telefone"), { target: { value: phone } });
  return form;
}

afterEach(cleanup);

describe("ContactPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
  });

  it("sem endereço: diz que a receita de controle especial não sai e cadastra com PUT só com dígitos", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue({ address: null, phone: null });
    mocked(api.saveProfessionalContact).mockResolvedValue(contact());
    const { client } = renderWithProviders(<ContactPanel />);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    expect((await screen.findByRole("note")).textContent)
      .toBe("sem endereço e telefone, a receita de controle especial não sai — cadastre aqui");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar endereço e telefone" }));
    const form = fillForm();
    expect((within(form).getByLabelText("CEP") as HTMLInputElement).value).toBe("80230-040");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(api.saveProfessionalContact).toHaveBeenCalledWith({
      address: { street: "Rua Ouvidor Pardinho", number: "28", district: "Rebouças", city: "Curitiba", uf: "PR", zip: "80230040" },
      phone: "4133501234"
    }));
    expect((await screen.findByRole("status")).textContent).toBe("Endereço e telefone salvos.");
    expect(screen.getByText(LINE)).not.toBeNull();
    expect(screen.getByText("(41) 3350-1234")).not.toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    // O telefone é o mesmo professionals.phone de "Nome e contato".
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "myProfessional", "us1" ] });
  });

  it("GET {address:null, phone}: formulário vazio, com o telefone já preenchido", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue({ address: null, phone: "4133501234" });
    renderWithProviders(<ContactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar endereço e telefone" }));
    const form = screen.getByRole("form", FORM);
    expect((within(form).getByLabelText("Logradouro") as HTMLInputElement).value).toBe("");
    expect((within(form).getByLabelText("Telefone") as HTMLInputElement).value).toBe("(41) 3350-1234");
  });

  it("CEP incompleto ou telefone sem DDD: diz na tela e não manda", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue({ address: null, phone: null });
    renderWithProviders(<ContactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar endereço e telefone" }));
    const form = fillForm("3350-1234");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("telefone: DDD e número, 10 ou 11 dígitos");
    fireEvent.change(within(form).getByLabelText("CEP"), { target: { value: "8023" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
    expect(within(form).getByRole("alert").textContent).toBe("endereço: o CEP precisa ter 8 dígitos");
    fireEvent.change(within(form).getByLabelText("CEP"), { target: { value: "80230040" } });
    fireEvent.change(within(form).getByLabelText("Número"), { target: { value: "12345678901" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
    expect(within(form).getByRole("alert").textContent).toBe("endereço: o número tem até 10 caracteres");
    expect(api.saveProfessionalContact).not.toHaveBeenCalled();
  });

  it("recusa do api (invalid_address com field) aparece no formulário, que fica preenchido", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue({ address: null, phone: null });
    mocked(api.saveProfessionalContact).mockRejectedValue(new ApiError(422, { error: "invalid_address", field: "zip" }, "422"));
    renderWithProviders(<ContactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar endereço e telefone" }));
    const form = fillForm();
    fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("endereço inválido: confira o CEP");
    expect((within(form).getByLabelText("Logradouro") as HTMLInputElement).value).toBe("Rua Ouvidor Pardinho");
  });

  it("dois cliques em Salvar mandam um PUT só, e o botão fica desligado em voo", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue({ address: null, phone: null });
    let finish: (c: ReturnType<typeof contact>) => void = () => {};
    mocked(api.saveProfessionalContact).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderWithProviders(<ContactPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar endereço e telefone" }));
    const form = fillForm();
    const save = within(form).getByRole("button", { name: "Salvar" });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    expect(api.saveProfessionalContact).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    expect((within(form).getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    finish(contact());
    expect((await screen.findByRole("status")).textContent).toBe("Endereço e telefone salvos.");
    expect(api.saveProfessionalContact).toHaveBeenCalledTimes(1);
  });

  it("com cadastro: mostra e altera a partir do que existe", async () => {
    mocked(api.getProfessionalContact).mockResolvedValue(contact());
    renderWithProviders(<ContactPanel />);
    expect(await screen.findByText(LINE)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Alterar endereço e telefone" }));
    const form = screen.getByRole("form", FORM);
    expect((within(form).getByLabelText("Bairro") as HTMLInputElement).value).toBe("Rebouças");
    expect((within(form).getByLabelText("Telefone") as HTMLInputElement).value).toBe("(41) 3350-1234");
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", FORM)).toBeNull();
  });

  it("sem perfil de profissional (404): diz que o cadastro falta", async () => {
    mocked(api.getProfessionalContact).mockRejectedValue(new ApiError(404, { error: "not_found" }, "404"));
    renderWithProviders(<ContactPanel />);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("seu cadastro de profissional ainda não foi feito — fale com a administração da cidade");
    expect(screen.queryByRole("button", { name: "Cadastrar endereço e telefone" })).toBeNull();
  });

  it("prontuário desligado no meio do caminho: diz (o contato é barrado por clinical_record)", async () => {
    mocked(api.getProfessionalContact).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "clinical_record" }, "403"));
    renderWithProviders(<ContactPanel />);
    expect((await screen.findByRole("alert")).textContent).toBe("o prontuário está desligado nesta cidade");
  });
});
