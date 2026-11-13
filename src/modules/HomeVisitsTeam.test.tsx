import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listHomeVisitDays: vi.fn(), getHomeVisitDay: vi.fn(),
    listHomeVisits: vi.fn(), countHomeVisits: vi.fn(), getHomeVisit: vi.fn(), closeHomeVisitDay: vi.fn(), withdrawHomeVisit: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { HOME_VISIT_ERRORS, HOME_VISITS_DISABLED } from "../lib/homeVisits";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW24B, TODAY24B, acsTeam, context, day, hvUser, nurseTeam, tacsTeam, visit } from "../test/homeVisitFixtures";
import { HomeVisitsTeam } from "./HomeVisitsTeam";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getHomeVisitContext, api.listHomeVisitDays, api.getHomeVisitDay, api.listHomeVisits, api.countHomeVisits,
  api.getHomeVisit, api.closeHomeVisitDay, api.withdrawHomeVisit ];
afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.countHomeVisits).mockResolvedValue({ done: 0, refused: 0, absent: 0, withdrawn: 0 });
  mocked(api.listHomeVisits).mockResolvedValue({ items: [], next_before: null });
});
const mount = () => renderWithProviders(<HomeVisitsTeam now={NOW24B} />);
const closedDay = (o = {}) => day({ visits: undefined, own: false, state: "closed", ficha: { status: "not_generated", reasons: [ "professional_without_cns" ] }, ...o });

describe("Visitas da equipe", () => {
  it("folhas sem pessoa; filtros só no Atualizar; cursor", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValueOnce({ items: [ closedDay() ], next_before: "c2" }).mockResolvedValueOnce({ items: [], next_before: null });
    mount();
    expect(await screen.findByText(/ficha não gerada: profissional sem CNS/)).not.toBeNull();
    expect(mocked(api.listHomeVisitDays).mock.calls[0][0]).toEqual({ team_id: "t1", from: "2026-11-01", to: TODAY24B });
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p-tacs" } });
    expect(api.listHomeVisitDays).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(mocked(api.listHomeVisitDays).mock.calls[1][0]).toMatchObject({ before: "c2" }));
  });

  it("Atualizar aplica o profissional; período invertido não sai", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [], next_before: null });
    mount();
    await waitFor(() => expect(api.listHomeVisitDays).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p-tacs" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(mocked(api.listHomeVisitDays).mock.calls[1][0]).toMatchObject({ professional_id: "p-tacs" }));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-20" } });
    expect((screen.getByRole("button", { name: "Atualizar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("o fim do período não pode ser antes do início")).not.toBeNull();
    expect(api.listHomeVisitDays).toHaveBeenCalledTimes(2);
  });

  it("a ordem do api é mantida; exportação desligada aparece com a frase da ficha", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [
      closedDay({ id: "d9", day: "2026-11-10", ficha: { status: "not_exported", reasons: [] } }),
      closedDay({ id: "d8", day: "2026-11-11", ficha: { status: "sent", reasons: [] } }) ], next_before: null });
    mount();
    expect(await screen.findByText("não exportada — exportação para o e-SUS desligada")).not.toBeNull();
    const opens = screen.getAllByRole("button", { name: /^Abrir folha/ }).map((b) => b.getAttribute("aria-label"));
    expect(opens[0]).toContain("10/11/2026");
    expect(opens[1]).toContain("11/11/2026");
  });

  it("cursor antigo (invalid_cursor) recomeça da primeira página com a frase", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValueOnce({ items: [ closedDay() ], next_before: "c2" })
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor" }, "x"))
      .mockResolvedValue({ items: [ closedDay() ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(HOME_VISIT_ERRORS.invalid_cursor)).not.toBeNull();
    await waitFor(() => expect(api.listHomeVisitDays).toHaveBeenCalledTimes(3));
    expect(mocked(api.listHomeVisitDays).mock.calls[2][0]).not.toHaveProperty("before");
  });

  it("abrir a folha mostra a folha só leitura; sem fechar quando não é a dela", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [ day({ visits: undefined, own: false, state: "open" }) ], next_before: null });
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ own: false, state: "open", visits: [ visit() ] }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Abrir folha/ }));
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar o dia" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retirar visita/ })).toBeNull();
    expect(api.getHomeVisitDay).toHaveBeenCalledWith("d1");
  });

  it("a aba Visitas só lê ao abrir; contagens só com os filtros que o api aceita", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [], next_before: null });
    mocked(api.countHomeVisits).mockResolvedValue({ done: 7, refused: 1, absent: 2, withdrawn: 1 });
    mocked(api.listHomeVisits).mockResolvedValue({ items: [ visit() ], next_before: null });
    mount();
    await screen.findByRole("tab", { name: "Folhas" });
    expect(api.listHomeVisits).not.toHaveBeenCalled();
    expect(api.countHomeVisits).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Visitas" }));
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(screen.getByText("7")).not.toBeNull();
    expect(screen.getByText(/da equipe no período/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p-tacs" } });
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(mocked(api.listHomeVisits).mock.calls.length).toBe(2));
    expect(mocked(api.listHomeVisits).mock.calls[1][0]).toMatchObject({ team_id: "t1", professional_id: "p-tacs", outcome: [ 2 ] });
    for (const [ q ] of mocked(api.countHomeVisits).mock.calls) {
      expect(q).not.toHaveProperty("professional_id");
      expect(q).not.toHaveProperty("outcome");
    }
  });

  it("detalhe: observação só aqui; retirada sem motivo para quem não pode ver", async () => {
    const withdrawn = { at: "2026-11-12T10:05:00-03:00", reason: null, by: { name: "Joana ACS" } };
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ tacsTeam() ] }));
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [], next_before: null });
    mocked(api.countHomeVisits).mockResolvedValue({ done: 1, refused: 0, absent: 0, withdrawn: 1 });
    mocked(api.listHomeVisits).mockResolvedValue({ items: [ visit({ state: "withdrawn", withdrawn }) ], next_before: null });
    mocked(api.getHomeVisit).mockResolvedValue(visit({ note: "Pediu retorno.", state: "withdrawn", withdrawn }));
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Visitas" }));
    expect(screen.queryByText("Pediu retorno.")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir visita das 09:15" }));
    expect(await screen.findByText("Pediu retorno.")).not.toBeNull();
    expect(screen.getByText("motivo visível só para o dono e o enfermeiro ou médico da equipe")).not.toBeNull();
    expect(screen.getByText("Dashboard")).not.toBeNull();
  });

  it("403 out_of_scope vira frase; sem professionals no contexto, sem filtro de profissional", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ acsTeam() ] }));
    mocked(api.listHomeVisitDays).mockRejectedValue(new ApiError(403, { error: "out_of_scope" }, "x"));
    mount();
    expect(await screen.findByText(HOME_VISIT_ERRORS.out_of_scope)).not.toBeNull();
    expect(screen.queryByLabelText("Profissional")).toBeNull();
  });

  it("403 feature_disabled mostra a frase do interruptor", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listHomeVisitDays).mockRejectedValue(new ApiError(403, { error: "feature_disabled" }, "x"));
    mount();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
  });
});
