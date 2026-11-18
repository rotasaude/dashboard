// src/modules/HomeVisitDay.due.test.tsx
// "Imóveis a visitar" na Folha do dia (módulo 35a, Task 6; F-35.4): a lista do agente de endemias na ordem do api, sem pessoa,
// com motivo, risco e quarteirão; "Registrar visita" abre o formulário com o vínculo do boletim; ACS ou gate desligado não leem;
// depois de gravar a visita com boletim, uma releitura.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getVisitHousehold: vi.fn(), getHouseholdVectorProfile: vi.fn(), listCityBlocks: vi.fn(),
    recordHomeVisit: vi.fn(), listVisitHouseholds: vi.fn(), getHomeVisitContext: vi.fn(), listHomeVisitDays: vi.fn(), getHomeVisitDay: vi.fn(),
    getVectorDomains: vi.fn(), listDue: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type HomeVisitInput } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { acsTeam, day, householdDetail, visit } from "../test/homeVisitFixtures";
import {
  NOW35, VC_DOMAINS, agentTeam, dueItem, householdProfile, inspection, vcContext, vcUser
} from "../test/vectorControlFixtures";
import { HomeVisitDay } from "./HomeVisitDay";
import { DUE_CBO_NOT_ALLOWED, DUE_EMPTY, startFor } from "./vectorControl/DueList";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getVisitHousehold, api.getHouseholdVectorProfile, api.listCityBlocks, api.recordHomeVisit,
  api.listVisitHouseholds, api.getHomeVisitContext, api.listHomeVisitDays, api.getHomeVisitDay, api.getVectorDomains, api.listDue ];

afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser());
  mocked(api.getHomeVisitContext).mockResolvedValue(vcContext());
  mocked(api.listHomeVisitDays).mockResolvedValue({ items: [], next_before: null });
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  mocked(api.getVisitHousehold).mockResolvedValue(householdDetail());
  mocked(api.getHouseholdVectorProfile).mockResolvedValue(householdProfile());
  mocked(api.listCityBlocks).mockResolvedValue([]);
  mocked(api.listVisitHouseholds).mockResolvedValue({ items: [], next_before: null });
  mocked(api.listDue).mockResolvedValue({ items: [], next_before: null });
});

const mount = () => renderWithProviders(<HomeVisitDay now={NOW35} />);
const body = (n = 0) => mocked(api.recordHomeVisit).mock.calls[n][0] as HomeVisitInput;
const panel = () => within(screen.getByRole("region", { name: "Imóveis a visitar" }));

// Abre o formulário pelo cartão do bloqueio, escolhe imóvel sem pessoa e fechado, e envia.
async function startBlockVisitAndSend() {
  const card = within((await screen.findAllByRole("article"))[0]);
  fireEvent.click(card.getByRole("button", { name: "Registrar visita" }));
  await screen.findByLabelText("Imóvel sem pessoa");
  await waitFor(() => expect(screen.queryByText("Carregando o perfil do imóvel…")).toBeNull());
  fireEvent.click(screen.getByLabelText("Imóvel sem pessoa"));
  fireEvent.click(screen.getByLabelText("Fechado"));
  fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
}

