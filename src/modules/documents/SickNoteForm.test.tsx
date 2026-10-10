import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchTerminology: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { emptySickNote } from "../../lib/clinicalDocuments";
import { SickNoteForm } from "./SickNoteForm";
import { TODAY19C } from "../../test/documentFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt(onSubmit: (c: api.SickNoteInput) => Promise<void> = vi.fn(async () => {}), extra: { busy?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<SickNoteForm initial={emptySickNote(TODAY19C)} today={TODAY19C} onSubmit={onSubmit} onCancel={vi.fn()} searchDelayMs={0} {...extra} />, { wrapper });
  return onSubmit;
}

async function pickCid() {
  fireEvent.change(screen.getByLabelText("CID-10 (opcional, só com autorização do paciente)"), { target: { value: "ivas" } });
  const list = await screen.findByRole("list", { name: "resultados: CID-10 (opcional, só com autorização do paciente)" });
  fireEvent.click(within(list).getByRole("button", { name: "J069 — Infecção aguda das vias aéreas superiores" }));
}

describe("SickNoteForm", () => {
  beforeEach(() => {
    mocked(api.searchTerminology).mockReset();
    mocked(api.searchTerminology).mockResolvedValue([ { code: "J069", label: "Infecção aguda das vias aéreas superiores" } ]);
  });

  it("afastamento com CID autorizado: manda dias, início, código e a autorização", async () => {
    const onSubmit = renderIt();
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    await pickCid();
    expect(api.searchTerminology).toHaveBeenCalledWith("ivas", "cid10");
    fireEvent.click(screen.getByLabelText("O paciente autorizou o CID no atestado"));
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      type: "leave", days: 3, start_on: TODAY19C, cid10: { code: "J069" }, cid_authorized: true
    }));
  });

  it("CID escolhido sem marcar a autorização: não emite e diz por quê", async () => {
    const onSubmit = renderIt();
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    await pickCid();
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("o CID só entra com a autorização do paciente — marque a autorização ou tire o CID");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "tirar o CID" }));
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ type: "leave", days: 3, start_on: TODAY19C, cid_authorized: false }));
  });

  it("acompanhante: pede nome, parentesco e motivo; trocar para acompanhante tira o CID", async () => {
    const onSubmit = renderIt();
    await pickCid();
    fireEvent.click(screen.getByLabelText("Acompanhante"));
    expect(screen.queryByText(/J069/)).toBeNull();
    expect(screen.queryByLabelText("CID-10 (opcional, só com autorização do paciente)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent).toBe("informe o nome do acompanhante");
    fireEvent.change(screen.getByLabelText("Nome do acompanhante"), { target: { value: "Marcos Lima" } });
    fireEvent.change(screen.getByLabelText("Parentesco"), { target: { value: "filho" } });
    fireEvent.change(screen.getByLabelText("Motivo (CLT art. 473)"), { target: { value: "clt_473_xi" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      type: "companion", start_on: TODAY19C, companion_name: "Marcos Lima", companion_kinship: "filho",
      companion_reason: "clt_473_xi", cid_authorized: false
    }));
    const sent = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect("days" in sent).toBe(false);
    expect("cid10" in sent).toBe(false);
    fireEvent.click(screen.getByLabelText("Afastamento"));
    expect(screen.queryByText(/J069/)).toBeNull();
    expect(screen.getByLabelText("CID-10 (opcional, só com autorização do paciente)")).not.toBeNull();
  });

  it("as datas aceitam de hoje − 30 a hoje (data da cidade) nos dois tipos", () => {
    renderIt();
    const start = screen.getByLabelText("Início") as HTMLInputElement;
    expect(start.min).toBe("2026-09-09");
    expect(start.max).toBe(TODAY19C);
    fireEvent.click(screen.getByLabelText("Acompanhante"));
    const day = screen.getByLabelText("Dia do acompanhamento") as HTMLInputElement;
    expect(day.min).toBe("2026-09-09");
    expect(day.max).toBe(TODAY19C);
  });

  it("data fora da janela (hoje − 30) não emite", async () => {
    const onSubmit = renderIt();
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o início precisa estar entre 30 dias atrás e hoje");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("observação limitada a 500 caracteres", () => {
    renderIt();
    expect((screen.getByLabelText("Observação (opcional)") as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it("recusa do api fica no formulário com o que foi digitado", async () => {
    renderIt(vi.fn(async () => { throw new ApiError(403, { error: "cbo_not_allowed" }, "403"); }));
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir atestado" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o seu CBO não emite este tipo de documento");
    expect((screen.getByLabelText("Dias de afastamento") as HTMLInputElement).value).toBe("3");
  });

  it("em voo: botões travados e o segundo envio síncrono é ignorado", async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderIt(onSubmit);
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    const form = screen.getByRole("form", { name: "Atestado" });
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Emitir atestado" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: "Emitir atestado" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prop busy do contêiner trava os botões e o envio", async () => {
    const onSubmit = renderIt(vi.fn(async () => {}), { busy: true });
    fireEvent.change(screen.getByLabelText("Dias de afastamento"), { target: { value: "3" } });
    expect((screen.getByRole("button", { name: "Emitir atestado" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.submit(screen.getByRole("form", { name: "Atestado" })); });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
