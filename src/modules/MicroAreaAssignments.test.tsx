import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listFieldAssignments: vi.fn(), createFieldAssignment: vi.fn(), endFieldAssignment: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ASSIGNEE_CBO_NOT_ALLOWED, HOME_VISIT_ERRORS, HOME_VISITS_DISABLED } from "../lib/homeVisits";
import { renderWithProviders } from "../test/campaignFixtures";
import { acsTeam, assignment, context, hvUser, nurseTeam } from "../test/homeVisitFixtures";
import { MicroAreaAssignments } from "./MicroAreaAssignments";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getHomeVisitContext, api.listFieldAssignments, api.createFieldAssignment, api.endFieldAssignment ];
const CANDIDATES = [ { professional_id: "p-tacs", name: "Rui TACS", cbo: "322255" } ];
afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
  mocked(api.listFieldAssignments).mockResolvedValue({ items: [ assignment() ], candidates: CANDIDATES });
});
const mount = () => renderWithProviders(<MicroAreaAssignments />);
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
async function fillAssign() {
  fireEvent.click(await screen.findByRole("button", { name: "Atribuir microárea" }));
  fireEvent.change(screen.getByLabelText("Microárea"), { target: { value: "ma2" } });
  fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p-tacs" } });
}
const reject = (fn: unknown, status: number, error: string) => mocked(fn).mockRejectedValue(new ApiError(status, { error }, "x"));

describe("Atribuição de microáreas", () => {
  it("ACS (sem can_assign): frase, nenhuma leitura, nenhuma ação", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ acsTeam() ] }));
    mount();
    expect(await screen.findByText("só o enfermeiro da equipe atribui microáreas")).not.toBeNull();
    expect(api.listFieldAssignments).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Atribuir microárea" })).toBeNull();
  });

  it("interruptor desligado: frase do interruptor", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "health_professional" ], [ "clinical_record", "territory_registry" ]));
    mount();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
    expect(api.listFieldAssignments).not.toHaveBeenCalled();
  });

  it("lista ativa: microárea, profissional e CBO, desde, por quem; lida sem pessoa do cidadão", async () => {
    mount();
    expect(await screen.findByText("Rui TACS")).not.toBeNull();
    expect(screen.getByText(/02 · Jardim Sul/)).not.toBeNull();
    expect(screen.getByText("322255")).not.toBeNull();
    expect(screen.getByText("Rita Enfermeira")).not.toBeNull();
    expect(screen.getByText("10/11/2026")).not.toBeNull();
    expect(mocked(api.listFieldAssignments).mock.calls[0]).toEqual([ "t1" ]);
  });

  it("atribuir com step-up: microárea e candidato no corpo, lista relida", async () => {
    mocked(api.createFieldAssignment).mockResolvedValue(assignment());
    mount();
    await fillAssign();
    confirm();
    await waitFor(() => expect(api.createFieldAssignment).toHaveBeenCalledWith({ micro_area_id: "ma2", professional_id: "p-tacs" }));
    await waitFor(() => expect(api.listFieldAssignments).toHaveBeenCalledTimes(2));
  });

  it("atribuir sem escolher: nada é enviado", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Atribuir microárea" }));
    confirm();
    expect(await screen.findByText("escolha a microárea e o profissional")).not.toBeNull();
    expect(api.createFieldAssignment).not.toHaveBeenCalled();
  });

  it("409 already_assigned: frase e uma releitura, sem reenvio", async () => {
    reject(api.createFieldAssignment, 409, "already_assigned");
    mount();
    await fillAssign();
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.already_assigned)).not.toBeNull();
    await waitFor(() => expect(api.listFieldAssignments).toHaveBeenCalledTimes(2));
    expect(api.createFieldAssignment).toHaveBeenCalledTimes(1);
  });

  it("422 cbo_not_allowed: frase do profissional escolhido, não a do 403", async () => {
    reject(api.createFieldAssignment, 422, "cbo_not_allowed");
    mount();
    await fillAssign();
    confirm();
    expect(await screen.findByText(ASSIGNEE_CBO_NOT_ALLOWED)).not.toBeNull();
    expect(screen.queryByText(HOME_VISIT_ERRORS.cbo_not_allowed)).toBeNull();
  });

  it("403 cbo_not_allowed: frase de quem pede", async () => {
    reject(api.createFieldAssignment, 403, "cbo_not_allowed");
    mount();
    await fillAssign();
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.cbo_not_allowed)).not.toBeNull();
  });

  it("422 micro_area_inactive: frase", async () => {
    reject(api.createFieldAssignment, 422, "micro_area_inactive");
    mount();
    await fillAssign();
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.micro_area_inactive)).not.toBeNull();
  });

  it("403 feature_disabled: frase do interruptor", async () => {
    reject(api.createFieldAssignment, 403, "feature_disabled");
    mount();
    await fillAssign();
    confirm();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
  });

  it("encerrar com step-up e o efeito no aparelho dito antes", async () => {
    mocked(api.endFieldAssignment).mockResolvedValue(assignment({ ended_at: "2026-11-12T10:00:00-03:00" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar atribuição de Rui TACS na microárea 02" }));
    expect(screen.getByText(/deixa de baixar esta microárea/)).not.toBeNull();
    expect(api.endFieldAssignment).not.toHaveBeenCalled();
    confirm();
    await waitFor(() => expect(api.endFieldAssignment).toHaveBeenCalledWith("as1"));
    await waitFor(() => expect(api.listFieldAssignments).toHaveBeenCalledTimes(2));
  });

  it("409 assignment_already_ended: frase e uma releitura", async () => {
    reject(api.endFieldAssignment, 409, "assignment_already_ended");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar atribuição de Rui TACS na microárea 02" }));
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.assignment_already_ended)).not.toBeNull();
    await waitFor(() => expect(api.listFieldAssignments).toHaveBeenCalledTimes(2));
    expect(api.endFieldAssignment).toHaveBeenCalledTimes(1);
  });

  it("cancelar fecha o painel sem gravar; só um painel por vez", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Atribuir microárea" }));
    expect((screen.getByRole("button", { name: "Encerrar atribuição de Rui TACS na microárea 02" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.createFieldAssignment).not.toHaveBeenCalled();
  });
});
