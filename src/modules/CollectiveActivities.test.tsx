// src/modules/CollectiveActivities.test.tsx
// Atividade coletiva — lista, detalhe e "Registrada por engano" (módulo 24b, Task 12; F-24.12). A lista não traz pessoa nem temas
// (Q57a); o detalhe é a leitura nominal; "por engano" só com `can_mark_mistaken`, com `expected_state` e uma releitura no 409.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getCollectiveOptions: vi.fn(), listCollectiveActivities: vi.fn(), getCollectiveActivity: vi.fn(), markCollectiveMistaken: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { NO_TEAM } from "../lib/collectiveActivities";
import { HOME_VISIT_ERRORS, NOT_FOUND_REREAD } from "../lib/homeVisits";
import { renderWithProviders } from "../test/campaignFixtures";
import { expectFrozenNotice } from "../test/frozenNotice";
import { activity, hvUser, listActivity, options } from "../test/homeVisitFixtures";
import { CollectiveActivities } from "./CollectiveActivities";
import { MISTAKEN_REASON_HIDDEN, MISTAKEN_EFFECT } from "./collectiveActivities/ActivityDetail";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getCollectiveOptions, api.listCollectiveActivities, api.getCollectiveActivity, api.markCollectiveMistaken ];
afterEach(cleanup);
beforeEach(() => {
  for (const f of ALL) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getCollectiveOptions).mockResolvedValue(options());
  mocked(api.listCollectiveActivities).mockResolvedValue({ items: [ listActivity() ], next_before: null });
  mocked(api.getCollectiveActivity).mockResolvedValue(activity());
});

const mount = () => renderWithProviders(<CollectiveActivities />);
const listCall = (n: number) => mocked(api.listCollectiveActivities).mock.calls[n][0];
const openDetail = async () => fireEvent.click(await screen.findByRole("button", { name: "Abrir atividade de 12/11/2026" }));

describe("Atividade coletiva — lista", () => {
  it("lista sem participantes nem temas; por engano só com o filtro", async () => {
    mocked(api.listCollectiveActivities).mockResolvedValue({ items: [ listActivity() ], next_before: null });
    mount();
    await screen.findByRole("button", { name: "Abrir atividade de 12/11/2026" });
    // O tipo da linha (além da opção do filtro).
    expect(screen.getAllByText("Atendimento em grupo").length).toBeGreaterThan(1);
    expect(screen.queryByText("Maria Lima")).toBeNull();
    expect(listCall(0)).not.toHaveProperty("state");
    fireEvent.click(screen.getByLabelText("Mostrar as registradas por engano"));
    expect(mocked(api.listCollectiveActivities).mock.calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(listCall(1)).toMatchObject({ state: [ "recorded", "mistaken" ] }));
  });

  it("filtro de tipo vai como lista codificada, só no Atualizar", async () => {
    mount();
    await screen.findByRole("button", { name: "Abrir atividade de 12/11/2026" });
    fireEvent.change(screen.getByLabelText("Filtrar por tipo"), { target: { value: "4" } });
    expect(mocked(api.listCollectiveActivities).mock.calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(listCall(1)).toMatchObject({ team_id: "t1", activity_type: [ 4 ] }));
  });

  it("a linha mostra situação da ficha e o cursor carrega mais", async () => {
    mocked(api.listCollectiveActivities)
      .mockResolvedValueOnce({ items: [ listActivity() ], next_before: "c1" })
      .mockResolvedValueOnce({ items: [ listActivity({ id: "ca2", held_on: "2026-11-10", state: "mistaken" }) ], next_before: null });
    mount();
    await screen.findByRole("button", { name: "Abrir atividade de 12/11/2026" });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("button", { name: "Abrir atividade de 10/11/2026" })).not.toBeNull();
    expect(listCall(1)).toMatchObject({ before: "c1" });
    expect(screen.getByText("registrada por engano")).not.toBeNull();
  });

  it("sem CBO que registre, sem 'Nova atividade' mas a lista aparece", async () => {
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ teams: [ { ...options().teams[0], can_register: false } ] }));
    mount();
    expect(await screen.findByRole("button", { name: "Abrir atividade de 12/11/2026" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Nova atividade" })).toBeNull();
  });

  it("sem equipe: a frase e nenhuma leitura de lista", async () => {
    mocked(api.getCollectiveOptions).mockResolvedValue(options({ teams: [] }));
    mount();
    expect(await screen.findByText(NO_TEAM)).not.toBeNull();
    expect(api.listCollectiveActivities).not.toHaveBeenCalled();
  });

  it("recusa da lista vira frase", async () => {
    mocked(api.listCollectiveActivities).mockRejectedValue(new ApiError(403, { error: "feature_disabled" }, "x"));
    mount();
    expect(await screen.findByText(/desligada nesta cidade/)).not.toBeNull();
  });
});

