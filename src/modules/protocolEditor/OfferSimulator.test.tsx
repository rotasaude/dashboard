// src/modules/protocolEditor/OfferSimulator.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, simulateOffer: vi.fn() };
});

import * as api from "../../lib/api";
import { OfferSimulator } from "./OfferSimulator";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const DEF = {
  name: "saude-do-idoso", version: 1, start_step_id: "s1",
  steps: [ { id: "s1", prompt: "Caiu no último ano?", answer_type: "boolean" } ],
  scoring: { type: "weighted", thresholds: { baixa: 0, alta: 15 } },
  offer: { eligibility: { gte: [ "profile.age", 60 ] } },
  suggestions: [ { protocol: "saude-mental", when: { gte: [ "outcome.score", 15 ] } } ]
};
const OK = { eligible: true, eligibility_text: "idade ≥ 60", suggestions: [ { protocol: "saude-mental", title: "Saúde mental", matches: true } ], errors: [], warnings: [] };
const simulate = () => fireEvent.click(screen.getByRole("button", { name: "Simular" }));

describe("OfferSimulator", () => {
  beforeEach(() => { mocked(api.simulateOffer).mockReset(); });

  it("manda o perfil e as respostas, sem resultado quando os campos dele estão vazios", async () => {
    mocked(api.simulateOffer).mockResolvedValue(OK);
    render(<OfferSimulator definition={DEF} valid answers={'{"s1":"true"}'} />);
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "62" } });
    simulate();
    await waitFor(() => expect(api.simulateOffer).toHaveBeenCalledWith({
      definition: DEF, profile: { age: 62, sex: "female", neighborhood_id: null }, answers: { s1: "true" }
    }));
    expect(await screen.findByText("Elegível: a triagem aparece no catálogo deste perfil")).not.toBeNull();
    expect(screen.getByText("Saúde mental: sugere")).not.toBeNull();
  });

  it("resultado preenchido vai como números, com a classificação do protocolo", async () => {
    mocked(api.simulateOffer).mockResolvedValue(OK);
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    fireEvent.change(screen.getByLabelText("Sexo"), { target: { value: "male" } });
    fireEvent.change(screen.getByLabelText("Classificação"), { target: { value: "alta" } });
    fireEvent.change(screen.getByLabelText("Pontuação"), { target: { value: "17" } });
    fireEvent.change(screen.getByLabelText("Prioridade"), { target: { value: "3" } });
    simulate();
    await waitFor(() => expect(api.simulateOffer).toHaveBeenCalledWith({
      definition: DEF, profile: { age: 62, sex: "male", neighborhood_id: null }, answers: {},
      outcome: { tier: "alta", score: 17, priority: 3 }
    }));
  });

  it("respostas com JSON inválido não chamam a API", () => {
    render(<OfferSimulator definition={DEF} valid answers="{" />);
    simulate();
    expect(screen.getByText("respostas: JSON inválido")).not.toBeNull();
    expect(api.simulateOffer).not.toHaveBeenCalled();
  });

  it("idade fora de 0 a 130 ou pontuação quebrada trava o botão", () => {
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "131" } });
    expect((screen.getByRole("button", { name: "Simular" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("idade de 0 a 130; pontuação e prioridade, números inteiros")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Pontuação"), { target: { value: "1.5" } });
    expect((screen.getByRole("button", { name: "Simular" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("definição com erro trava e diz por quê", () => {
    render(<OfferSimulator definition={DEF} valid={false} answers="{}" />);
    expect((screen.getByRole("button", { name: "Simular" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Corrija os erros para simular.")).not.toBeNull();
  });

  it("não elegível e erros do gate", async () => {
    mocked(api.simulateOffer).mockResolvedValue({ eligible: false, eligibility_text: null, suggestions: [], errors: [ "suggestions[0].when usa citizen.neighborhood_id" ], warnings: [] });
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    simulate();
    expect(await screen.findByText("Não elegível: a triagem não aparece para este perfil")).not.toBeNull();
    expect(screen.getByText("suggestions[0].when usa citizen.neighborhood_id")).not.toBeNull();
  });

  it("falha de rede vira mensagem", async () => {
    mocked(api.simulateOffer).mockRejectedValue(new Error("rede"));
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    simulate();
    expect(await screen.findByText("não foi possível simular — tente de novo")).not.toBeNull();
  });

  it("avisos do gate aparecem sem bloquear e sem alerta", async () => {
    mocked(api.simulateOffer).mockResolvedValue({
      eligible: true, eligibility_text: null, suggestions: [], errors: [],
      warnings: [ "sugestão para protocolo inexistente nesta cidade: x-y" ]
    });
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    simulate();
    expect(await screen.findByText("sugestão para protocolo inexistente nesta cidade: x-y")).not.toBeNull();
    expect(screen.getByText("Elegível: a triagem aparece no catálogo deste perfil")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resultado some quando a idade muda ou a definição muda", async () => {
    mocked(api.simulateOffer).mockResolvedValue(OK);
    const { rerender } = render(<OfferSimulator definition={DEF} valid answers="{}" />);
    simulate();
    expect(await screen.findByRole("status")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "30" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.change(screen.getByLabelText("Idade"), { target: { value: "62" } });
    expect(screen.queryByRole("status")).not.toBeNull();
    rerender(<OfferSimulator definition={{ ...DEF, version: 2 }} valid answers="{}" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("duas sugestões ao mesmo protocolo não geram chave duplicada", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocked(api.simulateOffer).mockResolvedValue({
      ...OK, suggestions: [ { protocol: "saude-mental", matches: true }, { protocol: "saude-mental", matches: false } ]
    });
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    simulate();
    await screen.findByRole("status");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("sem título na resposta (api antigo), mostra o nome do protocolo", async () => {
    mocked(api.simulateOffer).mockResolvedValue({ ...OK, suggestions: [ { protocol: "saude-mental", matches: false } ] });
    render(<OfferSimulator definition={DEF} valid answers="{}" />);
    simulate();
    expect(await screen.findByText("saude-mental: não sugere")).not.toBeNull();
  });
});