describe("Imóveis a visitar na Folha do dia", () => {
  it("agente: lista sem pessoa, na ordem do api, com motivo, risco e quarteirão", async () => {
    vi.mocked(api.listDue).mockResolvedValue({ items: [ dueItem({ reason: "transmission_block", transmission_block_id: "tb1" }), dueItem({ household_id: "h2", reason: "due", block: null, last_worked_on: null }) ], next_before: null });
    mount();
    const cards = await screen.findAllByRole("article");
    expect(cards.map((c) => c.textContent)).toEqual([ expect.stringMatching(/bloqueio.*Quarteirão 12/), expect.stringMatching(/vencido.*sem quarteirão.*nunca trabalhado/) ]);
    expect(api.listDue).toHaveBeenCalledWith("ma1", null);
    // Endereço curto e tipo do imóvel, risco pelo rótulo do domínio, último trabalho e vencimento; nenhum morador.
    expect(cards[0].textContent).toMatch(/Rua das Flores, 120/);
    expect(cards[0].textContent).toMatch(/Amarelo \(médio\)/);
    expect(cards[0].textContent).toMatch(/trabalhado em 10\/09\/2026/);
    expect(cards[0].textContent).toMatch(/vencido desde 09\/11\/2026/);
    expect(screen.queryByText(/José Lima|Maria Lima/)).toBeNull();
  });

  it("Registrar visita do bloqueio abre o formulário com a atividade e o vínculo", async () => {
    vi.mocked(api.listDue).mockResolvedValue({ items: [ dueItem({ reason: "transmission_block", transmission_block_id: "tb1" }) ], next_before: null });
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit({ vector_inspection: inspection() }), day: day({ visits: undefined }), replayed: false });
    mount();
    const card = within((await screen.findAllByRole("article"))[0]);
    fireEvent.click(card.getByRole("button", { name: "Registrar visita" }));
    const activity = await screen.findByLabelText("Atividade") as HTMLSelectElement;
    expect(activity.value).toBe("transmission_block");
    expect(activity.selectedOptions[0].textContent).toBe("Bloqueio de transmissão");
    expect(api.getVisitHousehold).toHaveBeenCalledWith("h1");
    await waitFor(() => expect(screen.queryByText("Carregando o perfil do imóvel…")).toBeNull());
    fireEvent.click(screen.getByLabelText("Imóvel sem pessoa"));
    fireEvent.click(screen.getByLabelText("Fechado"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar visita" }));
    await waitFor(() => expect(api.recordHomeVisit).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({ team_id: "t1", household_id: "h1" });
    expect(body().vector_inspection).toMatchObject({ activity: "transmission_block", transmission_block_id: "tb1", situation: "closed" });
    expect(body().vector_inspection).not.toHaveProperty("liraa_draw_item_id");
  });

  it("ACS ou gate desligado: sem a lista e sem chamar listDue", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext({ teams: [ acsTeam() ] }));
    mount();
    await screen.findByRole("button", { name: "Nova visita" });
    expect(screen.queryByRole("region", { name: "Imóveis a visitar" })).toBeNull();
    cleanup();
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext());
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "health_professional" ], [ "clinical_record", "territory_registry", "home_visits" ]));
    mount();
    await screen.findByRole("button", { name: "Nova visita" });
    expect(screen.queryByRole("region", { name: "Imóveis a visitar" })).toBeNull();
    expect(api.listDue).not.toHaveBeenCalled();
  });

  it("depois de gravar a visita, a lista é relida uma vez", async () => {
    vi.mocked(api.listDue).mockResolvedValue({ items: [ dueItem({ reason: "transmission_block", transmission_block_id: "tb1" }) ], next_before: null });
    vi.mocked(api.recordHomeVisit).mockResolvedValue({ visit: visit({ vector_inspection: inspection() }), day: day({ visits: undefined }), replayed: false });
    mount();
    await startBlockVisitAndSend();
    await waitFor(() => expect(api.listDue).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listDue).toHaveBeenCalledTimes(2);
    // A lista volta à tela (o formulário fechou) com a releitura.
    expect(panel().getAllByRole("article").length).toBe(1);
  });

  it("visita gravada sem boletim e formulário fechado sem gravar: nenhuma releitura", async () => {
    vi.mocked(api.listDue).mockResolvedValue({ items: [ dueItem() ], next_before: null });
    mount();
    const card = within((await screen.findAllByRole("article"))[0]);
    fireEvent.click(card.getByRole("button", { name: "Registrar visita" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await panel().findAllByRole("article");
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listDue).toHaveBeenCalledTimes(1);
  });

  it("vazio, várias microáreas e a recusa de CBO com a frase da lista", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext({ teams: [ agentTeam({ micro_areas: [
      { id: "ma1", code: "01", name: "Vila Verde", scope: "assigned" }, { id: "ma2", code: "02", name: "Jardim Sul", scope: "assigned" } ] }) ] }));
    mount();
    expect(await screen.findByText(DUE_EMPTY)).not.toBeNull();
    mocked(api.listDue).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "x"));
    fireEvent.change(panel().getByLabelText("Microárea"), { target: { value: "ma2" } });
    expect(await panel().findByText(DUE_CBO_NOT_ALLOWED)).not.toBeNull();
    expect(api.listDue).toHaveBeenLastCalledWith("ma2", null);
  });

  it("uma microárea só: sem seletor", async () => {
    mount();
    await screen.findByText(DUE_EMPTY);
    expect(panel().queryByLabelText("Microárea")).toBeNull();
  });

  it("startFor: o vínculo vem do motivo; PE pelo tipo do imóvel; senão nada", () => {
    expect(startFor(dueItem({ reason: "transmission_block", transmission_block_id: "tb1" }))).toEqual({ activity: "transmission_block", transmissionBlockId: "tb1" });
    expect(startFor(dueItem({ reason: "liraa", liraa_draw_item_id: "ld1" }))).toEqual({ activity: "liraa", liraaDrawItemId: "ld1" });
    expect(startFor(dueItem({ reason: "pending" }))).toEqual({ workType: "pending" });
    expect(startFor(dueItem({ property_type: "4" }))).toEqual({ activity: "pe" });
    expect(startFor(dueItem())).toEqual({});
  });
});
