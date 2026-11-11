// Painel da urgência (F-32.6; contrato §11 e §14 Q15, Q25, Q28; preflight A11, C-T13, E5). A forma é a do api real
// (Urgency::Dashboard): só contagens, de 1 a 4 "lt5" (aparece "menos de 5", nunca calculado), tempos com contagem 0 nulos, sem total
// e sem `registered_in_error`. As UPAs do seletor vêm do próprio painel (`units` da leitura de todas): o analista não lê
// /attendance/units (require_unit_reader).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { MONTH32, dashboard, urgencyUser } from "../test/urgencyFixtures";
import * as api from "../lib/api";
import { UrgencyPanel } from "./UrgencyPanel";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getUrgencyDashboard: vi.fn(), listActiveUnits: vi.fn()
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const TODAY = "2026-11-05";
const ALL_UPAS = [ { id: "upa1", name: "UPA Boqueirão" }, { id: "upa2", name: "UPA Cajuru" } ];

beforeEach(() => {
  vi.mocked(api.getUrgencyDashboard).mockImplementation(async (q) =>
    dashboard({ units: q.unitId ? ALL_UPAS.filter((u) => u.id === q.unitId) : ALL_UPAS }));
});

function mount(user = urgencyUser([ "analyst" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<UrgencyPanel today={TODAY} />);
}
const optionTexts = (select: HTMLElement) => [ ...(select as HTMLSelectElement).options ].map((o) => o.text);
const lastQuery = () => vi.mocked(api.getUrgencyDashboard).mock.calls.at(-1)?.[0];

describe("painel da urgência", () => {
  it("tempos por cor só com contagens, com menos de 5, e nenhum nome", async () => {
    mount();
    const table = await screen.findByRole("table", { name: "Tempos por cor" });
    const yellow = within(table).getByRole("row", { name: /amarelo/ });
    expect(within(yellow).getByText("40")).not.toBeNull();
    expect(within(yellow).getByText("mediana 8 min · p90 15 min")).not.toBeNull();
    expect(within(yellow).getByText("38")).not.toBeNull();
    expect(within(yellow).getByText("mediana 41 min · p90 70 min")).not.toBeNull();
    // over de count, e o % só com os dois em número.
    expect(within(yellow).getByText("6 de 38 (16%)")).not.toBeNull();
    const red = within(table).getByRole("row", { name: /vermelho/ });
    // contagem e tempos da porta, contagem e tempos do médico
    expect(within(red).getAllByText("menos de 5").length).toBe(4);
    expect(within(red).getByText("0 de menos de 5")).not.toBeNull();
    // O laranja vai com o texto (o tema não tem laranja); estouro "lt5" não vira %.
    expect(within(within(table).getByRole("row", { name: /laranja/ })).getByText("menos de 5 de 12")).not.toBeNull();
    // Sem caso: tempos nulos.
    expect(within(within(table).getByRole("row", { name: /azul/ })).getAllByText("—").length).toBe(3);
    // Nenhum paciente no painel.
    expect(document.body.textContent).not.toMatch(/Maria|CPF|CNS/);
    expect(vi.mocked(api.getUrgencyDashboard).mock.calls[0][0]).toEqual({ month: MONTH32, unitId: null });
  });

  it("por cor, por desfecho (sem o registrado por engano), evasão e permanência; sem total", async () => {
    mount();
    const byColor = await screen.findByRole("table", { name: "Atendimentos por cor" });
    expect(within(within(byColor).getByRole("row", { name: /sem classificação/ })).getByText("6")).not.toBeNull();
    expect(within(within(byColor).getByRole("row", { name: /vermelho/ })).getByText("menos de 5")).not.toBeNull();
    const byOutcome = screen.getByRole("table", { name: "Por desfecho" });
    expect(within(within(byOutcome).getByRole("row", { name: /Óbito/ })).getByText("0")).not.toBeNull();
    expect(within(within(byOutcome).getByRole("row", { name: /Saiu contra orientação médica/ })).getByText("menos de 5")).not.toBeNull();
    expect(within(byOutcome).getAllByRole("row").length).toBe(7);
    expect(screen.queryByText("Registrado por engano")).toBeNull();
    expect(screen.getByText("Saíram sem atendimento antes da classificação")).not.toBeNull();
    expect(screen.getByText("Saíram sem atendimento depois da classificação")).not.toBeNull();
    expect(screen.getByText("95 min")).not.toBeNull();
    expect(screen.getByText("210 min")).not.toBeNull();
    // E5: o api não tem total, e somar contagens suprimidas inventaria número.
    expect(screen.queryByText("Atendimentos")).toBeNull();
    expect(screen.getByText("Contagens de 1 a 4 aparecem como “menos de 5”.")).not.toBeNull();
  });

  it("UPAs do seletor vêm do painel; filtro por UPA e por mês vão na consulta", async () => {
    mount(urgencyUser([ "municipal_admin" ]));
    const select = await screen.findByLabelText("UPA do painel");
    await waitFor(() => expect(optionTexts(select)).toEqual([ "Todas as UPAs", "UPA Boqueirão", "UPA Cajuru" ]));
    fireEvent.change(select, { target: { value: "upa2" } });
    await waitFor(() => expect(lastQuery()).toEqual({ month: MONTH32, unitId: "upa2" }));
    const month = screen.getByLabelText("Mês") as HTMLInputElement;
    expect(month.max).toBe(MONTH32);
    fireEvent.change(month, { target: { value: "2026-10" } });
    await waitFor(() => expect(lastQuery()).toEqual({ month: "2026-10", unitId: "upa2" }));
    // A lista não encolhe para a UPA escolhida.
    expect(optionTexts(screen.getByLabelText("UPA do painel"))).toEqual([ "Todas as UPAs", "UPA Boqueirão", "UPA Cajuru" ]);
    fireEvent.change(screen.getByLabelText("UPA do painel"), { target: { value: "" } });
    await waitFor(() => expect(lastQuery()).toEqual({ month: "2026-10", unitId: null }));
    expect(api.listActiveUnits).not.toHaveBeenCalled();
  });

  it("mês futuro não vai ao api; recusa 422 do mês mostra a frase do campo", async () => {
    mount();
    await screen.findByRole("table", { name: "Tempos por cor" });
    const calls = vi.mocked(api.getUrgencyDashboard).mock.calls.length;
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-12" } });
    expect(await screen.findByText("escolha um mês até o atual")).not.toBeNull();
    expect(vi.mocked(api.getUrgencyDashboard).mock.calls.length).toBe(calls);
    vi.mocked(api.getUrgencyDashboard).mockRejectedValue(new api.ApiError(422, { error: "invalid_request", path: "month" }, "422"));
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-09" } });
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o mês");
  });

  describe("observação (32b)", () => {
    const obs = (o: NonNullable<api.UrgencyDashboard["observation"]>) =>
      vi.mocked(api.getUrgencyDashboard).mockResolvedValue(dashboard({ observation: o }));

    it("mostra o bloco com números de uma casa e vírgula", async () => {
      obs({ stays: 12, over_24h: 3, median_hours: 9.5, p90_hours: 22, bed_hours: 140.3 });
      mount();
      const block = await screen.findByRole("region", { name: "Observação" });
      expect(within(block).getByText("12")).not.toBeNull();
      expect(within(block).getByText("3")).not.toBeNull();
      expect(within(block).getByText("9,5 h")).not.toBeNull();
      expect(within(block).getByText("22 h")).not.toBeNull();
      expect(within(block).getByText("140,3 h")).not.toBeNull();
    });
    it("de 1 a 4 estadias o bloco inteiro é 'menos de 5'", async () => {
      obs({ stays: "lt5", over_24h: "lt5", median_hours: "lt5", p90_hours: "lt5", bed_hours: "lt5" });
      mount();
      const block = await screen.findByRole("region", { name: "Observação" });
      expect(within(block).getAllByText("menos de 5").length).toBe(5);
    });
    it("sem estadias: contagens 0 e o resto em traço", async () => {
      obs({ stays: 0, over_24h: 0, median_hours: null, p90_hours: null, bed_hours: null });
      mount();
      const block = await screen.findByRole("region", { name: "Observação" });
      expect(within(block).getAllByText("0").length).toBe(2);
      expect(within(block).getAllByText("—").length).toBe(3);
    });
    it("sem o bloco (api do 32a), o painel segue igual", async () => {
      mount();
      await screen.findByRole("table", { name: "Tempos por cor" });
      expect(screen.queryByRole("region", { name: "Observação" })).toBeNull();
    });
  });
});
