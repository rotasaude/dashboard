// src/modules/ProtocolEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, listAuthorProtocols: vi.fn(), loadProtocolDefinition: vi.fn(), gateProtocol: vi.fn(),
    previewProtocol: vi.fn(), saveProtocolDraft: vi.fn(), simulateOffer: vi.fn(), listAppointmentTypes: vi.fn()
  };
});

import * as api from "../lib/api";
import { ProtocolEditor } from "./ProtocolEditor";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const DEF = {
  name: "arbovirose", version: 3, start_step_id: "febre",
  steps: [
    { id: "febre", prompt: "Teve febre?", answer_type: "boolean", branches: { true: "dias", false: null } },
    { id: "dias", prompt: "Há quantos dias?", answer_type: "integer", branches: {} }
  ]
};

const definitionBox = () => screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
const typeDefinition = (value: unknown) =>
  fireEvent.change(definitionBox(), { target: { value: JSON.stringify(value, null, 2) } });

describe("ProtocolEditor — Usar em Analytics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.listAuthorProtocols).mockResolvedValue([]);
    mocked(api.gateProtocol).mockResolvedValue({ valid: true });
    mocked(api.saveProtocolDraft).mockResolvedValue({ name: "arbovirose", version: 3, status: "draft" });
  });

  it("marcar a caixa grava analytic: true no JSON da pergunta", () => {
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    fireEvent.click(within(screen.getByRole("group", { name: "Teve febre?" })).getByLabelText("Usar em Analytics"));
    expect(JSON.parse(definitionBox().value).steps[0].analytic).toBe(true);
    expect(screen.queryByRole("group", { name: "Há quantos dias?" })).toBeNull();
  });

  it("desmarcar tira a chave do JSON", () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], analytic: true }, DEF.steps[1] ] });
    fireEvent.click(within(screen.getByRole("group", { name: "Teve febre?" })).getByLabelText("Usar em Analytics"));
    expect("analytic" in JSON.parse(definitionBox().value).steps[0]).toBe(false);
  });

  it("pergunta que virou integer perde a marca ao salvar, com aviso antes", async () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], answer_type: "integer", analytic: true }, DEF.steps[1] ] });
    expect(screen.getByRole("alert").textContent).toContain("“Teve febre?” não é de sim/não nem de lista");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.saveProtocolDraft).toHaveBeenCalledTimes(1));
    const sent = mocked(api.saveProtocolDraft).mock.calls[0][0] as { steps: Array<Record<string, unknown>> };
    expect("analytic" in sent.steps[0]).toBe(false);
    expect(definitionBox().value).not.toContain("analytic");
    expect(await screen.findByText("Salvo: arbovirose@3 (draft)")).toBeTruthy();
  });

  it("pergunta text com analytic: false também perde a chave ao salvar, com aviso", async () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], answer_type: "text", analytic: false }, DEF.steps[1] ] });
    expect(screen.getByRole("alert").textContent).toContain("“Teve febre?” não é de sim/não nem de lista");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.saveProtocolDraft).toHaveBeenCalledTimes(1));
    const sent = mocked(api.saveProtocolDraft).mock.calls[0][0] as { steps: Array<Record<string, unknown>> };
    expect("analytic" in sent.steps[0]).toBe(false);
    expect(definitionBox().value).not.toContain("analytic");
  });

  it("marca válida vai inteira no rascunho", async () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, steps: [ { ...DEF.steps[0], analytic: true }, DEF.steps[1] ] });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.saveProtocolDraft).toHaveBeenCalledTimes(1));
    expect((mocked(api.saveProtocolDraft).mock.calls[0][0] as { steps: Array<{ analytic?: boolean }> }).steps[0].analytic).toBe(true);
  });
});

