// src/modules/consultation/ConsultationView.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchConsultationPdf: vi.fn(), getConsultation: vi.fn(), addAddendum: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationLoader, ConsultationView } from "./ConsultationView";
import { finalized, options, problem } from "../../test/consultationFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const addendum = { id: "ad1", author_name: "Enf. Lúcia Prado", created_at: "2026-10-07T11:00:00-03:00",
  reason: "correção do plano", text: "Retorno em 15 dias.", changes: { conducts: [ "12" ] } };

describe("ConsultationView", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchConsultationPdf, api.getConsultation, api.addAddendum ]) mocked(fn).mockReset();
    win = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    // O jsdom não tem createObjectURL/revokeObjectURL.
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:pdf-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("mostra o registro finalizado e os adendos em ordem", () => {
    wrap(<ConsultationView consultation={finalized({ addenda: [ addendum ] })} options={options()} patientProblems={[ problem() ]}
      canAddendum={false} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    const view = screen.getByRole("region", { name: "Consulta finalizada" });
    expect(within(view).getByText("Consulta de 07/10/2026, 10:20")).not.toBeNull();
    expect(within(view).getByText("Diabetes descompensado.")).not.toBeNull();
    expect(within(view).getByText("Glicemia capilar: 280 mg/dL")).not.toBeNull();
    expect(within(view).getByText("T90 — Diabetes não insulino-dependente · avaliado")).not.toBeNull();
    expect(within(view).getByText("Condutas: Retorno para consulta agendada")).not.toBeNull();
    const list = within(view).getByRole("list", { name: "adendos" });
    expect(within(list).getByText("Adendo de Enf. Lúcia Prado em 07/10/2026, 11:00")).not.toBeNull();
    expect(within(list).getByText("Condutas: Alta do episódio")).not.toBeNull();
    expect(within(view).queryByRole("button", { name: "Adendo" })).toBeNull();
  });

  it("consulta e adendo sem chaves opcionais (changes null, sem justificativa)", () => {
    const bare = { id: "ad2", author_name: "Enf. Lúcia Prado", created_at: "2026-10-07T11:00:00-03:00", reason: "correção do plano", text: "Só texto.", changes: null };
    const c = finalized({ addenda: [ bare ], exam_requests: [ { sigtap_code: "0202010503", label: "HEMOGLOBINA GLICOSILADA" } ] });
    wrap(<ConsultationView consultation={c} options={options()} patientProblems={[]} canAddendum={false} onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    const list = screen.getByRole("list", { name: "adendos" });
    expect(within(list).getByText("Só texto.")).not.toBeNull();
    expect(screen.getByText("0202010503 — HEMOGLOBINA GLICOSILADA")).not.toBeNull();
  });

  it("Imprimir abre o PDF numa janela nova", async () => {
    mocked(api.fetchConsultationPdf).mockResolvedValue(new Blob([ "%PDF" ], { type: "application/pdf" }));
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]} canAddendum onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(win.location.href).toBe("blob:pdf-1"));
    expect(api.fetchConsultationPdf).toHaveBeenCalledWith("cs1");
  });

  it("Imprimir sem o nome do paciente fecha a janela e diz o caminho", async () => {
    mocked(api.fetchConsultationPdf).mockRejectedValue(new ApiError(409, { error: "patient_name_missing" }, "409"));
    wrap(<ConsultationView consultation={finalized()} options={options()} patientProblems={[]} canAddendum onAddendumAdded={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("falta o nome completo do paciente — peça à recepção para completar os nomes no check-in e tente de novo");
    expect(win.close).toHaveBeenCalled();
  });

  it("o loader lê pelo id e avisa quando a abertura acabou", async () => {
    mocked(api.getConsultation).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    const onOpeningRequired = vi.fn();
    wrap(<ConsultationLoader id="cs1" canAddendum={() => true} options={options()} patientProblems={[]} onClose={vi.fn()}
      onOpeningRequired={onOpeningRequired} />);
    await waitFor(() => expect(onOpeningRequired).toHaveBeenCalled());
    expect(api.getConsultation).toHaveBeenCalledWith("cs1");
  });
});
