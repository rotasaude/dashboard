import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { psySettings, psyUser } from "../test/psychosocialFixtures";
import * as api from "../lib/api";
import { BED_ADDED, BED_DEACTIVATED, BED_REACTIVATED, CAPS_III_NOTE, NO_NIGHT_CAPS, PSY_BEDS_KEY, PSY_DISABLED, PSY_ERRORS, PSY_NO_ROLE, PSY_SETTINGS_KEY, SETTINGS_SAVED, settingsProblems, textProblem } from "../lib/psychosocial";
import { CapsSettings } from "./CapsSettings";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listAllUnits: vi.fn(), listPsyBeds: vi.fn(),
  createPsyBed: vi.fn(), updatePsyBed: vi.fn(), getPsySettings: vi.fn(), updatePsySettings: vi.fn(), listPsyUnits: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const unit = (id: string, name: string, caps_modality: string, active = true) => ({ id, name, kind: "caps", active, caps_modality });
const UNITS = [
  { id: "ubs1", name: "UBS Centro", kind: "ubs", active: true },
  unit("caps2", "CAPS II Centro", "caps_ii"),
  unit("capsad3", "CAPS AD III Boqueirão", "caps_ad_iii")
];
const BEDS = [ { id: "b1", health_unit_id: "capsad3", label: "Leito 1", active: true }, { id: "b2", health_unit_id: "capsad3", label: "Leito 2", active: false } ];

function mount(user = psyUser([ "municipal_admin" ]), units: unknown[] = UNITS, onGoToSecurity?: () => void) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  vi.mocked(api.listAllUnits).mockResolvedValue(units as never);
  vi.mocked(api.listPsyBeds).mockResolvedValue(BEDS);
  vi.mocked(api.getPsySettings).mockResolvedValue(psySettings());
  vi.mocked(api.updatePsySettings).mockImplementation(async () => psySettings());
  return renderWithProviders(<CapsSettings onGoToSecurity={onGoToSecurity} />);
}
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const saveRules = () => fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
const prazoText = settingsProblems(psySettings({ care_plan_review_days: 0 }))[0].text;