describe("ProtocolEditor — Oferta e sugestões", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.listAuthorProtocols).mockResolvedValue([
      { name: "saude-mental-aprofundada", version: "1", status: "active" },
      { name: "arbovirose", version: "3", status: "draft" }
    ]);
    mocked(api.gateProtocol).mockResolvedValue({ valid: true });
  });

  const offerBox = () => screen.getByRole("group", { name: "Quem pode fazer (elegibilidade)" });
  const json = () => JSON.parse(definitionBox().value);

  it("JSON com offer preenche o painel; digitar o título grava no JSON e apagar tira o bloco", () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, offer: { title: "Arboviroses" } });
    const title = screen.getByLabelText("Título no catálogo") as HTMLInputElement;
    expect(title.value).toBe("Arboviroses");
    fireEvent.change(title, { target: { value: "Dengue e chikungunya" } });
    expect(json().offer).toEqual({ title: "Dengue e chikungunya" });
    fireEvent.change(title, { target: { value: "" } });
    expect("offer" in json()).toBe(false);
  });

  it("elegibilidade montada no construtor vai para o JSON, e a frase acompanha", () => {
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    fireEvent.click(within(offerBox()).getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(offerBox()).getByLabelText("valor"), { target: { value: "60" } });
    expect(json().offer).toEqual({ eligibility: { gte: [ "profile.age", 60 ] } });
    expect(within(offerBox()).getByText("idade a partir de 60 anos")).not.toBeNull();
  });

  it("editar o JSON atualiza o construtor", () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, offer: { eligibility: { gte: [ "profile.age", 65 ] } } });
    expect((within(offerBox()).getByLabelText("valor") as HTMLInputElement).value).toBe("65");
    typeDefinition({ ...DEF, offer: { eligibility: { gte: [ "profile.age", 70 ] } } });
    expect((within(offerBox()).getByLabelText("valor") as HTMLInputElement).value).toBe("70");
  });

  it("regra avançada no JSON: painel em leitura e o texto não muda", () => {
    render(<ProtocolEditor />);
    const def = { ...DEF, offer: { eligibility: { gt: [ "profile.age", 59 ] } } };
    typeDefinition(def);
    expect(within(offerBox()).getByText("Regra avançada: o construtor não edita esta regra. Altere no JSON.")).not.toBeNull();
    expect(within(offerBox()).getByText("idade acima de 59 anos")).not.toBeNull();
    expect(definitionBox().value).toBe(JSON.stringify(def, null, 2));
  });

  it("atalho '1 ano' grava 365; valor inválido não grava; 'sem intervalo' tira a chave", () => {
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    fireEvent.click(screen.getByRole("button", { name: "1 ano" }));
    expect(json().offer).toEqual({ retake_after_days: 365 });
    expect(screen.getByText("1 ano (365 dias)")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Intervalo para refazer (dias)"), { target: { value: "0" } });
    expect(screen.getByText("use de 1 a 3650 dias")).not.toBeNull();
    expect(json().offer).toEqual({ retake_after_days: 365 });
    fireEvent.click(screen.getByRole("button", { name: "sem intervalo" }));
    expect("offer" in json()).toBe(false);
  });

  it("sugestão: protocolo da cidade e condição sobre a pontuação; o próprio protocolo não é oferecido", async () => {
    render(<ProtocolEditor />);
    typeDefinition({ ...DEF, scoring: { type: "weighted", thresholds: { baixa: 0 } } });
    fireEvent.click(screen.getByRole("button", { name: "+ sugestão" }));
    const card = screen.getByRole("group", { name: "sugestão 1" });
    expect(within(card).getByText("escolha o protocolo sugerido")).not.toBeNull();
    const select = within(card).getByLabelText("Protocolo sugerido") as HTMLSelectElement;
    await waitFor(() => expect(within(select).queryByText("saude-mental-aprofundada")).not.toBeNull());
    expect(within(select).queryByText("arbovirose")).toBeNull();
    fireEvent.change(select, { target: { value: "saude-mental-aprofundada" } });
    const when = within(card).getByRole("group", { name: "Quando sugerir" });
    fireEvent.click(within(when).getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(when).getByLabelText("campo"), { target: { value: "outcome.score" } });
    fireEvent.change(within(when).getByLabelText("valor"), { target: { value: "15" } });
    expect(json().suggestions).toEqual([ { protocol: "saude-mental-aprofundada", when: { gte: [ "outcome.score", 15 ] } } ]);
    expect(within(card).queryByText("defina quando sugerir")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "remover sugestão" }));
    expect("suggestions" in json()).toBe(false);
  });

  it("JSON inválido: o painel pede correção", () => {
    render(<ProtocolEditor />);
    fireEvent.change(definitionBox(), { target: { value: "{ quebrado" } });
    expect(screen.getByText("Corrija o JSON para editar a oferta e as sugestões.")).not.toBeNull();
  });

  it("as perguntas aparecem no visual do wpda", () => {
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    const preview = screen.getByRole("region", { name: "Como o cidadão vê" });
    expect(within(preview).getByRole("heading", { name: "Teve febre?" })).not.toBeNull();
  });

  it("o simulador usa a definição e as respostas do editor", async () => {
    mocked(api.simulateOffer).mockResolvedValue({ eligible: true, eligibility_text: null, suggestions: [], errors: [], warnings: [] });
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    const button = screen.getByRole("button", { name: "Simular" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(api.simulateOffer).toHaveBeenCalledWith({
      definition: DEF, profile: { age: 62, sex: "female", neighborhood_id: null }, answers: {}
    }));
  });
});

