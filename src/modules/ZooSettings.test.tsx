// src/modules/ZooSettings.test.tsx
// Parâmetros de zoonoses (módulo 35b, Task 13; F-35.14, F-35.15): os 8 campos do §9 sem a prevalência esperada (Q18), versão e data,
// decimais com vírgula, recusa antes do envio (10–30 dias, tabela crescente), PUT com step-up e corpo inteiro com a versão lida,
// `invalid_parameter` no campo, 409 parameters_changed com UMA releitura que mantém o digitado, equipe sem papel de coordenação.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getZooParameters: vi.fn(), putZooParameters: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError, type ZoonosesParameterVersion } from "../lib/api";
import { ZOO_DOMAINS_KEY, ZOO_NO_ROLE } from "../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { sessionWith, renderWithProviders } from "../test/campaignFixtures";
import { ZOO_FEATURES, ZOO_PARAMS, zooUser } from "../test/zoonosesFixtures";
import { ZooSettings } from "./ZooSettings";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const version = (o: Partial<ZoonosesParameterVersion> = {}): ZoonosesParameterVersion => ({ version: 0, values: ZOO_PARAMS, created_at: null, ...o });
const mount = () => renderWithProviders(<ZooSettings onGoToSecurity={() => {}} />);
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? "" : "";
};
const coordinator = () => sessionWith([ "endemic_coordinator" ], { features: ZOO_FEATURES, mfa_verified_at: null });
const DAYS = "Dias de observação do agressor";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.getZooParameters, api.putZooParameters ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(coordinator());
  mocked(api.getZooParameters).mockResolvedValue(version());
  mocked(api.stepUpMfa).mockResolvedValue(undefined);
});

describe("portão", () => {
  it("a equipe e o municipal_admin veem a frase do papel e nada é lido", async () => {
    for (const roles of [ [ "zoonoses_team" ], [ "municipal_admin" ] ]) {
      mocked(api.fetchCurrentSession).mockResolvedValue(zooUser(roles));
      mount();
      expect(await screen.findByText(ZOO_NO_ROLE)).not.toBeNull();
      cleanup();
    }
    expect(api.getZooParameters).not.toHaveBeenCalled();
  });
});

describe("leitura", () => {
  it("os 8 campos agrupados, decimais com vírgula, estimativas vazias, versão 0 sem data e sem a prevalência esperada", async () => {
    mount();
    expect(await screen.findByText("padrão de fábrica (versão 0)")).not.toBeNull();
    expect(field(DAYS).value).toBe("10");
    expect(field("Duração da coleira (meses)").value).toBe("6");
    expect(field("Mínimo de cães do foco").value).toBe("100");
    expect(field("Cães por quarteirão").value).toBe("16");
    expect(field("Cobertura alvo da vacinação").value).toBe("0,8");
    expect(field("Estimativa de cães").value).toBe("");
    expect(field("Estimativa de gatos").value).toBe("");
    expect(field("População até, linha 1").value).toBe("599");
    expect(field("Amostra, linha 1").value).toBe("300");
    expect(field("População até, linha 6").value).toBe("1000");
    expect(screen.getByText("Abaixo de 500 cães, o manual não traz amostra: todos os cães entram no inquérito.")).not.toBeNull();
    expect(screen.queryByLabelText(/prevalência/i)).toBeNull();
    for (const name of [ "Observação do agressor", "Coleira", "Leishmaniose", "Raiva" ]) expect(screen.getByText(name)).not.toBeNull();
  });

  it("versão gravada: rótulo com a data da cidade", async () => {
    mocked(api.getZooParameters).mockResolvedValue(version({ version: 3, created_at: "2026-11-16T13:00:00.000000Z" }));
    mount();
    expect(await screen.findByText("versão 3, de 16/11/2026")).not.toBeNull();
  });
});

describe("recusa antes do envio", () => {
  it("observation_days 9 e 31 recusados; 10 e 30 valem (abrem a confirmação)", async () => {
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    for (const bad of [ "9", "31" ]) {
      type(DAYS, bad);
      click("Salvar parâmetros");
      await waitFor(() => expect(field(DAYS).getAttribute("aria-invalid")).toBe("true"));
      expect(describedText(field(DAYS))).toBe("dias de observação: inteiro de 10 a 30");
      expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    }
    for (const good of [ "10", "30" ]) {
      type(DAYS, good);
      click("Salvar parâmetros");
      expect(await screen.findByRole("button", { name: "Confirmar" })).not.toBeNull();
      expect(field(DAYS).getAttribute("aria-invalid")).toBeNull();
      type("Cães por quarteirão", good === "10" ? "17" : "18"); // mexer num campo fecha a confirmação
      await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull());
    }
    expect(api.putZooParameters).not.toHaveBeenCalled();
  });

  it("tabela com população decrescente: recusada na linha, sem chamada", async () => {
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    type("População até, linha 3", "650");
    click("Salvar parâmetros");
    await waitFor(() => expect(field("População até, linha 3").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(field("População até, linha 3"))).toBe("as populações da tabela vão em ordem estritamente crescente");
    expect(field("População até, linha 2").getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.putZooParameters).not.toHaveBeenCalled();
  });

  it("estimativa e cobertura: texto que não é número é recusado, nada é cortado", async () => {
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    type("Estimativa de cães", "12,5");
    type("Cobertura alvo da vacinação", "1,5");
    click("Salvar parâmetros");
    await waitFor(() => expect(field("Estimativa de cães").getAttribute("aria-invalid")).toBe("true"));
    expect(field("Cobertura alvo da vacinação").getAttribute("aria-invalid")).toBe("true");
    expect(api.putZooParameters).not.toHaveBeenCalled();
  });
});

