import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listHomeVisitDays: vi.fn(), getHomeVisitDay: vi.fn(),
    closeHomeVisitDay: vi.fn(), withdrawHomeVisit: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError, type HomeVisitDay as ApiDay } from "../../lib/api";
import {
  BLOCKER_TEXT, CLOSE_EFFECT, DAY_CHANGED, HOME_VISIT_ERRORS, HOME_VISITS_DISABLED, HV_CANNOT_REGISTER, LEDI_EXPORT_OFF, NOT_FOUND_REREAD, VISIT_CHANGED,
  closedByLabel
} from "../../lib/homeVisits";
import { renderWithProviders } from "../../test/campaignFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { NOW24B, TODAY24B, context, day, hvUser, nurseTeam, visit } from "../../test/homeVisitFixtures";
import { HomeVisitDay } from "../HomeVisitDay";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  for (const f of [ api.fetchCurrentSession, api.getHomeVisitContext, api.listHomeVisitDays, api.getHomeVisitDay, api.closeHomeVisitDay, api.withdrawHomeVisit ]) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getHomeVisitContext).mockResolvedValue(context());
  mocked(api.listHomeVisitDays).mockResolvedValue({ items: [ day({ visits: undefined }) ], next_before: null });
  mocked(api.getHomeVisitDay).mockResolvedValue(day());
});
const mount = () => renderWithProviders(<HomeVisitDay now={NOW24B} />);
const closeNow = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Fechar o dia" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
};

