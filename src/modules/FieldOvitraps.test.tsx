// src/modules/FieldOvitraps.test.tsx
// "Ovitrampas de campo" do agente de endemias (módulo 35a, Task 7; F-35.5; contrato §6, §17; Q7, Q23): só a equipe 515140 lê;
// cartões das ativas com a janela da palheta; instalar exige quarteirão no perfil e o TCLE, com o client_uuid do 24b (o mesmo no
// reenvio por rede); coletar recusa fora da janela antes de enviar; retirar como perdida; recusas do api no campo; tela velha
// relê a lista uma vez. Nunca morador, nunca <table>, nada em storage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listOvitraps: vi.fn(), installOvitrap: vi.fn(), collectOvitrap: vi.fn(),
    getVectorDomains: vi.fn(), listVisitHouseholds: vi.fn(), getHouseholdVectorProfile: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type OvitrapInstallInput } from "../lib/api";
import { HOME_VISIT_ERRORS } from "../lib/homeVisits";
import { VC_NOT_AGENT } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { acsTeam, household } from "../test/homeVisitFixtures";
import {
  TODAY35, VC_DOMAINS, householdProfile, householdVector, ovitrap, vcContext, vcUser
} from "../test/vectorControlFixtures";
import { FieldOvitraps } from "./FieldOvitraps";
import { COLLECT_STALE_REREAD, LOST_ON_REMOVE } from "./vectorControl/CollectForm";
import { INSTALL_NETWORK_RETRY } from "./vectorControl/InstallForm";

const ALL = [ api.fetchCurrentSession, api.getHomeVisitContext, api.listOvitraps, api.installOvitrap, api.collectOvitrap, api.getVectorDomains,
  api.listVisitHouseholds, api.getHouseholdVectorProfile ];
const OV1 = ovitrap({ open_reading: { id: "or1", installed_on: "2026-11-13" } });
const OV2 = ovitrap({ id: "ov2", number: "OV-08", household: { id: "h2", address_short: "Rua das Palmeiras, 33" },
  open_reading: { id: "or2", installed_on: "2026-11-14" }, last_reading: null });
const H1 = household();
const H2 = household({ id: "h2", address_short: "Rua das Palmeiras, 33",
  families: [ { id: "f2", responsible: { patient_id: "pa9", display_name: "Ana Souza", sex: "female" }, moved_out: false, responsible_exited: false } ] });

afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) vi.mocked(f as ReturnType<typeof vi.fn>).mockReset();
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser());
  vi.mocked(api.getHomeVisitContext).mockResolvedValue(vcContext());
  vi.mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  vi.mocked(api.listOvitraps).mockResolvedValue({ items: [ OV1, OV2 ], next_before: null });
  vi.mocked(api.listVisitHouseholds).mockResolvedValue({ items: [ H1, H2 ], next_before: null });
  vi.mocked(api.getHouseholdVectorProfile).mockResolvedValue(householdProfile({ id: "h2" }));
});

const card = (number: string) => within(screen.getByRole("article", { name: `Ovitrampa ${number}` }));
const installBody = (n = 0) => vi.mocked(api.installOvitrap).mock.calls[n][0] as OvitrapInstallInput;
async function openInstall() {
  renderWithProviders(<FieldOvitraps />);
  await screen.findByRole("article", { name: "Ovitrampa OV-07" });
  fireEvent.click(screen.getByRole("button", { name: "Instalar ovitrampa" }));
  await screen.findByRole("button", { name: "Rua das Palmeiras, 33" });
}
async function pickHousehold(address: string) {
  fireEvent.click(await screen.findByRole("button", { name: address }));
  await waitFor(() => expect(screen.queryByText("Carregando o perfil do imóvel…")).toBeNull());
}
function fillInstall(number: string, consent: boolean) {
  fireEvent.change(screen.getByLabelText("Número"), { target: { value: number } });
  const box = screen.getByLabelText("O morador assinou o termo de consentimento (TCLE)") as HTMLInputElement;
  if (box.checked !== consent) fireEvent.click(box);
}
const install = () => fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
async function openCollect(number: string) {
  renderWithProviders(<FieldOvitraps />);
  await screen.findByRole("article", { name: `Ovitrampa ${number}` });
  await waitFor(() => expect(card(number).getByText(/colete entre/)).not.toBeNull());
  fireEvent.click(card(number).getByRole("button", { name: "Coletar palheta" }));
  await screen.findByLabelText("Data da coleta");
}
const collect = () => fireEvent.click(screen.getByRole("button", { name: "Registrar coleta" }));

