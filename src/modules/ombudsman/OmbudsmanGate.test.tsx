import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { ombudsmanUser } from "../../test/ombudsmanFixtures";
import * as api from "../../lib/api";
import { OMBUDSMAN_DISABLED, OMBUDSMAN_NO_ROLE } from "../../lib/ombudsman";
import { OmbudsmanGate } from "./OmbudsmanGate";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(user: ReturnType<typeof ombudsmanUser>) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(
    <OmbudsmanGate title="Caixa da ouvidoria" sub="manifestações" allow={(r) => r.staff}>
      {(roles) => <p>{roles.lead ? "dentro como ouvidor" : "dentro como técnico"}</p>}
    </OmbudsmanGate>);
}

describe("portão da ouvidoria", () => {
  it("sem o interruptor: frase, título, e nada do api além da sessão", async () => {
    mount(ombudsmanUser([ "ombudsman" ], []));
    expect(await screen.findByText(OMBUDSMAN_DISABLED)).not.toBeNull();
    expect(screen.getByText("Caixa da ouvidoria")).not.toBeNull();
    expect(screen.queryByText(/dentro como/)).toBeNull();
  });
  it("papel errado: frase de papel", async () => {
    mount(ombudsmanUser([ "ombudsman_responder" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(screen.queryByText(/dentro como/)).toBeNull();
  });
  it("papel certo: o corpo recebe os papéis", async () => {
    mount(ombudsmanUser([ "ombudsman" ]));
    expect(await screen.findByText("dentro como ouvidor")).not.toBeNull();
    cleanup();
    mount(ombudsmanUser([ "ombudsman_staff" ]));
    expect(await screen.findByText("dentro como técnico")).not.toBeNull();
  });
});
