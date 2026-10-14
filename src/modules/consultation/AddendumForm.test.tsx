// src/modules/consultation/AddendumForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, addAddendum: vi.fn(), searchTerminology: vi.fn(), searchSigtap: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { AddendumForm } from "./AddendumForm";
import { finalized, options, problem } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderForm(extra: { loadPatientProblems?: () => Promise<import("../../lib/api").PatientProblem[]> } = {}) {
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<AddendumForm consultation={finalized()} options={options()} patientProblems={[ problem() ]}
    searchDelayMs={0} onDone={onDone} onCancel={vi.fn()} {...extra} />, { wrapper });
  return { onDone };
}
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AddendumForm — prioridade do exame (módulo 21a, A33)", () => {
  const base = finalized({ exam_requests: [ { sigtap_code: "0202010503", label: "HbA1c", priority: "urgent" } ] });
  const open = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AddendumForm consultation={base} options={options()} patientProblems={[]}
      searchDelayMs={0} examPriority onDone={vi.fn()} onCancel={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
  };

  it("exame já pedido: prioridade só para leitura (com a dica), mesmo removido e pedido de novo; código novo escolhe", async () => {
    open();
    expect(screen.queryByLabelText("Prioridade (0202010503)")).toBeNull();
    expect(screen.getByText("Prioridade: urgente")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remover exame 0202010503" }));
    mocked(api.searchSigtap).mockResolvedValue([ { code: "0202010503", label: "HbA1c" } ]);
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "hba" } });
    fireEvent.click(await screen.findByRole("button", { name: /0202010503/ }));
    expect(screen.queryByLabelText("Prioridade (0202010503)")).toBeNull();
    expect(screen.getByText("Prioridade: urgente")).not.toBeNull();
    expect(screen.getByText("para trocar a prioridade, retire o exame num adendo e peça de novo num adendo seguinte")).not.toBeNull();
    mocked(api.searchSigtap).mockResolvedValue([ { code: "0202020380", label: "Hemograma completo" } ]);
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "hem" } });
    fireEvent.click(await screen.findByRole("button", { name: /0202020380/ }));
    expect(screen.getByLabelText("Prioridade (0202020380)")).not.toBeNull();
  });
});