describe("Folha do dia", () => {
  it("cartões, nunca tabela; motivos por rótulo; sem observação", async () => {
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ visits: [ visit({ note: "Pediu retorno." }) ] }));
    const { container } = mount();
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByText(/Visita periódica/)).not.toBeNull();
    expect(screen.getByText(/PA 130\/85/)).not.toBeNull();
    expect(screen.queryByText("Pediu retorno.")).toBeNull();
    expect(api.listHomeVisitDays).toHaveBeenCalledWith({ team_id: "t1", from: TODAY24B, to: TODAY24B });
  });

  it("blockers em linguagem simples antes de fechar", async () => {
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ blockers: [ { code: "professional_without_cns", visit_id: null }, { code: "patient_without_identifier", visit_id: "v1" } ] }));
    mount();
    expect(await screen.findByText(BLOCKER_TEXT.professional_without_cns)).not.toBeNull();
    expect(screen.getByText(`${BLOCKER_TEXT.patient_without_identifier} · 09:15 · Maria Lima`)).not.toBeNull();
  });

  it("exportação desligada (Q50): a frase fica acima da lista e os blockers continuam", async () => {
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ ledi_export_enabled: false, blockers: [ { code: "unit_without_cnes", visit_id: null } ] }));
    mount();
    expect(await screen.findByText(LEDI_EXPORT_OFF)).not.toBeNull();
    expect(screen.getByText(BLOCKER_TEXT.unit_without_cnes)).not.toBeNull();
  });

  it("fechar: confirma, manda uma vez e mostra a ficha", async () => {
    let resolve!: (d: ApiDay) => void;
    mocked(api.closeHomeVisitDay).mockReturnValue(new Promise((r) => { resolve = r; }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Fechar o dia" }));
    expect(screen.getByText(CLOSE_EFFECT)).not.toBeNull();
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(api.closeHomeVisitDay).toHaveBeenCalledTimes(1);
    expect(api.closeHomeVisitDay).toHaveBeenCalledWith("d1");
    resolve(day({ state: "closed", closed_by: "user", closed_at: "2026-11-12T10:01:00-03:00", ficha: { status: "pending", reasons: [] } }));
    expect(await screen.findByText("pendente")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Fechar o dia" })).toBeNull();
    expect(screen.getByText(new RegExp(closedByLabel("user", true)))).not.toBeNull();
  });

  it("fechar: 409 day_changed mostra a frase e relê uma vez, sem reenviar", async () => {
    mocked(api.closeHomeVisitDay).mockRejectedValue(new ApiError(409, { error: "day_changed" }, "x"));
    mount();
    await closeNow();
    expect(await screen.findByText(DAY_CHANGED)).not.toBeNull();
    await waitFor(() => expect(api.getHomeVisitDay).toHaveBeenCalledTimes(2));
    expect(api.closeHomeVisitDay).toHaveBeenCalledTimes(1);
  });

  it("fechar: 403 feature_disabled mostra a frase do interruptor", async () => {
    mocked(api.closeHomeVisitDay).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "home_visits" }, "x"));
    mount();
    await closeNow();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
  });

  it("folha fechada de hoje: cartão com a ficha e quem fechou (folha cheia)", async () => {
    mocked(api.listHomeVisitDays).mockResolvedValue({ items: [ day({ visits: undefined, state: "closed", closed_by: "full", visits_count: 99, ficha: { status: "pending", reasons: [] } }) ], next_before: null });
    mount();
    expect(await screen.findByText("pendente")).not.toBeNull();
    expect(screen.getByText(new RegExp("folha cheia \\(99 visitas\\)"))).not.toBeNull();
    expect(api.getHomeVisitDay).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Fechar o dia" })).toBeNull();
  });

  it("retirar: motivo 10–500 com o aviso congelado; expected_state; 409 visit_changed relê", async () => {
    mocked(api.withdrawHomeVisit).mockRejectedValueOnce(new ApiError(409, { error: "visit_changed" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retirar visita das 09:15" }));
    const reason = screen.getByLabelText("Motivo da retirada");
    expectFrozenNotice(reason);
    fireEvent.change(reason, { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect(api.withdrawHomeVisit).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: "Registrei na casa errada." } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect(await screen.findByText(VISIT_CHANGED)).not.toBeNull();
    await waitFor(() => expect(api.getHomeVisitDay).toHaveBeenCalledTimes(2));
    expect(api.withdrawHomeVisit).toHaveBeenCalledTimes(1);
    expect(api.withdrawHomeVisit).toHaveBeenCalledWith("v1", "Registrei na casa errada.");
  });

  it("retirar: 404 not_found diz que releu, e relê uma vez", async () => {
    mocked(api.withdrawHomeVisit).mockRejectedValueOnce(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retirar visita das 09:15" }));
    fireEvent.change(screen.getByLabelText("Motivo da retirada"), { target: { value: "Registrei na casa errada." } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect(await screen.findByText(NOT_FOUND_REREAD)).not.toBeNull();
    await waitFor(() => expect(api.getHomeVisitDay).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(HOME_VISIT_ERRORS.not_found)).toBeNull();
  });

  it("retirar: sucesso relê e o cartão retirado mostra o motivo", async () => {
    mocked(api.withdrawHomeVisit).mockResolvedValue(visit({ state: "withdrawn", can_withdraw: false }));
    mocked(api.getHomeVisitDay).mockResolvedValueOnce(day()).mockResolvedValue(day({ withdrawn_count: 1, visits: [
      visit({ state: "withdrawn", can_withdraw: false, withdrawn: { at: "2026-11-12T10:05:00-03:00", reason: "Registrei na casa errada.", by: { name: "Joana ACS" } } }) ] }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retirar visita das 09:15" }));
    fireEvent.change(screen.getByLabelText("Motivo da retirada"), { target: { value: "Registrei na casa errada." } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect(await screen.findByText(/retirada: Registrei na casa errada\./)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Retirar visita/ })).toBeNull();
  });

  it("sem can_withdraw, retirada ou folha fechada: sem botão Retirar", async () => {
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ visits: [ visit({ can_withdraw: false }), visit({ id: "v2", state: "withdrawn", occurred_at: "2026-11-12T09:40:00-03:00" }) ] }));
    mount();
    await screen.findAllByText("Maria Lima");
    expect(screen.queryByRole("button", { name: /Retirar visita/ })).toBeNull();
  });

  it("imóvel sem pessoa e família com responsável", async () => {
    mocked(api.getHomeVisitDay).mockResolvedValue(day({ visits: [ visit({ subject: "none", patient: null }),
      visit({ id: "v2", subject: "family_responsible", occurred_at: "2026-11-12T09:40:00-03:00", patient: { id: "pa2", display_name: "José Lima", has_cpf: true, cns_masked: null } }) ] }));
    mount();
    expect(await screen.findByText("imóvel sem pessoa")).not.toBeNull();
    expect(screen.getByText("família — responsável José Lima")).not.toBeNull();
  });

  it("enfermeiro (não registra): frase e nenhuma leitura de folha", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    const go = vi.fn();
    renderWithProviders(<HomeVisitDay now={NOW24B} onGoToTeam={go} />);
    expect(await screen.findByText(HV_CANNOT_REGISTER)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Visitas da equipe" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(api.listHomeVisitDays).not.toHaveBeenCalled();
  });

  it("leitura 404: frase neutra, sem dizer que releu", async () => {
    mocked(api.getHomeVisitDay).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    expect(await screen.findByText("não encontrado — recarregue a lista")).not.toBeNull();
    expect(screen.queryByText(NOT_FOUND_REREAD)).toBeNull();
  });

  it("erro de leitura mostra a frase da recusa", async () => {
    mocked(api.listHomeVisitDays).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "home_visits" }, "x"));
    mount();
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
  });
});
