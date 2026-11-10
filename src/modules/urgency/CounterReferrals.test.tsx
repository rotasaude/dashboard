// "Retornos pedidos pela urgência" na UBS (F-32.4; contrato §14 Q11, Q20; preflight A10, C-T13): `{ items }` sem o motivo, lidos
// campo a campo; lista lida ao abrir e quando pedida, sem polling. Nunca na UPA nem no CAPS; só com a urgência utilizável.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/campaignFixtures";
import { UBS, UPA, counterReferral, patientRef, urgencyUser } from "../../test/urgencyFixtures";
import * as api from "../../lib/api";
import { CounterReferrals } from "./CounterReferrals";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listCounterReferrals: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(unit: api.HealthUnit, user = urgencyUser([ "citizen_verifier" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<CounterReferrals unit={unit} />);
}
// A sessão chega e a tela se decide: sem isto, "não aparece" passaria antes do usuário carregar.
async function settled() {
  await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("retornos pedidos pela urgência", () => {
  it("UBS: retornos pedidos pela urgência, sem o motivo na lista", async () => {
    vi.mocked(api.listCounterReferrals).mockResolvedValue([ { encounter_id: "en5", patient: patientRef(), upa: { name: "UPA Boqueirão" },
      closed_at: "2026-11-04T22:10:00-03:00", return_days: 7, due_on: "2026-11-11", reason: "reavaliar a pressão" } as never ]);
    mount(UBS);
    const region = await screen.findByRole("region", { name: "Retornos pedidos pela urgência" });
    expect(await within(region).findByText("Maria Lima")).not.toBeNull();
    expect(within(region).getByText("UPA Boqueirão")).not.toBeNull();
    expect(within(region).getByText("procurar a UBS até 11/11/2026")).not.toBeNull();
    expect(document.body.textContent).not.toContain("reavaliar a pressão");
    expect(screen.getByText("O motivo está na linha do tempo do paciente.")).not.toBeNull();
    expect(api.listCounterReferrals).toHaveBeenCalledWith("ubs1");
  });

  it("lista vazia e releitura só quando pedida", async () => {
    vi.mocked(api.listCounterReferrals).mockResolvedValue([]);
    mount(UBS);
    expect(await screen.findByText("nenhum retorno pedido pela urgência nos últimos 60 dias")).not.toBeNull();
    expect(api.listCounterReferrals).toHaveBeenCalledTimes(1);
    vi.mocked(api.listCounterReferrals).mockResolvedValue([ counterReferral() ]);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByText("José Alves")).not.toBeNull();
    expect(api.listCounterReferrals).toHaveBeenCalledTimes(2);
  });

  it("recusa do api mostra a frase", async () => {
    vi.mocked(api.listCounterReferrals).mockRejectedValue(new api.ApiError(403, { error: "missing_link" }, "403"));
    mount(UBS);
    expect((await screen.findByRole("alert")).textContent).toBe("você não tem vínculo com esta unidade");
  });

  it("só com urgency_care, e nunca na própria UPA", async () => {
    mount(UPA);
    await settled();
    expect(screen.queryByRole("region", { name: "Retornos pedidos pela urgência" })).toBeNull();
    cleanup();
    mount(UBS, urgencyUser([ "citizen_verifier" ], [ "clinical_record" ]));
    await settled();
    expect(screen.queryByRole("region", { name: "Retornos pedidos pela urgência" })).toBeNull();
    cleanup();
    mount({ ...UBS, id: "caps1", kind: "caps" });
    await settled();
    expect(screen.queryByRole("region", { name: "Retornos pedidos pela urgência" })).toBeNull();
    expect(api.listCounterReferrals).not.toHaveBeenCalled();
  });
});
