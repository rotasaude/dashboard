import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listWhoToVisit: vi.fn(), countWhoToVisit: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { HOME_VISIT_ERRORS, HOME_VISITS_DISABLED } from "../lib/homeVisits";
import { renderWithProviders } from "../test/campaignFixtures";
import { context, hvUser, nurseTeam, whoItem } from "../test/homeVisitFixtures";
import { WhoToVisit } from "./WhoToVisit";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getHomeVisitContext, api.listWhoToVisit, api.countWhoToVisit ];
afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getHomeVisitContext).mockResolvedValue(context());
  mocked(api.countWhoToVisit).mockResolvedValue({ care_line: 1, registration_due: 1, never_visited: 0, people: 1 });
});
const mount = (props: { onStartVisit?: (s: never) => void } = {}) => renderWithProviders(<WhoToVisit onStartVisit={props.onStartVisit ?? vi.fn()} />);

describe("Quem visitar", () => {
  it("motivos legíveis, sem CID; contagem sem pessoa", async () => {
    mocked(api.listWhoToVisit).mockResolvedValue({ items: [ whoItem() ], next_before: null });
    mount();
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(screen.getByText("Pessoa com hipertensão · Visitas do agente de saúde · vencida desde 01/11/2026")).not.toBeNull();
    expect(screen.getByText("cadastro vence em 20/12/2026")).not.toBeNull();
    expect(mocked(api.listWhoToVisit).mock.calls[0][0]).toEqual({ micro_area_id: "ma1", limit: 50 });
    expect(mocked(api.countWhoToVisit).mock.calls[0][0]).toBe("ma1");
  });

  it("prática nunca feita e idade ausente", async () => {
    mocked(api.listWhoToVisit).mockResolvedValue({ items: [ whoItem({
      age: null, reasons: [ { code: "care_line", care_line: "Pessoa com diabetes", practice: "Hemoglobina glicada", status: "overdue", due_on: null } ] }) ], next_before: null });
    mount();
    expect(await screen.findByText("Pessoa com diabetes · Hemoglobina glicada · nunca feita")).not.toBeNull();
    expect(screen.queryByText(/anos/)).toBeNull();
  });

  it("filtro de motivo só no Atualizar; cursor", async () => {
    mocked(api.countWhoToVisit).mockResolvedValue({ care_line: 1, registration_due: 0, never_visited: 3, people: 4 });
    mocked(api.listWhoToVisit).mockResolvedValueOnce({ items: [ whoItem() ], next_before: "c2" }).mockResolvedValue({ items: [], next_before: null });
    mount();
    await screen.findByText("Maria Lima");
    fireEvent.click(screen.getByLabelText("Nunca visitadas"));
    expect(api.listWhoToVisit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(mocked(api.listWhoToVisit).mock.calls[1][0]).toEqual({ micro_area_id: "ma1", reason: [ "never_visited" ], limit: 50 }));
  });

  it("Carregar mais usa o cursor; cursor inválido recarrega do início uma vez", async () => {
    mocked(api.listWhoToVisit)
      .mockResolvedValueOnce({ items: [ whoItem() ], next_before: "c2" })
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_cursor" }, "x"))
      .mockResolvedValue({ items: [ whoItem({ patient_id: "pa5", display_name: "Rosa Reis" }) ], next_before: null });
    mount();
    await screen.findByText("Maria Lima");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(mocked(api.listWhoToVisit).mock.calls[1][0]).toMatchObject({ before: "c2" }));
    expect(await screen.findByText("Rosa Reis")).not.toBeNull();
    expect(screen.getByText(HOME_VISIT_ERRORS.invalid_cursor)).not.toBeNull();
    expect(mocked(api.listWhoToVisit).mock.calls[2][0]).not.toHaveProperty("before");
    expect(api.listWhoToVisit).toHaveBeenCalledTimes(3);
  });

  it("Registrar visita leva o domicílio e a pessoa, em memória", async () => {
    mocked(api.listWhoToVisit).mockResolvedValue({ items: [ whoItem() ], next_before: null });
    const onStartVisit = vi.fn();
    mount({ onStartVisit });
    fireEvent.click(await screen.findByRole("button", { name: "Registrar visita para Maria Lima" }));
    expect(onStartVisit).toHaveBeenCalledWith({ teamId: "t1", microAreaId: "ma1", householdId: "h1", familyId: "f1", patientId: "pa1", displayName: "Maria Lima" });
  });

  it("enfermeiro lê a equipe toda, sem o atalho de registrar", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listWhoToVisit).mockResolvedValue({ items: [ whoItem() ], next_before: null });
    mount();
    await screen.findByText("Maria Lima");
    expect(screen.queryByRole("button", { name: /Registrar visita/ })).toBeNull();
    expect(screen.getByRole("option", { name: "02 · Jardim Sul (da equipe)" })).not.toBeNull();
  });

  it("interruptor desligado mostra a frase", async () => {
    mocked(api.listWhoToVisit).mockRejectedValue(new ApiError(403, { error: "feature_disabled" }, "x"));
    mount();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
  });

});
