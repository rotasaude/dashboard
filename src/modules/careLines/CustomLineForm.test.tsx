// src/modules/careLines/CustomLineForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), createCustomCareLine: vi.fn(), updateCareLine: vi.fn(),
    listCareTemplates: vi.fn(), listCityCareLines: vi.fn(), adoptCareLine: vi.fn() };
});

import * as api from "../../lib/api";
import { CustomLineForm } from "./CustomLineForm";
import { CareLinesAdmin } from "../CareLinesAdmin";
import { customLineBody, draftOfLine } from "../../lib/careLines";
import { renderWithProviders } from "../../test/campaignFixtures";
import { careUser, cityLine } from "../../test/careLineFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.createCustomCareLine, api.updateCareLine, api.listCareTemplates,
    api.listCityCareLines, api.adoptCareLine ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(careUser([ "municipal_admin" ]));
  mocked(api.createCustomCareLine).mockResolvedValue(cityLine({ id: "cl9" }));
  mocked(api.updateCareLine).mockResolvedValue(cityLine({ id: "cl9" }));
  mocked(api.listCareTemplates).mockResolvedValue([]);
  mocked(api.listCityCareLines).mockResolvedValue([]);
});

const form = () => screen.getByRole("region", { name: "Linha própria" });
const set = (label: string, value: string, scope: HTMLElement = form()) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });

// Linha própria como o api a devolve (forma do Rules): consulta com os CBOs da semente de saúde mental.
const customLine = (over: Partial<api.CareLine> = {}) => cityLine({
  id: "cl9", source: "custom", template_key: null, template_version: null, indicator: null, name: "Saúde mental",
  declared_condition: "mental_health",
  eligibility: { problems: { ciap2: [ "P74", "P76" ] }, declared: [ "mental_health" ] },
  practices: [ { key: "sm_a", label: "Consulta de acompanhamento", source: "consultation", anchor: "rolling", window_days: 92, min_count: 1,
    schedule: "end_of_window", cbo_filter: [ "2251", "2235", "251510" ] } ],
  ...over
});