describe("regras do CAPS (limites e prazo do PTS)", () => {
  it("mostra os valores do api, recusa 0 e grava o corpo inteiro com step-up", async () => {
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    expect(input("Prazo de revisão do PTS (dias)").value).toBe("90");
    expect(input("CAPS III — noites corridas").value).toBe("7");
    expect(input("CAPS III — noites intercaladas").value).toBe("10");
    expect(input("CAPS III — janela (dias)").value).toBe("30");
    expect(input("CAPS AD III — noites na janela").value).toBe("14");
    expect(input("CAPS AD III — janela (dias)").value).toBe("30");
    expect(input("CAPS AD IV — noites na janela").value).toBe("14");
    expect(input("CAPS AD IV — janela (dias)").value).toBe("30");
    expect(screen.getByText(CAPS_III_NOTE)).not.toBeNull();
    change("Prazo de revisão do PTS (dias)", "0");
    saveRules();
    expect(prazoText).toBe("o prazo de revisão do PTS vai de 30 a 365 dias");
    expect(screen.getByText(prazoText)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.updatePsySettings).not.toHaveBeenCalled();
    change("Prazo de revisão do PTS (dias)", "60");
    saveRules();
    await confirm();
    await waitFor(() => expect(api.updatePsySettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updatePsySettings).mock.calls[0][0]).toEqual({
      night_limits: { caps_iii: { consecutive: 7, alternate: 10, window_days: 30 }, caps_ad_iii: { total: 14, window_days: 30 },
        caps_ad_iv: { total: 14, window_days: 30 } },
      care_plan_review_days: 60
    });
    expect((await screen.findByRole("status")).textContent).toBe(SETTINGS_SAVED);
  });
  it("o prazo vai de 30 a 365: 29 e 366 recusados; 30 e 365 passam", async () => {
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    for (const bad of [ "29", "366", "", "12x", "1.5" ]) {
      change("Prazo de revisão do PTS (dias)", bad);
      saveRules();
      expect(screen.getByText(prazoText)).not.toBeNull();
    }
    for (const good of [ "30", "365" ]) {
      change("Prazo de revisão do PTS (dias)", good);
      saveRules();
      expect(screen.queryByText(prazoText)).toBeNull();
      expect(await screen.findByRole("button", { name: "Confirmar" })).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    }
  });
  it("todas as recusas de uma vez, cada uma no seu campo, sem enviar", async () => {
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    change("CAPS III — janela (dias)", "3");
    change("CAPS AD III — noites na janela", "0");
    change("CAPS AD IV — noites na janela", "91");
    change("CAPS III — noites corridas", "abc");
    change("Prazo de revisão do PTS (dias)", "0");
    saveRules();
    const expected = settingsProblems({ ...psySettings(), care_plan_review_days: 0, night_limits: {
      caps_iii: { consecutive: NaN, alternate: 10, window_days: 3 }, caps_ad_iii: { total: 0, window_days: 30 }, caps_ad_iv: { total: 91, window_days: 30 } } });
    expect(expected).toHaveLength(5);
    for (const p of expected) expect(screen.getAllByText(p.text).length).toBeGreaterThan(0);
    expect(input("CAPS III — janela (dias)").getAttribute("aria-invalid")).toBe("true");
    expect(input("CAPS III — noites intercaladas").getAttribute("aria-invalid")).toBeNull();
    expect(api.updatePsySettings).not.toHaveBeenCalled();
  });
  it("sem janela de step-up pede o código; mfa_required no meio repete uma vez; sem autenticador leva à segurança", async () => {
    mount({ ...psyUser([ "municipal_admin" ]), mfa_verified_at: null });
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    saveRules();
    expect(await screen.findByLabelText("Código do autenticador")).not.toBeNull();
    cleanup();
    const toSecurity = vi.fn();
    mount({ ...psyUser([ "municipal_admin" ]), mfa_enrolled: false, mfa_verified_at: null }, UNITS, toSecurity);
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    saveRules();
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
    expect(toSecurity).toHaveBeenCalledTimes(1);
    cleanup();
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    vi.mocked(api.updatePsySettings).mockRejectedValueOnce(new api.ApiError(401, { error: "mfa_required" }, "401"));
    saveRules();
    await confirm();
    expect(await screen.findByLabelText("Código do autenticador")).not.toBeNull();
    expect(api.updatePsySettings).toHaveBeenCalledTimes(1);
  });
  it("mexer num campo com a confirmação aberta fecha a confirmação", async () => {
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    saveRules();
    await screen.findByRole("button", { name: "Confirmar" });
    change("Prazo de revisão do PTS (dias)", "45");
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    saveRules();
    await confirm();
    await waitFor(() => expect(vi.mocked(api.updatePsySettings).mock.calls[0][0].care_plan_review_days).toBe(45));
  });
  it("digitar num campo recusado mantém o foco nele, com outro campo também recusado", async () => {
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    change("CAPS III — janela (dias)", "3");
    change("Prazo de revisão do PTS (dias)", "0");
    saveRules();
    // Depois do envio, o foco vai ao primeiro campo recusado (na ordem da tela).
    expect(document.activeElement).toBe(input("CAPS III — janela (dias)"));
    // O mesmo no outro sentido: foco no segundo recusado, dois caracteres seguidos (sem user-event no projeto: foco + change).
    const prazo = input("Prazo de revisão do PTS (dias)");
    prazo.focus();
    change("Prazo de revisão do PTS (dias)", "6");
    expect(document.activeElement).toBe(prazo);
    expect(prazo.getAttribute("aria-invalid")).toBeNull();
    change("Prazo de revisão do PTS (dias)", "60");
    expect(document.activeElement).toBe(prazo);
    expect(prazo.value).toBe("60");
    // O outro campo segue recusado, sem ter roubado o foco.
    expect(input("CAPS III — janela (dias)").getAttribute("aria-invalid")).toBe("true");
    // Digitar no recusado remove a recusa dele e o foco continua nele.
    const window = input("CAPS III — janela (dias)");
    window.focus();
    change("CAPS III — janela (dias)", "30");
    expect(document.activeElement).toBe(window);
    expect(window.value).toBe("30");
  });
  it("recusa do api com path vai para o campo e a frase aparece uma vez", async () => {
    mount();
    await screen.findByLabelText("Prazo de revisão do PTS (dias)");
    vi.mocked(api.updatePsySettings).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_request", problems: [
      { error: "invalid_request", path: "care_plan_review_days" }, { error: "invalid_request", path: "night_limits.caps_ad_iii.window_days" } ] }, "422"));
    saveRules();
    await confirm();
    const [ review, window ] = [ "care_plan_review_days", "night_limits" ].map((k) => settingsProblems(k === "night_limits"
      ? { ...psySettings(), night_limits: { ...psySettings().night_limits, caps_ad_iii: { total: 14, window_days: 3 } } }
      : psySettings({ care_plan_review_days: 0 }))[0].text);
    expect(await screen.findByText(review)).not.toBeNull();
    expect(screen.getByText(window)).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(`${review}; ${window}`);
    expect(input("Prazo de revisão do PTS (dias)").getAttribute("aria-invalid")).toBe("true");
    expect(input("CAPS AD III — janela (dias)").getAttribute("aria-invalid")).toBe("true");
    // Editar um campo limpa só a recusa dele.
    change("Prazo de revisão do PTS (dias)", "45");
    expect(input("Prazo de revisão do PTS (dias)").getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(review)).toBeNull();
    expect(input("CAPS AD III — janela (dias)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(window)).not.toBeNull();
  });
  it("só o administrador abre a tela; coordenação e equipe não leem nada; interruptor desligado", async () => {
    for (const roles of [ [ "psychosocial_lead" ], [ "psychosocial_staff" ], [ "analyst" ] ]) {
      mount(psyUser(roles));
      expect(await screen.findByText(PSY_NO_ROLE)).not.toBeNull();
      cleanup();
    }
    mount(psyUser([ "municipal_admin" ], [ "clinical_record" ]));
    expect(await screen.findByText(PSY_DISABLED)).not.toBeNull();
    expect(api.getPsySettings).not.toHaveBeenCalled();
    expect(api.listAllUnits).not.toHaveBeenCalled();
    expect(api.listPsyUnits).not.toHaveBeenCalled();
  });
  it("falha ao ler as regras mostra a frase e não o formulário", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(psyUser([ "municipal_admin" ]));
    vi.mocked(api.listAllUnits).mockResolvedValue([]);
    vi.mocked(api.getPsySettings).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<CapsSettings />);
    expect((await screen.findAllByRole("alert"))[0].textContent).toBe(PSY_ERRORS.missing_role);
    expect(screen.queryByRole("button", { name: "Salvar regras" })).toBeNull();
  });
});

