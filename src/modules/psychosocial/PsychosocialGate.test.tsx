import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CAPS_AD_III, CAPS_II, psyUser } from "../../test/psychosocialFixtures";
import * as api from "../../lib/api";
import { PSY_DETAIL_KEY } from "../../lib/psychosocial";
import { PsychosocialGate } from "./PsychosocialGate";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listPsyUnits: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(user = psyUser(), unit: "team" | "any" | "beds" | "none" = "team", allow = (r: { staff: boolean }) => r.staff) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(
    <PsychosocialGate title="Usuários do CAPS" sub="matrícula" unit={unit} allow={allow}>
      {({ unit: u }) => <p>{u ? `dentro de ${u.name}` : "dentro sem CAPS"}</p>}
    </PsychosocialGate>);
}

describe("portão do CAPS", () => {
  it("interruptor desligado e papel errado: frases, sem ler os CAPS", async () => {
    mount(psyUser([ "psychosocial_staff" ], [ "clinical_record" ]));
    expect(await screen.findByText("a atenção psicossocial está desligada nesta cidade")).not.toBeNull();
    expect(screen.getByText("Usuários do CAPS")).not.toBeNull();
    cleanup();
    mount(psyUser([ "health_professional" ]));
    expect(await screen.findByText("seu papel não permite usar o CAPS")).not.toBeNull();
    expect(api.listPsyUnits).not.toHaveBeenCalled();
  });
  it("sem lotação: frase; um CAPS: entra direto; dois: seletor e troca", async () => {
    vi.mocked(api.listPsyUnits).mockResolvedValue([]);
    mount();
    expect(await screen.findByText(/você não está lotado em nenhum CAPS/)).not.toBeNull();
    cleanup();
    vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
    mount();
    expect(await screen.findByText("dentro de CAPS II Centro")).not.toBeNull();
    expect(screen.queryByLabelText("CAPS")).toBeNull();
    cleanup();
    vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II, CAPS_AD_III ]);
    mount();
    const select = await screen.findByLabelText("CAPS");
    expect(screen.getByText("dentro de CAPS II Centro")).not.toBeNull();
    expect(screen.getByRole("option", { name: "CAPS AD III Boqueirão · CAPS AD III" })).not.toBeNull();
    fireEvent.change(select, { target: { value: CAPS_AD_III.id } });
    expect(await screen.findByText("dentro de CAPS AD III Boqueirão")).not.toBeNull();
  });
  it("trocar de CAPS apaga o detalhe nominal do cache", async () => {
    vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II, CAPS_AD_III ]);
    const { client } = mount();
    const select = await screen.findByLabelText("CAPS");
    client.setQueryData([ PSY_DETAIL_KEY, "enrollment", "en1" ], { id: "en1" });
    fireEvent.change(select, { target: { value: CAPS_AD_III.id } });
    await screen.findByText("dentro de CAPS AD III Boqueirão");
    expect(client.getQueryData([ PSY_DETAIL_KEY, "enrollment", "en1" ])).toBeUndefined();
  });
  it("leitos: só CAPS com leito", async () => {
    vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II ]);
    mount(psyUser(), "beds");
    expect(await screen.findByText(/nenhum CAPS seu tem leitos/)).not.toBeNull();
    cleanup();
    vi.mocked(api.listPsyUnits).mockResolvedValue([ CAPS_II, CAPS_AD_III ]);
    mount(psyUser(), "beds");
    expect(await screen.findByText("dentro de CAPS AD III Boqueirão")).not.toBeNull();
    expect(screen.queryByLabelText("CAPS")).toBeNull();
  });
  it("faturista sem CAPS ativo na cidade: frase própria; \"none\" não lê os CAPS", async () => {
    vi.mocked(api.listPsyUnits).mockResolvedValue([]);
    mount(psyUser([ "billing_clerk" ]), "any", () => true);
    expect(await screen.findByText("nenhum CAPS ativo nesta cidade")).not.toBeNull();
    cleanup();
    vi.clearAllMocks();
    mount(psyUser([ "municipal_admin" ]), "none", () => true);
    expect(await screen.findByText("dentro sem CAPS")).not.toBeNull();
    expect(api.listPsyUnits).not.toHaveBeenCalled();
  });
  it("erro ao ler os CAPS: frase traduzida", async () => {
    vi.mocked(api.listPsyUnits).mockRejectedValue(new api.ApiError(403, { error: "feature_disabled", feature: "psychosocial_care" }, "forbidden"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe("a atenção psicossocial está desligada nesta cidade");
    expect(screen.queryByText(/dentro/)).toBeNull();
  });
});
