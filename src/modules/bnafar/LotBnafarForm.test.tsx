import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  updateLotBnafar: vi.fn(), getBnafarDomains: vi.fn(), listObmPresentations: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError, type LotBnafarState } from "../../lib/api";
import { LotBnafarForm } from "./LotBnafarForm";
import { bnafarErrorText } from "../../lib/bnafar";
import { renderWithProviders } from "../../test/campaignFixtures";
import { BNAFAR_DOMAINS, FIVE_MISSING, PRESENTATIONS, bnafarUser, lotBnafar } from "../../test/bnafarFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const OLD: LotBnafarState = { version: 0, missing: FIVE_MISSING };

type Over = Partial<{ state: LotBnafarState; hasVmp: boolean; vaccine: boolean; reload: () => Promise<LotBnafarState | null>; onSaved: (l: unknown) => void }>;
function setup(o: Over = {}) {
  const onSaved = o.onSaved ?? vi.fn(), onCancel = vi.fn(), reload = o.reload ?? vi.fn().mockResolvedValue(null);
  renderWithProviders(<LotBnafarForm lotId="lt1" lotNumber="AMX2611" locationId="l1" state={o.state ?? OLD} hasVmp={o.hasVmp ?? false}
    vmpCode={o.hasVmp ? "VMP0001" : null} vaccine={o.vaccine} onSaved={onSaved as never} onCancel={onCancel} reload={reload} />);
  return { onSaved, onCancel, reload };
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar dados do lote" }));
function fillAll() {
  text("Valor unitário (R$)", "12,50"); text("CNPJ do fabricante", "11.222.333/0001-81"); text("Registro ANVISA", "1234567890123");
}
async function program(code = "AF") {
  await screen.findByRole("option", { name: /AF —/ });
  text("Programa de saúde", code);
}

describe("LotBnafarForm", () => {
  beforeEach(() => {
    for (const fn of [ api.updateLotBnafar, api.getBnafarDomains, api.listObmPresentations ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "stock_keeper" ]));
    mocked(api.getBnafarDomains).mockResolvedValue(BNAFAR_DOMAINS);
    mocked(api.listObmPresentations).mockResolvedValue(PRESENTATIONS);
    mocked(api.updateLotBnafar).mockResolvedValue({ id: "lt1", bnafar: lotBnafar({ version: 1 }) });
  });

  it("lote antigo manda expected_version 0, location_id e só os preenchidos", async () => {
    const { onSaved } = setup();
    fillAll(); await program();
    save();
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLotBnafar)).toHaveBeenCalledWith("lt1", {
      location_id: "l1", expected_version: 0, unit_price_cents: 1250, manufacturer_cnpj: "11222333000181", anvisa_registration: "1234567890123", health_program: "AF"
    });
    expect(await screen.findByText("Dados do lote salvos. O lote entra na posição de estoque do próximo envio.")).not.toBeNull();
    expect(onSaved).toHaveBeenCalledWith(lotBnafar({ version: 1 }));
  });

  it("os exigidos vêm do missing; os outros ficam opcionais; vazio trava sem chamar o api", async () => {
    setup({ state: { version: 2, missing: [ "unit_price_cents" ] } });
    await screen.findByRole("option", { name: /AF —/ });
    expect(screen.getByLabelText("Valor unitário (R$)")).not.toBeNull();
    expect(screen.getByLabelText("Registro ANVISA (opcional)")).not.toBeNull();
    save();
    expect(await screen.findByText("informe valor unitário (R$)")).not.toBeNull();
    expect(mocked(api.updateLotBnafar)).not.toHaveBeenCalled();
  });

  it("409 lot_bnafar_changed: a frase, uma releitura, o digitado fica e o segundo envio leva a versão relida", async () => {
    mocked(api.updateLotBnafar).mockRejectedValueOnce(new ApiError(409, { error: "lot_bnafar_changed" }, "x"));
    const reload = vi.fn().mockResolvedValue({ version: 3, missing: FIVE_MISSING });
    setup({ reload });
    fillAll(); await program();
    save();
    expect(await screen.findByText(bnafarErrorText("lot_bnafar_changed"))).not.toBeNull();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Valor unitário (R$)") as HTMLInputElement).value).toBe("12,50");
    expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByRole("button", { name: "Salvar dados do lote" }) as HTMLButtonElement).disabled).toBe(false));
    save();
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateLotBnafar).mock.calls[1][1].expected_version).toBe(3);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("422 com path manufacturer_cnpj aparece no campo", async () => {
    mocked(api.updateLotBnafar).mockRejectedValueOnce(new ApiError(422, { error: "invalid_cnpj", path: "manufacturer_cnpj" }, "x"));
    setup();
    fillAll(); await program();
    save();
    const field = (await screen.findByText(bnafarErrorText("invalid_cnpj")));
    expect(field.closest("label")?.textContent).toContain("CNPJ do fabricante");
  });

  it("lot_mismatch no campo traz a frase do campo (F-32)", async () => {
    mocked(api.updateLotBnafar).mockRejectedValueOnce(new ApiError(422, { error: "lot_mismatch", path: "anvisa_registration" }, "x"));
    setup();
    fillAll(); await program();
    save();
    const field = await screen.findByText("o lote já tem outro valor gravado aqui — confira no extrato do lote");
    expect(field.closest("label")?.textContent).toContain("Registro ANVISA");
  });

  it("o fabricante internacional manda o nome e nenhum CNPJ", async () => {
    setup();
    text("Valor unitário (R$)", "12,50"); text("Registro ANVISA", "1234567890123"); await program();
    fireEvent.click(screen.getByLabelText("Fabricante internacional (sem CNPJ)"));
    text("Nome do fabricante internacional", "Pfizer Ireland");
    save();
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLotBnafar)).toHaveBeenCalledWith("lt1", {
      location_id: "l1", expected_version: 0, unit_price_cents: 1250, manufacturer_international: true, manufacturer: "Pfizer Ireland",
      anvisa_registration: "1234567890123", health_program: "AF"
    });
  });

  it("o duplo clique envia um pedido", async () => {
    let release: (v: unknown) => void = () => undefined;
    mocked(api.updateLotBnafar).mockReturnValue(new Promise((r) => { release = r; }));
    setup();
    fillAll(); await program();
    save(); save();
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1));
    release({ id: "lt1", bnafar: lotBnafar() });
    await screen.findByText(/Dados do lote salvos/);
    expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1);
  });

  it("vacina: o CNPJ do fabricante não é campo, é a frase do catálogo (F-11)", async () => {
    setup({ vaccine: true, state: { version: 0, missing: [ "manufacturer_cnpj", "unit_price_cents" ] } });
    await screen.findByRole("option", { name: /AF —/ });
    expect(screen.queryByLabelText(/CNPJ do fabricante/)).toBeNull();
    expect(screen.getByText(/o CNPJ do fabricante vem do catálogo de imunobiológicos/)).not.toBeNull();
    text("Valor unitário (R$)", "45,90");
    save();
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLotBnafar).mock.calls[0][1]).toEqual({ location_id: "l1", expected_version: 0, unit_price_cents: 4590 });
  });
});
