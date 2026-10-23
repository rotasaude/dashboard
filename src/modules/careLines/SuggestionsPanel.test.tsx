// src/modules/careLines/SuggestionsPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getCareContext: vi.fn(), listCareEnrollments: vi.fn(), countOverdueEnrollments: vi.fn(),
    countCareSuggestions: vi.fn(), listCareSuggestions: vi.fn(), acceptCareSuggestion: vi.fn(), dismissCareSuggestion: vi.fn(),
    endCareEnrollment: vi.fn()
  };
});

import * as api from "../../lib/api";
import { CareLinesTeam } from "../CareLinesTeam";
import { renderWithProviders } from "../../test/campaignFixtures";
import { PREGNANCY_REF, TODAY23, careContext, careUser, enrollment, suggestion } from "../../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ANA = suggestion({ id: "sg2", person: { patient_id: null, citizen_id: "ci7", display_name: "Ana Souza", age: 27 }, care_line: PREGNANCY_REF,
  reason: "declared" });
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getCareContext, api.listCareEnrollments, api.countOverdueEnrollments,
    api.countCareSuggestions, api.listCareSuggestions, api.acceptCareSuggestion, api.dismissCareSuggestion, api.endCareEnrollment ]) {
    mocked(fn).mockReset();
  }
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser());
  mocked(api.getCareContext).mockResolvedValue(careContext());
  mocked(api.listCareEnrollments).mockResolvedValue({ enrollments: [ enrollment() ], next_before: null });
  mocked(api.countOverdueEnrollments).mockResolvedValue(12);
  mocked(api.countCareSuggestions).mockResolvedValue(3);
  mocked(api.listCareSuggestions).mockResolvedValue({ suggestions: [ suggestion() ], next_before: null });
  mocked(api.acceptCareSuggestion).mockResolvedValue(undefined);
  mocked(api.dismissCareSuggestion).mockResolvedValue(undefined);
  mocked(api.endCareEnrollment).mockResolvedValue(undefined);
});

