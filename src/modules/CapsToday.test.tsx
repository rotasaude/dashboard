// Hoje no CAPS (F-31.4): grupos e atendimentos do dia da cidade, sem nada clínico; a presença do grupo ali mesmo (registrada vale
// `action_id != null`); abrir a matrícula passa o handoff { enrollmentId, unitId } a "Usuários do CAPS". As frases vêm da lib.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CAPS_II, OPTIONS, TODAY31, action, enrollmentRow, today, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { NO_GROUPS_TODAY, NO_VISITS_TODAY, PRESENCE_DONE_TAG, PRESENCE_SAVED, TODAY_NO_NOTICE } from "../lib/psychosocial";
import { CapsToday } from "./CapsToday";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn(), getPsyOptions: vi.fn(),
  getPsyToday: vi.fn(), getPsyEnrollment: vi.fn(), listPsyEnrollments: vi.fn(), createPsyAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const LATE = new Date("2026-11-04T17:00:00-03:00");

beforeEach(() => {
  // O api não manda clínico no Hoje; se mandar por engano, a tela não mostra.
  const t = today();
  vi.mocked(api.getPsyToday).mockResolvedValue({ ...t, visits: t.visits.map((v) => ({ ...v, cid_main: "F322", notes: "segredo" }) as never) });
  vi.mocked(api.listPsyEnrollments).mockResolvedValue([ enrollmentRow() ]);
  vi.mocked(api.createPsyAction).mockResolvedValue(action({ group_id: "g1" }));
});

function mount(o: { onOpenEnrollment?: (h: { enrollmentId: string; unitId: string }) => void } = {}) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser());
  vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
  vi.mocked(api.getPsyOptions).mockResolvedValue(OPTIONS);
  return renderWithProviders(<CapsToday today={TODAY31} now={LATE} onOpenEnrollment={o.onOpenEnrollment} />);
}

describe("Hoje no CAPS", () => {
  it("junta grupos e atendimentos do dia; nada clínico; abrir passa o handoff com o CAPS", async () => {
    const open = vi.fn();
    mount({ onOpenEnrollment: open });
    expect(await screen.findByText("Oficina de artes")).not.toBeNull();
    expect(screen.getByText("14:00 · Maria da Silva · Lia Psicóloga")).not.toBeNull();
    expect(screen.getByText(TODAY_NO_NOTICE)).not.toBeNull();
    expect(screen.queryByText(/F32/)).toBeNull();
    expect(screen.queryByText("segredo")).toBeNull();
    expect(vi.mocked(api.getPsyToday).mock.calls[0]).toEqual([ CAPS_II.id, TODAY31 ]);
    fireEvent.click(screen.getByRole("button", { name: "Abrir Maria da Silva" }));
    expect(open).toHaveBeenCalledWith({ enrollmentId: "en1", unitId: CAPS_II.id });
    // O detalhe (com trilha) é lido em "Usuários do CAPS", nunca aqui.
    expect(api.getPsyEnrollment).not.toHaveBeenCalled();
  });

  it("grupo com presença já registrada mostra 'presença registrada' e não oferece outra", async () => {
    vi.mocked(api.getPsyToday).mockResolvedValue(today({ groups: [ { ...today().groups[0], action_id: "ac7" } ], visits: [] }));
    mount();
    expect(await screen.findByText(PRESENCE_DONE_TAG)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar presença de Oficina de artes" })).toBeNull();
    expect(screen.getByText(NO_VISITS_TODAY)).not.toBeNull();
  });

  it("api sem action_id (antigo): presença ainda não registrada", async () => {
    const { action_id: _a, ...old } = today().groups[0];
    vi.mocked(api.getPsyToday).mockResolvedValue(today({ groups: [ old as never ] }));
    mount();
    expect(await screen.findByRole("button", { name: "Registrar presença de Oficina de artes" })).not.toBeNull();
    expect(screen.queryByText(PRESENCE_DONE_TAG)).toBeNull();
  });

  it("dia vazio: as frases", async () => {
    vi.mocked(api.getPsyToday).mockResolvedValue(today({ groups: [], visits: [] }));
    mount();
    expect(await screen.findByText(NO_GROUPS_TODAY)).not.toBeNull();
    expect(screen.getByText(NO_VISITS_TODAY)).not.toBeNull();
  });

  it("registra a presença do grupo de hoje ali mesmo e relê o dia", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar presença de Oficina de artes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Maria da Silva" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar presença" }));
    await waitFor(() => expect(api.createPsyAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createPsyAction).mock.calls[0][0]).toMatchObject({
      health_unit_id: CAPS_II.id, group_id: "g1", sigtap_code: "0301080216", performed_at: "2026-11-04T14:00:00-03:00",
      participants: [ { enrollment_id: "en1" } ]
    });
    expect(await screen.findByText(PRESENCE_SAVED)).not.toBeNull();
    await waitFor(() => expect(api.getPsyToday).toHaveBeenCalledTimes(2));
  });
});
