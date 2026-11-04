import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { SETTINGS, trUser } from "../test/transportFixtures";
import * as api from "../lib/api";
import { TransportSettings, settingsProblems } from "./TransportSettings";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getTransportSettings: vi.fn(),
  updateTransportSettings: vi.fn(), listAllUnits: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const UNITS = [ { id: "u1", name: "UBS Centro", kind: "ubs", active: true }, { id: "u9", name: "Secretaria de Saúde", kind: "health_management", active: true } ];
function mount(roles = [ "municipal_admin" ], settings = SETTINGS) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser(roles));
  vi.mocked(api.getTransportSettings).mockResolvedValue(settings);
  vi.mocked(api.listAllUnits).mockResolvedValue(UNITS as never);
  return renderWithProviders(<TransportSettings />);
}
const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
};

describe("regras do TFD e do acompanhante", () => {
  it("lê, mostra só unidades de gestão para o CNES do TFD e grava com step-up", async () => {
    vi.mocked(api.updateTransportSettings).mockResolvedValue({ ...SETTINGS, tfd_billing_health_unit_id: "u9" });
    mount();
    const min = (await screen.findByLabelText("Distância mínima do TFD (km)")) as HTMLInputElement;
    expect(min.value).toBe("50");
    const unit = screen.getByLabelText("Unidade do BPA do TFD") as HTMLSelectElement;
    expect([ ...unit.options ].map((o) => o.textContent)).toEqual([ "Escolha a unidade de gestão", "Secretaria de Saúde" ]);
    fireEvent.change(unit, { target: { value: "u9" } });
    fireEvent.change(screen.getByLabelText(/^0803010125 — /), { target: { value: "10,00" } });
    await save();
    await waitFor(() => expect(api.updateTransportSettings).toHaveBeenCalledWith({
      tfd_min_distance_km: 50, companion_rule: { max_age_child: 15, min_age_elderly: 60 }, tfd_billing_health_unit_id: "u9",
      allowance_complements: { "0803010125": 1000 }
    }));
  });
  it("manda o mapa inteiro de complementos (o api substitui tudo) e aceita código sem nome", async () => {
    vi.mocked(api.updateTransportSettings).mockResolvedValue(SETTINGS);
    mount(undefined, { ...SETTINGS, allowance_complements: { "0803010010": 500, "0803010044": 700 } });
    const a = (await screen.findByLabelText(/^0803010010 — /)) as HTMLInputElement;
    expect(a.value).toBe("5,00");
    expect(screen.getByLabelText("0803010095")).not.toBeNull();
    fireEvent.change(a, { target: { value: "" } });
    await save();
    await waitFor(() => expect(api.updateTransportSettings).toHaveBeenCalledWith(expect.objectContaining({ allowance_complements: { "0803010044": 700 } })));
  });
  it("todas as recusas de uma vez, antes de enviar", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Distância mínima do TFD (km)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Criança até (anos)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Idoso a partir de (anos)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/^0803010010 — /), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar regras" }));
    expect(screen.getByText("a distância mínima precisa ser de 1 a 1000 km")).not.toBeNull();
    expect(screen.getByText("a idade da criança precisa ser de 0 a 17 anos")).not.toBeNull();
    expect(screen.getByText("a idade do idoso precisa ser de 50 a 100 anos")).not.toBeNull();
    expect(screen.getByText("o complemento precisa ser um valor em reais, de 0 a 10.000,00")).not.toBeNull();
    expect(api.updateTransportSettings).not.toHaveBeenCalled();
  });
  it("billing_unit_invalid do api vira a frase da unidade", async () => {
    vi.mocked(api.updateTransportSettings).mockRejectedValue(new api.ApiError(422, { error: "billing_unit_invalid", problems: [ { path: "tfd_billing_health_unit_id", error: "billing_unit_invalid" } ] }, "422"));
    mount();
    await screen.findByLabelText("Distância mínima do TFD (km)");
    await save();
    expect((await screen.findByRole("alert")).textContent).toContain("unidade de faturamento do TFD");
  });
  it("sem unidade escolhida vai null; só o administrador abre a tela", async () => {
    vi.mocked(api.updateTransportSettings).mockResolvedValue(SETTINGS);
    mount();
    await screen.findByLabelText("Distância mínima do TFD (km)");
    await save();
    await waitFor(() => expect(api.updateTransportSettings).toHaveBeenCalledWith(expect.objectContaining({ tfd_billing_health_unit_id: null, allowance_complements: {} })));
    cleanup();
    mount([ "transport_dispatcher" ]);
    expect(await screen.findByText("seu papel não permite usar o transporte sanitário")).not.toBeNull();
    expect(screen.queryByLabelText("Distância mínima do TFD (km)")).toBeNull();
  });
  it("settingsProblems: limites do api", () => {
    const ok = { minKm: "1000", maxAgeChild: "17", minAgeElderly: "100", complements: {} };
    expect(settingsProblems(ok)).toEqual([]);
    expect(settingsProblems({ ...ok, minKm: "1001" }).map((p) => p.path)).toEqual([ "tfd_min_distance_km" ]);
    expect(settingsProblems({ ...ok, maxAgeChild: "-1", minAgeElderly: "49" }).map((p) => p.path)).toEqual([ "companion_rule.max_age_child", "companion_rule.min_age_elderly" ]);
    expect(settingsProblems({ ...ok, complements: { "0803010010": "100.000,01" } }).map((p) => p.path)).toEqual([ "allowance_complements.0803010010" ]);
  });
});