async function openSuggestions() {
  renderWithProviders(<CareLinesTeam today={TODAY23} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sugestões (3)" }));
  return screen.findByRole("region", { name: "Sugestões a confirmar" });
}

describe("SuggestionsPanel", () => {
  it("a lista só é lida no clique da aba; o motivo sem texto clínico", async () => {
    renderWithProviders(<CareLinesTeam today={TODAY23} />);
    await screen.findByRole("button", { name: "Sugestões (3)" });
    expect(api.listCareSuggestions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sugestões (3)" }));
    const panel = await screen.findByRole("region", { name: "Sugestões a confirmar" });
    expect(await within(panel).findByText("problema ativo na lista de problemas")).not.toBeNull();
    expect(api.listCareSuggestions).toHaveBeenCalledWith({ teamId: "tm1", careLineId: undefined, before: null });
    expect(api.listCareSuggestions).toHaveBeenCalledTimes(1);
  });

  it("aceita escolhendo a equipe de referência; relê a lista e os contadores", async () => {
    const panel = await openSuggestions();
    fireEvent.click(await within(panel).findByRole("button", { name: "Aceitar sugestão de João Batista" }));
    const accept = within(panel).getByRole("region", { name: "Aceitar João Batista em Pessoa com diabetes" });
    expect(within(accept).queryByLabelText("DUM (data da última menstruação)")).toBeNull();
    fireEvent.change(within(accept).getByLabelText("Equipe de referência"), { target: { value: "tm2" } });
    fireEvent.click(within(accept).getByRole("button", { name: "Confirmar inscrição" }));
    await waitFor(() => expect(api.acceptCareSuggestion).toHaveBeenCalledWith("sg1", { team_id: "tm2" }));
    expect((await screen.findByRole("status")).textContent).toBe("Inscrição de João Batista em Pessoa com diabetes confirmada.");
    await waitFor(() => expect(api.listCareSuggestions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocked(api.countCareSuggestions).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("gestante: sem DUM não envia; DUM no futuro recusa; 422 anchor_required abre o campo", async () => {
    mocked(api.listCareSuggestions).mockResolvedValue({ suggestions: [ ANA, suggestion() ], next_before: null });
    const panel = await openSuggestions();
    fireEvent.click(await within(panel).findByRole("button", { name: "Aceitar sugestão de Ana Souza" }));
    const ana = within(panel).getByRole("region", { name: "Aceitar Ana Souza em Gestante e puérpera" });
    fireEvent.click(within(ana).getByRole("button", { name: "Confirmar inscrição" }));
    expect(within(ana).getByRole("alert").textContent).toBe("informe a DUM (data da última menstruação)");
    fireEvent.change(within(ana).getByLabelText("DUM (data da última menstruação)"), { target: { value: "2026-10-23" } });
    fireEvent.click(within(ana).getByRole("button", { name: "Confirmar inscrição" }));
    expect(within(ana).getByRole("alert").textContent).toBe("a DUM não pode ser depois de hoje");
    expect(api.acceptCareSuggestion).not.toHaveBeenCalled();
    fireEvent.change(within(ana).getByLabelText("DUM (data da última menstruação)"), { target: { value: "2026-08-01" } });
    fireEvent.click(within(ana).getByRole("button", { name: "Confirmar inscrição" }));
    await waitFor(() => expect(api.acceptCareSuggestion).toHaveBeenCalledWith("sg2", { team_id: "tm1", anchor_date: "2026-08-01" }));

    // Linha que a tela não sabia que pedia âncora: o api recusa e o campo aparece.
    mocked(api.acceptCareSuggestion).mockRejectedValueOnce(new api.ApiError(422, { error: "anchor_required" }, "x"));
    fireEvent.click(await within(panel).findByRole("button", { name: "Aceitar sugestão de João Batista" }));
    const joao = within(panel).getByRole("region", { name: "Aceitar João Batista em Pessoa com diabetes" });
    fireEvent.click(within(joao).getByRole("button", { name: "Confirmar inscrição" }));
    expect((await within(joao).findByRole("alert")).textContent).toBe("informe a DUM para inscrever na linha da gestante");
    expect(within(joao).getByLabelText("DUM (data da última menstruação)")).not.toBeNull();
    expect(api.acceptCareSuggestion).toHaveBeenCalledTimes(2);
  });

  it("sem can_confirm: só Recusar; 403 cbo_not_allowed vira frase e nada muda", async () => {
    mocked(api.getCareContext).mockResolvedValue(careContext({ canConfirm: false }));
    let panel = await openSuggestions();
    expect(await within(panel).findByRole("button", { name: "Recusar sugestão de João Batista" })).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: "Aceitar sugestão de João Batista" })).toBeNull();
    cleanup();
    mocked(api.getCareContext).mockResolvedValue(careContext());
    mocked(api.listCareSuggestions).mockClear();
    mocked(api.acceptCareSuggestion).mockRejectedValueOnce(new api.ApiError(403, { error: "cbo_not_allowed" }, "x"));
    panel = await openSuggestions();
    fireEvent.click(await within(panel).findByRole("button", { name: "Aceitar sugestão de João Batista" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Confirmar inscrição" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("só médico ou enfermeiro confirma a inscrição");
    expect(api.listCareSuggestions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("recusar exige motivo (1 a 500) e manda o motivo no corpo", async () => {
    const panel = await openSuggestions();
    fireEvent.click(await within(panel).findByRole("button", { name: "Recusar sugestão de João Batista" }));
    const dismiss = within(panel).getByRole("region", { name: "Recusar a sugestão de João Batista" });
    fireEvent.click(within(dismiss).getByRole("button", { name: "Recusar sugestão" }));
    expect(within(dismiss).getByRole("alert").textContent).toBe("escreva o motivo");
    fireEvent.change(within(dismiss).getByLabelText("Motivo da recusa"), { target: { value: "  já acompanhado no ambulatório de endocrinologia " } });
    fireEvent.click(within(dismiss).getByRole("button", { name: "Recusar sugestão" }));
    await waitFor(() => expect(api.dismissCareSuggestion).toHaveBeenCalledWith("sg1", "já acompanhado no ambulatório de endocrinologia"));
    expect((await screen.findByRole("status")).textContent).toBe("Sugestão de João Batista recusada.");
  });

  it("decidida por outra pessoa (409 invalid_transition): frase e relê", async () => {
    mocked(api.acceptCareSuggestion).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    const panel = await openSuggestions();
    fireEvent.click(await within(panel).findByRole("button", { name: "Aceitar sugestão de João Batista" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Confirmar inscrição" }));
    expect((await screen.findByRole("status")).textContent).toBe("isso já foi decidido ou encerrado por outra pessoa — a lista foi relida");
    await waitFor(() => expect(api.listCareSuggestions).toHaveBeenCalledTimes(2));
  });

  it("problema resolvido (L5): Encerrar aceita a sugestão sem equipe e encerra com alta; Manter pede motivo", async () => {
    mocked(api.listCareSuggestions).mockResolvedValue({ suggestions: [ suggestion({ reason: "resolved_problem", enrollment_id: "en1" }) ], next_before: null });
    const panel = await openSuggestions();
    expect(await within(panel).findByText("problema resolvido — sugestão de encerrar")).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: "Aceitar sugestão de João Batista" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Manter inscrição de João Batista" }));
    expect(within(panel).getByLabelText("Por que manter a inscrição")).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Encerrar inscrição de João Batista" }));
    const endForm = within(panel).getByRole("region", { name: "Encerrar a inscrição de João Batista" });
    fireEvent.click(within(endForm).getByRole("button", { name: "Encerrar com alta" }));
    await waitFor(() => expect(api.acceptCareSuggestion).toHaveBeenCalledWith("sg1", {}));
    expect(api.endCareEnrollment).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toBe("Inscrição de João Batista encerrada com alta.");
  });
  it("problema resolvido: a técnica (sem can_confirm) também encerra (P-dashboard-08), e Manter manda o motivo", async () => {
    mocked(api.getCareContext).mockResolvedValue(careContext({ canConfirm: false }));
    mocked(api.listCareSuggestions).mockResolvedValue({ suggestions: [ suggestion({ reason: "resolved_problem", enrollment_id: "en1" }) ], next_before: null });
    const panel = await openSuggestions();
    expect(await within(panel).findByRole("button", { name: "Encerrar inscrição de João Batista" })).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Manter inscrição de João Batista" }));
    const keep = within(panel).getByRole("region", { name: "Manter a inscrição de João Batista" });
    fireEvent.change(within(keep).getByLabelText("Por que manter a inscrição"), { target: { value: "ainda em tratamento" } });
    fireEvent.click(within(keep).getByRole("button", { name: "Manter inscrição" }));
    await waitFor(() => expect(api.dismissCareSuggestion).toHaveBeenCalledWith("sg1", "ainda em tratamento"));
    expect((await screen.findByRole("status")).textContent).toBe("Inscrição de João Batista mantida.");
  });

  it("cada formulário mostra, como texto visível, a pessoa, a linha e o motivo da sugestão", async () => {
    mocked(api.listCareSuggestions).mockResolvedValue({
      suggestions: [ suggestion(), suggestion({ id: "sg3", reason: "resolved_problem", enrollment_id: "en1" }) ], next_before: null
    });
    const panel = await openSuggestions();
    const header = /João Batista · Pessoa com diabetes · /;
    const visible = (form: HTMLElement) => within(form).getByText(header, { selector: "strong" });
    fireEvent.click((await within(panel).findAllByRole("button", { name: "Aceitar sugestão de João Batista" }))[0]);
    expect(visible(within(panel).getByRole("region", { name: "Aceitar João Batista em Pessoa com diabetes" })).textContent)
      .toBe("João Batista · Pessoa com diabetes · problema ativo na lista de problemas");
    fireEvent.click(within(panel).getAllByRole("button", { name: "Recusar sugestão de João Batista" })[0]);
    expect(visible(within(panel).getByRole("region", { name: "Recusar a sugestão de João Batista" })).textContent)
      .toBe("João Batista · Pessoa com diabetes · problema ativo na lista de problemas");
    fireEvent.click(within(panel).getByRole("button", { name: "Manter inscrição de João Batista" }));
    expect(visible(within(panel).getByRole("region", { name: "Manter a inscrição de João Batista" })).textContent)
      .toBe("João Batista · Pessoa com diabetes · problema resolvido — sugestão de encerrar");
    fireEvent.click(within(panel).getByRole("button", { name: "Encerrar inscrição de João Batista" }));
    expect(visible(within(panel).getByRole("region", { name: "Encerrar a inscrição de João Batista" })).textContent)
      .toBe("João Batista · Pessoa com diabetes · problema resolvido — sugestão de encerrar");
  });

  it("a aba de sugestões não vira status=suggestions nas inscrições", async () => {
    const panel = await openSuggestions();
    expect(panel).not.toBeNull();
    const statuses = mocked(api.listCareEnrollments).mock.calls.map((c) => (c[0] as { status: string }).status);
    expect(statuses).not.toContain("suggestions");
  });
});