describe("CustomLineForm", () => {
  it("cria com step-up: idade em anos, SIGTAP na fonte e CBO só na consulta", async () => {
    const onSaved = vi.fn();
    renderWithProviders(<CustomLineForm line={null} onSaved={onSaved} onCancel={vi.fn()} />);
    set("Nome da linha", "Saúde mental");
    set("Condição declarada que sugere esta linha", "mental_health");
    set("Códigos CIAP-2", "P76, P74");
    set("Códigos CID-10", "F32");
    set("Idade mínima (anos)", "18");
    const first = within(form()).getByRole("group", { name: "Boa prática 1" });
    set("O que deve ser feito", "Consulta de acompanhamento", first);
    set("Janela (dias)", "90", first);
    fireEvent.click(within(form()).getByRole("button", { name: "Incluir boa prática" }));
    const second = within(form()).getByRole("group", { name: "Boa prática 2" });
    set("O que deve ser feito", "Matriciamento", second);
    set("Fonte", "procedure", second);
    set("Código SIGTAP", "0301080232", second);
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    await waitFor(() => expect(api.createCustomCareLine).toHaveBeenCalledWith({
      name: "Saúde mental", declared_condition: "mental_health",
      eligibility: { problems: { ciap2: [ "P76", "P74" ], cid10: [ "F32" ] }, age_min_years: 18, age_max_years: null, sex: null,
        declared: [ "mental_health" ], requires_anchor: null },
      practices: [
        { key: "consulta_de_acompanhamento", label: "Consulta de acompanhamento", source: "consultation", window_days: 90, min_count: 1,
          schedule: "end_of_window", anchor: "rolling", cbo_filter: [ "2231", "2251", "2252", "2253", "2235" ] },
        { key: "matriciamento", label: "Matriciamento", source: "procedure:0301080232", window_days: 180, min_count: 1,
          schedule: "end_of_window", anchor: "rolling", cbo_filter: null }
      ]
    }));
    expect(onSaved).toHaveBeenCalledWith("Linha Saúde mental criada.");
  });

  it("recusa antes de enviar e mantém o digitado: código inválido e SIGTAP curto", () => {
    renderWithProviders(<CustomLineForm line={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    set("Nome da linha", "Saúde mental");
    set("Códigos CID-10", "F3");
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    expect(within(form()).getByRole("alert").textContent).toBe("código CID-10 inválido: F3");
    expect((within(form()).getByLabelText("Códigos CID-10") as HTMLInputElement).value).toBe("F3");
    set("Códigos CID-10", "F32");
    const first = within(form()).getByRole("group", { name: "Boa prática 1" });
    set("O que deve ser feito", "Exame", first);
    set("Fonte", "exam", first);
    set("Código SIGTAP", "02020105", first);
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    expect(within(form()).getByRole("alert").textContent).toBe("boa prática 1: código SIGTAP com 10 dígitos");
    expect(screen.queryByRole("button", { name: "Salvar linha" })).toBeNull();
    expect(api.createCustomCareLine).not.toHaveBeenCalled();
  });

  it("consulta mostra a caixa de médico ou enfermeiro; outra fonte não", () => {
    renderWithProviders(<CustomLineForm line={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const first = within(form()).getByRole("group", { name: "Boa prática 1" });
    expect(within(first).getByLabelText("Só consulta de médico ou enfermeiro conta")).not.toBeNull();
    set("Fonte", "blood_pressure", first);
    expect(within(first).queryByLabelText("Só consulta de médico ou enfermeiro conta")).toBeNull();
    expect(within(first).queryByLabelText("Código SIGTAP")).toBeNull();
  });

  it("editar: preenche, guarda as chaves e manda declared_condition null ao tirar a condição", async () => {
    renderWithProviders(<CustomLineForm line={customLine()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect((within(form()).getByLabelText("Nome da linha") as HTMLInputElement).value).toBe("Saúde mental");
    set("Condição declarada que sugere esta linha", "");
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    await waitFor(() => expect(api.updateCareLine).toHaveBeenCalled());
    const [ id, patch ] = mocked(api.updateCareLine).mock.calls[0];
    expect(id).toBe("cl9");
    expect(patch.declared_condition).toBeNull();
    expect(patch.practices.map((p: { key: string }) => p.key)).toEqual([ "sm_a" ]);
    expect("declared" in patch.eligibility).toBe(false); // D-01: nunca lista vazia
    expect(patch.eligibility.problems).toEqual({ ciap2: [ "P74", "P76" ] });
  });

  it("editar linha com CBO fora do conjunto: mostra os CBOs reais, caixa desmarcada e o corpo os preserva", async () => {
    renderWithProviders(<CustomLineForm line={customLine()} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const first = within(form()).getByRole("group", { name: "Boa prática 1" });
    expect((within(first).getByLabelText("Só consulta de médico ou enfermeiro conta") as HTMLInputElement).checked).toBe(false);
    expect(first.textContent).toMatch(/2251, 2235, 251510/);
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    await waitFor(() => expect(api.updateCareLine).toHaveBeenCalled());
    expect(mocked(api.updateCareLine).mock.calls[0][1].practices[0].cbo_filter).toEqual([ "2251", "2235", "251510" ]);
  });

  it("editar linha com o conjunto médico/enfermeiro: caixa marcada; desmarcar tira o filtro", async () => {
    const doctorNurse = [ "2231", "2251", "2252", "2253", "2235" ];
    const line = customLine({ practices: [ { ...customLine().practices[0], cbo_filter: doctorNurse } ] });
    renderWithProviders(<CustomLineForm line={line} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const first = within(form()).getByRole("group", { name: "Boa prática 1" });
    const box = within(first).getByLabelText("Só consulta de médico ou enfermeiro conta") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    await waitFor(() => expect(api.updateCareLine).toHaveBeenCalled());
    expect(mocked(api.updateCareLine).mock.calls[0][1].practices[0].cbo_filter).toBeNull();
  });

  it("422 invalid_practices do api vira frase", async () => {
    mocked(api.createCustomCareLine).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_practices" }, "x"));
    renderWithProviders(<CustomLineForm line={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    set("Nome da linha", "Saúde mental");
    set("Condição declarada que sugere esta linha", "mental_health");
    set("O que deve ser feito", "Consulta", within(form()).getByRole("group", { name: "Boa prática 1" }));
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    expect((await screen.findByRole("alert")).textContent).toBe("boas práticas inválidas — confira os campos");
  });

  it("recusa sem código do api cai no padrão, nunca no código cru (sessão expirada, papel)", async () => {
    mocked(api.createCustomCareLine).mockRejectedValueOnce(new api.ApiError(401, { error: "unauthenticated" }, "x"));
    renderWithProviders(<CustomLineForm line={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    set("Nome da linha", "Saúde mental");
    set("Condição declarada que sugere esta linha", "mental_health");
    set("O que deve ser feito", "Consulta", within(form()).getByRole("group", { name: "Boa prática 1" }));
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).not.toMatch(/unauthenticated/);
    expect(text.length).toBeGreaterThan(0);
  });

  it("duplicate_declared_condition do api vira frase e o formulário continua no passo de confirmar", async () => {
    mocked(api.createCustomCareLine).mockRejectedValueOnce(new api.ApiError(422, { error: "duplicate_declared_condition" }, "x"));
    renderWithProviders(<CustomLineForm line={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    set("Nome da linha", "Saúde mental");
    set("Condição declarada que sugere esta linha", "mental_health");
    set("O que deve ser feito", "Consulta", within(form()).getByRole("group", { name: "Boa prática 1" }));
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    expect((await screen.findByRole("alert")).textContent).toBe("já existe uma linha da cidade para esta condição declarada");
  });

  it("na tela do admin: Nova linha própria abre o formulário; Editar só nas próprias", async () => {
    mocked(api.listCityCareLines).mockResolvedValue([ cityLine(), cityLine({ id: "cl9", name: "Saúde mental", source: "custom",
      template_key: null, template_version: null, indicator: null }) ]);
    renderWithProviders(<CareLinesAdmin />);
    const lines = await screen.findByRole("region", { name: "Linhas da cidade" });
    expect(await within(lines).findByText("Saúde mental")).not.toBeNull();
    expect(within(lines).getAllByRole("button", { name: "Editar" })).toHaveLength(1);
    fireEvent.click(within(lines).getByRole("button", { name: "Nova linha própria" }));
    expect((within(form()).getByLabelText("Nome da linha") as HTMLInputElement).value).toBe("");
    // Linha nova: uma boa prática vazia, sem a segunda.
    expect(within(form()).getByRole("group", { name: "Boa prática 1" })).not.toBeNull();
    expect(within(form()).queryByRole("group", { name: "Boa prática 2" })).toBeNull();
  });

  it("na tela do admin: salvar relê as linhas, fecha o formulário e mostra o aviso", async () => {
    mocked(api.listCityCareLines).mockResolvedValue([ customLine() ]);
    renderWithProviders(<CareLinesAdmin />);
    const lines = await screen.findByRole("region", { name: "Linhas da cidade" });
    fireEvent.click(await within(lines).findByRole("button", { name: "Editar" }));
    expect((within(form()).getByLabelText("Nome da linha") as HTMLInputElement).value).toBe("Saúde mental");
    set("Nome da linha", "Saúde mental adulta");
    fireEvent.click(within(form()).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar linha" }));
    expect((await screen.findByRole("status")).textContent).toBe("Linha Saúde mental adulta salva.");
    await waitFor(() => expect(api.listCityCareLines).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Linha própria" })).toBeNull();
    expect(api.updateCareLine).toHaveBeenCalledTimes(1);
    expect(mocked(api.updateCareLine).mock.calls[0][0]).toBe("cl9");
  });

  it("cancelar fecha o formulário sem gravar", async () => {
    renderWithProviders(<CareLinesAdmin />);
    const lines = await screen.findByRole("region", { name: "Linhas da cidade" });
    fireEvent.click(within(lines).getByRole("button", { name: "Nova linha própria" }));
    fireEvent.click(within(form()).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("region", { name: "Linha própria" })).toBeNull();
    expect(api.createCustomCareLine).not.toHaveBeenCalled();
    expect(customLineBody(draftOfLine(customLine())).name).toBe("Saúde mental");
  });
});
