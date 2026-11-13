import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn() };
});

import * as api from "../../lib/api";
import { HOME_VISITS_DISABLED, COLLECTIVE_DISABLED, HV_NO_ROLE } from "../../lib/homeVisits";
import { renderWithProviders } from "../../test/campaignFixtures";
import { hvUser } from "../../test/homeVisitFixtures";
import { HomeVisitDay } from "../HomeVisitDay";
import { CollectiveActivities } from "../CollectiveActivities";
import { FieldDevices } from "../FieldDevices";
import { FieldDevicesAdmin } from "../FieldDevicesAdmin";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => { mocked(api.fetchCurrentSession).mockReset(); mocked(api.getHomeVisitContext).mockReset(); });

describe("HomeVisitGate", () => {
  it("interruptor desligado: frase e nenhuma leitura", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser(undefined, [ "clinical_record", "collective_activities" ]));
    renderWithProviders(<HomeVisitDay />);
    expect(await screen.findByText(HOME_VISITS_DISABLED)).not.toBeNull();
    expect(api.getHomeVisitContext).not.toHaveBeenCalled();
  });
  it("atividade coletiva desligada: a própria frase", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser(undefined, [ "clinical_record", "territory_registry", "home_visits" ]));
    renderWithProviders(<CollectiveActivities />);
    expect(await screen.findByText(COLLECTIVE_DISABLED)).not.toBeNull();
  });
  it("papel errado: frase do papel", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "municipal_admin" ]));
    renderWithProviders(<HomeVisitDay />);
    expect(await screen.findByText(HV_NO_ROLE)).not.toBeNull();
  });
  it("Q75: aparelhos abrem com home_visits desligado, sem ler o contexto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser(undefined, [ "clinical_record" ]));
    renderWithProviders(<FieldDevices />);
    expect(await screen.findByText("Aparelhos de campo")).not.toBeNull();
    expect(screen.queryByText(HOME_VISITS_DISABLED)).toBeNull();
    expect(screen.queryByText(HV_NO_ROLE)).toBeNull();
    expect(api.getHomeVisitContext).not.toHaveBeenCalled();
  });
  it("Q75: lista da cidade abre para o admin com home_visits desligado; profissional recebe a frase do papel", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "municipal_admin" ], [ "clinical_record" ]));
    renderWithProviders(<FieldDevicesAdmin />);
    expect(await screen.findByText("Aparelhos de campo da cidade")).not.toBeNull();
    expect(screen.queryByText(HOME_VISITS_DISABLED)).toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
    renderWithProviders(<FieldDevicesAdmin />);
    expect(await screen.findByText(HV_NO_ROLE)).not.toBeNull();
  });
});
