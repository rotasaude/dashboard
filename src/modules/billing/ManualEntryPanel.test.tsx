// src/modules/billing/ManualEntryPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listBillingProfessionals: vi.fn(), lookupBillingPatient: vi.fn(), searchBillingSigtap: vi.fn(),
    recordProcedure: vi.fn() };
});

import * as api from "../../lib/api";
import { ManualEntryPanel, ManualEntrySection } from "./ManualEntryPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { PROFESSIONALS_KEY } from "../../lib/billing";
import { LAB_EST, PATIENT, PROFESSIONALS, TODAY22, UPA_EST, URGENCY, billingUser, procedure } from "../../test/billingFixtures";
import { VALID_CPF } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listBillingProfessionals, api.lookupBillingPatient, api.searchBillingSigtap, api.recordProcedure ];
afterEach(cleanup);
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ]));
  mocked(api.listBillingProfessionals).mockResolvedValue(PROFESSIONALS);
  mocked(api.lookupBillingPatient).mockResolvedValue(PATIENT);
  mocked(api.searchBillingSigtap).mockResolvedValue([ URGENCY ]);
  mocked(api.recordProcedure).mockResolvedValue(procedure({ id: "pp7", source: "manual", source_ref: null }));
});

function open(onSaved = vi.fn()) {
  renderWithProviders(<ManualEntryPanel establishments={[ UPA_EST, LAB_EST ]} today={TODAY22} searchDelayMs={0} onSaved={onSaved} onClose={() => undefined} />);
  return { panel: screen.getByRole("region", { name: "Lançamento manual" }), onSaved };
}

async function choose(panel: HTMLElement, professional: string) {
  fireEvent.change(within(panel).getByLabelText("Estabelecimento"), { target: { value: "health_unit:u7" } });
  await within(panel).findByRole("option", { name: "Dra. Helena Prado" });
  fireEvent.change(within(panel).getByLabelText("Profissional"), { target: { value: professional } });
}

async function patientAndProcedure(panel: HTMLElement) {
  fireEvent.change(within(panel).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
  fireEvent.click(within(panel).getByRole("button", { name: "Buscar paciente" }));
  await within(panel).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
  fireEvent.change(within(panel).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "urgencia" } });
  fireEvent.click(await within(panel).findByRole("button", { name: /^0301060061 — / }));
}

const send = (panel: HTMLElement) => fireEvent.click(within(panel).getByRole("button", { name: "Registrar procedimento" }));

