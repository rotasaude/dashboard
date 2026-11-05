// Linha do tempo do CAPS (F-31.8; P18) e o marcador na linha do tempo geral (P46, P51). O api manda um kind só, `psychosocial`, na
// linha do CAPS (`{ items, next_before }`, R13) e o marcador `psychosocial_link` na geral ("Acompanhamento no CAPS", `unit: null`,
// `detail_ref: null`). O filtro "CAPS" da geral só existe com o interruptor e manda `psychosocial_link`, nunca `psychosocial` (B29).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { entry } from "../../test/timelineFixtures";
import { CAPS_II, OPTIONS, TODAY31, enrollment, psyUser } from "../../test/psychosocialFixtures";
import * as api from "../../lib/api";
import { detailTarget, filtersFrom, timelineKindLabel, timelineKinds, toggleKind, EMPTY_DRAFT } from "../../lib/timeline";
import { psyError, psychosocialRoles } from "../../lib/psychosocial";
import { PatientTimeline } from "../timeline/PatientTimeline";
import { CAPS_ONLY_NOTE, CapsTimeline } from "./CapsTimeline";
import { EnrollmentView } from "./EnrollmentView";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getPsyEnrollmentTimeline: vi.fn(),
  getPsyEnrollment: vi.fn(), getTimeline: vi.fn() }));
// mockReset: uma resposta "Once" que sobra num teste não vaza para o seguinte.
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(api.getPsyEnrollmentTimeline).mockReset(); });

// Forma do api (`Timeline::Sources::PsychosocialSource`): detail_ref real, summary nulo, status recorded/open/closed. Nada abre aqui.
const psy = (o: Partial<api.TimelineEntry>) => entry({ kind: "psychosocial", unit: { id: CAPS_II.id, name: CAPS_II.name },
  professional: { name: "Lia Psicóloga", cbo_code: "251510" }, summary: null, status: "recorded",
  detail_ref: { type: "psychosocial_action", id: o.id ?? "a1" }, ...o });
const MARKER = entry({ id: "psychosocial_link:en1", kind: "psychosocial_link", occurred_at: "2026-09-10T00:00:00-03:00", unit: null,
  professional: null, title: "Acompanhamento no CAPS", summary: "Desde 10/09/2026", status: "open", detail_ref: null });

function mount(enrollmentId = "en1") {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser([ "psychosocial_staff" ]));
  return renderWithProviders(<CapsTimeline enrollmentId={enrollmentId} unitId={CAPS_II.id} />);
}

