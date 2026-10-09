// src/modules/consultation/ConsultationView.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchConsultationPdf: vi.fn(), getConsultation: vi.fn(), addAddendum: vi.fn(), fetchCurrentSession: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationLoader, ConsultationView } from "./ConsultationView";
import { finalized, options, problem } from "../../test/consultationFixtures";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function wrap(ui: ReactNode) { renderWithProviders(<>{ui}</>); }
// A sessão chega assíncrona: espera o AuthProvider assentar antes de afirmar ausência.
const settled = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const sessionAs = (id: string) => mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id }));
const addendum = { id: "ad1", author_name: "Enf. Lúcia Prado", created_at: "2026-10-07T11:00:00-03:00",
  reason: "correção do plano", text: "Retorno em 15 dias.", changes: { conducts: [ "12" ] } };

describe("ConsultationView", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchConsultationPdf, api.getConsultation, api.addAddendum, api.fetchCurrentSession ]) mocked(fn).mockReset();
    sessionAs("us1");
    win = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    // O jsdom não tem createObjectURL/revokeObjectURL.
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:pdf-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("mostra o registro finalizado e os adendos em ordem", () => {
    wrap(<ConsultationView consultation={finalized({ addenda: [ addendum ] })} options={options()} patientProblems={[ problem() ]}
      onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    const view = screen.getByRole("region", { name: "Consulta finalizada" });
    expect(within(view).getByText("Consulta de 07/10/2026, 10:20")).not.toBeNull();
    expect(within(view).getByText("Diabetes descompensado.")).not.toBeNull();
    expect(within(view).getByText("Glicemia capilar: 280 mg/dL")).not.toBeNull();
    expect(within(view).getByText("T90 — Diabetes não insulino-dependente · avaliado")).not.toBeNull();
    expect(within(view).getByText("Condutas: Retorno para consulta agendada")).not.toBeNull();
    const list = within(view).getByRole("list", { name: "adendos" });
    expect(within(list).getByText("Adendo de Enf. Lúcia Prado em 07/10/2026, 11:00")).not.toBeNull();
    expect(within(list).getByText("Condutas: Alta do episódio")).not.toBeNull();
    expect(within(view).getByRole("button", { name: "Fechar consulta" })).not.toBeNull();
  });

  it("consulta e adendo sem chaves opcionais (changes null, sem justificativa)", () => {
    const bare = { id: "ad2", author_name: "Enf. Lúcia Prado", created_at: "2026-10-07T11:00:00-03:00", reason: "correção do plano", text: "Só texto.", changes: null };
    const c = finalized({ addenda: [ bare ], exam_requests: [ { sigtap_code: "0202010503", label: "HEMOGLOBINA GLICOSILADA" } ] });
    wrap(<ConsultationView consultation={c} options={options()} patientProblems={[]} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    const list = screen.getByRole("list", { name: "adendos" });
    expect(within(list).getByText("Só texto.")).not.toBeNull();
    expect(screen.getByText("0202010503 — HEMOGLOBINA GLICOSILADA")).not.toBeNull();
  });

  it("Imprimir abre o PDF numa janela nova", async () => {
    mocked(api.fetchConsultationPdf).mockResolvedValue(new Blob([ "%PDF" ], { type: "application/pdf" }));
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]}  onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(win.location.href).toBe("blob:pdf-1"));
    expect(api.fetchConsultationPdf).toHaveBeenCalledWith("cs1");
  });

  it("Imprimir sem o nome do paciente fecha a janela e diz o caminho", async () => {
    mocked(api.fetchConsultationPdf).mockRejectedValue(new ApiError(409, { error: "patient_name_missing" }, "409"));
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]}  onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("falta o nome completo do paciente — peça à recepção para completar os nomes no check-in e tente de novo");
    expect(win.close).toHaveBeenCalled();
  });

  it("a autora vê Imprimir e Adendo", async () => {
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Imprimir" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Adendo" })).not.toBeNull();
  });

  it("outro profissional vê o conteúdo e Fechar consulta, sem Imprimir nem Adendo", async () => {
    sessionAs("us9");
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    await settled();
    expect(screen.getByText("Diabetes descompensado.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Fechar consulta" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Imprimir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Adendo" })).toBeNull();
  });

  it("readOnly esconde Imprimir e Adendo mesmo para a autora", async () => {
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]} readOnly onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    await settled();
    expect(mocked(api.fetchCurrentSession)).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Imprimir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Adendo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fechar consulta" })).not.toBeNull();
  });

  it("403 not_author no impresso mostra a frase", async () => {
    mocked(api.fetchConsultationPdf).mockRejectedValue(new ApiError(403, { error: "not_author" }, "403"));
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect((await screen.findByRole("alert")).textContent).toBe("só quem escreveu a consulta pode editá-la, imprimi-la ou fazer adendo");
  });

  it("o loader mostra o adendo devolvido pelo 201 sem reler a consulta", async () => {
    mocked(api.getConsultation).mockResolvedValue(finalized());
    mocked(api.addAddendum).mockResolvedValue(addendum);
    const onAddendumAdded = vi.fn();
    wrap(<ConsultationLoader id="cs1" options={options()} patientProblems={[]} onClose={vi.fn()}
      onAddendumAdded={onAddendumAdded} />);
    fireEvent.click(await screen.findByRole("button", { name: "Adendo" }));
    fireEvent.change(screen.getByLabelText("Motivo do adendo"), { target: { value: "correção do plano" } });
    fireEvent.change(screen.getByLabelText("Texto do adendo"), { target: { value: "Retorno em 15 dias." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar adendo" }));
    const list = await screen.findByRole("list", { name: "adendos" });
    expect(within(list).getByText("Retorno em 15 dias.")).not.toBeNull();
    expect(onAddendumAdded).toHaveBeenCalledWith(addendum);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getConsultation).toHaveBeenCalledTimes(1);
  });

  it("o loader não tenta de novo: 403 opening_required encerra na primeira resposta", async () => {
    mocked(api.getConsultation).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const onOpeningRequired = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
    render(<QueryClientProvider client={client}><ConsultationLoader id="cs1" options={options()}
      patientProblems={[]} onClose={vi.fn()} onOpeningRequired={onOpeningRequired} /></QueryClientProvider>);
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
    expect(api.getConsultation).toHaveBeenCalledTimes(1);
  });

  it("403 out_of_context encerra só com endOnOutOfContext", async () => {
    mocked(api.getConsultation).mockRejectedValue(new ApiError(403, { error: "out_of_context" }, "403"));
    const off = vi.fn(); const on = vi.fn();
    wrap(<ConsultationLoader id="cs1" options={options()} patientProblems={[]} onClose={vi.fn()} onOpeningRequired={off} />);
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(off).not.toHaveBeenCalled();
    cleanup();
    wrap(<ConsultationLoader id="cs1" options={options()} patientProblems={[]} onClose={vi.fn()} onOpeningRequired={on} endOnOutOfContext />);
    await waitFor(() => expect(on).toHaveBeenCalled());
  });

  it("o loader lê pelo id e avisa quando a abertura acabou", async () => {
    mocked(api.getConsultation).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const onOpeningRequired = vi.fn();
    wrap(<ConsultationLoader id="cs1" options={options()} patientProblems={[]} onClose={vi.fn()}
      onOpeningRequired={onOpeningRequired} />);
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
    expect(api.getConsultation).toHaveBeenCalledWith("cs1");
  });
});
