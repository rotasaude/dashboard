// src/modules/VectorSettings.test.tsx — "Produtos e parâmetros" da coordenação de endemias (módulo 35a, F-35.3; contrato §4, §11).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getVectorDomains: vi.fn(), listVectorProducts: vi.fn(), createVectorProduct: vi.fn(),
    updateVectorProduct: vi.fn(), getVectorParameters: vi.fn(), putVectorParameters: vi.fn(), getVectorSettings: vi.fn(), putVectorSettings: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type VectorParameters, type VectorProduct, type VectorSettings as Settings } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { ADULTICIDE, INACTIVE_PRODUCT, LARVICIDE, PARAMS, VC_DOMAINS, VC_FEATURES, parameterVersion, vcUser } from "../test/vectorControlFixtures";
import { NOTHING_CHANGED, productProblems } from "./vectorControl/ProductsPanel";
import { PARAM_FIELDS, PARAMS_SAVED, currentValueHint, draftOf, parameterProblems, parametersVersionLabel, type ParamDraft } from "./vectorControl/ParametersPanel";
import { LOCATION_GONE, NO_LOCATION, VectorSettings } from "./VectorSettings";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const IN_USE = { ...LARVICIDE, in_use: true };
const SETTINGS: Settings = { stock_location: null, options: [ { id: "loc-uvz", name: "Almoxarifado da UVZ" }, { id: "loc-2", name: "Depósito Norte" } ] };
const BTI: VectorProduct = { id: "pr9", code: "BTI", name: "Bti WG", unit: "g", charge_size: "0.50", uses: [ "focal" ], active: true, in_use: false };

const mount = (onGoToSecurity?: () => void) => renderWithProviders(<VectorSettings onGoToSecurity={onGoToSecurity} />);
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const productsTable = () => screen.findByRole("table", { name: "Produtos de campo" });
const rowOf = (text: string) => {
  const row = screen.getAllByRole("row").find((r) => within(r).queryAllByText(text).length > 0);
  if (!row) throw new Error(`sem a linha ${text}`);
  return within(row);
};
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? "" : "";
};
async function fillNewProduct() {
  fireEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
  type("Código", "BTI");
  type("Nome", "Bti WG");
  fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "g" } });
  type("Tamanho da carga", "0,5");
  fireEvent.click(screen.getByLabelText("Focal (larvicida)"));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === "function" && "mockReset" in fn) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  mocked(api.getVectorDomains).mockResolvedValue(VC_DOMAINS);
  mocked(api.listVectorProducts).mockResolvedValue([ LARVICIDE, ADULTICIDE, INACTIVE_PRODUCT ]);
  mocked(api.getVectorParameters).mockResolvedValue(parameterVersion());
  mocked(api.getVectorSettings).mockResolvedValue(SETTINGS);
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
});

describe("portão", () => {
  it("só a coordenação: laboratório e agente veem a frase do papel e nada é lido", async () => {
    for (const roles of [ [ "vector_lab" ], [ "health_professional" ], [ "municipal_admin" ] ]) {
      mocked(api.fetchCurrentSession).mockResolvedValue(vcUser(roles));
      mount();
      expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
      cleanup();
    }
    expect(api.listVectorProducts).not.toHaveBeenCalled();
    expect(api.getVectorParameters).not.toHaveBeenCalled();
    expect(api.getVectorSettings).not.toHaveBeenCalled();
  });
});