describe("linha do tempo do CAPS", () => {
  it("entradas da fonte psychosocial em páginas, sem abrir detalhe", async () => {
    vi.mocked(api.getPsyEnrollmentTimeline)
      .mockResolvedValueOnce({ items: [ psy({ id: "psychosocial:a1", title: "Atendimento individual em CAPS" }) ], next_before: "c1" })
      .mockResolvedValueOnce({ items: [ psy({ id: "psychosocial:p1", title: "PTS versão 1", detail_ref: { type: "psychosocial_care_plan", id: "p1" } }) ],
        next_before: null });
    mount();
    expect(await screen.findByText("Atendimento individual em CAPS")).not.toBeNull();
    expect(screen.getAllByText("CAPS").length).toBeGreaterThan(0);
    expect(screen.getByText("Lia Psicóloga")).not.toBeNull();
    expect(screen.getByText(CAPS_ONLY_NOTE)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("PTS versão 1")).not.toBeNull();
    expect(vi.mocked(api.getPsyEnrollmentTimeline).mock.calls[0]).toEqual([ "en1", null ]);
    expect(vi.mocked(api.getPsyEnrollmentTimeline).mock.calls[1]).toEqual([ "en1", "c1" ]);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir/ })).toBeNull();
    expect(screen.getAllByText("registrado").length).toBe(2);
  });

  it("situação da permanência: aberta 'em aberto', encerrada 'encerrado'; nunca o código cru", async () => {
    vi.mocked(api.getPsyEnrollmentTimeline).mockResolvedValueOnce({ items: [
      psy({ id: "psychosocial:n1", title: "Acolhimento noturno", status: "open", detail_ref: { type: "psychosocial_night_stay", id: "n1" } }),
      psy({ id: "psychosocial:n0", title: "Acolhimento noturno", status: "closed", detail_ref: { type: "psychosocial_night_stay", id: "n0" } })
    ], next_before: null });
    mount();
    expect(await screen.findByText("em aberto")).not.toBeNull();
    expect(screen.getByText("encerrado")).not.toBeNull();
    expect(screen.queryByText("open")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir/ })).toBeNull();
  });

  it("invalid_cursor no 'Carregar mais': a frase, e a lista é relida do começo", async () => {
    vi.mocked(api.getPsyEnrollmentTimeline)
      .mockResolvedValueOnce({ items: [ psy({ id: "psychosocial:a1", title: "Atendimento individual em CAPS" }) ], next_before: "c1" })
      .mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_cursor", path: "before" }, "422"))
      .mockResolvedValueOnce({ items: [ psy({ id: "psychosocial:a2", title: "Atendimento familiar em CAPS" }) ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect((await screen.findByRole("alert")).textContent).toBe(psyError(new api.ApiError(422, { error: "invalid_cursor" }, "422")));
    expect(await screen.findByText("Atendimento familiar em CAPS")).not.toBeNull();
    expect(vi.mocked(api.getPsyEnrollmentTimeline).mock.calls).toEqual([ [ "en1", null ], [ "en1", "c1" ], [ "en1", null ] ]);
    expect(screen.queryByText("Atendimento individual em CAPS")).toBeNull();
  });

  it("entrada repetida entre páginas aparece uma vez; tipo desconhecido aparece cru", async () => {
    const a = psy({ id: "psychosocial:a1", title: "Acolhimento noturno" });
    vi.mocked(api.getPsyEnrollmentTimeline)
      .mockResolvedValueOnce({ items: [ a ], next_before: "c1" })
      .mockResolvedValueOnce({ items: [ a, psy({ id: "x:1", kind: "psychosocial_new", title: "Novo registro" }) ], next_before: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Novo registro")).not.toBeNull();
    expect(screen.getAllByText("Acolhimento noturno").length).toBe(1);
    expect(screen.getByText("psychosocial_new")).not.toBeNull();
  });

  it("vazio e erro com frase", async () => {
    vi.mocked(api.getPsyEnrollmentTimeline).mockResolvedValueOnce({ items: [], next_before: null });
    mount();
    expect(await screen.findByText("nenhum registro nesta matrícula")).not.toBeNull();
    cleanup();
    vi.mocked(api.getPsyEnrollmentTimeline).mockRejectedValueOnce(new api.ApiError(403, { error: "not_on_caps_team" }, "403"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("você não está lotado neste CAPS");
  });

  it("aba Linha do tempo da matrícula: a leitura só corre ao abrir a aba", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser([ "psychosocial_staff" ]));
    vi.mocked(api.getPsyEnrollment).mockResolvedValue(enrollment());
    vi.mocked(api.getPsyEnrollmentTimeline).mockResolvedValue({ items: [ psy({ id: "psychosocial:a1", title: "PTS versão 2" }) ], next_before: null });
    renderWithProviders(<EnrollmentView enrollmentId="en1" unit={CAPS_II} options={OPTIONS} roles={psychosocialRoles(psyUser([ "psychosocial_staff" ]))}
      today={TODAY31} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Linha do tempo" }));
    expect(await screen.findByText("PTS versão 2")).not.toBeNull();
    expect(vi.mocked(api.getPsyEnrollmentTimeline).mock.calls).toEqual([ [ "en1", null ] ]);
  });
});

describe("marcador do CAPS na linha do tempo geral", () => {
  it("rótulo CAPS (também para o kind da linha do CAPS), filtro só com o interruptor, sem detalhe", () => {
    expect(timelineKindLabel("psychosocial_link")).toBe("CAPS");
    expect(timelineKindLabel("psychosocial")).toBe("CAPS");
    expect(timelineKinds(false).some((k) => k.key === "psychosocial_link")).toBe(false);
    expect(timelineKinds(false, false, false, false, false, true).some((k) => k.key === "psychosocial_link")).toBe(true);
    expect(detailTarget(MARKER, true)).toBeNull();
  });

  it("o filtro manda psychosocial_link, nunca psychosocial (422 invalid_kinds)", () => {
    const kinds = timelineKinds(false, false, false, false, false, true);
    expect(kinds.some((k) => (k.key as string) === "psychosocial")).toBe(false);
    const sent = filtersFrom(toggleKind(EMPTY_DRAFT, "campaign"), kinds).kinds as string[];
    expect(sent).toContain("psychosocial_link");
    expect(sent).not.toContain("psychosocial");
    expect(filtersFrom(toggleKind(EMPTY_DRAFT, "campaign"), timelineKinds(false)).kinds).not.toContain("psychosocial_link");
  });

  it("com o interruptor ligado, a caixa CAPS existe; o marcador aparece sem nome de CAPS e sem botão de abrir", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser([ "health_professional" ], [ "clinical_record", "patient_timeline", "psychosocial_care" ]));
    vi.mocked(api.getTimeline).mockResolvedValue({ person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" }, next_before: null,
      entries: [ MARKER ] });
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("Acompanhamento no CAPS")).not.toBeNull();
    expect(screen.getByText("em aberto")).not.toBeNull();
    expect(screen.queryByText("open")).toBeNull();
    await waitFor(() => expect(screen.queryByLabelText("CAPS")).not.toBeNull());
    expect(screen.queryByText(/CAPS II|Centro/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Abrir caps/ })).toBeNull();
  });

  it("com o interruptor desligado, o marcador continua (registro retido) e a caixa CAPS some", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser([ "health_professional" ], [ "clinical_record", "patient_timeline" ]));
    vi.mocked(api.getTimeline).mockResolvedValue({ person: { display_name: "Joana Lima", partial: false, patient_id: "pa1" }, next_before: null,
      entries: [ MARKER ] });
    renderWithProviders(<PatientTimeline subject={{ attendanceId: "a1" }} />);
    expect(await screen.findByText("Acompanhamento no CAPS")).not.toBeNull();
    expect(screen.getByLabelText("Triagem")).not.toBeNull();
    expect(screen.queryByLabelText("CAPS")).toBeNull();
  });
});
