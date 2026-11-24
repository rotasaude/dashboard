import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn() };
});

import * as api from "../../lib/api";
import { ZOO_NO_ROLE, type ZoonosesRoles } from "../../lib/zoonoses";
import { ZOONOSES_DISABLED } from "../../lib/zoonosesErrors";
import { renderWithProviders } from "../../test/campaignFixtures";
import { zooUser } from "../../test/zoonosesFixtures";
import { ZoonosesGate } from "./ZoonosesGate";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => { mocked(api.fetchCurrentSession).mockReset(); });

const gate = (allow: (r: ZoonosesRoles) => boolean, children: (r: ZoonosesRoles) => JSX.Element) =>
  <ZoonosesGate title="Animais" sub="zoonoses · animais" allow={allow}>{children}</ZoonosesGate>;

describe("ZoonosesGate", () => {
  it("sem o interruptor: frase do desligado e children nunca é chamado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "zoonoses_team" ], [ "clinical_record", "territory_registry" ]));
    const children = vi.fn(() => <p>corpo</p>);
    renderWithProviders(gate(() => true, children));
    expect(await screen.findByText(ZOONOSES_DISABLED)).not.toBeNull();
    expect(screen.getByText("Animais")).not.toBeNull();
    expect(children).not.toHaveBeenCalled();
  });
  it("papel errado: frase do papel, sem children", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "municipal_admin" ]));
    const children = vi.fn(() => <p>corpo</p>);
    renderWithProviders(gate((r) => r.team, children));
    expect(await screen.findByText(ZOO_NO_ROLE)).not.toBeNull();
    expect(children).not.toHaveBeenCalled();
  });
  it("equipe: children com os papéis", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser());
    const children = vi.fn((r: ZoonosesRoles) => <p>{r.team ? "corpo da equipe" : "x"}</p>);
    renderWithProviders(gate((r) => r.team, children));
    expect(await screen.findByText("corpo da equipe")).not.toBeNull();
  });
});
