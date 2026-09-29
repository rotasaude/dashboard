import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Neighborhood } from "../../lib/api";
import { UnitForm, type UnitFormValue } from "./UnitForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const neighborhoods: Neighborhood[] = [
  { id: "n1", name: "Centro", active: true, source: "seed", units: [] },
  { id: "n2", name: "São Francisco", active: true, source: "seed", units: [] },
  { id: "n3", name: "Batel", active: false, source: "seed", units: [] }
];
const blank: UnitFormValue = { name: "UBS Nova", kind: "ubs", street: "", number: "", complement: "", zip: "", neighborhoodId: "" };
const FAIL = /não foi possível consultar o CEP/;

function renderForm(props: Partial<Parameters<typeof UnitForm>[0]> = {}) {
  const onSave = vi.fn();
  render(<UnitForm initial={blank} neighborhoods={neighborhoods} busy={false} onSave={onSave} onCancel={vi.fn()} {...props} />);
  return { onSave };
}

function stubViaCep(bairro: string, logradouro = "Rua XV de Novembro") {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ cep: "80010-000", logradouro, bairro, localidade: "Curitiba", uf: "PR" }), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const typeCep = (value: string) => fireEvent.change(screen.getByLabelText("CEP"), { target: { value } });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const bairro = () => screen.getByLabelText("Bairro") as HTMLSelectElement;

describe("UnitForm — CEP", () => {
  it("sucesso: mascara, preenche o logradouro, mostra a sugestão e pré-seleciona o bairro", async () => {
    const fetchMock = stubViaCep("Centro");
    renderForm();
    typeCep("80010000");
    expect(field("CEP").value).toBe("80010-000");
    expect(await screen.findByText("bairro segundo o CEP: Centro")).toBeTruthy();
    expect(field("Logradouro").value).toBe("Rua XV de Novembro");
    expect(bairro().value).toBe("n1");
    expect((fetchMock.mock.calls[0] as [ string, RequestInit ])[0]).toBe("https://viacep.com.br/ws/80010000/json/");
  });

  it("casa o bairro sem diferenciar maiúsculas e acentos", async () => {
    stubViaCep("SAO FRANCISCO");
    renderForm();
    typeCep("80010000");
    await screen.findByText("bairro segundo o CEP: SAO FRANCISCO");
    expect(bairro().value).toBe("n2");
  });

  it("bairro inativo não é pré-selecionado, mas a sugestão aparece", async () => {
    stubViaCep("Batel");
    renderForm();
    typeCep("80010000");
    await screen.findByText("bairro segundo o CEP: Batel");
    expect(bairro().value).toBe("");
  });

  it("não troca o bairro já escolhido", async () => {
    stubViaCep("Centro");
    renderForm();
    fireEvent.change(bairro(), { target: { value: "n2" } });
    typeCep("80010000");
    await screen.findByText("bairro segundo o CEP: Centro");
    expect(bairro().value).toBe("n2");
  });

  it("CEP geral (logradouro e bairro vazios): não apaga a rua nem escolhe bairro", async () => {
    stubViaCep("", "");
    renderForm({ initial: { ...blank, street: "Rua Digitada" } });
    typeCep("80010000");
    await waitFor(() => expect((screen.getByLabelText("CEP") as HTMLInputElement).value).toBe("80010-000"));
    await new Promise((r) => setTimeout(r, 20));
    expect(field("Logradouro").value).toBe("Rua Digitada");
    expect(bairro().value).toBe("");
    expect(screen.queryByText(/bairro segundo o CEP/)).toBeNull();
    expect(screen.queryByText(FAIL)).toBeNull();
  });

  it("{erro: true}: aviso e campos livres", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ erro: true }), { status: 200 })));
    renderForm();
    typeCep("99999999");
    expect(await screen.findByText(FAIL)).toBeTruthy();
    fireEvent.change(field("Logradouro"), { target: { value: "Rua sem CEP" } });
    expect(field("Logradouro").value).toBe("Rua sem CEP");
  });

  it("falha de rede: aviso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    renderForm();
    typeCep("80010000");
    expect(await screen.findByText(FAIL)).toBeTruthy();
  });

  it("timeout: aviso", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    renderForm({ cepTimeoutMs: 30 });
    typeCep("80010000");
    expect(await screen.findByText(FAIL)).toBeTruthy();
  });

  it("antes de 8 dígitos não consulta", () => {
    const fetchMock = stubViaCep("Centro");
    renderForm();
    typeCep("8001");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resposta de um CEP já trocado é descartada", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const slow = url.includes("80010000");
      if (slow) await new Promise((r) => setTimeout(r, 50));
      return new Response(JSON.stringify(slow
        ? { logradouro: "Rua Velha", bairro: "Centro" }
        : { logradouro: "Rua Nova", bairro: "São Francisco" }), { status: 200 });
    }));
    renderForm();
    typeCep("80010000");
    typeCep("80020000");
    await screen.findByText("bairro segundo o CEP: São Francisco");
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByText("bairro segundo o CEP: Centro")).toBeNull();
    expect(field("Logradouro").value).toBe("Rua Nova");
    expect(bairro().value).toBe("n2");
  });
});

describe("UnitForm — salvar", () => {
  it("CEP incompleto bloqueia, sem chamar onSave", () => {
    stubViaCep("Centro");
    const { onSave } = renderForm();
    typeCep("8001");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert").textContent).toBe("CEP precisa ter 8 dígitos");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("entrega o valor do formulário", async () => {
    stubViaCep("Centro");
    const { onSave } = renderForm();
    typeCep("80010000");
    await screen.findByText("bairro segundo o CEP: Centro");
    fireEvent.change(field("Número"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: "UBS Nova", zip: "80010-000", street: "Rua XV de Novembro", number: "100", neighborhoodId: "n1"
    }));
  });

  it("mostra o bairro atual mesmo se ele estiver inativo, marcado", () => {
    renderForm({ initial: { ...blank, neighborhoodId: "n3" } });
    expect(bairro().value).toBe("n3");
    expect(Array.from(bairro().options).map((o) => o.textContent)).toContain("Batel (inativo)");
  });
});
