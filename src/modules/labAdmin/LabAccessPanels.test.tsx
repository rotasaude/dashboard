// src/modules/labAdmin/LabAccessPanels.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listRejectionReasons: vi.fn(), createRejectionReason: vi.fn(), updateRejectionReason: vi.fn(),
    listLabReleasers: vi.fn(), addLabReleaser: vi.fn(), removeLabReleaser: vi.fn(), listMemberships: vi.fn(),
    rotateMiddlewareToken: vi.fn(), revokeMiddlewareToken: vi.fn() };
});

import * as api from "../../lib/api";
import { RejectionReasonsPanel } from "./RejectionReasonsPanel";
import { ReleasersPanel } from "./ReleasersPanel";
import { MiddlewareTokenPanel } from "./MiddlewareTokenPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { labUser } from "../../test/labFixtures";
import { examProvider } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const LAB = examProvider({ id: "pv9", name: "Laboratório Municipal", kind: "municipal", uses_municipal_lab: true, has_middleware_token: false });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listRejectionReasons, api.createRejectionReason, api.updateRejectionReason, api.listLabReleasers,
    api.addLabReleaser, api.removeLabReleaser, api.listMemberships, api.rotateMiddlewareToken, api.revokeMiddlewareToken ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "municipal_admin" ], { features: [ "exam_tracking", "municipal_lab", "lab_hl7_inbound" ] }));
  mocked(api.listRejectionReasons).mockResolvedValue([ { id: "rr1", provider_id: "pv9", name: "hemolisada", active: true } ]);
  mocked(api.createRejectionReason).mockResolvedValue({ id: "rr2", provider_id: "pv9", name: "sem identificação", active: true });
  mocked(api.listLabReleasers).mockResolvedValue([]);
  mocked(api.listMemberships).mockResolvedValue([
    { id: "m1", user: { id: "us7", email_address: "bia@curitiba.demo" }, role: "lab_releaser", granted_at: "2026-10-01T10:00:00-03:00" },
    { id: "m2", user: { id: "us8", email_address: "rita@curitiba.demo" }, role: "health_professional", granted_at: "2026-10-01T10:00:00-03:00" }
  ]);
  mocked(api.rotateMiddlewareToken).mockResolvedValue("mw_secret_123");
});

describe("motivos de rejeição", () => {
  it("lista e inclui com step-up", async () => {
    renderWithProviders(<RejectionReasonsPanel providerId="pv9" />);
    const panel = await screen.findByRole("region", { name: "Motivos de rejeição" });
    expect(await within(panel).findByText("hemolisada")).not.toBeNull();
    fireEvent.change(within(panel).getByLabelText("Novo motivo"), { target: { value: "sem identificação" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Incluir motivo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Incluir" }));
    await waitFor(() => expect(api.createRejectionReason).toHaveBeenCalledWith({ provider_id: "pv9", name: "sem identificação", active: true }));
  });
});

describe("liberadores", () => {
  it("só quem tem o papel lab_releaser; RT marcado; conselho faltando vira frase", async () => {
    mocked(api.addLabReleaser).mockRejectedValueOnce(new api.ApiError(422, { error: "council_missing" }, "x"));
    renderWithProviders(<ReleasersPanel providerId="pv9" />);
    const panel = await screen.findByRole("region", { name: "Liberadores" });
    const select = within(panel).getByLabelText("Pessoa com o papel de liberador") as HTMLSelectElement;
    await waitFor(() => expect([ ...select.options ].map((o) => o.textContent)).toEqual([ "—", "bia@curitiba.demo" ]));
    fireEvent.change(select, { target: { value: "us7" } });
    fireEvent.click(within(panel).getByLabelText("Responsável técnico (RT)"));
    fireEvent.click(within(panel).getByRole("button", { name: "Incluir liberador" }));
    fireEvent.click(await screen.findByRole("button", { name: "Incluir" }));
    await waitFor(() => expect(api.addLabReleaser).toHaveBeenCalledWith({ user_id: "us7", provider_id: "pv9", technical_lead: true, technical_deputy: false }));
    expect(await screen.findByText("o profissional não tem conselho, UF e registro no perfil — complete em Profissionais")).not.toBeNull();
  });

  it("RT e substituto não podem ser a mesma marca da mesma pessoa", async () => {
    renderWithProviders(<ReleasersPanel providerId="pv9" />);
    const panel = await screen.findByRole("region", { name: "Liberadores" });
    const select = within(panel).getByLabelText("Pessoa com o papel de liberador") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select, { target: { value: "us7" } });
    fireEvent.click(within(panel).getByLabelText("Responsável técnico (RT)"));
    fireEvent.click(within(panel).getByLabelText("Substituto do RT"));
    fireEvent.click(within(panel).getByRole("button", { name: "Incluir liberador" }));
    expect(within(panel).getByRole("alert").textContent).toBe("a mesma pessoa não é RT e substituto ao mesmo tempo");
    expect(api.addLabReleaser).not.toHaveBeenCalled();
  });

  it("recusas do api viram frase: RT/substituto ocupados, já ligado, marcas inválidas", async () => {
    const { labError } = await import("../../lib/lab");
    const e = (error: string) => new api.ApiError(422, { error }, "x");
    expect(labError(e("lead_taken"))).toMatch(/responsável técnico/);
    expect(labError(e("deputy_taken"))).toMatch(/substituto/);
    expect(labError(e("already_assigned"))).toMatch(/já é liberador/);
    expect(labError(e("invalid_marks"))).toBe("a mesma pessoa não é RT e substituto ao mesmo tempo");
    expect(labError(e("user_missing_role"))).toMatch(/papel de liberador/);
  });
});

describe("token do middleware", () => {
  it("token do middleware: aparece uma vez, some com Já guardei e nunca vai ao cache", async () => {
    const spies = [ "log", "info", "warn", "error", "debug" ].map((m) => vi.spyOn(console, m as "log"));
    const onChanged = vi.fn();
    const { client } = renderWithProviders(<MiddlewareTokenPanel provider={LAB} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerar token do middleware" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Gerar token do middleware — Laboratório Municipal" })).getByRole("button", { name: "Gerar token" }));
    const shown = await screen.findByRole("region", { name: "Token do middleware novo" });
    expect(within(shown).getByText("mw_secret_123")).not.toBeNull();
    expect(onChanged).toHaveBeenCalled();
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state))).not.toContain("mw_secret_123");
    expect(JSON.stringify({ ...localStorage })).not.toContain("mw_secret_123");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("mw_secret_123");
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("mw_secret_123");
    fireEvent.click(within(shown).getByRole("button", { name: "Já guardei" }));
    expect(document.body.innerHTML).not.toContain("mw_secret_123");
  });

  it("sem a entrada HL7 ligada, avisa que o token ainda não funciona", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "municipal_admin" ]));
    renderWithProviders(<MiddlewareTokenPanel provider={{ ...LAB, has_middleware_token: true }} onChanged={vi.fn()} />);
    expect(await screen.findByText("a entrada de resultados de aparelhos (HL7) está desligada nesta cidade — o token só funciona quando ela for ligada")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Revogar token do middleware" })).not.toBeNull();
  });
});