describe("gravação", () => {
  it("step-up, corpo inteiro com a versão lida (0), vírgula vira ponto e vazio vira nulo; depois relê e invalida os domínios", async () => {
    const sent = { ...ZOO_PARAMS, observation_days: 12, rabies_coverage_target: 0.85, dog_population_estimate: 4200 };
    const saved = version({ version: 1, values: sent, created_at: "2026-11-23T13:00:00.000000Z" });
    mocked(api.putZooParameters).mockResolvedValue(saved);
    const { client } = mount();
    client.setQueryData([ ZOO_DOMAINS_KEY ], { stub: true });
    await screen.findByText("padrão de fábrica (versão 0)");
    type(DAYS, "12");
    type("Cobertura alvo da vacinação", "0,85");
    type("Estimativa de cães", "4200");
    click("Salvar parâmetros");
    expect(await screen.findByText("Cria a versão 1. O inquérito já aberto continua com a versão dele.")).not.toBeNull();
    type("Código do autenticador", "123456");
    mocked(api.getZooParameters).mockResolvedValue(saved);
    click("Confirmar");
    await waitFor(() => expect(api.putZooParameters).toHaveBeenCalledTimes(1));
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
    expect(mocked(api.putZooParameters).mock.calls[0]).toEqual([ sent, 0 ]);
    expect(await screen.findByText("parâmetros salvos — versão 1")).not.toBeNull();
    expect(await screen.findByText("versão 1, de 23/11/2026")).not.toBeNull();
    expect(client.getQueryState([ ZOO_DOMAINS_KEY ])?.isInvalidated).toBe(true);
    await waitFor(() => expect(api.getZooParameters).toHaveBeenCalledTimes(2));
  });

  it("invalid_parameter com path values.<chave>: a frase no campo", async () => {
    mocked(api.putZooParameters).mockRejectedValue(new ApiError(422, { error: "invalid_parameter", path: "values.dogs_per_block" }, "x"));
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    click("Salvar parâmetros");
    type("Código do autenticador", "123456");
    click("Confirmar");
    await waitFor(() => expect(field("Cães por quarteirão").getAttribute("aria-invalid")).toBe("true"));
    expect(describedText(field("Cães por quarteirão"))).toBe(ZOONOSES_ERRORS.invalid_parameter);
    expect(api.getZooParameters).toHaveBeenCalledTimes(1);
  });

  it("invalid_parameter na tabela: marca a tabela", async () => {
    mocked(api.putZooParameters).mockRejectedValue(new ApiError(422, { error: "invalid_parameter", path: "values.leish_sample_table" }, "x"));
    mount();
    await screen.findByText("padrão de fábrica (versão 0)");
    click("Salvar parâmetros");
    type("Código do autenticador", "123456");
    click("Confirmar");
    expect(await screen.findByText(ZOONOSES_ERRORS.invalid_parameter, { selector: "span" })).not.toBeNull();
  });

  it("409 parameters_changed: a frase, UMA releitura, o digitado fica com o vigente ao lado; o próximo envio leva a versão relida", async () => {
    mocked(api.getZooParameters).mockResolvedValue(version({ version: 3, created_at: "2026-11-16T13:00:00.000000Z" }));
    mocked(api.putZooParameters).mockRejectedValueOnce(new ApiError(409, { error: "parameters_changed" }, "x"));
    mount();
    await screen.findByText("versão 3, de 16/11/2026");
    type("Cães por quarteirão", "20");
    type(DAYS, "15");
    const v4 = version({ version: 4, values: { ...ZOO_PARAMS, dogs_per_block: 18 }, created_at: "2026-11-16T13:05:00.000000Z" });
    mocked(api.getZooParameters).mockResolvedValue(v4);
    click("Salvar parâmetros");
    type("Código do autenticador", "123456");
    click("Confirmar");
    expect(await screen.findByText(ZOONOSES_ERRORS.parameters_changed)).not.toBeNull();
    expect(await screen.findByText("versão 4, de 16/11/2026")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(field("Cães por quarteirão").value).toBe("20");
    expect(field(DAYS).value).toBe("15");
    expect(screen.getByText("vigente agora: 18")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getZooParameters).toHaveBeenCalledTimes(2);
    expect(api.putZooParameters).toHaveBeenCalledTimes(1);
    mocked(api.putZooParameters).mockResolvedValue(version({ version: 5 }));
    click("Salvar parâmetros");
    expect(await screen.findByText("Cria a versão 5. O inquérito já aberto continua com a versão dele.")).not.toBeNull();
    type("Código do autenticador", "123456");
    click("Confirmar");
    await waitFor(() => expect(api.putZooParameters).toHaveBeenCalledTimes(2));
    expect(mocked(api.putZooParameters).mock.calls[1]).toEqual([ { ...ZOO_PARAMS, dogs_per_block: 20, observation_days: 15 }, 4 ]);
    expect(await screen.findByText("parâmetros salvos — versão 5")).not.toBeNull();
    expect(screen.queryByText(ZOONOSES_ERRORS.parameters_changed)).toBeNull();
  });
});