describe("ProtocolEditor — Agendamento", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.listAuthorProtocols).mockResolvedValue([]);
    mocked(api.gateProtocol).mockResolvedValue({ valid: true });
  });

  // Espera a carga dos tipos chegar ao fim (resolvida ou recusada) antes de olhar o painel.
  const typesSettled = async () => {
    await waitFor(() => expect(api.listAppointmentTypes).toHaveBeenCalledTimes(1));
    await act(() => new Promise((r) => setTimeout(r, 0)));
  };

  it("o painel aparece ao lado do JSON e usa a lista de tipos quando o papel lê", async () => {
    mocked(api.listAppointmentTypes).mockResolvedValue([
      { key: "consulta_medica", name: "Consulta médica", duration_minutes: 20, cbo_prefixes: [ "2251" ], active: true, origin: "platform" }
    ]);
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    fireEvent.click(screen.getByRole("button", { name: "+ regra de agendamento" }));
    expect(await screen.findByRole("option", { name: "Consulta médica" })).not.toBeNull();
    expect(screen.queryByLabelText("Tipo de atendimento (chave)")).toBeNull();
  });

  it("403 nos tipos: o painel continua, com campo de texto", async () => {
    mocked(api.listAppointmentTypes).mockRejectedValue(new api.ApiError(403, { error: "forbidden" }, "x"));
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    await typesSettled();
    fireEvent.click(screen.getByRole("button", { name: "+ regra de agendamento" }));
    const field = screen.getByLabelText("Tipo de atendimento (chave)") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    expect(screen.queryByLabelText("Tipo de atendimento")).toBeNull();
    fireEvent.change(field, { target: { value: "consulta_medica" } });
    expect(JSON.parse(definitionBox().value).scheduling[0].appointment_type).toBe("consulta_medica");
  });

  it("abrir o painel não reescreve a definição", async () => {
    mocked(api.listAppointmentTypes).mockResolvedValue([]);
    render(<ProtocolEditor />);
    const raw = JSON.stringify(DEF);
    fireEvent.change(definitionBox(), { target: { value: raw } });
    await typesSettled();
    expect(definitionBox().value).toBe(raw);
  });

  it("avisos do gate aparecem sem tirar o 'válido'", async () => {
    mocked(api.listAppointmentTypes).mockResolvedValue([]);
    mocked(api.gateProtocol).mockResolvedValue({ valid: true,
      warnings: [ "scheduling appointment_type 'puericultura' is inactive in this city" ] });
    render(<ProtocolEditor />);
    typeDefinition(DEF);
    expect(await screen.findByText("aviso: scheduling appointment_type 'puericultura' is inactive in this city", {}, { timeout: 2000 }))
      .not.toBeNull();
    expect(screen.getByText("válido ✓")).not.toBeNull();
  });
});
