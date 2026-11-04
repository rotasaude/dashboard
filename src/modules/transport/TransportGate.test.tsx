import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { trUser } from "../../test/transportFixtures";
import * as api from "../../lib/api";
import { TransportGate } from "./TransportGate";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(user = trUser(), area: "transport" | "tfd" = "transport") {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(
    <TransportGate title="Viagens do dia" sub="agenda" area={area} allow={(r) => (area === "tfd" ? r.committee : r.dispatcher)}>
      {() => <p>dentro</p>}
    </TransportGate>);
}

describe("portão do transporte e do TFD", () => {
  it("interruptor desligado: frase", async () => {
    mount(trUser([ "transport_dispatcher" ], []));
    expect(await screen.findByText("o transporte sanitário está desligado nesta cidade")).not.toBeNull();
    expect(screen.queryByText("dentro")).toBeNull();
  });
  it("papel errado: frase", async () => {
    mount(trUser([ "driver" ]));
    expect(await screen.findByText("seu papel não permite usar o transporte sanitário")).not.toBeNull();
    expect(screen.queryByText("dentro")).toBeNull();
  });
  it("central com o interruptor: abre o corpo e mostra o título", async () => {
    mount(trUser([ "transport_dispatcher" ]));
    expect(await screen.findByText("dentro")).not.toBeNull();
    expect(screen.getByText("Viagens do dia")).not.toBeNull();
  });
  it("TFD desligado e TFD com papel", async () => {
    mount(trUser([ "tfd_committee" ], [ "sanitary_transport", "clinical_record" ]), "tfd");
    expect(await screen.findByText("o TFD está desligado nesta cidade")).not.toBeNull();
    cleanup();
    mount(trUser([ "tfd_committee" ]), "tfd");
    expect(await screen.findByText("dentro")).not.toBeNull();
  });
  it("TFD com o papel errado: frase do TFD", async () => {
    mount(trUser([ "transport_dispatcher" ]), "tfd");
    expect(await screen.findByText("seu papel não permite usar o TFD")).not.toBeNull();
  });
});
