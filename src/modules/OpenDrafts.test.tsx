// src/modules/OpenDrafts.test.tsx
// fix51 (api#51): rascunhos abertos do municipal_admin — descartar ou designar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listOpenDrafts: vi.fn(), listDraftCandidates: vi.fn(),
    discardDraft: vi.fn(), reassignDraft: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import type { DraftCandidate, OpenDraft } from "../lib/consultationDrafts";
import { OpenDrafts } from "./OpenDrafts";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW19C, docUser } from "../test/documentFixtures";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const draft = (over: Partial<OpenDraft> = {}): OpenDraft => ({
  consultation_id: "c1", attendance_id: "a1", health_unit: { id: "u1", name: "UBS Centro" },
  author: { user_id: "us1", name: "Dra. Helena Prado" }, author_linked: true, patient_initials: "J.L.",
  started_at: "2026-10-09T08:00:00-03:00", last_saved_at: "2026-10-09T08:40:00-03:00", ...over
});
const cand = (over: Partial<DraftCandidate> = {}): DraftCandidate => ({
  user_id: "us2", name: "Dr. Caio Mendes", cbo_code: "225142", cbo_title: "Médico da estratégia de saúde da família",
  council: "CRM", council_state: "PR", registration_number: "45123", ...over
});
const REASON = "profissional foi desligado da unidade";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW19C));
  for (const fn of [ api.fetchCurrentSession, api.listOpenDrafts, api.listDraftCandidates, api.discardDraft, api.reassignDraft ]) m(fn).mockReset();
  m(api.fetchCurrentSession).mockResolvedValue(docUser([ "municipal_admin" ], { id: "ad1" }));
  m(api.listOpenDrafts).mockResolvedValue([ draft(), draft({ consultation_id: "c2", attendance_id: "a2", author_linked: false,
    author: { user_id: "us3", name: "Dr. Paulo Rocha" }, patient_initials: "M.S.", health_unit: { id: "u2", name: "UBS Boqueirão" } }) ]);
  m(api.listDraftCandidates).mockResolvedValue([ cand(), cand({ user_id: "us4", name: "Enf. Ana Lopes", cbo_code: "223505",
    cbo_title: null, council: null, council_state: null, registration_number: null }) ]);
  m(api.discardDraft).mockResolvedValue({ consultation_id: "c1", status: "discarded" });
  m(api.reassignDraft).mockResolvedValue({ consultation_id: "c1", author: { user_id: "us2", name: "Dr. Caio Mendes" } });
});

const row = async (name: string) => (await screen.findByText(name)).closest('[role="row"]') as HTMLElement;
const typeReason = (panel: HTMLElement, text = REASON) =>
  fireEvent.change(within(panel).getByLabelText("Motivo"), { target: { value: text } });