describe("Atividade coletiva — detalhe", () => {
  it("detalhe: participantes, temas por rótulo, procedimento e ficha não gerada com motivo", async () => {
    mocked(api.getCollectiveActivity).mockResolvedValue(activity({
      procedure_code: "0101010010", ficha: { status: "not_generated", reasons: [ "participant_without_identifier" ] },
      participants: [ activity().participants![0], { patient: { id: "pa2", display_name: "Ivo Reis", has_cpf: false, cns_masked: "*** **** **** 1234" },
        altered_evaluation: false, measurements: null, smoking: { quit: true, dropped_out: false } } ]
    }));
    mount();
    await openDetail();
    expect(await screen.findByText("Maria Lima")).not.toBeNull();
    expect(screen.getByText("Ivo Reis")).not.toBeNull();
    expect(screen.getByText(/ficha não gerada: participante sem CPF e sem CNS/)).not.toBeNull();
    expect(screen.getByText(/Peso 72,5 kg/)).not.toBeNull();
    expect(screen.getByText(/\*\*\* \*\*\*\* \*\*\*\* 1234/)).not.toBeNull();
    expect(screen.queryByText(/12345678909/)).toBeNull();
    expect(mocked(api.getCollectiveActivity)).toHaveBeenCalledWith("ca1");
  });

  it("detalhe: leitura nominal única, sem sondagem", async () => {
    mount();
    await openDetail();
    await screen.findByText("Maria Lima");
    expect(api.getCollectiveActivity).toHaveBeenCalledTimes(1);
  });

  it("voltar à lista", async () => {
    mount();
    await openDetail();
    await screen.findByText("Maria Lima");
    fireEvent.click(screen.getByRole("button", { name: "Voltar à lista" }));
    expect(await screen.findByRole("button", { name: "Abrir atividade de 12/11/2026" })).not.toBeNull();
  });

  it("por engano: motivo oculto tem frase, nunca um motivo inventado", async () => {
    mocked(api.getCollectiveActivity).mockResolvedValue(activity({
      state: "mistaken", can_mark_mistaken: false, mistaken: { at: "2026-11-12T10:00:00-03:00", reason: null, by: { name: "Rita Enfermeira" } } }));
    mount();
    await openDetail();
    expect(await screen.findByText(MISTAKEN_REASON_HIDDEN)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrada por engano" })).toBeNull();
  });

  it("por engano: motivo visível aparece", async () => {
    mocked(api.getCollectiveActivity).mockResolvedValue(activity({
      state: "mistaken", can_mark_mistaken: true, mistaken: { at: "2026-11-12T10:00:00-03:00", reason: "Lançada em duplicidade.", by: { name: "Rita Enfermeira" } } }));
    mount();
    await openDetail();
    expect(await screen.findByText("Lançada em duplicidade.")).not.toBeNull();
    // Já marcada: não se marca de novo, mesmo que o api diga que pode.
    expect(screen.queryByRole("button", { name: "Registrada por engano" })).toBeNull();
  });
});

describe("Atividade coletiva — registrada por engano", () => {
  it("motivo com aviso; expected_state é do client; sucesso relê e fecha o formulário", async () => {
    mocked(api.markCollectiveMistaken).mockResolvedValue(activity({ state: "mistaken", can_mark_mistaken: false,
      mistaken: { at: "2026-11-12T10:00:00-03:00", reason: "Atividade lançada em duplicidade.", by: { name: "Rita Enfermeira" } } }));
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Registrada por engano" }));
    expect(screen.getByText(MISTAKEN_EFFECT)).not.toBeNull();
    const reason = screen.getByLabelText("Motivo");
    expectFrozenNotice(reason);
    fireEvent.change(reason, { target: { value: "  Atividade lançada em duplicidade.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.markCollectiveMistaken).toHaveBeenCalledWith("ca1", "Atividade lançada em duplicidade."));
    await waitFor(() => expect(screen.queryByLabelText("Motivo")).toBeNull());
  });

  it("motivo curto não sai", async () => {
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Registrada por engano" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    expect(api.markCollectiveMistaken).not.toHaveBeenCalled();
  });

  it("409 activity_changed: frase, uma releitura, nenhum reenvio", async () => {
    mocked(api.markCollectiveMistaken).mockRejectedValue(new ApiError(409, { error: "activity_changed" }, "x"));
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Registrada por engano" }));
    const reason = screen.getByLabelText("Motivo");
    expectFrozenNotice(reason);
    fireEvent.change(reason, { target: { value: "Atividade lançada em duplicidade." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(HOME_VISIT_ERRORS.activity_changed)).not.toBeNull();
    await waitFor(() => expect(api.getCollectiveActivity).toHaveBeenCalledTimes(2));
    expect(api.markCollectiveMistaken).toHaveBeenCalledTimes(1);
    // Sem releitura extra nem reenvio depois de um tempo.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.getCollectiveActivity).toHaveBeenCalledTimes(2);
    expect(api.markCollectiveMistaken).toHaveBeenCalledTimes(1);
  });

  it("404 not_found no engano: diz que releu, e relê uma vez", async () => {
    mocked(api.markCollectiveMistaken).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Registrada por engano" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Atividade lançada em duplicidade." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(NOT_FOUND_REREAD)).not.toBeNull();
    await waitFor(() => expect(api.getCollectiveActivity).toHaveBeenCalledTimes(2));
  });

  it("botão fica bloqueado enquanto a chamada corre (um envio só)", async () => {
    let finish: (a: api.CollectiveActivity) => void = () => {};
    mocked(api.markCollectiveMistaken).mockImplementation(() => new Promise((r) => { finish = r; }));
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Registrada por engano" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Atividade lançada em duplicidade." } });
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(confirm);
    expect(api.markCollectiveMistaken).toHaveBeenCalledTimes(1);
    finish(activity({ state: "mistaken", can_mark_mistaken: false, mistaken: { at: "2026-11-12T10:00:00-03:00", reason: null, by: { name: null } } }));
    await waitFor(() => expect(screen.queryByLabelText("Motivo")).toBeNull());
  });

  it("sem can_mark_mistaken, sem o botão", async () => {
    mocked(api.getCollectiveActivity).mockResolvedValue(activity({ can_mark_mistaken: false }));
    mount();
    await openDetail();
    await screen.findByText("Maria Lima");
    expect(screen.queryByRole("button", { name: "Registrada por engano" })).toBeNull();
  });

  it("a tela da ficha só mostra a situação: sem 'Gerar de novo' nem 'Reenviar'", async () => {
    mocked(api.getCollectiveActivity).mockResolvedValue(activity({ ficha: { status: "failed", reasons: [] } }));
    mount();
    await openDetail();
    await screen.findByText("Maria Lima");
    expect(screen.queryByRole("button", { name: /Gerar de novo|Reenviar/ })).toBeNull();
  });
});
