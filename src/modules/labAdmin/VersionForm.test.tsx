import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), createLabExamVersion: vi.fn() };
});

import * as api from "../../lib/api";
import { VersionForm } from "./VersionForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { labExam, labUser, labVersion } from "../../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(labUser([ "municipal_admin" ]));
  mocked(api.createLabExamVersion).mockReset().mockResolvedValue(labVersion({ id: "ev2", version: 2 }));
});

describe("VersionForm", () => {
  it("nova versão: faixa por sexo e idade, com step-up; nunca edita a atual", async () => {
    const onSaved = vi.fn();
    renderWithProviders(<VersionForm exam={labExam()} onSaved={onSaved} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" });
    const analyte = within(form).getByRole("group", { name: "Componente 1" });
    fireEvent.click(within(analyte).getByRole("button", { name: "Incluir faixa" }));
    const range = within(analyte).getByRole("group", { name: "Faixa 2" });
    fireEvent.change(within(range).getByLabelText("Sexo"), { target: { value: "female" } });
    fireEvent.change(within(range).getByLabelText("Idade mínima"), { target: { value: "60" } });
    fireEvent.change(within(range).getByLabelText("Mínimo"), { target: { value: "70" } });
    fireEvent.change(within(range).getByLabelText("Máximo"), { target: { value: "110" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    await waitFor(() => expect(api.createLabExamVersion).toHaveBeenCalled());
    const [ id, body ] = mocked(api.createLabExamVersion).mock.calls[0];
    expect(id).toBe("le1");
    expect(body.analytes[0].reference_ranges[1]).toEqual({ sex: "female", age_min_days: 21900, age_max_days: 43800, low: 70, high: 110, text: null });
    expect(onSaved).toHaveBeenCalled();
  });

  it("problema no formulário não abre a confirmação", async () => {
    renderWithProviders(<VersionForm exam={labExam()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const form = await screen.findByRole("region", { name: "Nova versão de Glicose (atual v1)" });
    fireEvent.change(within(form).getByLabelText("Método"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar versão" }));
    expect(within(form).getByRole("alert").textContent).toBe("informe o método");
    expect(screen.queryByRole("button", { name: "Criar versão 2" })).toBeNull();
  });

  it("422 do api vira frase (ex.: código do aparelho repetido)", async () => {
    mocked(api.createLabExamVersion).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_instrument_code" }, "x"));
    renderWithProviders(<VersionForm exam={labExam()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    expect(await screen.findByText("este código do aparelho já está em outro exame do laboratório")).not.toBeNull();
  });

  it("409 conflict (vigente mudou, C-E44): frase própria e a tela relê", async () => {
    mocked(api.createLabExamVersion).mockRejectedValueOnce(new api.ApiError(409, { error: "conflict" }, "x"));
    const onStale = vi.fn();
    renderWithProviders(<VersionForm exam={labExam()} onSaved={vi.fn()} onCancel={vi.fn()} onStale={onStale} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar e salvar versão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar versão 2" }));
    expect(await screen.findByText(/a versão vigente do exame mudou enquanto você salvava/)).not.toBeNull();
    expect(onStale).toHaveBeenCalledTimes(1);
  });
});
