// src/modules/OpeningImport.test.tsx — "Saldo inicial" (módulo 27b; contrato §5, Q11, Q20, Q24, Q26, Q36–Q38; F-15, F-17–F-19).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { ApiError, type OpeningImportDetail, type OpeningImportStatus } from "../lib/api";
import { BNAFAR_ERRORS } from "../lib/bnafarErrors";
import { IMPORT_ERRORS, OPENING_IMPORT_HEADER, discardedText } from "../lib/openingImport";
import { renderWithProviders } from "../test/campaignFixtures";
import { bnafarUser, importRows, openingImport } from "../test/bnafarFixtures";
import { CENTRAL, UBS_REF } from "../test/pharmacyFixtures";
import { saveFile } from "./lab/saveFile";
import { OpeningImport } from "./OpeningImport";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
  listMyPharmacyLocations: vi.fn(), listOpeningImports: vi.fn(), getOpeningImport: vi.fn(), uploadOpeningImport: vi.fn(),
  applyOpeningImport: vi.fn(), revertOpeningImport: vi.fn(), discardOpeningImport: vi.fn(), fetchOpeningImportTemplate: vi.fn() }));
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const has = (t: string) => (content: string) => content.includes(t);
const ROW = "2384299;medicamento;267645;;L1;2027-06-30;10;12,50;;;";

let current: OpeningImportStatus = "validated";
let version = 1;
const detail = (o: Partial<OpeningImportDetail> = {}): OpeningImportDetail =>
  ({ ...openingImport({ status: current, version }), rows: importRows(3), next_before: null, ...o });

function setup(opts: { roles?: string[]; ph?: unknown[]; phError?: unknown; features?: string[] } = {}) {
  mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser(opts.roles ?? [ "municipal_admin" ], opts.features ?? [ "pharmacy" ]));
  if (opts.phError) mocked(api.listMyPharmacyLocations).mockRejectedValue(opts.phError);
  else mocked(api.listMyPharmacyLocations).mockResolvedValue(opts.ph ?? [ CENTRAL ]);
  return renderWithProviders(<OpeningImport />);
}
const pick = (file: File) => fireEvent.change(screen.getByLabelText("Planilha do saldo inicial"), { target: { files: [ file ] } });
async function openFromList() {
  fireEvent.click(await screen.findByRole("button", { name: "abrir" }));
  return screen.findByRole("region", { name: "Importação" });
}

