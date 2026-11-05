import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import * as api from "../lib/api";
import { currentUnitKey } from "../lib/attendance";
import { Attendance } from "./Attendance";

// A fila e a escuta recebem as unidades de destino do encaminhamento; aqui só se confere o que chega a elas.
vi.mock("./attendance/UnitQueue", () => ({ UnitQueue: ({ units }: { units: { name: string }[] }) => <p data-testid="queue-units">{units.map((u) => u.name).join("|")}</p> }));
vi.mock("./attendance/ScreeningQueue", () => ({ ScreeningQueue: ({ units }: { units: { name: string }[] }) => <p data-testid="screening-units">{units.map((u) => u.name).join("|")}</p> }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listActiveUnits: vi.fn(), getMyProfessional: vi.fn(),
  listAllUnits: vi.fn(), listVerifications: vi.fn(), listUnitRequests: vi.fn(), getUnitAgenda: vi.fn(), listUnassignedRequests: vi.fn(),
  listPendingErasures: vi.fn(), listAppointmentTypes: vi.fn() }));

afterEach(() => { cleanup(); localStorage.clear(); });

const UBS = { id: "un1", name: "UBS Centro", kind: "ubs" };
const UPA = { id: "un2", name: "UPA Norte", kind: "upa" };
const CAPS = { id: "c1", name: "CAPS AD III Boqueirão", kind: "caps" };

describe("Atendimento — destinos de encaminhamento sem o CAPS (P46/P53)", () => {
  beforeEach(() => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue({
      id: "u1", email_address: "a@cidade.gov.br", operator: false, mfa_enrolled: true, mfa_verified_at: null,
      memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "health_professional" } ]
    });
    localStorage.setItem(currentUnitKey("u1"), UBS.id);
    vi.mocked(api.listActiveUnits).mockResolvedValue([ UBS, UPA, CAPS ] as never);
    vi.mocked(api.getMyProfessional).mockResolvedValue({ professional: {} as api.Professional, shifts: [],
      links: [ { id: "l1", health_unit_id: "un1", unit_name: "UBS Centro", cbo_code: "225125", cbo_title: null, started_at: "x", started_by: "a", ended_at: null, ended_by: null } ] });
  });

  it("a fila e a escuta recebem as unidades sem o CAPS", async () => {
    renderWithProviders(<Attendance onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("queue-units").textContent).toBe("UBS Centro|UPA Norte"));
    await waitFor(() => expect(screen.getByTestId("screening-units").textContent).toBe("UBS Centro|UPA Norte"));
  });
});
