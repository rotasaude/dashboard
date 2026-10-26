// src/modules/territory/ExitForm.test.tsx
// Saída do cadastro (Task 13; preflight A16, C20; errata 10). Definitiva: a
// tela valida (exitProblem), pede confirmação com a frase do efeito e só então
// envia. Óbito exige a data do óbito (a DO, 9 dígitos, é opcional); `on` é o
// dia da saída; nada de `version` no corpo. Dois lugares de erro: regra local
// (frase + foco) e recusa do api (frase; invalid_registration foca o path).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), exitRegistration: vi.fn() };
});

import * as api from "../../lib/api";
import { ExitForm } from "./ExitForm";
import { STALE_TEXT } from "../../lib/territoryRegistry";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY24, registration, territoryUser } from "../../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MOVED_SENTENCE = "A pessoa sai da equipe pelo cadastro; consulta recente e bairro continuam valendo.";
const DEATH_SENTENCE = "A pessoa fica marcada como falecida nas linhas de cuidado e as inscrições são encerradas por óbito.";
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
const body = () => mocked(api.exitRegistration).mock.calls[0];

function open(over: { onDone?: () => void; onCancel?: () => void } = {}) {
  const props = { onDone: vi.fn(), onCancel: vi.fn(), ...over };
  return { ...props, ...renderWithProviders(<ExitForm registration={registration()} today={TODAY24} {...props} />) };
}

afterEach(() => { cleanup(); window.localStorage.clear(); });
beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(territoryUser());
  mocked(api.exitRegistration).mockReset().mockResolvedValue(registration({
    status: "exited", exit: { reason: "death", on: "2026-10-20", death_on: "2026-10-19", death_certificate: null }
  }));
});

