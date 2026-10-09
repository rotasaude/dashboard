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

function renderForm(openingId?: string) {
  const onDone = vi.fn();
  const onOpeningRequired = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<AddendumForm consultation={finalized()} options={options()} patientProblems={[ problem() ]} openingId={openingId}
    searchDelayMs={0} onDone={onDone} onCancel={vi.fn()} onOpeningRequired={onOpeningRequired} />, { wrapper });
  return { onDone, onOpeningRequired };
}
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

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

  it("com mudanças: só vai o que mudou, e a abertura quando há", async () => {
    renderForm("op1");
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Problema resolvido; alta.");
    fireEvent.click(screen.getByLabelText("Mudar problemas, condutas ou exames"));
    fireEvent.click(screen.getByRole("button", { name: "Resolver T90" }));
    fireEvent.click(screen.getByLabelText("Alta do episódio"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    await waitFor(() => expect(api.addAddendum).toHaveBeenCalled());
    expect(mocked(api.addAddendum).mock.calls[0][1]).toEqual({
      reason: "correção do plano", text: "Problema resolvido; alta.", opening_id: "op1",
      changes: {
        evaluated_problems: [ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: problem().label, action: "resolve" } ],
        conducts: [ "9", "12" ]
      }
    });
  });

  it("403 opening_required avisa quem abriu a leitura", async () => {
    mocked(api.addAddendum).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const { onOpeningRequired } = renderForm("op1");
    text("Motivo do adendo", "correção do plano");
    text("Texto do adendo", "Retorno em 15 dias.");
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("a abertura justificada terminou ou não existe — abra o prontuário de novo com o motivo");
    expect(onOpeningRequired).toHaveBeenCalled();
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
});