describe("produtos de campo", () => {
  it("produto novo: corpo com charge_size em texto e usos; produto em uso trava unidade e carga", async () => {
    mocked(api.listVectorProducts).mockResolvedValue([ LARVICIDE, ADULTICIDE, INACTIVE_PRODUCT ]);
    mocked(api.createVectorProduct).mockResolvedValue(BTI);
    mount();
    await productsTable();
    expect(rowOf("PYR").getByText("Pyriproxyfen 0,5% G")).not.toBeNull();
    expect(rowOf("PYR").getByText("2,00")).not.toBeNull();
    expect(rowOf("MAL").getByText("Perifocal (adulticida residual), Espacial (UBV)")).not.toBeNull();
    expect(rowOf("TEM").getByText("inativo")).not.toBeNull();
    await fillNewProduct();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar produto/ }));
    await waitFor(() => expect(api.createVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.createVectorProduct).mock.calls[0][0]).toEqual({ code: "BTI", name: "Bti WG", unit: "g", charge_size: "0.5", uses: [ "focal" ], active: true });
    expect(await screen.findByText("produto BTI salvo")).not.toBeNull();
    // Depois de gravar: a lista e os domínios (o boletim lê os produtos ativos de lá) são relidos.
    await waitFor(() => expect(api.listVectorProducts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getVectorDomains).toHaveBeenCalledTimes(2));

    // Produto com lote ou medida: unidade e carga desabilitadas, com a frase do product_in_use.
    mocked(api.listVectorProducts).mockResolvedValue([ IN_USE, ADULTICIDE ]);
    cleanup();
    mount();
    await productsTable();
    fireEvent.click(rowOf("PYR").getByRole("button", { name: "Editar PYR" }));
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).disabled).toBe(true);
    expect(field("Tamanho da carga").disabled).toBe(true);
    expect(field("Nome").disabled).toBe(false);
    expect(screen.getByText(VECTOR_ERRORS.product_in_use)).not.toBeNull();
  });

  it("edição manda só o que mudou; 409 product_in_use → a frase e UMA releitura, sem reenvio", async () => {
    mocked(api.updateVectorProduct).mockRejectedValue(new ApiError(409, { error: "product_in_use" }, "x"));
    mount();
    await productsTable();
    fireEvent.click(rowOf("PYR").getByRole("button", { name: "Editar PYR" }));
    expect(field("Código").value).toBe("PYR");
    expect(field("Tamanho da carga").value).toBe("2,00");
    type("Tamanho da carga", "3");
    mocked(api.listVectorProducts).mockResolvedValue([ IN_USE, ADULTICIDE, INACTIVE_PRODUCT ]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ "pr1", { charge_size: "3" } ]);
    expect(await screen.findByText(VECTOR_ERRORS.product_in_use)).not.toBeNull();
    await waitFor(() => expect(api.listVectorProducts).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listVectorProducts).toHaveBeenCalledTimes(2);
    expect(api.updateVectorProduct).toHaveBeenCalledTimes(1);
    // A releitura trouxe o produto em uso: ao abrir de novo, unidade e carga travadas.
    fireEvent.click(rowOf("PYR").getByRole("button", { name: "Editar PYR" }));
    expect(field("Tamanho da carga").disabled).toBe(true);
    expect(field("Tamanho da carga").value).toBe("2,00");
  });

  it("nome e ativo mudam; código repetido sem caixa e recusa do api no campo", async () => {
    mocked(api.updateVectorProduct).mockResolvedValue({ ...LARVICIDE, name: "Pyriproxyfen G", active: false });
    mount();
    await productsTable();
    fireEvent.click(rowOf("PYR").getByRole("button", { name: "Editar PYR" }));
    type("Nome", "  Pyriproxyfen G  ");
    fireEvent.click(screen.getByLabelText("Ativo"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.updateVectorProduct).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateVectorProduct).mock.calls[0]).toEqual([ "pr1", { name: "Pyriproxyfen G", active: false } ]);

    // Novo com código já usado (sem diferenciar caixa): recusado na tela, sem chamada.
    await fillNewProduct();
    type("Código", "mal");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(describedText(field("Código"))).toBe(productProblems({ code: "mal", name: "x", unit: "g", charge: "1", uses: [ "focal" ] }, [ "MAL" ])[0].text);
    expect(api.createVectorProduct).not.toHaveBeenCalled();
    // A corrida (outro cadastrou o código entre a leitura e o envio): 422 path code no campo.
    mocked(api.createVectorProduct).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "code" }, "x"));
    type("Código", "BTI");
    fireEvent.click(await screen.findByRole("button", { name: "Salvar produto" }));
    await waitFor(() => expect(api.createVectorProduct).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(field("Código").getAttribute("aria-invalid")).toBe("true"));
    // O 422 path code (tamanho ou repetido) diz a mesma frase do campo.
    expect(describedText(field("Código"))).toBe(productProblems({ code: "", name: "x", unit: "g", charge: "1", uses: [ "focal" ] }, [])[0].text);
  });

  it("sem /domains, os usos aparecem crus; editar sem mudar nada não chama o api", async () => {
    mocked(api.getVectorDomains).mockRejectedValue(new ApiError(503, { error: "unavailable" }, "x"));
    mount();
    await productsTable();
    await waitFor(() => expect(api.getVectorDomains).toHaveBeenCalledTimes(1));
    expect(rowOf("PYR").getByText("focal")).not.toBeNull();
    expect(rowOf("MAL").getByText("perifocal, spatial")).not.toBeNull();
    fireEvent.click(rowOf("PYR").getByRole("button", { name: "Editar PYR" }));
    for (const raw of [ "focal", "perifocal", "spatial" ]) expect(screen.getByLabelText(raw)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(await screen.findByText(NOTHING_CHANGED)).not.toBeNull();
    // Carga "2" igual a "2.00": também nada mudou.
    type("Tamanho da carga", "2");
    fireEvent.click(await screen.findByRole("button", { name: "Salvar produto" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(NOTHING_CHANGED)).not.toBeNull();
    expect(api.updateVectorProduct).not.toHaveBeenCalled();
  });

  it("limites do api dos dois lados: código 1–10, nome 1–80, carga > 0 com até 8 inteiros e 2 casas, ao menos um uso", () => {
    const ok = { code: "B", name: "N", unit: "g", charge: "0,01", uses: [ "focal" ] };
    const paths = (d: Partial<typeof ok>) => productProblems({ ...ok, ...d }, []).map((p) => p.path);
    expect(paths({})).toEqual([]);
    expect(paths({ code: "" })).toEqual([ "code" ]);
    expect(paths({ code: "   " })).toEqual([ "code" ]);
    expect(paths({ code: "B".repeat(10) })).toEqual([]);
    expect(paths({ code: "B".repeat(11) })).toEqual([ "code" ]);
    expect(paths({ name: "N".repeat(80) })).toEqual([]);
    expect(paths({ name: "N".repeat(81) })).toEqual([ "name" ]);
    expect(paths({ name: "" })).toEqual([ "name" ]);
    expect(paths({ unit: "kg" })).toEqual([ "unit" ]);
    expect(paths({ unit: "" })).toEqual([ "unit" ]);
    for (const good of [ "0,01", "0.5", "2", "12,50", "12345678", "12345678,99" ]) expect(paths({ charge: good })).toEqual([]);
    for (const bad of [ "0", "0,00", "0.0", "", "123456789", "1,234", "-1", "1e2", "1,", ",5" ]) expect(paths({ charge: bad })).toEqual([ "charge_size" ]);
    expect(paths({ uses: [] })).toEqual([ "uses" ]);
    expect(paths({ uses: [ "focal", "perifocal", "spatial" ] })).toEqual([]);
    // Código repetido sem diferenciar caixa (o mesmo produto, na edição, não conta).
    expect(productProblems({ ...ok, code: "pyr" }, [ "PYR" ]).map((p) => p.path)).toEqual([ "code" ]);
  });
});

describe("parâmetros técnicos", () => {
  it("parâmetros: step-up, corpo inteiro, invalid_parameter no campo da chave", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_verified_at: null }));
    mocked(api.putVectorParameters).mockRejectedValue(new ApiError(422, { error: "invalid_parameter", path: "values.ovitrap_alert_eggs" }, "x"));
    mount();
    expect(await screen.findByText("padrão de fábrica (versão 0)")).not.toBeNull();
    expect(field("Alerta de ovos").value).toBe("100");
    expect(field("Doenças que abrem bloqueio (códigos separados por vírgula)").value).toBe("dengue, chikungunya, zika");
    expect(field("Fração de imóveis do quarteirão — padrão").value).toBe("0,2");
    expect(field("IIP — início da faixa média").value).toBe("1,0");
    expect(field("IIP — início da faixa alta").value).toBe("4,0");
    type("Alerta de ovos", "120");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    expect(await screen.findByText("Cria a versão 1. O levantamento já sorteado continua com a versão do sorteio.")).not.toBeNull();
    type("Código do autenticador", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.putVectorParameters).toHaveBeenCalledTimes(1));
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    // Q34: a versão lida vai junto; a 0 (padrão de fábrica) vai como 0.
    expect(mocked(api.putVectorParameters).mock.calls[0]).toEqual([ { ...PARAMS, ovitrap_alert_eggs: 120 }, 0 ]);
    await waitFor(() => expect(field("Alerta de ovos").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(field("Alerta de ovos"))).toBe(VECTOR_ERRORS.invalid_parameter);
    expect(api.getVectorParameters).toHaveBeenCalledTimes(1);
  });

  it("versão gravada: rótulo com a data; um envio no duplo clique com a versão lida; sem aviso de corrida, UMA releitura", async () => {
    mocked(api.getVectorParameters).mockResolvedValue(parameterVersion({ version: 3, created_at: "2026-11-16T13:00:00.000000Z" }));
    let resolve!: (v: api.VectorParameterVersion) => void;
    mocked(api.putVectorParameters).mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount();
    expect(await screen.findByText("versão 3, de 16/11/2026")).not.toBeNull();
    type("Fração de imóveis do quarteirão — metade", "0,45");
    type("Doenças que abrem bloqueio (códigos separados por vírgula)", "dengue, zika,");
    type("IIP — início da faixa alta", "4,5");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    expect(await screen.findByText("Cria a versão 4. O levantamento já sorteado continua com a versão do sorteio.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(api.putVectorParameters).toHaveBeenCalledTimes(1));
    const sent = { ...PARAMS, liraa_half_household_fraction: 0.45, block_diseases: [ "dengue", "zika" ], iip_bands: [ 1, 4.5 ] as [number, number] };
    expect(mocked(api.putVectorParameters).mock.calls[0]).toEqual([ sent, 3 ]);
    const v4 = parameterVersion({ version: 4, values: sent, created_at: "2026-11-16T13:05:00.000000Z" });
    mocked(api.getVectorParameters).mockResolvedValue(v4);
    resolve(v4);
    expect((await screen.findByText(PARAMS_SAVED(4))).getAttribute("role")).toBe("status");
    expect(screen.getByText("versão 4, de 16/11/2026")).not.toBeNull();
    // O formulário volta com os valores gravados (a vírgula sobrando sai).
    expect(field("Doenças que abrem bloqueio (códigos separados por vírgula)").value).toBe("dengue, zika");
    await waitFor(() => expect(api.getVectorParameters).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(VECTOR_ERRORS.parameters_changed)).toBeNull();
    expect(api.getVectorParameters).toHaveBeenCalledTimes(2);
    expect(api.putVectorParameters).toHaveBeenCalledTimes(1);
  });

  it("409 parameters_changed: a frase, UMA releitura, o digitado fica com o vigente ao lado; o próximo envio leva a versão nova", async () => {
    mocked(api.getVectorParameters).mockResolvedValue(parameterVersion({ version: 3, created_at: "2026-11-16T13:00:00.000000Z" }));
    mocked(api.putVectorParameters).mockRejectedValueOnce(new ApiError(409, { error: "parameters_changed" }, "x"));
    mount();
    await screen.findByText("versão 3, de 16/11/2026");
    type("Alerta de ovos", "150");
    type("Raio do bloqueio (anéis de quarteirões)", "2");
    const v4 = parameterVersion({ version: 4, values: { ...PARAMS, ovitrap_alert_eggs: 130 }, created_at: "2026-11-16T13:05:00.000000Z" });
    mocked(api.getVectorParameters).mockResolvedValue(v4);
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(VECTOR_ERRORS.parameters_changed)).not.toBeNull();
    expect(await screen.findByText("versão 4, de 16/11/2026")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    // O digitado fica; o vigente aparece só onde difere (alerta: digitado 150, vigente 130; raio: digitado 2, vigente 1).
    expect(field("Alerta de ovos").value).toBe("150");
    expect(field("Raio do bloqueio (anéis de quarteirões)").value).toBe("2");
    expect(screen.getByText(currentValueHint("130"))).not.toBeNull();
    expect(screen.getByText(currentValueHint("1"))).not.toBeNull();
    expect(screen.queryByText(currentValueHint("60"))).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getVectorParameters).toHaveBeenCalledTimes(2);
    // O próximo envio: a versão relida (4), o que foi digitado.
    mocked(api.putVectorParameters).mockResolvedValue(parameterVersion({ version: 5, values: { ...PARAMS, ovitrap_alert_eggs: 150, block_radius_rings: 2 }, created_at: "2026-11-16T13:10:00.000000Z" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    expect(await screen.findByText("Cria a versão 5. O levantamento já sorteado continua com a versão do sorteio.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.putVectorParameters).toHaveBeenCalledTimes(2));
    expect(mocked(api.putVectorParameters).mock.calls[1]).toEqual([ { ...PARAMS, ovitrap_alert_eggs: 150, block_radius_rings: 2 }, 4 ]);
    expect(await screen.findByText(PARAMS_SAVED(5))).not.toBeNull();
    expect(screen.queryByText(VECTOR_ERRORS.parameters_changed)).toBeNull();
  });

  it("422 expected_version_required: a frase genérica, sem releitura", async () => {
    mocked(api.putVectorParameters).mockRejectedValue(new ApiError(422, { error: "expected_version_required", path: "expected_version" }, "x"));
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(VECTOR_ERRORS.expected_version_required)).not.toBeNull();
    expect(api.getVectorParameters).toHaveBeenCalledTimes(1);
  });

  it("releitura que falha depois de gravar: a versão salva e o aviso ficam, com o erro e Tentar de novo", async () => {
    const saved = parameterVersion({ version: 1, values: { ...PARAMS, ovitrap_alert_eggs: 120 }, created_at: "2026-11-16T13:00:00.000000Z" });
    mocked(api.putVectorParameters).mockResolvedValue(saved);
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    mocked(api.getVectorParameters).mockRejectedValue(new ApiError(503, { error: "unavailable" }, "x"));
    type("Alerta de ovos", "120");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.getVectorParameters).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Tentar de novo" })).not.toBeNull();
    expect(screen.getByText("versão 1, de 16/11/2026")).not.toBeNull();
    expect(screen.getByText(PARAMS_SAVED(1))).not.toBeNull();
    expect(field("Alerta de ovos").value).toBe("120");
    mocked(api.getVectorParameters).mockResolvedValue(saved);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull());
    expect(api.getVectorParameters).toHaveBeenCalledTimes(3);
    expect(api.putVectorParameters).toHaveBeenCalledTimes(1);
  });

  it("sem autenticador cadastrado: pede o cadastro e leva à segurança, sem gravar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "endemic_coordinator" ], { features: VC_FEATURES, mfa_enrolled: false, mfa_verified_at: null }));
    const onGoToSecurity = vi.fn();
    mount(onGoToSecurity);
    await screen.findByText("padrão de fábrica (versão 0)");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
    expect(onGoToSecurity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.putVectorParameters).not.toHaveBeenCalled();
  });

  it("recusa na tela antes do step-up: faixa e desigualdade, sem chamada", async () => {
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    type("Coleta da palheta — mínimo (dias)", "11");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    expect(field("Coleta da palheta — mínimo (dias)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    type("Coleta da palheta — mínimo (dias)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    expect(field("Coleta da palheta — mínimo (dias)").getAttribute("aria-invalid")).toBeNull();
    expect(await screen.findByRole("button", { name: "Confirmar" })).not.toBeNull();
    // Mexer num campo fecha a confirmação: o que se confirma é o que está na tela.
    type("Alerta de ovos", "0");
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.putVectorParameters).not.toHaveBeenCalled();
  });

  it("faixas do api dos dois lados de cada limite (RANGES), depois NOT_ABOVE e BELOW", () => {
    const paths = (o: Record<string, unknown>) => parameterProblems({ ...draftOf(PARAMS), ...o } as ParamDraft).map((p) => p.path);
    const problems = (o: Record<string, unknown>) => parameterProblems({ ...draftOf(PARAMS), ...o } as ParamDraft);
    // As 16 chaves inteiras de parameters.rb RANGES (tabela à parte de PARAM_FIELDS).
    const INT: [keyof VectorParameters, number, number][] = [
      [ "default_days", 7, 365 ], [ "strategic_point_days", 7, 365 ], [ "block_radius_rings", 0, 5 ], [ "block_grouping_days", 1, 30 ],
      [ "ubv_cycles_max", 1, 5 ], [ "ubv_cycle_days_min", 1, 15 ], [ "ubv_cycle_days_max", 1, 15 ], [ "ubv_cycle_interval_days", 0, 30 ],
      [ "ovitrap_collection_days_min", 1, 30 ], [ "ovitrap_collection_days_max", 1, 30 ], [ "ovitrap_alert_eggs", 1, 9999 ],
      [ "ovitrap_radius_rings", 0, 5 ], [ "liraa_standard_min", 1, 100000 ], [ "liraa_standard_max", 1, 100000 ],
      [ "liraa_half_min", 1, 100000 ], [ "liraa_base_sample", 1, 10000 ]
    ];
    expect(paths({})).toEqual([]);
    for (const [ key, min, max ] of INT) {
      // A frase da faixa desta chave; no limite de dentro ela não aparece (um par pode recusar, como o api, mas não pela faixa).
      const rangeText = problems({ [key]: "" })[0].text;
      const rangeRefused = (v: string) => problems({ [key]: v }).some((p) => p.path === key && p.text === rangeText);
      expect(rangeRefused(String(min))).toBe(false);
      expect(rangeRefused(String(max))).toBe(false);
      expect(paths({ [key]: String(max + 1) })).toEqual([ key ]);
      if (min > 0) expect(paths({ [key]: String(min - 1) })).toEqual([ key ]);
      expect(paths({ [key]: "1,5" })).toEqual([ key ]);
      expect(paths({ [key]: "" })).toEqual([ key ]);
    }
    // No limite de dentro com o par coerente, nada é recusado.
    expect(paths({ ubv_cycle_days_min: "15", ubv_cycle_days_max: "15" })).toEqual([]);
    expect(paths({ ubv_cycle_days_min: "1", ubv_cycle_days_max: "1" })).toEqual([]);
    expect(paths({ ovitrap_collection_days_min: "30", ovitrap_collection_days_max: "30" })).toEqual([]);
    expect(paths({ ovitrap_collection_days_min: "1", ovitrap_collection_days_max: "1" })).toEqual([]);
    expect(paths({ liraa_half_min: "99998", liraa_standard_min: "99999", liraa_standard_max: "100000" })).toEqual([]);
    expect(paths({ liraa_half_min: "1", liraa_standard_min: "2", liraa_standard_max: "3" })).toEqual([]);
    // Onde o par não cabe (standard_min = 1 pediria half_min < 1), a recusa é a do par, no campo de baixo.
    expect(paths({ liraa_standard_min: "1" })).toEqual([ "liraa_half_min" ]);
    // Pares NOT_ABOVE (≤): faixa 1–15 / 1–30, igual passa, de baixo maior recusa no de baixo.
    expect(paths({ ubv_cycle_days_min: "1", ubv_cycle_days_max: "1" })).toEqual([]);
    expect(paths({ ubv_cycle_days_min: "15", ubv_cycle_days_max: "15" })).toEqual([]);
    expect(paths({ ubv_cycle_days_min: "0" })).toEqual([ "ubv_cycle_days_min" ]);
    expect(paths({ ubv_cycle_days_max: "16" })).toEqual([ "ubv_cycle_days_max" ]);
    expect(paths({ ubv_cycle_days_min: "6", ubv_cycle_days_max: "5" })).toEqual([ "ubv_cycle_days_min" ]);
    expect(paths({ ovitrap_collection_days_min: "1", ovitrap_collection_days_max: "1" })).toEqual([]);
    expect(paths({ ovitrap_collection_days_min: "30", ovitrap_collection_days_max: "30" })).toEqual([]);
    expect(paths({ ovitrap_collection_days_min: "0" })).toEqual([ "ovitrap_collection_days_min" ]);
    expect(paths({ ovitrap_collection_days_max: "31" })).toEqual([ "ovitrap_collection_days_max" ]);
    expect(paths({ ovitrap_collection_days_min: "11" })).toEqual([ "ovitrap_collection_days_min" ]);
    // LIRAa 1–100000 e BELOW (<): half < standard_min < standard_max; igual recusa.
    expect(paths({ liraa_half_min: "1" })).toEqual([]);
    expect(paths({ liraa_half_min: "0" })).toEqual([ "liraa_half_min" ]);
    expect(paths({ liraa_standard_max: "100000" })).toEqual([]);
    expect(paths({ liraa_standard_max: "100001" })).toEqual([ "liraa_standard_max" ]);
    expect(paths({ liraa_half_min: "8100" })).toEqual([ "liraa_half_min" ]);
    expect(paths({ liraa_half_min: "8099" })).toEqual([]);
    expect(paths({ liraa_standard_min: "12000" })).toEqual([ "liraa_standard_min" ]);
    expect(paths({ liraa_standard_min: "11999" })).toEqual([]);
    // Uma faixa errada esconde as desigualdades (o api confere as faixas antes).
    expect(paths({ ovitrap_collection_days_min: "11", ovitrap_alert_eggs: "0" })).toEqual([ "ovitrap_alert_eggs" ]);
    // Frações 0,01–1,0 com até 2 casas (zero à direita não conta).
    for (const key of [ "liraa_household_fraction", "liraa_half_household_fraction" ] as const) {
      for (const good of [ "0,01", "1", "1,0", "0.2", "0,20", "0,250" ]) expect(paths({ [key]: good })).toEqual([]);
      for (const bad of [ "0", "0,009", "1,01", "0,205", "", "abc" ]) expect(paths({ [key]: bad })).toEqual([ key ]);
    }
    // IIP: dois números entre 0 e 100, o primeiro menor.
    expect(paths({ iip_bands: [ "0", "100" ] })).toEqual([]);
    expect(paths({ iip_bands: [ "0,5", "3,95" ] })).toEqual([]);
    for (const bad of [ [ "4", "4" ], [ "5", "4" ], [ "0", "100,1" ], [ "", "4" ], [ "-1", "4" ] ]) expect(paths({ iip_bands: bad })).toEqual([ "iip_bands" ]);
    // Doenças: ao menos um código, sem repetição (a lista de doenças é o api que confere, só no código novo).
    expect(paths({ block_diseases: "dengue" })).toEqual([]);
    expect(paths({ block_diseases: "dengue, febre_amarela" })).toEqual([]);
    expect(paths({ block_diseases: " , " })).toEqual([ "block_diseases" ]);
    expect(paths({ block_diseases: "dengue, dengue" })).toEqual([ "block_diseases" ]);
  });

  it("rótulo da versão: 0 é o padrão de fábrica; 20 campos, um por chave do api", () => {
    expect(parametersVersionLabel(parameterVersion())).toBe("padrão de fábrica (versão 0)");
    expect(parametersVersionLabel(parameterVersion({ version: 2, created_at: "2026-11-16T02:30:00.000000Z" }))).toBe("versão 2, de 15/11/2026");
    expect(PARAM_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(PARAMS).sort());
  });
});

describe("local de estoque", () => {
  it("local de estoque: escolhe entre as opções; nulo diz que vira falta", async () => {
    mocked(api.putVectorSettings)
      .mockResolvedValueOnce({ ...SETTINGS, stock_location: { id: "loc-uvz", name: "Almoxarifado da UVZ" } })
      .mockResolvedValueOnce(SETTINGS);
    mount();
    const select = await screen.findByLabelText("Local de estoque do boletim") as HTMLSelectElement;
    await screen.findByRole("option", { name: "Almoxarifado da UVZ" });
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "sem baixa de estoque" })).not.toBeNull();
    expect(screen.getByText(NO_LOCATION)).not.toBeNull();
    fireEvent.change(select, { target: { value: "loc-uvz" } });
    expect(screen.queryByText(NO_LOCATION)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar local/ }));
    await waitFor(() => expect(api.putVectorSettings).toHaveBeenCalledTimes(1));
    expect(mocked(api.putVectorSettings).mock.calls[0]).toEqual([ "loc-uvz" ]);
    expect(await screen.findByText("local de estoque salvo")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Local de estoque do boletim"), { target: { value: "" } });
    expect(screen.getByText(NO_LOCATION)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    await waitFor(() => expect(api.putVectorSettings).toHaveBeenCalledTimes(2));
    expect(mocked(api.putVectorSettings).mock.calls[1]).toEqual([ null ]);
    expect(api.getVectorSettings).toHaveBeenCalledTimes(1);
  });

  it("local desativado entre a leitura e o envio (422 path stock_location_id): a frase e UMA releitura", async () => {
    mocked(api.putVectorSettings).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "stock_location_id" }, "x"));
    mount();
    await screen.findByRole("option", { name: "Depósito Norte" });
    mocked(api.getVectorSettings).mockResolvedValue({ stock_location: null, options: [ SETTINGS.options[0] ] });
    fireEvent.change(screen.getByLabelText("Local de estoque do boletim"), { target: { value: "loc-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    expect(await screen.findByText(LOCATION_GONE)).not.toBeNull();
    await waitFor(() => expect(api.getVectorSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Depósito Norte" })).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getVectorSettings).toHaveBeenCalledTimes(2);
    expect(api.putVectorSettings).toHaveBeenCalledTimes(1);
  });
});