describe("FieldOvitraps", () => {
  it("só o agente: ACS vê a frase e nada é listado", async () => {
    vi.mocked(api.getHomeVisitContext).mockResolvedValue(vcContext({ teams: [ acsTeam() ] }));
    renderWithProviders(<FieldOvitraps />);
    expect(await screen.findByText(VC_NOT_AGENT)).not.toBeNull();
    expect(api.listOvitraps).not.toHaveBeenCalled();
    expect(api.getVectorDomains).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Instalar ovitrampa" })).toBeNull();
  });

  it("recusa de escopo depois da leitura: cbo_not_allowed e missing_role dão a frase do agente; out_of_scope a dela; nada cru", async () => {
    vi.mocked(api.listOvitraps).mockRejectedValueOnce(new ApiError(403, { error: "cbo_not_allowed" }, "x"));
    renderWithProviders(<FieldOvitraps />);
    expect(await screen.findByText(VC_NOT_AGENT)).not.toBeNull();
    expect(screen.queryByText(/cbo_not_allowed|403/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Instalar ovitrampa" })).toBeNull();
    cleanup();

    vi.mocked(api.listOvitraps).mockRejectedValueOnce(new ApiError(403, { error: "out_of_scope" }, "x"));
    renderWithProviders(<FieldOvitraps />);
    expect(await screen.findByText(HOME_VISIT_ERRORS.out_of_scope)).not.toBeNull();
    expect(screen.queryByText(/out_of_scope|403/)).toBeNull();
  });

  it("cartões das ativas: janela da palheta, quarteirão e última leitura; nenhuma tabela, nenhum dado em storage", async () => {
    vi.mocked(api.listOvitraps).mockResolvedValue({ items: [ ovitrap({ open_reading: { id: "or1", installed_on: "2026-11-10" } }) ], next_before: null });
    renderWithProviders(<FieldOvitraps />);
    expect(await screen.findByText("palheta desde 10/11/2026 — colete entre 13/11 e 20/11 (ideal 15/11)")).not.toBeNull();
    const c = screen.getByRole("article", { name: "Ovitrampa OV-07" });
    expect(api.listOvitraps).toHaveBeenCalledWith({ microAreaId: "ma1", status: "active" });
    expect(api.listOvitraps).toHaveBeenCalledTimes(1);
    const text = c.textContent ?? "";
    expect(text).toContain("Rua das Flores, 120");
    expect(text).toContain("Quarteirão 12");
    expect(text).toContain("palheta desde 10/11/2026 — colete entre 13/11 e 20/11 (ideal 15/11)");
    expect(text).toContain("última leitura em 09/11/2026 · em bom estado · 42 ovos");
    expect(document.querySelector("table")).toBeNull();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("instalar: exige quarteirão e o TCLE; manda client_uuid, consent true e a data", async () => {
    vi.mocked(api.getHouseholdVectorProfile).mockResolvedValueOnce(householdProfile({ vector: householdVector({ city_block_id: null }) }));
    vi.mocked(api.installOvitrap).mockResolvedValue(ovitrap({ id: "ov9", number: "OV-12", household: { id: "h2", address_short: "Rua das Palmeiras, 33" } }));
    await openInstall();
    // Nunca morador: a lista de domicílios só com o endereço curto.
    expect(screen.queryByText(/José Lima|Ana Souza/)).toBeNull();

    await pickHousehold("Rua das Flores, 120");
    expect(screen.getByText(VECTOR_ERRORS.household_without_block)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Instalar" }).getAttribute("aria-disabled")).toBe("true");
    fillInstall("OV-12", true);
    install();
    expect(api.installOvitrap).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Trocar domicílio" }));
    await pickHousehold("Rua das Palmeiras, 33");
    expect(api.getHouseholdVectorProfile).toHaveBeenLastCalledWith("h2");
    expect(screen.queryByText(VECTOR_ERRORS.household_without_block)).toBeNull();

    // Q7(6): espaço no número recusa antes de enviar.
    fillInstall("OV 12", false);
    install();
    expect(await screen.findByText("número da ovitrampa: de 1 a 12 letras, dígitos ou hífen, sem espaço")).not.toBeNull();
    expect(api.installOvitrap).not.toHaveBeenCalled();

    fillInstall("OV-12", false);
    install();
    expect(await screen.findByText(VECTOR_ERRORS.consent_required)).not.toBeNull();
    expect(api.installOvitrap).not.toHaveBeenCalled();

    fillInstall("OV-12", true);
    install();
    install(); // duplo clique: um envio
    await waitFor(() => expect(api.installOvitrap).toHaveBeenCalledTimes(1));
    expect(installBody()).toEqual({ client_uuid: expect.any(String), household_id: "h2", number: "OV-12", consent: true, installed_on: TODAY35 });
    expect(installBody().client_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("ovitrampa OV-12 instalada")).not.toBeNull();
    // Uma releitura da lista depois da instalação.
    await waitFor(() => expect(api.listOvitraps).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Número")).toBeNull();
  });

  it("coletar: 2 dias recusa antes de enviar; 3 dias envia com reinstalar", async () => {
    vi.mocked(api.collectOvitrap).mockResolvedValue(ovitrap({ version: 3 }));
    await openCollect("OV-08");
    expect((screen.getByLabelText("Data da coleta") as HTMLInputElement).value).toBe(TODAY35);
    expect((screen.getByLabelText("Reinstalar palheta") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("em bom estado"));
    collect();
    expect(await screen.findByText(VECTOR_ERRORS.collection_out_of_range)).not.toBeNull();
    expect(api.collectOvitrap).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(card("OV-07").getByRole("button", { name: "Coletar palheta" }));
    fireEvent.click(await screen.findByLabelText("em bom estado"));
    collect();
    collect(); // duplo clique: um envio
    await waitFor(() => expect(api.collectOvitrap).toHaveBeenCalledTimes(1));
    expect(api.collectOvitrap).toHaveBeenCalledWith("ov1", { collected_on: "2026-11-16", condition: "ok", reinstall: true, remove: false });
    expect(await screen.findByText("palheta da ovitrampa OV-07 coletada")).not.toBeNull();
    await waitFor(() => expect(api.listOvitraps).toHaveBeenCalledTimes(2));
  });

  it("retirar perdida: reinstalar desmarca; o corpo leva remove true e condition lost", async () => {
    vi.mocked(api.collectOvitrap).mockResolvedValue(ovitrap({ status: "lost", removed_on: TODAY35, open_reading: null }));
    await openCollect("OV-07");
    fireEvent.click(screen.getByLabelText("Retirar a ovitrampa"));
    const reinstall = screen.getByLabelText("Reinstalar palheta") as HTMLInputElement;
    expect(reinstall.checked).toBe(false);
    expect(reinstall.disabled).toBe(true);
    expect(screen.queryByText(LOST_ON_REMOVE)).toBeNull();
    fireEvent.click(screen.getByLabelText("perdida"));
    expect(screen.getByText(LOST_ON_REMOVE)).not.toBeNull();
    collect();
    await waitFor(() => expect(api.collectOvitrap).toHaveBeenCalledTimes(1));
    expect(api.collectOvitrap).toHaveBeenCalledWith("ov1", { collected_on: TODAY35, condition: "lost", reinstall: false, remove: true });
    expect(await screen.findByText("ovitrampa OV-07 registrada como perdida")).not.toBeNull();
  });

  it("409 ovitrap_number_taken no campo; rede guarda o uuid e 'Tentar de novo' manda o mesmo", async () => {
    // O api responde 422 (Q23), não 409: a frase vai ao campo "Número".
    vi.mocked(api.installOvitrap)
      .mockRejectedValueOnce(new ApiError(422, { error: "ovitrap_number_taken", path: "number" }, "x"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ovitrap({ id: "ov9", number: "OV-13" }));
    await openInstall();
    await pickHousehold("Rua das Palmeiras, 33");
    fillInstall("OV-12", true);
    install();
    expect(await screen.findByText(VECTOR_ERRORS.ovitrap_number_taken)).not.toBeNull();
    expect(screen.getByLabelText("Número").getAttribute("aria-invalid")).toBe("true");
    expect(api.listOvitraps).toHaveBeenCalledTimes(1);

    fillInstall("OV-13", true);
    install();
    expect(await screen.findByText(INSTALL_NETWORK_RETRY)).not.toBeNull();
    expect((screen.getByLabelText("Número") as HTMLInputElement).disabled).toBe(true);
    // A recusa do 4xx trocou o uuid; o da rede fica para o reenvio.
    expect(installBody(1).client_uuid).not.toBe(installBody(0).client_uuid);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(api.installOvitrap).toHaveBeenCalledTimes(3));
    expect(installBody(2)).toEqual(installBody(1));
    expect(await screen.findByText("ovitrampa OV-13 instalada")).not.toBeNull();
  });

  it("tela velha: ovitrampa já inativa ou sumida dá a frase, relê a lista uma vez e não reenvia", async () => {
    vi.mocked(api.collectOvitrap).mockRejectedValueOnce(new ApiError(422, { error: "ovitrap_not_active", path: "ovitrap_id" }, "x"));
    await openCollect("OV-07");
    fireEvent.click(screen.getByLabelText("em bom estado"));
    collect();
    expect(await screen.findByText(`${VECTOR_ERRORS.ovitrap_not_active} — ${COLLECT_STALE_REREAD}`)).not.toBeNull();
    await waitFor(() => expect(api.listOvitraps).toHaveBeenCalledTimes(2));
    expect(api.collectOvitrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Data da coleta")).toBeNull();
    cleanup();

    vi.mocked(api.listOvitraps).mockClear();
    vi.mocked(api.collectOvitrap).mockReset().mockRejectedValueOnce(new ApiError(404, { error: "not_found" }, "x"));
    await openCollect("OV-07");
    fireEvent.click(screen.getByLabelText("em bom estado"));
    collect();
    await waitFor(() => expect(api.listOvitraps).toHaveBeenCalledTimes(2));
    expect(api.collectOvitrap).toHaveBeenCalledTimes(1);
  });
});
