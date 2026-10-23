// src/modules/careLines/ManualEnrollPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getCareContext: vi.fn(), listCareEnrollments: vi.fn(), countOverdueEnrollments: vi.fn(),
    countCareSuggestions: vi.fn(), lookupCarePerson: vi.fn(), enrollCare: vi.fn()
  };
});

import * as api from "../../lib/api";
import { CareLinesTeam } from "../CareLinesTeam";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY23, careContext, careUser, enrollment } from "../../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const BENEDITA = { patient_id: null, citizen_id: "ci3", display_name: "Benedita Ramos", cpf_masked: "***.982.247-**", verified: true };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getCareContext, api.listCareEnrollments, api.countOverdueEnrollments,
    api.countCareSuggestions, api.lookupCarePerson, api.enrollCare ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser());
  mocked(api.getCareContext).mockResolvedValue(careContext());
  mocked(api.listCareEnrollments).mockResolvedValue({ enrollments: [ enrollment() ], next_before: null });
  mocked(api.countOverdueEnrollments).mockResolvedValue(12);
  mocked(api.countCareSuggestions).mockResolvedValue(0);
  mocked(api.lookupCarePerson).mockResolvedValue(BENEDITA);
  mocked(api.enrollCare).mockResolvedValue(enrollment({ id: "en9" }));
});

async function openPanel() {
  renderWithProviders(<CareLinesTeam today={TODAY23} />);
  fireEvent.click(await screen.findByRole("button", { name: "Inscrever pessoa" }));
  return screen.getByRole("region", { name: "Inscrever pessoa" });
}
async function find(panel: HTMLElement, cpf = "529.982.247-25") {
  fireEvent.change(within(panel).getByLabelText("CPF da pessoa"), { target: { value: cpf } });
  fireEvent.click(within(panel).getByRole("button", { name: "Buscar" }));
}

