import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listCareProviders: vi.fn(), createCareProvider: vi.fn(), updateCareProvider: vi.fn(), listCareOffers: vi.fn(), createCareOffer: vi.fn(),
  updateCareOffer: vi.fn(), listAllUnits: vi.fn(), searchRegulationTargets: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { RegulationOffers } from "./RegulationOffers";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMB_ESPEC, CARDIO, TODAY26, offer, provider, regUser } from "../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
// O prestador aparece nas duas tabelas (prestadores e ofertas): as linhas se procuram dentro do painel.
const offersPanel = async () => within(await screen.findByRole("region", { name: /^Ofertas e cotas de/ }));
const providersPanel = async () => within(await screen.findByRole("region", { name: "Prestadores" }));

describe("RegulationOffers", () => {
  beforeEach(() => {
    for (const fn of [ api.createCareProvider, api.updateCareProvider, api.createCareOffer, api.updateCareOffer, api.listCareOffers, api.listAllUnits, api.listCareProviders ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "municipal_admin" ]));
    mocked(api.listCareProviders).mockResolvedValue([ provider(), provider({ id: "pr2", name: "Clínica do Coração", cnes: "7654321", kind: "contracted", health_unit: null }) ]);
    mocked(api.listAllUnits).mockResolvedValue([ { ...AMB_ESPEC, kind: "other", active: true }, { id: "u9", name: "UBS Fechada", kind: "ubs", active: false } ]);
    mocked(api.listCareOffers).mockResolvedValue([ offer(), offer({ id: "of2", provider: { id: "pr2", name: "Clínica do Coração", kind: "contracted" },
      quantity: 6, used: 6, available: 0 }) ]);
    mocked(api.searchRegulationTargets).mockResolvedValue([ CARDIO ]);
    mocked(api.createCareProvider).mockResolvedValue(provider());
    mocked(api.createCareOffer).mockResolvedValue(offer());
  });

  it("ofertas do mês corrente com usadas, saldo e esgotada", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    expect(await screen.findByText("Ofertas e cotas de outubro de 2026")).not.toBeNull();
    expect(mocked(api.listCareOffers)).toHaveBeenCalledWith({ month: "2026-10" });
    const full = await (await offersPanel()).findByRole("row", { name: /Clínica do Coração/ });
    expect(within(full).getByText("esgotada")).not.toBeNull();
    expect(within((await offersPanel()).getByRole("row", { name: /Ambulatório de Especialidades.*Cardiologia/ })).getByText("2")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 oferta esgotada neste mês");
  });

  it("os prestadores mostram nome, CNES, tipo, unidade da rede e situação", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    const own = await (await providersPanel()).findByRole("row", { name: /Ambulatório de Especialidades/ });
    expect(own.textContent).toContain("2384310");
    expect(own.textContent).toContain("rede própria");
    expect(own.textContent).toContain("ativo");
    expect((await providersPanel()).getByRole("row", { name: /Clínica do Coração/ }).textContent).toContain("contratado");
  });

  it("outro mês relê as ofertas desse mês", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    await screen.findByText("Ofertas e cotas de outubro de 2026");
    mocked(api.listCareOffers).mockResolvedValue([]);
    fireEvent.change(screen.getByLabelText("Ver o mês"), { target: { value: "2026-11" } });
    expect(await screen.findByText("Ofertas e cotas de novembro de 2026")).not.toBeNull();
    expect(mocked(api.listCareOffers)).toHaveBeenLastCalledWith({ month: "2026-11" });
    expect(await screen.findByText("nenhuma oferta neste mês")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("novo prestador: CNES conferido antes; na rede própria, a unidade no lugar do CNES (R17); step-up e o corpo", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo prestador" }));
    text("Nome", "Clínica do Coração"); text("Tipo", "contracted"); text("CNES", "765432");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("CNES tem 7 dígitos");
    text("CNES", "7654321");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.createCareProvider)).toHaveBeenCalledWith({ name: "Clínica do Coração", cnes: "7654321",
      kind: "contracted", active: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Novo prestador" }));
    text("Nome", "Ambulatório de Especialidades"); text("Tipo", "own");
    expect(screen.queryByLabelText("CNES")).toBeNull();
    text("Unidade da rede", "u2");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.createCareProvider)).toHaveBeenLastCalledWith({ name: "Ambulatório de Especialidades", kind: "own",
      health_unit_id: "u2", active: true }));
  });

  it("prestador: nome curto e rede própria sem unidade são recusados antes; unidade inativa não é oferecida", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo prestador" }));
    text("Nome", "ab"); text("Tipo", "own");
    expect(within(screen.getByLabelText("Unidade da rede")).queryByRole("option", { name: "UBS Fechada" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o nome tem de 3 a 120 caracteres");
    text("Nome", "Ambulatório Novo");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a unidade da rede");
    expect(mocked(api.createCareProvider)).not.toHaveBeenCalled();
  });

  it("editar prestador: o tipo não muda; recusa cnes_taken fica no formulário", async () => {
    mocked(api.updateCareProvider).mockRejectedValue(new ApiError(409, { error: "cnes_taken" }, "x"));
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    const line = await (await providersPanel()).findByRole("row", { name: /Clínica do Coração/ });
    fireEvent.click(within(line).getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).disabled).toBe(true);
    text("CNES", "1111111");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("já existe prestador com este CNES")).not.toBeNull();
    expect(mocked(api.updateCareProvider)).toHaveBeenCalledWith("pr2", { name: "Clínica do Coração", cnes: "1111111", kind: "contracted", active: true });
    expect((screen.getByLabelText("CNES") as HTMLInputElement).value).toBe("1111111");
  });

  it("nova oferta: alvo pela busca, mês e quantidade inteira; 10,5 recusado", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova oferta" }));
    text("Prestador", "pr2"); text("Mês", "2026-11"); text("Quantidade no mês", "10,5");
    text("Especialidade ou procedimento", "cardio");
    fireEvent.click(await screen.findByRole("button", { name: /225120 — Cardiologia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("quantidade é um número inteiro de 0 a 9999");
    text("Quantidade no mês", "10");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked(api.createCareOffer)).toHaveBeenCalledWith({ provider_id: "pr2", target_type: "specialty",
      target_code: "225120", month: "2026-11", quantity: 10 }));
  });

  it("nova oferta: mês passado e falta do alvo são recusados antes; a busca não filtra por CBO", async () => {
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova oferta" }));
    text("Prestador", "pr2"); text("Quantidade no mês", "10");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a especialidade ou o procedimento");
    text("Especialidade ou procedimento", "cardio");
    fireEvent.click(await screen.findByRole("button", { name: /225120 — Cardiologia/ }));
    text("Mês", "2026-09");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o mês da oferta não pode ser anterior ao corrente");
    expect(mocked(api.createCareOffer)).not.toHaveBeenCalled();
  });

  it("nova oferta repetida: 409 duplicate_offer fica no formulário", async () => {
    mocked(api.createCareOffer).mockRejectedValue(new ApiError(409, { error: "duplicate_offer" }, "x"));
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova oferta" }));
    text("Prestador", "pr1"); text("Quantidade no mês", "4");
    text("Especialidade ou procedimento", "cardio");
    fireEvent.click(await screen.findByRole("button", { name: /225120 — Cardiologia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("já existe oferta deste prestador para este alvo neste mês")).not.toBeNull();
    expect((screen.getByLabelText("Quantidade no mês") as HTMLInputElement).value).toBe("4");
  });

  it("mudar a quantidade abaixo do usado: 422 quantity_below_used fica no formulário", async () => {
    mocked(api.updateCareOffer).mockRejectedValue(new ApiError(422, { error: "quantity_below_used", used: 8 }, "x"));
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    fireEvent.click(within(await (await offersPanel()).findByRole("row", { name: /Ambulatório de Especialidades.*Cardiologia/ })).getByRole("button", { name: "Mudar quantidade" }));
    text("Quantidade no mês", "5");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("a quantidade não pode ficar abaixo do que já foi autorizado no mês (8)")).not.toBeNull();
    expect((screen.getByLabelText("Quantidade no mês") as HTMLInputElement).value).toBe("5");
    expect(mocked(api.updateCareOffer)).toHaveBeenCalledWith("of1", 5);
  });

  it("regulador lê sem botões e sem pedir as unidades", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "care_regulator" ]));
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    await (await offersPanel()).findByRole("row", { name: /Clínica do Coração/ });
    expect(screen.queryByRole("button", { name: "Nova oferta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Novo prestador" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mudar quantidade" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(mocked(api.listAllUnits)).not.toHaveBeenCalled();
  });

  it("sem papel de regulação ou administração: nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser([ "health_professional" ]));
    renderWithProviders(<RegulationOffers today={TODAY26} />);
    expect(await screen.findByText("seu papel não permite usar a regulação municipal")).not.toBeNull();
    expect(mocked(api.listCareProviders)).not.toHaveBeenCalled();
  });
});