describe("ExitForm", () => {
  it("óbito: diz o efeito, recusa data no futuro e sem data do óbito; confirma e envia motivo, saída e óbito", async () => {
    const { onDone } = open();
    fireEvent.click(screen.getByLabelText("óbito"));
    expect(screen.getByText(DEATH_SENTENCE)).not.toBeNull();
    typeIn("Data", "2026-10-24");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("data depois de hoje");
    typeIn("Data", "2026-10-20");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("informe a data do óbito");
    expect(document.activeElement).toBe(screen.getByLabelText("Data do óbito"));
    typeIn("Data do óbito", "2026-10-19");
    submit();
    // Definitiva: nada saiu antes da confirmação.
    expect(api.exitRegistration).not.toHaveBeenCalled();
    expect(screen.getByText("Esta ação não pode ser desfeita.")).not.toBeNull();
    confirm();
    await waitFor(() => expect(api.exitRegistration).toHaveBeenCalledWith("rg1", { reason: "death", on: "2026-10-20", death_on: "2026-10-19" }));
    expect(Object.keys(body()[1] as object)).not.toContain("version");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("óbito: a DO é opcional, vai só com 9 dígitos e sem separadores", async () => {
    open();
    fireEvent.click(screen.getByLabelText("óbito"));
    typeIn("Data", "2026-10-20");
    typeIn("Data do óbito", "2026-10-19");
    typeIn("Número da DO (opcional)", "12345");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("declaração de óbito com 9 dígitos");
    expect(document.activeElement).toBe(screen.getByLabelText("Número da DO (opcional)"));
    typeIn("Número da DO (opcional)", "123.456.789");
    submit();
    confirm();
    await waitFor(() => expect(body()[1]).toEqual({ reason: "death", on: "2026-10-20", death_on: "2026-10-19", death_certificate: "123456789" }));
  });

  it("óbito antes do nascimento é recusado na tela", () => {
    open();
    fireEvent.click(screen.getByLabelText("óbito"));
    typeIn("Data", "2026-10-20");
    typeIn("Data do óbito", "1960-01-01");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("data do óbito antes do nascimento");
    expect(api.exitRegistration).not.toHaveBeenCalled();
  });

  it("mudança: a frase da equipe; o corpo leva só motivo e data, sem o que sobrou do óbito", async () => {
    open();
    fireEvent.click(screen.getByLabelText("óbito"));
    typeIn("Data do óbito", "2026-10-19");
    typeIn("Número da DO (opcional)", "123456789");
    fireEvent.click(screen.getByLabelText("mudou de território"));
    expect(screen.getByText(MOVED_SENTENCE)).not.toBeNull();
    expect(screen.queryByText(DEATH_SENTENCE)).toBeNull();
    expect(screen.queryByLabelText("Data do óbito")).toBeNull();
    typeIn("Data", "2026-10-20");
    submit();
    confirm();
    await waitFor(() => expect(body()).toEqual([ "rg1", { reason: "moved", on: "2026-10-20" } ]));
  });

  it("sem motivo ou sem data: a frase e o campo; nada sai", () => {
    open();
    submit();
    expect(screen.getByRole("alert").textContent).toBe("escolha o motivo da saída");
    fireEvent.click(screen.getByLabelText("mudou de território"));
    submit();
    expect(screen.getByRole("alert").textContent).toBe("informe a data da saída");
    expect(document.activeElement).toBe(screen.getByLabelText("Data"));
    expect(api.exitRegistration).not.toHaveBeenCalled();
  });

  it("Voltar na confirmação devolve o formulário com o que foi digitado", () => {
    open();
    fireEvent.click(screen.getByLabelText("mudou de território"));
    typeIn("Data", "2026-10-20");
    submit();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("2026-10-20");
    expect(api.exitRegistration).not.toHaveBeenCalled();
  });

  it("Cancelar fecha sem enviar", () => {
    const { onCancel } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar saída" }));
    expect(onCancel).toHaveBeenCalled();
    expect(api.exitRegistration).not.toHaveBeenCalled();
  });

  it("invalid_registration: volta ao formulário, mostra a frase e foca o campo do path", async () => {
    mocked(api.exitRegistration).mockRejectedValue(new api.ApiError(422, { error: "invalid_registration", path: "death_on" }, "422"));
    open();
    fireEvent.click(screen.getByLabelText("óbito"));
    typeIn("Data", "2026-10-20");
    typeIn("Data do óbito", "2026-10-19");
    submit();
    confirm();
    expect((await screen.findByRole("alert")).textContent).toBe("confira o campo destacado");
    const field = screen.getByLabelText("Data do óbito");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  it("invalid_transition: só a frase (já saiu ou recusou)", async () => {
    mocked(api.exitRegistration).mockRejectedValue(new api.ApiError(422, { error: "invalid_transition" }, "422"));
    const { onDone } = open();
    fireEvent.click(screen.getByLabelText("mudou de território"));
    typeIn("Data", "2026-10-20");
    submit();
    confirm();
    expect((await screen.findByRole("alert")).textContent).toBe("esta ação não vale para a situação atual do cadastro (já saiu ou recusou)");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("409 stale_version (saída concorrente): a frase e Recarregar, que relê e fecha; nada é reenviado", async () => {
    mocked(api.exitRegistration).mockRejectedValue(new api.ApiError(409, { error: "stale_version" }, "409"));
    const { onCancel, client } = open();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByLabelText("mudou de território"));
    typeIn("Data", "2026-10-20");
    submit();
    confirm();
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect(api.exitRegistration).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "territoryRegistration", "rg1" ] });
    expect(onCancel).toHaveBeenCalled();
    expect(api.exitRegistration).toHaveBeenCalledTimes(1);
  });

  it("depois de sair, relê as listas do território", async () => {
    const { client } = open();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByLabelText("mudou de território"));
    typeIn("Data", "2026-10-20");
    submit();
    confirm();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "territoryRegistryStatus" ] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "territoryRegistryCount" ] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [ "territoryResidents" ] });
  });
});
