import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  setRegulationExternal: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ExternalNumberForm } from "./ExternalNumberForm";
import { STALE_TEXT } from "../../lib/regulation";
import { renderWithProviders } from "../../test/campaignFixtures";
import { regRequest, regUser } from "../../test/regulationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const NUMBER = "Número no sistema do estado";
const EXTERNAL = regRequest({ status: "external", state_regulated: true, version: 2 });

describe("ExternalNumberForm", () => {
  const after = regRequest({ status: "external", state_regulated: true, version: 3, external: { system: "sisreg", number: "2026/123456" } });
  beforeEach(() => {
    mocked(api.setRegulationExternal).mockReset().mockResolvedValue(after);
    mocked(api.fetchCurrentSession).mockResolvedValue(regUser());
  });

  it("formato conferido antes; sistema, número e versão no corpo", async () => {
    const onChanged = vi.fn();
    renderWithProviders(<ExternalNumberForm request={EXTERNAL} onChanged={onChanged} />);
    text("Sistema", "sisreg"); text(NUMBER, "SR 12");
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    expect((await screen.findByRole("alert")).textContent).toBe("número inválido: até 30 letras, números, ponto, barra ou hífen");
    expect(mocked(api.setRegulationExternal)).not.toHaveBeenCalled();
    text(NUMBER, "2026/123456");
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    await waitFor(() => expect(mocked(api.setRegulationExternal)).toHaveBeenCalledWith("rr1", "sisreg", "2026/123456", 2));
    expect(onChanged).toHaveBeenCalledWith("Número externo registrado.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("oferece os quatro sistemas; o número vai aparado; devolve o pedido gravado por onApplied", async () => {
    const onApplied = vi.fn();
    renderWithProviders(<ExternalNumberForm request={EXTERNAL} onChanged={vi.fn()} onApplied={onApplied} />);
    const options = Array.from((screen.getByLabelText("Sistema") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "SISREG", "CARE", "CROSS", "outro" ]);
    text("Sistema", "cross"); text(NUMBER, "  A-1.2/3  ");
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    await waitFor(() => expect(mocked(api.setRegulationExternal)).toHaveBeenCalledWith("rr1", "cross", "A-1.2/3", 2));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(after));
  });

  it("já tem número: o formulário vem com o que foi lançado", () => {
    renderWithProviders(<ExternalNumberForm request={regRequest({ ...EXTERNAL, external: { system: "care", number: "C-77" } })} onChanged={vi.fn()} />);
    expect((screen.getByLabelText("Sistema") as HTMLSelectElement).value).toBe("care");
    expect((screen.getByLabelText(NUMBER) as HTMLInputElement).value).toBe("C-77");
  });

  it("stale_version: a frase sobe por onStale (ou fica aqui), o número digitado fica e nada é aplicado", async () => {
    mocked(api.setRegulationExternal).mockRejectedValue(new ApiError(409, { error: "stale_version" }, "x"));
    const onStale = vi.fn(); const onChanged = vi.fn(); const onApplied = vi.fn();
    renderWithProviders(<ExternalNumberForm request={EXTERNAL} onChanged={onChanged} onApplied={onApplied} onStale={onStale} />);
    text(NUMBER, "2026/123456");
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    await waitFor(() => expect(onStale).toHaveBeenCalledWith(STALE_TEXT));
    expect((screen.getByLabelText(NUMBER) as HTMLInputElement).value).toBe("2026/123456");
    expect(onChanged).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    cleanup();
    renderWithProviders(<ExternalNumberForm request={EXTERNAL} onChanged={onChanged} />);
    text(NUMBER, "2026/123456");
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    expect((await screen.findByRole("alert")).textContent).toBe(STALE_TEXT);
    expect((screen.getByLabelText(NUMBER) as HTMLInputElement).value).toBe("2026/123456");
  });

  it("só onde a ação vale (pendente e regulado pelo estado); autorizado não desenha nada", () => {
    renderWithProviders(<ExternalNumberForm request={regRequest({ status: "pending" })} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Registrar número" })).not.toBeNull();
    cleanup();
    renderWithProviders(<ExternalNumberForm request={regRequest({ status: "authorized" })} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Registrar número" })).toBeNull();
    expect(screen.queryByLabelText("Sistema")).toBeNull();
  });

  it("avisa que uma nova ação começou ao enviar", async () => {
    const onStart = vi.fn();
    renderWithProviders(<ExternalNumberForm request={EXTERNAL} onChanged={vi.fn()} onStart={onStart} />);
    text(NUMBER, "2026/123456");
    fireEvent.click(screen.getByRole("button", { name: "Registrar número" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocked(api.setRegulationExternal)).toHaveBeenCalled());
  });
});
