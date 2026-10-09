import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError, type CodedOption } from "../../lib/api";
import { consultationError } from "../../lib/consultation";
import { CodeSearch } from "./CodeSearch";

afterEach(cleanup);

function renderIt(search: (q: string) => Promise<CodedOption[]>, onPick = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<CodeSearch label="Incluir problema (CIAP-2)" queryKey="terminologySearch:ciap2" search={search}
    onPick={onPick} errorText={consultationError} delayMs={0} />, { wrapper });
  return onPick;
}

describe("CodeSearch", () => {
  it("busca por nome, escolhe e limpa o campo", async () => {
    const search = vi.fn(async () => [ { code: "T90", label: "Diabetes não insulino-dependente" } ]);
    const onPick = renderIt(search);
    const field = screen.getByLabelText("Incluir problema (CIAP-2)") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "diabetes" } });
    const list = await screen.findByRole("list", { name: "resultados: Incluir problema (CIAP-2)" });
    fireEvent.click(within(list).getByRole("button", { name: "T90 — Diabetes não insulino-dependente" }));
    expect(search).toHaveBeenCalledWith("diabetes");
    expect(onPick).toHaveBeenCalledWith({ code: "T90", label: "Diabetes não insulino-dependente" });
    expect(field.value).toBe("");
    expect(screen.queryByRole("list", { name: "resultados: Incluir problema (CIAP-2)" })).toBeNull();
  });

  it("um caractere não busca", async () => {
    const search = vi.fn(async () => []);
    renderIt(search);
    fireEvent.change(screen.getByLabelText("Incluir problema (CIAP-2)"), { target: { value: "d" } });
    expect(screen.getByText("digite pelo menos 2 caracteres")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(search).not.toHaveBeenCalled();
  });

  it("nada encontrado e terminologia indisponível", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiError(503, { error: "terminology_unavailable" }, "503"));
    renderIt(search);
    fireEvent.change(screen.getByLabelText("Incluir problema (CIAP-2)"), { target: { value: "xyzw" } });
    expect(await screen.findByText("nenhum código encontrado")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Incluir problema (CIAP-2)"), { target: { value: "febre" } });
    expect((await screen.findByRole("alert")).textContent).toBe("a terminologia não está disponível agora — tente de novo em instantes");
  });
});