describe("OpenDrafts", () => {
  it("lista com unidade, profissional, só iniciais do paciente e selo de sem vínculo", async () => {
    renderWithProviders(<OpenDrafts />);
    const r1 = await row("Dra. Helena Prado");
    expect(within(r1).getByText("UBS Centro")).not.toBeNull();
    expect(within(r1).getByText("J.L.")).not.toBeNull();
    expect(within(r1).queryByText("sem vínculo ativo")).toBeNull();
    const r2 = await row("Dr. Paulo Rocha");
    expect(within(r2).getByText("sem vínculo ativo")).not.toBeNull();
    expect(screen.getByText(/não mostra conteúdo clínico/)).not.toBeNull();
  });

  it("estado vazio e erro de leitura", async () => {
    m(api.listOpenDrafts).mockResolvedValue([]);
    const { unmount } = renderWithProviders(<OpenDrafts />);
    expect(await screen.findByText("nenhum rascunho aberto")).not.toBeNull();
    unmount();
    m(api.listOpenDrafts).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<OpenDrafts />);
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite esta ação");
  });

  it("só municipal_admin com o prontuário ligado", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ]));
    const { unmount } = renderWithProviders(<OpenDrafts />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.listOpenDrafts).not.toHaveBeenCalled();
    unmount();
    m(api.fetchCurrentSession).mockResolvedValue(docUser([ "municipal_admin" ], { features: [] }));
    renderWithProviders(<OpenDrafts />);
    expect(await screen.findByText("o prontuário está desligado nesta cidade")).not.toBeNull();
    expect(api.listOpenDrafts).not.toHaveBeenCalled();
  });

  it("descartar com motivo chama discardDraft uma vez, avisa e recarrega a lista", async () => {
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Descartar" }));
    const panel = screen.getByRole("region", { name: /Descartar rascunho/ });
    expect(within(panel).getByText(/não vira registro clínico/)).not.toBeNull();
    expect(within(panel).getByText(/encerrado pela fila da unidade/)).not.toBeNull();
    typeReason(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Descartar rascunho" }));
    await waitFor(() => expect(api.discardDraft).toHaveBeenCalledWith("c1", REASON));
    expect((await screen.findByRole("status")).textContent).toMatch(/Rascunho descartado.*fila da unidade/);
    await waitFor(() => expect(api.listOpenDrafts).toHaveBeenCalledTimes(2));
    expect(api.discardDraft).toHaveBeenCalledTimes(1);
  });

  it("motivo curto não chama a API", async () => {
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Descartar" }));
    const panel = screen.getByRole("region", { name: /Descartar rascunho/ });
    typeReason(panel, "curto");
    fireEvent.click(within(panel).getByRole("button", { name: "Descartar rascunho" }));
    expect((await within(panel).findByRole("alert")).textContent).toMatch(/pelo menos 10 caracteres/);
    expect(api.discardDraft).not.toHaveBeenCalled();
  });

  it("em voo: duplo clique em descartar chama a API uma vez", async () => {
    const d = deferred<{ consultation_id: string; status: "discarded" }>();
    m(api.discardDraft).mockReturnValue(d.promise);
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Descartar" }));
    const panel = screen.getByRole("region", { name: /Descartar rascunho/ });
    typeReason(panel);
    const go = within(panel).getByRole("button", { name: "Descartar rascunho" }) as HTMLButtonElement;
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(go.disabled).toBe(true));
    expect(api.discardDraft).toHaveBeenCalledTimes(1);
    d.resolve({ consultation_id: "c1", status: "discarded" });
    expect(await screen.findByRole("status")).not.toBeNull();
  });

  it("not_draft ao descartar mostra a frase e relê a lista", async () => {
    m(api.discardDraft).mockRejectedValue(new ApiError(409, { error: "not_draft" }, "409"));
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Descartar" }));
    const panel = screen.getByRole("region", { name: /Descartar rascunho/ });
    typeReason(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Descartar rascunho" }));
    expect((await within(panel).findByRole("alert")).textContent)
      .toBe("este rascunho já foi finalizado ou descartado — atualize a lista");
    await waitFor(() => expect(api.listOpenDrafts).toHaveBeenCalledTimes(2));
  });

  it("designar: carrega candidatos, escolhe um e chama reassignDraft(id, userId, motivo)", async () => {
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Designar outro profissional" }));
    expect(await screen.findByText(/225142 — Médico da estratégia de saúde da família/)).not.toBeNull();
    expect(screen.getByText(/CRM\/PR 45123/)).not.toBeNull();
    expect(api.listDraftCandidates).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("radio", { name: /Dr. Caio Mendes/ }));
    const panel = screen.getByRole("region", { name: /Designar rascunho para Dr. Caio Mendes/ });
    expect(within(panel).getByText(/encontra o rascunho pelo atendimento/)).not.toBeNull();
    typeReason(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Designar" }));
    await waitFor(() => expect(api.reassignDraft).toHaveBeenCalledWith("c1", "us2", REASON));
    expect((await screen.findByRole("status")).textContent).toMatch(/designado a Dr. Caio Mendes/);
    await waitFor(() => expect(api.listOpenDrafts).toHaveBeenCalledTimes(2));
  });

  it("em voo: duplo clique em designar chama a API uma vez", async () => {
    const d = deferred<{ consultation_id: string; author: { user_id: string; name: string } }>();
    m(api.reassignDraft).mockReturnValue(d.promise);
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Designar outro profissional" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Dr. Caio Mendes/ }));
    const panel = screen.getByRole("region", { name: /Designar rascunho para/ });
    typeReason(panel);
    const go = within(panel).getByRole("button", { name: "Designar" }) as HTMLButtonElement;
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(go.disabled).toBe(true));
    expect(api.reassignDraft).toHaveBeenCalledTimes(1);
    d.resolve({ consultation_id: "c1", author: { user_id: "us2", name: "Dr. Caio Mendes" } });
    expect(await screen.findByRole("status")).not.toBeNull();
  });

  it("invalid_professional ao designar mostra a frase", async () => {
    m(api.reassignDraft).mockRejectedValue(new ApiError(422, { error: "invalid_professional" }, "422"));
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Designar outro profissional" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Dr. Caio Mendes/ }));
    const panel = screen.getByRole("region", { name: /Designar rascunho para/ });
    typeReason(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Designar" }));
    expect((await within(panel).findByRole("alert")).textContent)
      .toBe("este profissional não é elegível nesta unidade — atualize os candidatos");
  });

  it("sem candidatos: mensagem e nenhuma ação de designar", async () => {
    m(api.listDraftCandidates).mockResolvedValue([]);
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Designar outro profissional" }));
    expect(await screen.findByText("nenhum profissional elegível nesta unidade")).not.toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });
  // Dois submits no MESMO tick (dentro de um único act): o `busy` do SensitiveAction
  // ainda não re-renderizou, então só o ref em voo da tela impede a 2ª chamada.
  it("trava por ref: dois submits no mesmo tick descartam uma vez só", async () => {
    const d = deferred<{ consultation_id: string; status: "discarded" }>();
    m(api.discardDraft).mockReturnValue(d.promise);
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Descartar" }));
    const panel = screen.getByRole("region", { name: /Descartar rascunho/ });
    typeReason(panel);
    const form = panel.querySelector("form") as HTMLFormElement;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.discardDraft).toHaveBeenCalledTimes(1);
    d.resolve({ consultation_id: "c1", status: "discarded" });
    expect(await screen.findByRole("status")).not.toBeNull();
  });

  it("trava por ref: dois submits no mesmo tick designam uma vez só", async () => {
    const d = deferred<{ consultation_id: string; author: { user_id: string; name: string } }>();
    m(api.reassignDraft).mockReturnValue(d.promise);
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Designar outro profissional" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Dr. Caio Mendes/ }));
    const panel = screen.getByRole("region", { name: /Designar rascunho para/ });
    typeReason(panel);
    const form = panel.querySelector("form") as HTMLFormElement;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.reassignDraft).toHaveBeenCalledTimes(1);
    d.resolve({ consultation_id: "c1", author: { user_id: "us2", name: "Dr. Caio Mendes" } });
    expect(await screen.findByRole("status")).not.toBeNull();
  });

  it("invalid_professional relê os candidatos", async () => {
    m(api.reassignDraft).mockRejectedValue(new ApiError(422, { error: "invalid_professional" }, "422"));
    renderWithProviders(<OpenDrafts />);
    fireEvent.click(within(await row("Dra. Helena Prado")).getByRole("button", { name: "Designar outro profissional" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Dr. Caio Mendes/ }));
    const panel = screen.getByRole("region", { name: /Designar rascunho para/ });
    typeReason(panel);
    expect(api.listDraftCandidates).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole("button", { name: "Designar" }));
    await within(panel).findByRole("alert");
    await waitFor(() => expect(api.listDraftCandidates).toHaveBeenCalledTimes(2));
  });
});