describe("AddendumForm", () => {
  beforeEach(() => {
    mocked(api.addAddendum).mockReset();
    mocked(api.addAddendum).mockResolvedValue({ id: "ad1" });
  });

  it("motivo curto trava o envio", () => {
    renderForm();
    text("Motivo do adendo", "curto");
    text("Texto do adendo", "Retorno em 15 dias.");
    expect(screen.getByRole("alert").textContent).toBe("o motivo do adendo precisa de pelo menos 10 caracteres");
    expect((screen.getByRole("button", { name: "Registrar adendo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem mudanças, só motivo e texto", async () => {
    const { onDone } = renderForm();
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Retorno em 15 dias.");
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.addAddendum).toHaveBeenCalledWith("cs1", { reason: "correção do plano", text: "Retorno em 15 dias." });
  });

  it("com mudanças: só vai o que mudou (problemas e condutas)", async () => {
    renderForm();
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Problema resolvido; alta.");
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
    fireEvent.click(screen.getByRole("button", { name: "Resolver T90" }));
    fireEvent.click(screen.getByLabelText("Alta do episódio"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(api.addAddendum).toHaveBeenCalled());
    expect(mocked(api.addAddendum).mock.calls[0][1]).toEqual({
      reason: "correção do plano", text: "Problema resolvido; alta.",
      changes: {
        evaluated_problems: [ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: problem().label, action: "resolve" } ],
        conducts: [ "9", "12" ]
      }
    });
  });

  it("devolve o adendo criado a quem mostra a consulta", async () => {
    const { onDone } = renderForm();
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Retorno em 15 dias.");
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: "ad1" }));
  });

  it("Incluir o que a própria consulta incluiu vira avaliado (lista do paciente lida antes)", async () => {
    mocked(api.searchTerminology).mockResolvedValue([ { code: "K86", label: "Hipertensão sem complicações" } ]);
    const base = finalized({ evaluated_problems: [
      { problem_id: "pp9", terminology: "ciap2", code: "K86", label: "Hipertensão sem complicações", action: "add" }
    ] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AddendumForm consultation={base} options={options()}
      patientProblems={[ problem() ]} searchDelayMs={0} onDone={vi.fn()} onCancel={vi.fn()} /></QueryClientProvider>);
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Hipertensão reavaliada.");
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
    fireEvent.change(screen.getByLabelText("Incluir problema (CIAP-2)"), { target: { value: "hipertensão" } });
    fireEvent.click(await screen.findByRole("button", { name: "K86 — Hipertensão sem complicações" }));
    expect(screen.getByRole("status").textContent).toBe("K86 já está na lista do paciente — marcado como avaliado");
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(api.addAddendum).toHaveBeenCalled());
    expect(mocked(api.addAddendum).mock.calls[0][1].changes.evaluated_problems).toEqual([
      { problem_id: "pp9", terminology: "ciap2", code: "K86", label: "Hipertensão sem complicações", action: "evaluate" }
    ]);
  });

  it("403 not_author mostra a frase", async () => {
    mocked(api.addAddendum).mockRejectedValue(new ApiError(403, { error: "not_author" }, "403"));
    renderForm();
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Retorno em 15 dias.");
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("só quem escreveu a consulta pode editá-la, imprimi-la ou fazer adendo");
  });

  it("mudar só condutas não tira a justificativa CID-10 existente do exame", async () => {
    renderForm();
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Alta do episódio.");
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
    fireEvent.click(screen.getByLabelText("Alta do episódio"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(api.addAddendum).toHaveBeenCalled());
    expect(mocked(api.addAddendum).mock.calls[0][1].changes).toEqual({ conducts: [ "9", "12" ] });
  });

  it("não médico: sem CID-10 novo nem justificativa nova; resolve o CID-10 existente e mantém a justificativa do exame", async () => {
    const e11 = problem({ id: "pp2", terminology: "cid10", code: "E11", label: "Diabetes mellitus tipo 2" });
    const base = finalized({ exam_requests: [ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E11" } ] });
    mocked(api.searchSigtap).mockResolvedValue([ { code: "0202010207", label: "DOSAGEM DE COLESTEROL TOTAL" } ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AddendumForm consultation={base} options={options({ cid10_allowed_for_cbo: false })}
      patientProblems={[ e11 ]} searchDelayMs={0} onDone={vi.fn()} onCancel={vi.fn()} /></QueryClientProvider>);
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Diabetes resolvido; exame extra.");
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
    expect(screen.queryByRole("option", { name: "CID-10" })).toBeNull();
    expect(screen.queryByLabelText(/CID-10 de justificativa/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resolver E11" }));
    fireEvent.change(screen.getByLabelText("Solicitar exame (SIGTAP)"), { target: { value: "colesterol" } });
    fireEvent.click(await screen.findByRole("button", { name: "0202010207 — DOSAGEM DE COLESTEROL TOTAL" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(api.addAddendum).toHaveBeenCalled());
    expect(mocked(api.addAddendum).mock.calls[0][1].changes).toEqual({
      evaluated_problems: [ { problem_id: "pp2", terminology: "cid10", code: "E11", label: "Diabetes mellitus tipo 2", action: "resolve" } ],
      exam_requests: [
        { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E11" },
        { sigtap_code: "0202010207", label: "DOSAGEM DE COLESTEROL TOTAL" }
      ]
    });
  });

  it("não médico: sem mexer nos exames, exam_requests não vai (a justificativa fica como está)", async () => {
    const e11 = problem({ id: "pp2", terminology: "cid10", code: "E11", label: "Diabetes mellitus tipo 2" });
    const base = finalized({ exam_requests: [ { sigtap_code: "0202010503", label: "X", cid10_justification: "E11" } ] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AddendumForm consultation={base} options={options({ cid10_allowed_for_cbo: false })}
      patientProblems={[ e11 ]} searchDelayMs={0} onDone={vi.fn()} onCancel={vi.fn()} /></QueryClientProvider>);
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Avaliado.");
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
    fireEvent.click(screen.getByRole("button", { name: "Avaliar E11" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(api.addAddendum).toHaveBeenCalled());
    const changes = mocked(api.addAddendum).mock.calls[0][1].changes;
    expect(changes.evaluated_problems[0]).toMatchObject({ code: "E11", action: "evaluate" });
    expect(changes.exam_requests).toBeUndefined();
  });

  // ---- rodada especial do 19 (dashboard#12): lista completa no adendo de "Minhas consultas" ----

  const old = problem({ id: "pp7", code: "L03", label: "Lombalgia" });
  const openChanges = () => fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));

  it("com a função de carregar, mostra também um problema antigo do paciente", async () => {
    renderForm({ loadPatientProblems: async () => [ problem(), old ] });
    openChanges();
    expect(await screen.findByText(/L03/)).not.toBeNull();
  });

  it("sem a função, só os problemas da consulta, como antes", () => {
    renderForm();
    openChanges();
    expect(screen.queryByText(/L03/)).toBeNull();
  });

  it("se carregar falhar, segue com os da consulta e avisa", async () => {
    renderForm({ loadPatientProblems: async () => { throw new ApiError(500, {}, "500"); } });
    openChanges();
    expect(await screen.findByText("não foi possível carregar a lista completa de problemas; seguem os desta consulta")).not.toBeNull();
    expect(screen.queryByText(/L03/)).toBeNull();
  });

  it("paciente sem problemas: abre sem erro", async () => {
    renderForm({ loadPatientProblems: async () => [] });
    openChanges();
    await waitFor(() => expect(screen.queryByText(/não foi possível carregar/)).toBeNull());
    expect(screen.getByLabelText("Motivo do adendo")).not.toBeNull();
  });
});