describe("ManualEntryPanel", () => {
  it("estabelecimento → profissionais dele; CBO único vem escolhido; registra com profissional e CBO, sem atendimento", async () => {
    const { panel, onSaved } = open();
    await choose(panel, "us1");
    expect(api.listBillingProfessionals).toHaveBeenCalledWith({ type: "health_unit", id: "u7" });
    expect(within(panel).getByText("CBO 225125")).not.toBeNull();
    expect(within(panel).queryByLabelText("CBO")).toBeNull();
    await patientAndProcedure(panel);
    fireEvent.change(within(panel).getByLabelText("Data do procedimento"), { target: { value: "2026-10-02" } });
    send(panel);
    await waitFor(() => expect(api.recordProcedure).toHaveBeenCalledWith({
      establishment: { type: "health_unit", id: "u7" }, performed_on: "2026-10-02", sigtap_code: "0301060061", quantity: 1,
      character: "elective", patient_id: "pa1", professional_user_id: "us1", cbo_code: "225125"
    }));
    expect(onSaved).toHaveBeenCalledWith(procedure({ id: "pp7", source: "manual", source_ref: null }));
  });

  it("CBO com mais de uma opção exige escolha; sem CBO no vínculo segue sem cbo_code", async () => {
    const { panel } = open();
    await choose(panel, "us3");
    await patientAndProcedure(panel);
    send(panel);
    expect(within(panel).getByRole("alert").textContent).toBe("escolha o CBO do profissional");
    await within(panel).findByRole("button", { name: "Registrar procedimento" });
    fireEvent.change(within(panel).getByLabelText("CBO"), { target: { value: "223565" } });
    send(panel);
    await waitFor(() => expect(api.recordProcedure).toHaveBeenLastCalledWith(expect.objectContaining({ professional_user_id: "us3", cbo_code: "223565" })));
    await within(panel).findByRole("button", { name: "Registrar procedimento" });
    fireEvent.change(within(panel).getByLabelText("Profissional"), { target: { value: "us4" } });
    expect(within(panel).getByText(/profissional sem CBO no vínculo/)).not.toBeNull();
    send(panel);
    await waitFor(() => expect(api.recordProcedure).toHaveBeenCalledTimes(2));
    expect(mocked(api.recordProcedure).mock.calls[1][0]).not.toHaveProperty("cbo_code");
    expect(mocked(api.recordProcedure).mock.calls[1][0].professional_user_id).toBe("us4");
  });

  it("sem estabelecimento ou paciente não envia; o que falta vem primeiro", async () => {
    const { panel } = open();
    fireEvent.change(within(panel).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "urgencia" } });
    fireEvent.click(await within(panel).findByRole("button", { name: /^0301060061 — / }));
    send(panel);
    expect(within(panel).getByRole("alert").textContent).toBe("escolha o estabelecimento");
    await within(panel).findByRole("button", { name: "Registrar procedimento" });
    await choose(panel, "us1");
    send(panel);
    expect(within(panel).getByRole("alert").textContent).toBe("busque o paciente pelo CPF");
    expect(api.recordProcedure).not.toHaveBeenCalled();
  });

  it("422 invalid_professional (vínculo encerrado no meio) vira frase", async () => {
    mocked(api.recordProcedure).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_professional" }, "x"));
    const { panel } = open();
    await choose(panel, "us1");
    await patientAndProcedure(panel);
    send(panel);
    expect((await within(panel).findByRole("alert")).textContent).toBe("este profissional não tem vínculo com o estabelecimento — escolha outro");
  });
});

describe("ManualEntrySection", () => {
  it("abre pelo botão, fecha ao salvar e devolve a frase da crítica", async () => {
    const onSaved = vi.fn();
    mocked(api.recordProcedure).mockResolvedValueOnce(procedure({ billable: false, blocking_reasons: [ "missing_professional_cns" ] }));
    renderWithProviders(<ManualEntrySection establishments={[ UPA_EST ]} today={TODAY22} searchDelayMs={0} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Lançamento manual" }));
    const panel = screen.getByRole("region", { name: "Lançamento manual" });
    await choose(panel, "us1");
    await patientAndProcedure(panel);
    send(panel);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(
      "Procedimento registrado — não faturável — profissional sem CNS no cadastro. O registro vale; o faturamento confere de novo no fechamento."
    ));
    expect(screen.queryByRole("region", { name: "Lançamento manual" })).toBeNull();
  });

  it("profissionais: sem releitura por foco ou rede, e sem cache guardado", async () => {
    const { client } = renderWithProviders(
      <ManualEntryPanel establishments={[ UPA_EST, LAB_EST ]} today={TODAY22} searchDelayMs={0} onSaved={vi.fn()} onClose={() => undefined} />
    );
    const panel = screen.getByRole("region", { name: "Lançamento manual" });
    await choose(panel, "us1");
    expect(api.listBillingProfessionals).toHaveBeenCalledTimes(1);
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    act(() => { onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listBillingProfessionals).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().find({ queryKey: [ PROFESSIONALS_KEY, "health_unit:u7" ] })?.options.gcTime).toBe(0);
    act(() => { focusManager.setFocused(undefined); });
  });

  it("paciente com display_name nulo: o lançamento mostra a frase, não \"null\"", async () => {
    mocked(api.lookupBillingPatient).mockResolvedValue({ ...PATIENT, display_name: null });
    const { panel } = open();
    fireEvent.change(within(panel).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(panel).getByRole("button", { name: "Buscar paciente" }));
    await within(panel).findByText("Paciente: paciente sem nome no cadastro · CPF ***.982.247-**");
    expect(panel.textContent).not.toMatch(/null/);
  });
});
