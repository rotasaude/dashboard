// src/modules/protocolEditor/UrgencyPanels.test.tsx
// Protocolo de classificação de risco no editor (módulo 32a, F-32.1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, listAuthorProtocols: vi.fn(), loadProtocolDefinition: vi.fn(), gateProtocol: vi.fn(),
    previewProtocol: vi.fn(), saveProtocolDraft: vi.fn(), simulateOffer: vi.fn(), listAppointmentTypes: vi.fn()
  };
});
let current: ReturnType<typeof urgencyUser> | null = null;
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: current }) }));

import * as api from "../../lib/api";
import { ProtocolEditor } from "../ProtocolEditor";
import { urgencyUser } from "../../test/urgencyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const definition = () => JSON.parse((screen.getByLabelText("Definição JSON") as HTMLTextAreaElement).value);
const pickUrgency = () => fireEvent.change(screen.getByLabelText("Carregar versão"), { target: { value: "__new_urgency__" } });

describe("editor — classificação de risco (módulo 32a)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    current = urgencyUser([ "protocol_author" ]);
    mocked(api.listAuthorProtocols).mockResolvedValue([]);
    mocked(api.gateProtocol).mockResolvedValue({ valid: true });
    mocked(api.listAppointmentTypes).mockResolvedValue([]);
  });

  it("'Nova classificação de risco (modelo)' carrega o modelo e troca a coluna da direita", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    expect(await screen.findByRole("heading", { name: "Cores e tempos máximos" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Regras de cor (classificação de risco)" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Oferta e sugestões" })).toBeNull();
    expect(definition().kind).toBe("urgency_classification");
    await waitFor(() => expect(api.gateProtocol).toHaveBeenCalled());
  });

  it("sem simulador nem pré-visualização para a urgência (Q1)", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    await screen.findByRole("heading", { name: "Cores e tempos máximos" });
    expect(screen.queryByRole("button", { name: "Pré-visualizar" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Simulador do acolhimento" })).toBeNull();
    expect(screen.getByText("Este tipo de protocolo não tem simulador: confira as regras com a equipe antes de enviar para revisão.")).not.toBeNull();
    expect(api.previewProtocol).not.toHaveBeenCalled();
  });

  it("editar o tempo do amarelo e o critério reescreve o JSON", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    fireEvent.change(await screen.findByLabelText("Tempo máximo do amarelo (min)"), { target: { value: "45" } });
    fireEvent.change(screen.getAllByLabelText("Critério (aparece para quem classifica)")[0], { target: { value: "SpO2 baixa" } });
    const json = definition();
    expect(json.levels[2]).toEqual({ color: "yellow", max_wait_minutes: 45 });
    expect(json.classification_rules[0].criterion).toBe("SpO2 baixa");
  });

  it("tempo fora de ordem ou inválido mostra o problema sob o campo", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    const yellow = await screen.findByLabelText("Tempo máximo do amarelo (min)");
    expect(yellow.getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(yellow, { target: { value: "5" } });
    expect(screen.getByText("o amarelo não pode esperar menos que o laranja (10 min)")).not.toBeNull();
    fireEvent.change(yellow, { target: { value: "abc" } });
    expect(screen.getByText("o tempo é um número inteiro de minutos, de 0 a 1440")).not.toBeNull();
    expect(definition().levels[2]).toEqual({ color: "yellow", max_wait_minutes: 5 });
    expect(screen.getByText("Vale para o estouro na fila e para o painel do gestor.")).not.toBeNull();
  });

  it("laranja: tom de urgente com o texto, nunca só a cor", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    const row = await screen.findByRole("group", { name: "nível laranja" });
    expect(within(row).getByText("laranja")).not.toBeNull();
  });

  it("regras: condição com a dor fora dos sinais vitais, adicionar e remover", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    const rule4 = await screen.findByRole("group", { name: "regra de cor 4" });
    const fieldSelect = within(rule4).getByLabelText("campo") as HTMLSelectElement;
    expect(fieldSelect.value).toBe("pain_scale");
    const labels = [ ...fieldSelect.options ].map((o) => o.textContent);
    expect(labels.filter((l) => l === "dor (0 a 10)")).toHaveLength(1);
    expect([ ...fieldSelect.options ].map((o) => o.value)).not.toContain("vitals.pain_score");
    expect([ ...fieldSelect.options ].map((o) => o.value)).not.toContain("complaint.ciap2");
    fireEvent.click(screen.getByRole("button", { name: "+ regra de cor" }));
    expect(definition().classification_rules).toHaveLength(6);
    expect(definition().classification_rules[5]).toEqual({ id: "r6", color: "yellow", criterion: "" });
    expect(screen.getAllByText("defina quando sugerir esta cor").length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole("group", { name: "regra de cor 1" })).getByRole("button", { name: "remover regra" }));
    expect(definition().classification_rules.map((r: { id: string }) => r.id)).toEqual([ "r2", "r3", "r4", "r5", "r6" ]);
    expect(screen.getByText("Vale a cor mais grave entre as regras que casarem. É só sugestão: a cor final é de quem classifica, com justificativa quando muda.")).not.toBeNull();
  });

  it("aviso de revisão clínica, de conteúdo licenciado e da troca do protocolo ativo (Q16)", async () => {
    render(<ProtocolEditor />);
    pickUrgency();
    expect(await screen.findByText("O modelo é só exemplo: as regras precisam de revisão clínica e das assinaturas antes de valer. Fluxogramas do Manchester dependem de licença da cidade.")).not.toBeNull();
    expect(screen.getByText("Só uma classificação de risco vale por vez na cidade: ativar esta versão tira de uso a que está ativa hoje.")).not.toBeNull();
  });

  it("o modelo vira a próxima versão do protocolo que a cidade já tem", async () => {
    mocked(api.listAuthorProtocols).mockResolvedValue([
      { name: "classificacao-urgencia", version: "1", status: "active" },
      { name: "classificacao-urgencia", version: "2", status: "draft" },
      { name: "arbovirose", version: "9", status: "active" }
    ]);
    render(<ProtocolEditor />);
    await waitFor(() => expect(api.listAuthorProtocols).toHaveBeenCalled());
    await screen.findByRole("option", { name: /classificacao-urgencia@2/ });
    pickUrgency();
    expect(definition().version).toBe(3);
  });

  it("os erros do gate aparecem como vieram (rule_id, levels_out_of_order, name_kind_conflict)", async () => {
    mocked(api.gateProtocol).mockResolvedValue({ valid: false, errors: [
      "rule_id: duplicate id 'r1' at classification_rules[1]",
      "name_kind_conflict: name 'acolhimento' is used by a protocol of another kind"
    ] });
    render(<ProtocolEditor />);
    pickUrgency();
    expect(await screen.findByText("rule_id: duplicate id 'r1' at classification_rules[1]")).not.toBeNull();
    expect(screen.getByText("name_kind_conflict: name 'acolhimento' is used by a protocol of another kind")).not.toBeNull();
  });

  it("sem urgency_care na sessão não oferece o modelo", () => {
    current = urgencyUser([ "protocol_author" ], [ "clinical_record" ]);
    render(<ProtocolEditor />);
    const values = [ ...(screen.getByLabelText("Carregar versão") as HTMLSelectElement).options ].map((o) => o.value);
    expect(values).not.toContain("__new_urgency__");
    expect(values).toContain("__new_screening__");
  });
});
