// src/modules/billing/ProcedureForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), searchBillingSigtap: vi.fn() };
});

import * as api from "../../lib/api";
import { ProcedureForm } from "./ProcedureForm";
import { ProcedureVerdict } from "./ProcedureVerdict";
import type { ProcedureDraft } from "../../lib/billing";
import { renderWithProviders } from "../../test/campaignFixtures";
import { SUTURE, TODAY22, URGENCY, billingUser, procedure } from "../../test/billingFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(billingUser([ "health_professional" ]));
  mocked(api.searchBillingSigtap).mockReset().mockResolvedValue([ URGENCY, SUTURE ]);
});

function setup(dateEditable = false) {
  const submit = vi.fn<(d: ProcedureDraft) => Promise<api.PerformedProcedure>>().mockResolvedValue(procedure());
  const onSaved = vi.fn();
  renderWithProviders(
    <ProcedureForm today={TODAY22} dateEditable={dateEditable} searchDelayMs={0} submit={submit} onSaved={onSaved} onCancel={() => undefined} />
  );
  return { submit, onSaved, form: screen.getByRole("region", { name: "Registrar procedimento" }) };
}

async function pick(form: HTMLElement, term: string, code: string) {
  fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: term } });
  fireEvent.click(await within(form).findByRole("button", { name: new RegExp(`^${code} — `) }));
}

// ActionButton fica ocupado até o fim do clique anterior: reenvio espera o botão voltar.
const sendAgain = async (form: HTMLElement) => fireEvent.click(await within(form).findByRole("button", { name: "Registrar procedimento" }));
const send = (form: HTMLElement) => fireEvent.click(within(form).getByRole("button", { name: "Registrar procedimento" }));

describe("ProcedureForm", () => {
  it("busca na SIGTAP da competência da data e registra com quantidade e caráter", async () => {
    const { form, submit, onSaved } = setup();
    expect(within(form).getByText("Data: 21/10/2026")).not.toBeNull();
    expect(within(form).queryByLabelText("Data do procedimento")).toBeNull();
    await pick(form, "urgencia", "0301060061");
    expect(api.searchBillingSigtap).toHaveBeenCalledWith("urgencia", "202610");
    expect(within(form).getByText("0301060061 — ATENDIMENTO DE URGENCIA EM ATENCAO ESPECIALIZADA")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Caráter"), { target: { value: "urgent" } });
    send(form);
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ sigtap: URGENCY, quantity: "1", cid10: "", character: "urgent", performedOn: TODAY22 }));
    expect(onSaved).toHaveBeenCalledWith(procedure());
  });

  it("sem CID num procedimento que exige: avisa, mas envia — quem decide é o api", async () => {
    const { form, submit } = setup();
    await pick(form, "sutura", "0401010066");
    expect(within(form).getByRole("note").textContent).toBe(
      "a SIGTAP exige CID-10 para faturar este procedimento — sem ele, o registro vale, mas fica não faturável"
    );
    send(form);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(within(form).queryByRole("alert")).toBeNull();
  });

  it("quantidade fora de 1..999, CID mal formado e data no futuro não enviam", async () => {
    const { form, submit } = setup(true);
    await pick(form, "urgencia", "0301060061");
    fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "1000" } });
    send(form);
    expect(within(form).getByRole("alert").textContent).toBe("quantidade de 1 a 999, só números");
    fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("CID-10"), { target: { value: "61S" } });
    await sendAgain(form);
    expect(within(form).getByRole("alert").textContent).toBe("CID-10 inválido — ex.: S61 ou S610");
    fireEvent.change(within(form).getByLabelText("CID-10"), { target: { value: "s61.0" } });
    fireEvent.change(within(form).getByLabelText("Data do procedimento"), { target: { value: "2026-10-22" } });
    await sendAgain(form);
    expect(within(form).getByRole("alert").textContent).toBe("a data do procedimento não pode ser no futuro");
    expect(submit).not.toHaveBeenCalled();
  });

  it("data editável troca a competência da busca", async () => {
    const { form } = setup(true);
    fireEvent.change(within(form).getByLabelText("Data do procedimento"), { target: { value: "2026-09-30" } });
    expect(within(form).getByText("tabela SIGTAP da competência 09/2026")).not.toBeNull();
    await pick(form, "urgencia", "0301060061");
    expect(api.searchBillingSigtap).toHaveBeenLastCalledWith("urgencia", "202609");
  });

  it("sem procedimento escolhido não envia; 422 do api vira frase e o formulário fica", async () => {
    const { form, submit } = setup();
    send(form);
    expect(within(form).getByRole("alert").textContent).toBe("escolha o procedimento pela busca");
    submit.mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_date" }, "x"));
    await pick(form, "urgencia", "0301060061");
    send(form);
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "data inválida: fora da competência atual e das 3 anteriores (BPA Magnético 05.00)"
    );
    expect(within(form).getByText("0301060061 — ATENDIMENTO DE URGENCIA EM ATENCAO ESPECIALIZADA")).not.toBeNull();
  });

  it("busca sem resultado e recusa da busca", async () => {
    const { form } = setup();
    mocked(api.searchBillingSigtap).mockResolvedValueOnce([]);
    fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "zz" } });
    expect(await within(form).findByText("nenhum procedimento encontrado")).not.toBeNull();
    mocked(api.searchBillingSigtap).mockRejectedValueOnce(new api.ApiError(403, { error: "feature_disabled", feature: "procedure_billing" }, "x"));
    fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "zzz" } });
    expect((await within(form).findByRole("alert")).textContent).toBe("o faturamento de procedimentos está desligado nesta cidade");
  });

  it("termo da busca acima de 60 caracteres é recusado na tela, sem chamar o api nem cortar", async () => {
    const { form } = setup();
    mocked(api.searchBillingSigtap).mockClear();
    const long = "a".repeat(61);
    fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: long } });
    expect(within(form).getByText("busca com até 60 caracteres — encurte o termo")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.searchBillingSigtap).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "a".repeat(60) } });
    await waitFor(() => expect(api.searchBillingSigtap).toHaveBeenCalledWith("a".repeat(60), "202610"));
  });
});

describe("ProcedureVerdict", () => {
  it("faturável, não faturável com motivo, atraso e SIGTAP de outra competência", () => {
    renderWithProviders(<ProcedureVerdict p={procedure({ billable: false, blocking_reasons: [ "cbo_not_allowed" ], late: true, sigtap_fallback: true, sigtap_competence: "202609" })} />);
    expect(screen.getByText("não faturável — CBO do profissional não permitido para o procedimento")).not.toBeNull();
    expect(screen.getByText("apresentação em atraso")).not.toBeNull();
    expect(screen.getByText(/conferido com a SIGTAP de 09\/2026/)).not.toBeNull();
    cleanup();
    renderWithProviders(<ProcedureVerdict p={procedure()} />);
    expect(screen.getByText("faturável · BPA-I")).not.toBeNull();
    expect(screen.queryByText("apresentação em atraso")).toBeNull();
  });
});
