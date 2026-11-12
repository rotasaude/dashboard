// Painel da ouvidoria (módulo 33; F-33.9): totais com supressão do api (sempre "oculto", Q61), período, e o recorte por profissional
// só para o ouvidor. A tela nunca recalcula nem deduz um valor escondido.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW33, dashboard33, ombudsmanUser } from "../test/ombudsmanFixtures";
import * as api from "../lib/api";
import { ApiError, type SessionUser } from "../lib/api";
import { OMBUDSMAN_ERRORS, OMBUDSMAN_NO_ROLE } from "../lib/ombudsman";
import { OmbudsmanPanel, numbersRows } from "./OmbudsmanPanel";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getOmbudsmanDashboard: vi.fn(),
  getOmbudsmanProfessionalsPanel: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const HIDDEN = { suppressed: true } as const;
const OCULTO = "oculto";
const NOTE = "Contagens pequenas, e as que permitiriam deduzi-las, aparecem como 'oculto'.";

function mount(user: SessionUser = ombudsmanUser([ "ombudsman_staff" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<OmbudsmanPanel now={NOW33} />);
}
// O valor do StatTile fica no mesmo cartão do rótulo (rótulo → cabeçalho → cartão).
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement as HTMLElement;
const rowOf = (scope: HTMLElement, label: string) => within(scope).getByText(label).closest("[role='row']") as HTMLElement;

describe("painel da ouvidoria", () => {
  it("totais com 'oculto', nunca zero nem '< 5' no lugar do suprimido; a nota da Q61", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33({ resolution_rate: HIDDEN }));
    const { container } = mount();
    expect(await screen.findByText("42")).not.toBeNull();
    const praise = screen.getByText("Elogio").closest("[role='row']") as HTMLElement;
    expect(within(praise).getByText(OCULTO)).not.toBeNull();
    expect(tile("Resolutividade").textContent).toMatch(/oculto/);
    expect(tile("Respondidas no prazo").textContent).toMatch(/85\s?%/);
    expect(screen.getByText(/17,4 dias/)).not.toBeNull();
    expect(screen.getByText(/4,1 de 5/)).not.toBeNull();
    // `unclassified` vem por último e se chama "sem assunto"; unidade pelo nome do api.
    const subjects = screen.getByRole("region", { name: "Por assunto" });
    const names = within(subjects).getAllByRole("row").slice(1).map((r) => r.querySelector("[role='cell']")!.textContent);
    expect(names).toEqual([ "Atendimento", "Transporte", "sem assunto" ]);
    expect(within(rowOf(screen.getByRole("region", { name: "Por unidade" }), "UBS Centro")).getByText("12")).not.toBeNull();
    expect(screen.getByText(NOTE)).not.toBeNull();
    expect(container.textContent).not.toContain("< 5");
    expect(container.textContent).not.toMatch(/de 1 a 4/);
  });

  it("zero escondido mostra 'oculto'; taxa sem caso mostra '—'", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33({
      by_channel: { web: 28, in_person: 6, phone: 8, ouvidorsus: HIDDEN, total: 42 },
      on_time_rate: null
    }));
    mount();
    await screen.findByText("42");
    const ouvidorsus = rowOf(screen.getByRole("region", { name: "Por canal" }), "OuvidorSUS");
    expect(within(ouvidorsus).getByText(OCULTO)).not.toBeNull();
    expect(within(ouvidorsus).queryByText("0")).toBeNull();
    expect(tile("Respondidas no prazo").textContent).toMatch(/—/);
  });

  it("satisfação toda escondida (Q55): tudo 'oculto', inclusive as respostas, sem quebrar", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33({
      by_state: { received: 5, in_analysis: 10, forwarded: 7, awaiting_complement: 0, answered: HIDDEN, archived: HIDDEN, total: 42 },
      on_time_rate: HIDDEN, avg_days_to_conclude: HIDDEN, resolution_rate: HIDDEN,
      satisfaction: { responses: HIDDEN, met: { yes: HIDDEN, partly: HIDDEN, no: HIDDEN }, clear: { yes: HIDDEN, no: HIDDEN }, avg_score: HIDDEN }
    }));
    const { container } = mount();
    await screen.findByText("42");
    const sat = screen.getByRole("region", { name: "Satisfação" });
    expect(within(rowOf(sat, "Pesquisas respondidas")).getByText(OCULTO)).not.toBeNull();
    expect(within(rowOf(sat, "Demanda atendida: sim")).getByText(OCULTO)).not.toBeNull();
    expect(within(rowOf(sat, "Resposta clara: não")).getByText(OCULTO)).not.toBeNull();
    expect(within(rowOf(sat, "Nota média")).getByText(OCULTO)).not.toBeNull();
    expect(container.textContent).not.toContain("< 5");
    expect(tile("Tempo médio até a conclusão").textContent).toMatch(/oculto/);
    expect(tile("Tempo médio até a conclusão").textContent).not.toMatch(/dias/);
  });

  it("período vai à consulta; o fim antes do início não sai", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33());
    mount();
    await screen.findByText("42");
    expect(vi.mocked(api.getOmbudsmanDashboard).mock.calls[0][0]).toEqual({ from: "2026-11-01", to: "2026-11-11" });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.getByText("o início vem antes do fim")).not.toBeNull();
    expect(api.getOmbudsmanDashboard).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(api.getOmbudsmanDashboard).toHaveBeenLastCalledWith({ from: "2026-01-01", to: "2026-11-11" }));
  });

  it("sem início ou fim: a frase, e nada sai", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33());
    mount();
    await screen.findByText("42");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.getByText("informe o início e o fim")).not.toBeNull();
    expect(api.getOmbudsmanDashboard).toHaveBeenCalledTimes(1);
  });

  it("abas com tabpanel ligado à aba ativa", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33());
    vi.mocked(api.getOmbudsmanProfessionalsPanel).mockResolvedValue([]);
    mount(ombudsmanUser([ "ombudsman" ]));
    await screen.findByText("42");
    const summary = screen.getByRole("tab", { name: "Resumo" });
    const panel = screen.getByRole("tabpanel");
    expect(summary.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(summary.id);
    fireEvent.click(screen.getByRole("tab", { name: "Por profissional" }));
    const prof = screen.getByRole("tab", { name: "Por profissional" });
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(prof.id);
    expect(prof.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
  });

  it("'Atualizar' no mesmo período relê também o recorte por profissional aberto", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33());
    vi.mocked(api.getOmbudsmanProfessionalsPanel).mockResolvedValue([]);
    mount(ombudsmanUser([ "ombudsman" ]));
    await screen.findByText("42");
    fireEvent.click(screen.getByRole("tab", { name: "Por profissional" }));
    await screen.findByText("nenhum profissional referido no período");
    expect(api.getOmbudsmanProfessionalsPanel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(api.getOmbudsmanProfessionalsPanel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getOmbudsmanDashboard).toHaveBeenCalledTimes(2));
  });

  it("invalid_period do api vira a frase", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockRejectedValue(new ApiError(422, { error: "invalid_period" }, "x"));
    mount();
    expect(await screen.findByText(OMBUDSMAN_ERRORS.invalid_period)).not.toBeNull();
  });

  it("por profissional só para o ouvidor, lido só ao abrir a aba", async () => {
    vi.mocked(api.getOmbudsmanDashboard).mockResolvedValue(dashboard33());
    vi.mocked(api.getOmbudsmanProfessionalsPanel).mockResolvedValue([
      { professional: { id: "p1", name: "Dr. Caio" }, by_kind: { complaint: 3, report: 0, praise: 1, suggestion: 0, request: 0 }, total: 4 }
    ]);
    mount(ombudsmanUser([ "ombudsman_staff" ]));
    await screen.findByText("42");
    expect(screen.queryByRole("tab", { name: "Por profissional" })).toBeNull();
    expect(api.getOmbudsmanProfessionalsPanel).not.toHaveBeenCalled();
    cleanup();
    mount(ombudsmanUser([ "ombudsman" ]));
    await screen.findByText("42");
    expect(api.getOmbudsmanProfessionalsPanel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Por profissional" }));
    const caio = (await screen.findByText("Dr. Caio")).closest("[role='row']") as HTMLElement;
    expect(within(caio).getAllByRole("cell").map((c) => c.textContent)).toEqual([ "Dr. Caio", "3", "0", "1", "0", "0", "4" ]);
    expect(api.getOmbudsmanProfessionalsPanel).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-11" });
    expect(screen.getByRole("tab", { name: "Por profissional" }).getAttribute("aria-selected")).toBe("true");
  });

  it("o ponto de resposta não vê o painel", async () => {
    mount(ombudsmanUser([ "ombudsman_responder" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(api.getOmbudsmanDashboard).not.toHaveBeenCalled();
  });
});

describe("numbersRows", () => {
  it("mostra o que o api manda, sem somar nem deduzir", () => {
    const rows = numbersRows(dashboard33({ resolution_rate: HIDDEN }));
    const get = (k: string) => rows.find(([ key ]) => key === k)?.[1];
    expect(get("Total de manifestações")).toBe("42");
    expect(get("Tipo: Elogio")).toBe(OCULTO);
    expect(get("Canal: OuvidorSUS")).toBe("0");
    expect(get("Assunto: sem assunto")).toBe("15");
    expect(get("Unidade: UBS Centro")).toBe("12");
    expect(get("Resolutividade")).toBe(OCULTO);
    expect(rows.some(([ , v ]) => v.includes("< 5"))).toBe(false);
    expect(get("Tempo médio até a conclusão")).toBe("17,4 dias");
    expect(get("Nota média")).toBe("4,1 de 5");
    expect(rows.some(([ k ]) => /total/i.test(k) && k !== "Total de manifestações")).toBe(false);
  });
});