describe("leitos do CAPS", () => {
  const panel = () => screen.getByRole("region", { name: /Leitos · CAPS AD III Boqueirão/ });
  it("só CAPS com leito têm painel; a lista vem do CAPS e a chave leva o id", async () => {
    const { client } = mount();
    expect(await screen.findByRole("heading", { name: "Leitos · CAPS AD III Boqueirão" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /Leitos · CAPS II Centro/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /UBS Centro/ })).toBeNull();
    await within(panel()).findByText("Leito 1");
    expect(api.listPsyBeds).toHaveBeenCalledTimes(1);
    expect(api.listPsyBeds).toHaveBeenCalledWith("capsad3");
    const keys = client.getQueryCache().findAll({ queryKey: [ PSY_BEDS_KEY ] }).map((q) => q.queryKey);
    expect(keys.length).toBe(1);
    expect(keys[0]).toContain("capsad3");
    expect(client.getQueryCache().findAll({ queryKey: [ PSY_SETTINGS_KEY ] }).length).toBe(1);
    expect(within(panel()).getByText("ativo")).not.toBeNull();
    expect(within(panel()).getByText("inativo")).not.toBeNull();
  });
  it("CAPS desativado não tem painel de leitos", async () => {
    mount(psyUser([ "municipal_admin" ]), [ UNITS[0], unit("capsad3", "CAPS AD III Boqueirão", "caps_ad_iii", false) ]);
    expect(await screen.findByText(NO_NIGHT_CAPS)).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /Leitos ·/ })).toBeNull();
    expect(api.listPsyBeds).not.toHaveBeenCalled();
  });
  it("sem CAPS com leito: frase, sem painel", async () => {
    mount(psyUser([ "municipal_admin" ]), [ UNITS[0], UNITS[1] ]);
    expect(await screen.findByText(NO_NIGHT_CAPS)).not.toBeNull();
    expect(api.listPsyBeds).not.toHaveBeenCalled();
  });
  it("adiciona o leito com step-up, relê a lista e limpa o campo", async () => {
    mount();
    await within(await screen.findByRole("region", { name: /Leitos · CAPS AD III Boqueirão/ })).findByText("Leito 1");
    vi.mocked(api.createPsyBed).mockResolvedValue({ id: "b3", health_unit_id: "capsad3", label: "Leito 3", active: true });
    vi.mocked(api.listPsyBeds).mockResolvedValue([ ...BEDS, { id: "b3", health_unit_id: "capsad3", label: "Leito 3", active: true } ]);
    fireEvent.change(within(panel()).getByLabelText("Rótulo do leito"), { target: { value: "  Leito 3 " } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Adicionar leito" }));
    await confirm();
    await waitFor(() => expect(api.createPsyBed).toHaveBeenCalledWith({ health_unit_id: "capsad3", label: "Leito 3" }));
    expect(await within(panel()).findByText("Leito 3")).not.toBeNull();
    expect((within(panel()).getByLabelText("Rótulo do leito") as HTMLInputElement).value).toBe("");
    expect(within(panel()).getByRole("status").textContent).toBe(BED_ADDED);
  });
  it("rótulo vazio ou com mais de 20 caracteres é recusado com a frase, sem pedir o código", async () => {
    mount();
    await within(await screen.findByRole("region", { name: /Leitos · CAPS AD III Boqueirão/ })).findByText("Leito 1");
    fireEvent.click(within(panel()).getByRole("button", { name: "Adicionar leito" }));
    expect(within(panel()).getByText(textProblem("", 1, 20, "o rótulo do leito") as string)).not.toBeNull();
    fireEvent.change(within(panel()).getByLabelText("Rótulo do leito"), { target: { value: "x".repeat(21) } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Adicionar leito" }));
    expect(within(panel()).getByText(textProblem("x".repeat(21), 1, 20, "o rótulo do leito") as string)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.createPsyBed).not.toHaveBeenCalled();
  });
  it("caps_without_beds e bed_label_taken viram frase dentro da confirmação", async () => {
    mount();
    await within(await screen.findByRole("region", { name: /Leitos · CAPS AD III Boqueirão/ })).findByText("Leito 1");
    vi.mocked(api.createPsyBed).mockRejectedValueOnce(new api.ApiError(422, { error: "caps_without_beds" }, "422"));
    fireEvent.change(within(panel()).getByLabelText("Rótulo do leito"), { target: { value: "Leito 3" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Adicionar leito" }));
    await confirm();
    expect(await screen.findByText(PSY_ERRORS.caps_without_beds)).not.toBeNull();
    expect(PSY_ERRORS.caps_without_beds).toBe("só CAPS III, CAPS AD III e CAPS AD IV têm leitos");
    vi.mocked(api.createPsyBed).mockRejectedValueOnce(new api.ApiError(409, { error: "bed_label_taken" }, "409"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(PSY_ERRORS.bed_label_taken)).not.toBeNull();
  });
  it("desativa e reativa pelo leito, com step-up", async () => {
    mount();
    const p = await screen.findByRole("region", { name: /Leitos · CAPS AD III Boqueirão/ });
    await within(p).findByText("Leito 1");
    vi.mocked(api.updatePsyBed).mockResolvedValue({ ...BEDS[0], active: false });
    fireEvent.click(within(p).getByRole("button", { name: "Desativar" }));
    await confirm();
    await waitFor(() => expect(api.updatePsyBed).toHaveBeenCalledWith("b1", { active: false }));
    await waitFor(() => expect(api.listPsyBeds).toHaveBeenCalledTimes(2));
    expect(within(p).getByRole("status").textContent).toBe(BED_DEACTIVATED);
    fireEvent.click(within(panel()).getByRole("button", { name: "Reativar" }));
    await confirm();
    await waitFor(() => expect(api.updatePsyBed).toHaveBeenLastCalledWith("b2", { active: true }));
    expect((await within(panel()).findByRole("status")).textContent).toBe(BED_REACTIVATED);
  });
  it("falha ao ler os leitos mostra a frase do painel", async () => {
    mount();
    vi.mocked(api.listPsyBeds).mockRejectedValue(new api.ApiError(403, { error: "missing_role" }, "403"));
    expect((await within(await screen.findByRole("region", { name: /Leitos · CAPS AD III Boqueirão/ })).findByRole("alert")).textContent).toBe(PSY_ERRORS.missing_role);
  });
});