describe("ManualEnrollPanel", () => {
  it("inscreve cidadão validado que nunca consultou: CPF no corpo, citizen_id, linha e equipe", async () => {
    const panel = await openPanel();
    await find(panel);
    expect(await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**")).not.toBeNull();
    expect(api.lookupCarePerson).toHaveBeenCalledWith("52998224725");
    expect((within(panel).getByLabelText("CPF da pessoa") as HTMLInputElement).value).toBe("");
    fireEvent.change(within(panel).getByLabelText("Linha"), { target: { value: "cl4" } });
    fireEvent.change(within(panel).getByLabelText("Equipe de referência"), { target: { value: "tm2" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Inscrever" }));
    await waitFor(() => expect(api.enrollCare).toHaveBeenCalledWith({ citizen_id: "ci3", care_line_id: "cl4", team_id: "tm2" }));
    expect((await screen.findByRole("status")).textContent).toBe("Inscrição de Benedita Ramos em Pessoa com diabetes confirmada.");
    await waitFor(() => expect(api.listCareEnrollments).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Inscrever pessoa" })).toBeNull();
  });

  it("paciente vai por patient_id; gestante pede a DUM antes de enviar", async () => {
    mocked(api.lookupCarePerson).mockResolvedValue({ ...BENEDITA, patient_id: "pa5", display_name: "Ana Souza" });
    const panel = await openPanel();
    await find(panel);
    await within(panel).findByText("Ana Souza · CPF ***.982.247-**");
    fireEvent.change(within(panel).getByLabelText("Linha"), { target: { value: "cl3" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Inscrever" }));
    expect(within(panel).getByRole("alert").textContent).toBe("informe a DUM (data da última menstruação)");
    fireEvent.change(within(panel).getByLabelText("DUM (data da última menstruação)"), { target: { value: "2026-07-15" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Inscrever" }));
    await waitFor(() => expect(api.enrollCare).toHaveBeenCalledWith({ patient_id: "pa5", care_line_id: "cl3", team_id: "tm1", anchor_date: "2026-07-15" }));
  });

  it("cadastro sem validação (409 citizen_not_verified) vira frase e não deixa inscrever; já inscrita (409 already_enrolled) também", async () => {
    mocked(api.lookupCarePerson).mockRejectedValueOnce(new api.ApiError(409, { error: "citizen_not_verified" }, "x"));
    const panel = await openPanel();
    await find(panel);
    expect((await within(panel).findByRole("alert")).textContent).toBe("o cadastro desta pessoa ainda não foi validado no posto — valide na recepção");
    expect(within(panel).queryByRole("button", { name: "Inscrever" })).toBeNull();
    mocked(api.enrollCare).mockRejectedValueOnce(new api.ApiError(409, { error: "already_enrolled" }, "x"));
    await find(panel);
    await within(panel).findByRole("button", { name: "Inscrever" });
    expect(within(panel).queryByRole("alert")).toBeNull();
    fireEvent.change(within(panel).getByLabelText("Linha"), { target: { value: "cl4" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Inscrever" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("a pessoa já está inscrita nesta linha");
  });

  it("422 anchor_required numa linha sem DUM no contexto abre o campo da DUM", async () => {
    const panel = await openPanel();
    await find(panel);
    await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**");
    fireEvent.change(within(panel).getByLabelText("Linha"), { target: { value: "cl4" } });
    expect(within(panel).queryByLabelText("DUM (data da última menstruação)")).toBeNull();
    mocked(api.enrollCare).mockRejectedValueOnce(new api.ApiError(422, { error: "anchor_required" }, "x"));
    fireEvent.click(within(panel).getByRole("button", { name: "Inscrever" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("informe a DUM para inscrever na linha da gestante");
    expect(within(panel).getByLabelText("DUM (data da última menstruação)")).not.toBeNull();
  });

  it("o CPF não vai a console nem storage e sai do campo ao buscar; busca nova sem resposta esquece a pessoa anterior", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const panel = await openPanel();
    await find(panel);
    await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**");
    expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    expect(document.body.textContent).not.toMatch(/52998224725|529\.982\.247-25/);
    mocked(api.lookupCarePerson).mockRejectedValueOnce(new api.ApiError(404, { error: "person_not_found" }, "x"));
    await find(panel, "111.444.777-35");
    expect((await within(panel).findByRole("alert")).textContent).toBe("nenhum cidadão com este CPF na cidade");
    expect(within(panel).queryByRole("button", { name: "Inscrever" })).toBeNull();
    spies.forEach((s) => s.mockRestore());
  });

  it("digitar outro CPF (ou buscar um inválido) esquece a pessoa, a linha e a DUM da anterior", async () => {
    const panel = await openPanel();
    await find(panel);
    await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**");
    fireEvent.change(within(panel).getByLabelText("Linha"), { target: { value: "cl3" } });
    fireEvent.change(within(panel).getByLabelText("DUM (data da última menstruação)"), { target: { value: "2026-07-15" } });
    // editar o campo já esquece a pessoa
    fireEvent.change(within(panel).getByLabelText("CPF da pessoa"), { target: { value: "111.444.777-3" } });
    expect(within(panel).queryByRole("button", { name: "Inscrever" })).toBeNull();
    expect(within(panel).queryByText(/Benedita Ramos/)).toBeNull();
    // achar de novo e buscar um CPF inválido: a pessoa não volta nem fica a anterior
    await find(panel);
    await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**");
    expect((within(panel).getByLabelText("Linha") as HTMLSelectElement).value).toBe("");
    expect(within(panel).queryByLabelText("DUM (data da última menstruação)")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Buscar" }));
    expect(within(panel).getByRole("alert").textContent).toBe("CPF inválido");
    expect(within(panel).queryByRole("button", { name: "Inscrever" })).toBeNull();
    expect(within(panel).queryByText(/Benedita Ramos/)).toBeNull();
    expect(api.enrollCare).not.toHaveBeenCalled();
  });

  it("durante a busca o CPF e o botão ficam desabilitados: resposta tardia não aparece depois de um CPF novo", async () => {
    let resolve!: (v: typeof BENEDITA) => void;
    mocked(api.lookupCarePerson).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const panel = await openPanel();
    await find(panel);
    expect((within(panel).getByLabelText("CPF da pessoa") as HTMLInputElement).disabled).toBe(true);
    expect((within(panel).getByRole("button", { name: "Buscar" }) as HTMLButtonElement).disabled).toBe(true);
    resolve(BENEDITA);
    await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**");
    expect((within(panel).getByLabelText("CPF da pessoa") as HTMLInputElement).disabled).toBe(false);
    expect((within(panel).getByRole("button", { name: "Buscar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("durante a inscrição a linha, a equipe e a DUM ficam desabilitadas", async () => {
    let resolve!: (v: unknown) => void;
    mocked(api.enrollCare).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const panel = await openPanel();
    await find(panel);
    await within(panel).findByText("Benedita Ramos · CPF ***.982.247-**");
    fireEvent.change(within(panel).getByLabelText("Linha"), { target: { value: "cl3" } });
    fireEvent.change(within(panel).getByLabelText("DUM (data da última menstruação)"), { target: { value: "2026-07-15" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Inscrever" }));
    await waitFor(() => expect((within(panel).getByLabelText("Linha") as HTMLSelectElement).disabled).toBe(true));
    expect((within(panel).getByLabelText("Equipe de referência") as HTMLSelectElement).disabled).toBe(true);
    expect((within(panel).getByLabelText("DUM (data da última menstruação)") as HTMLInputElement).disabled).toBe(true);
    expect((within(panel).getByLabelText("CPF da pessoa") as HTMLInputElement).disabled).toBe(true);
    resolve(enrollment({ id: "en9" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inscrever pessoa" })).toBeNull());
  });

  it("CPF inválido não busca; sem can_confirm não há Inscrever pessoa", async () => {
    const panel = await openPanel();
    await find(panel, "529.982.247-24");
    expect(within(panel).getByRole("alert").textContent).toBe("CPF inválido");
    expect(api.lookupCarePerson).not.toHaveBeenCalled();
    cleanup();
    mocked(api.getCareContext).mockResolvedValue(careContext({ canConfirm: false }));
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByText("Maria das Dores · 58 anos");
    expect(screen.queryByRole("button", { name: "Inscrever pessoa" })).toBeNull();
  });
});