describe("OpeningImport", () => {
  beforeEach(() => {
    current = "validated"; version = 1;
    for (const fn of [ api.listMyPharmacyLocations, api.listOpeningImports, api.getOpeningImport, api.uploadOpeningImport, api.applyOpeningImport,
      api.revertOpeningImport, api.discardOpeningImport, api.fetchOpeningImportTemplate, api.stepUpMfa, saveFile ]) mocked(fn).mockReset();
    mocked(api.listOpeningImports).mockImplementation(() => Promise.resolve({ items: [ openingImport({ status: current, version }) ], next_before: null }));
    mocked(api.getOpeningImport).mockImplementation(() => Promise.resolve(detail()));
  });

  it("abre sem o bnafar, com a nota, o aviso da cidade grande e o modelo pelo nome do api", async () => {
    mocked(api.fetchOpeningImportTemplate).mockResolvedValue({ blob: new Blob([ OPENING_IMPORT_HEADER ]), filename: null });
    setup();
    expect(await screen.findByText(has("A planilha vira o saldo de abertura de cada local"))).not.toBeNull();
    expect(screen.getByText(has("Cidade grande: divida a importação por local"))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Baixar o modelo" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.objectContaining({ filename: null }), "saldo-inicial.csv"));
  });

  it("arquivo recusado antes: nenhuma chamada", async () => {
    setup();
    await screen.findByRole("table", { name: "Importações" });
    pick(new File([ OPENING_IMPORT_HEADER ], "saldo.xlsx"));
    expect(await screen.findByText("a planilha é um arquivo .csv separado por ponto e vírgula — salve como CSV UTF-8")).not.toBeNull();
    const big = new File([ OPENING_IMPORT_HEADER ], "saldo.csv");
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    pick(big);
    expect(await screen.findByText("o arquivo passa de 5 MB — divida a planilha por local")).not.toBeNull();
    pick(new File([ `${OPENING_IMPORT_HEADER.replace(/;/g, ",")}\r\n${ROW}` ], "saldo.csv"));
    expect(await screen.findByText("o cabeçalho não é o da planilha padrão — baixe o modelo e copie as colunas na mesma ordem")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "enviar e conferir" })).toBeNull();
    expect(api.uploadOpeningImport).not.toHaveBeenCalled();
  });

  it("envio com BOM: relatório aberto e nome fora do corpo", async () => {
    mocked(api.uploadOpeningImport).mockResolvedValue(detail());
    setup();
    await screen.findByRole("table", { name: "Importações" });
    const file = new File([ `﻿${OPENING_IMPORT_HEADER}\r\n${ROW}\r\n` ], "saldo-ubs-centro.csv", { type: "text/csv" });
    pick(file);
    fireEvent.click(await screen.findByRole("button", { name: "enviar e conferir" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.uploadOpeningImport).toHaveBeenCalledTimes(1));
    expect(mocked(api.uploadOpeningImport).mock.calls[0]).toEqual([ file ]);
    const report = await screen.findByRole("region", { name: "Importação" });
    await within(report).findByText(`${BNAFAR_ERRORS.cnes_unknown}: 1`);
    expect(within(report).getByText(`${BNAFAR_ERRORS.invalid_date}: 1`)).not.toBeNull();
    expect(within(report).getByText("8 de 10")).not.toBeNull();
    expect(within(report).getByText("3 linhas sem os dados do envio — os lotes ficam nas Pendências do envio à BNAFAR")).not.toBeNull();
    expect(within(report).getByText("Locais sem CNES")).not.toBeNull();
    expect(within(report).getByText("Farmácia UBS Norte")).not.toBeNull();
    expect(within(report).getByText("Produtos sem catálogo")).not.toBeNull();
    expect(within(report).getByText(has("999999"))).not.toBeNull();
    const totals = within(report).getByRole("table", { name: "Totais por local" });
    expect(within(totals).getByText(UBS_REF.name)).not.toBeNull();
    expect(within(totals).getByText("R$ 3.000,00")).not.toBeNull();
    expect(screen.queryByText(has("saldo-ubs-centro"))).toBeNull();
    expect(mocked(api.getOpeningImport)).toHaveBeenCalledWith("oi1", expect.objectContaining({ limit: 100 }));
  });

  it("linhas em páginas: before na segunda leitura; só com erro pelo filtro do api", async () => {
    mocked(api.getOpeningImport)
      .mockResolvedValueOnce(detail({ rows: importRows(100), next_before: "c100" }))
      .mockResolvedValueOnce(detail({ rows: importRows(2).map((r, i) => ({ ...r, line: 500 + i })), next_before: null }))
      .mockResolvedValue(detail({ rows: importRows(1, { status: "error", error_codes: [ "expired_lot", "linha_nova" ], line: 7 }) }));
    setup();
    const report = await openFromList();
    const rows = await within(report).findByRole("table", { name: "Linhas da planilha" });
    expect(within(rows).getAllByRole("row")).toHaveLength(101);
    fireEvent.click(within(report).getByRole("button", { name: "Carregar mais linhas" }));
    await waitFor(() => expect(mocked(api.getOpeningImport)).toHaveBeenLastCalledWith("oi1", { before: "c100", limit: 100 }));
    await waitFor(() => expect(within(rows).getAllByRole("row")).toHaveLength(103));
    fireEvent.click(within(report).getByLabelText("só com erro"));
    await waitFor(() => expect(mocked(api.getOpeningImport)).toHaveBeenLastCalledWith("oi1", { status: "error", limit: 100 }));
    expect(await within(report).findByText(has(BNAFAR_ERRORS.expired_lot))).not.toBeNull();
    expect(within(report).getByText(has("linha_nova"))).not.toBeNull();
  });

  it("aplicar: step-up, um pedido, versão na chamada", async () => {
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.applyOpeningImport)
      .mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new ApiError(401, { error: "mfa_required" }, "401")), 20)))
      .mockImplementationOnce(() => { current = "applied"; version = 2; return Promise.resolve(detail()); });
    setup();
    const report = await openFromList();
    fireEvent.click(await within(report).findByRole("button", { name: "Aplicar 8 linhas" }));
    const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));
    confirm(); confirm();
    await waitFor(() => expect(api.applyOpeningImport).toHaveBeenCalledTimes(1));
    expect(api.applyOpeningImport).toHaveBeenCalledWith("oi1", 1);
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    const reads = mocked(api.getOpeningImport).mock.calls.length;
    const lists = mocked(api.listOpeningImports).mock.calls.length;
    confirm();
    await waitFor(() => expect(api.stepUpMfa).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(api.applyOpeningImport).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(
      "Saldo inicial aplicado: 8 linhas em 1 local. O envio à BNAFAR desses locais começa amanhã, se o envio estiver ligado."
    )).not.toBeNull();
    await waitFor(() => expect(mocked(api.getOpeningImport).mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(mocked(api.listOpeningImports).mock.calls.length).toBeGreaterThan(lists));
    expect(await within(report).findByRole("button", { name: "Desfazer" })).not.toBeNull();
    expect(within(report).queryByRole("button", { name: "Aplicar 8 linhas" })).toBeNull();
  });

  it("409 opening_import_changed: a frase e uma releitura, sem reenvio", async () => {
    mocked(api.applyOpeningImport).mockRejectedValue(new ApiError(409, { error: "opening_import_changed" }, "409"));
    setup();
    const report = await openFromList();
    fireEvent.click(await within(report).findByRole("button", { name: "Aplicar 8 linhas" }));
    const reads = mocked(api.getOpeningImport).mock.calls.length;
    version = 3;
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));
    expect(await within(report).findByText(IMPORT_ERRORS.opening_import_changed)).not.toBeNull();
    await waitFor(() => expect(mocked(api.getOpeningImport).mock.calls.length).toBe(reads + 1));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocked(api.getOpeningImport).mock.calls.length).toBe(reads + 1);
    expect(api.applyOpeningImport).toHaveBeenCalledTimes(1);
    fireEvent.click(await within(report).findByRole("button", { name: "Aplicar 8 linhas" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));
    await waitFor(() => expect(api.applyOpeningImport).toHaveBeenLastCalledWith("oi1", 3));
  });

  it("desfazer bloqueado: frase com os locais e situação mantida", async () => {
    current = "applied";
    mocked(api.revertOpeningImport).mockRejectedValue(new ApiError(409, { error: "revert_blocked", path: "id", locations: [ "l2" ] }, "409"));
    setup();
    const report = await openFromList();
    fireEvent.click(await within(report).findByRole("button", { name: "Desfazer" }));
    const reads = mocked(api.getOpeningImport).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Confirmar desfazer" }));
    expect(await within(report).findByText(`${IMPORT_ERRORS.revert_blocked}: ${UBS_REF.name}.`)).not.toBeNull();
    expect(api.revertOpeningImport).toHaveBeenCalledWith("oi1", 1);
    expect(within(report).getByText("aplicada")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocked(api.getOpeningImport).mock.calls.length).toBe(reads);
  });

  it("descartar: confirmação e só leitura depois", async () => {
    mocked(api.discardOpeningImport).mockImplementation(() => { current = "discarded"; version = 2; return Promise.resolve(detail()); });
    setup();
    const report = await openFromList();
    fireEvent.click(await within(report).findByRole("button", { name: "Descartar" }));
    fireEvent.click(within(report).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.discardOpeningImport).toHaveBeenCalledWith("oi1", 1));
    expect(await within(report).findByText(discardedText)).not.toBeNull();
    expect(await within(report).findByText("descartada")).not.toBeNull();
    expect(within(report).queryByRole("button", { name: "Aplicar 8 linhas" })).toBeNull();
    expect(within(report).queryByRole("button", { name: "Descartar" })).toBeNull();
    expect(within(report).queryByRole("button", { name: "Desfazer" })).toBeNull();
  });

  it("almoxarife de unidade não importa; o do central, sim", async () => {
    setup({ roles: [ "stock_keeper" ], ph: [ { ...UBS_REF, health_unit: { id: "u1", name: "UBS Centro" }, active: true, roles: [ "stock_keeper" ] } ] });
    expect(await screen.findByText(IMPORT_ERRORS.missing_role)).not.toBeNull();
    expect(api.listOpeningImports).not.toHaveBeenCalled();
    expect(api.getOpeningImport).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Planilha do saldo inicial")).toBeNull();
    cleanup();
    setup({ roles: [ "stock_keeper" ], ph: [ CENTRAL ] });
    expect(await screen.findByRole("table", { name: "Importações" })).not.toBeNull();
    expect(screen.queryByText(IMPORT_ERRORS.missing_role)).toBeNull();
  });

  it("403 missing_role do api: a frase, não a tela vazia", async () => {
    mocked(api.listOpeningImports).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    setup();
    expect(await screen.findByText(IMPORT_ERRORS.missing_role)).not.toBeNull();
  });

  it("recusa do envio: 413 com as 20.000 linhas, arquivo mantido e a lista relida", async () => {
    mocked(api.uploadOpeningImport).mockRejectedValue(new ApiError(413, { error: "file_too_large", path: "file_base64" }, "413"));
    setup();
    await screen.findByRole("table", { name: "Importações" });
    const lists = mocked(api.listOpeningImports).mock.calls.length;
    pick(new File([ `${OPENING_IMPORT_HEADER}\n${ROW}\n` ], "saldo.csv"));
    fireEvent.click(await screen.findByRole("button", { name: "enviar e conferir" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(IMPORT_ERRORS.file_too_large)).not.toBeNull();
    await waitFor(() => expect(mocked(api.listOpeningImports).mock.calls.length).toBeGreaterThan(lists));
    expect(api.uploadOpeningImport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Importação" })).toBeNull();
  });

  it("504 do proxy no aplicar: relê uma vez e mostra o que entrou, sem reenviar", async () => {
    mocked(api.applyOpeningImport).mockImplementation(() => { current = "applied"; version = 2; return Promise.reject(new ApiError(504, "gateway timeout", "504")); });
    setup();
    const report = await openFromList();
    fireEvent.click(await within(report).findByRole("button", { name: "Aplicar 8 linhas" }));
    const reads = mocked(api.getOpeningImport).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));
    await waitFor(() => expect(mocked(api.getOpeningImport).mock.calls.length).toBe(reads + 1));
    expect(await within(report).findByRole("button", { name: "Desfazer" })).not.toBeNull();
    expect(within(report).queryByRole("button", { name: "Aplicar 8 linhas" })).toBeNull();
    expect(within(report).getByRole("alert")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.applyOpeningImport).toHaveBeenCalledTimes(1);
    expect(mocked(api.getOpeningImport).mock.calls.length).toBe(reads + 1);
  });

  it("farmácia desligada: o almoxarife passa pela leitura dos locais e o api decide", async () => {
    const off = new ApiError(403, { error: "feature_disabled", feature: "pharmacy" }, "403");
    setup({ roles: [ "stock_keeper" ], features: [ "vaccination" ], phError: off });
    expect(await screen.findByRole("table", { name: "Importações" })).not.toBeNull();
    cleanup();
    mocked(api.listOpeningImports).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    setup({ roles: [ "stock_keeper" ], features: [ "vaccination" ], phError: off });
    expect(await screen.findByText(IMPORT_ERRORS.missing_role)).not.toBeNull();
  });

  it("local sem nome nos totais", async () => {
    const base = detail();
    mocked(api.getOpeningImport).mockResolvedValue({ ...base, report: { ...base.report,
      totals_by_location: [ { stock_location_id: "l7", location_name: null, rows: 2, quantity: "20.00", value_cents: 2500 } ] } });
    setup();
    const report = await openFromList();
    const totals = await within(report).findByRole("table", { name: "Totais por local" });
    expect(within(totals).getByText("Local sem nome")).not.toBeNull();
    expect(within(totals).getByText("R$ 25,00")).not.toBeNull();
  });

  it("descartar com a sessão vencida: a frase aparece (o descarte não tem SensitiveAction)", async () => {
    mocked(api.discardOpeningImport).mockRejectedValue(new ApiError(401, { error: "unauthorized" }, "401"));
    setup();
    const report = await openFromList();
    fireEvent.click(await within(report).findByRole("button", { name: "Descartar" }));
    fireEvent.click(within(report).getByRole("button", { name: "Confirmar" }));
    expect(await within(report).findByText("sessão expirada — entre de novo")).not.toBeNull();
    expect(api.discardOpeningImport).toHaveBeenCalledTimes(1);
  });

  it("o campo do arquivo fica desabilitado enquanto o envio corre", async () => {
    let finish: (d: OpeningImportDetail) => void = () => {};
    mocked(api.uploadOpeningImport).mockImplementation(() => new Promise((r) => { finish = r; }));
    setup();
    await screen.findByRole("table", { name: "Importações" });
    pick(new File([ `${OPENING_IMPORT_HEADER}\n${ROW}\n` ], "saldo.csv"));
    fireEvent.click(await screen.findByRole("button", { name: "enviar e conferir" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByLabelText("Planilha do saldo inicial")).toHaveProperty("disabled", true));
    finish(detail());
    expect(await screen.findByRole("region", { name: "Importação" })).not.toBeNull();
    expect(screen.getByLabelText("Planilha do saldo inicial")).toHaveProperty("disabled", false);
  });
});
