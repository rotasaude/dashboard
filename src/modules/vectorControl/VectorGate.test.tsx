import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn() };
});

import * as api from "../../lib/api";
import { VC_NOT_AGENT, VC_NO_ROLE, type VectorRoles } from "../../lib/vectorControl";
import { VECTOR_CONTROL_DISABLED } from "../../lib/vectorErrors";
import { renderWithProviders } from "../../test/campaignFixtures";
import { acsTeam } from "../../test/homeVisitFixtures";
import { vcContext, vcUser } from "../../test/vectorControlFixtures";
import { VectorGate } from "./VectorGate";
import { VectorBlocks } from "../VectorBlocks";
import { VectorLiraa } from "../VectorLiraa";
import { FieldOvitraps } from "../FieldOvitraps";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => { mocked(api.fetchCurrentSession).mockReset(); });

const gate = (allow: (r: VectorRoles) => boolean, children: (r: VectorRoles) => JSX.Element) =>
  <VectorGate title="Quarteirões e imóveis" sub="endemias · quarteirões" allow={allow}>{children}</VectorGate>;

describe("VectorGate", () => {
  it("sem o interruptor: frase do desligado, cabeçalho, e children nunca é chamado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ], [ "clinical_record", "territory_registry", "home_visits" ]));
    const children = vi.fn(() => <p>corpo</p>);
    const allow = vi.fn(() => true);
    renderWithProviders(gate(allow, children));
    expect(await screen.findByText(VECTOR_CONTROL_DISABLED)).not.toBeNull();
    expect(screen.getByText("Quarteirões e imóveis")).not.toBeNull();
    expect(children).not.toHaveBeenCalled();
    expect(screen.queryByText("corpo")).toBeNull();
  });

  it("sem a visita domiciliar utilizável também é o desligado (Q1)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ], [ "clinical_record", "territory_registry", "vector_control" ]));
    const children = vi.fn(() => <p>corpo</p>);
    renderWithProviders(gate(() => true, children));
    expect(await screen.findByText(VECTOR_CONTROL_DISABLED)).not.toBeNull();
    expect(children).not.toHaveBeenCalled();
  });

  it("papel errado: frase do papel, sem children", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "vector_lab" ]));
    const children = vi.fn(() => <p>corpo</p>);
    renderWithProviders(gate((r) => r.coordinator, children));
    expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
    expect(children).not.toHaveBeenCalled();
  });

  it("operador com o papel e o interruptor: frase do papel, não a do desligado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue({ ...vcUser([ "endemic_coordinator" ]), operator: true });
    const children = vi.fn(() => <p>corpo</p>);
    renderWithProviders(gate(() => true, children));
    expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
    expect(screen.queryByText(VECTOR_CONTROL_DISABLED)).toBeNull();
    expect(children).not.toHaveBeenCalled();
  });

  it("coordenação: children recebe os papéis", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    const children = vi.fn((r: VectorRoles) => <p>{r.coordinator ? "corpo da coordenação" : "outro"}</p>);
    renderWithProviders(gate((r) => r.coordinator, children));
    expect(await screen.findByText("corpo da coordenação")).not.toBeNull();
    expect(children.mock.calls[0][0]).toEqual({
      coordinator: true, lab: false, reader: true, admin: false, professional: false, stockKeeper: false
    });
    expect(screen.queryByText(VC_NO_ROLE)).toBeNull();
  });

  it("as cascas usam o portão: coordenação vê Em construção; o profissional passa na de campo (Task 7: a tela confere a equipe); o laboratório nos quarteirões, a frase do papel", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
    renderWithProviders(<VectorLiraa />);
    expect(await screen.findByText("Em construção")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "health_professional" ]));
    mocked(api.getHomeVisitContext).mockResolvedValue(vcContext({ teams: [ acsTeam() ] }));
    renderWithProviders(<FieldOvitraps />);
    expect(await screen.findByText(VC_NOT_AGENT)).not.toBeNull();
    expect(screen.queryByText(VC_NO_ROLE)).toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "vector_lab" ]));
    renderWithProviders(<VectorBlocks />);
    expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
  });
});
