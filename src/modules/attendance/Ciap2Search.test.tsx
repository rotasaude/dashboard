import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchCiap2: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type Ciap2Ref } from "../../lib/api";
import { Ciap2Search } from "./Ciap2Search";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function Harness({ initial = null }: { initial?: Ciap2Ref | null }) {
  const [ value, setValue ] = useState<Ciap2Ref | null>(initial);
  return (
    <>
      <Ciap2Search value={value} onChange={setValue} delayMs={0} />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}
function renderIt(initial?: Ciap2Ref | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<Harness initial={initial} />, { wrapper });
}
const value = () => JSON.parse(screen.getByTestId("value").textContent ?? "null");

describe("Ciap2Search", () => {
  beforeEach(() => {
    mocked(api.searchCiap2).mockReset();
    mocked(api.searchCiap2).mockResolvedValue([
      { code: "K86", label: "Hipertensão sem complicações" }, { code: "K87", label: "Hipertensão com complicações" }
    ]);
  });

  it("busca por nome e escolhe um código", async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Queixa (CIAP-2)"), { target: { value: "hipertensão" } });
    fireEvent.click(await screen.findByRole("button", { name: "K86 — Hipertensão sem complicações" }));
    expect(api.searchCiap2).toHaveBeenCalledWith("hipertensão");
    expect(value()).toEqual({ code: "K86", label: "Hipertensão sem complicações" });
    expect(screen.getByText("Hipertensão sem complicações")).not.toBeNull();
    expect(screen.queryByLabelText("Queixa (CIAP-2)")).toBeNull();
  });

  it("um caractere não busca", async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Queixa (CIAP-2)"), { target: { value: "k" } });
    expect(screen.getByText("digite pelo menos 2 caracteres")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.searchCiap2).not.toHaveBeenCalled();
  });

  it("nada encontrado e terminologia indisponível", async () => {
    mocked(api.searchCiap2).mockResolvedValueOnce([]);
    renderIt();
    fireEvent.change(screen.getByLabelText("Queixa (CIAP-2)"), { target: { value: "xyzw" } });
    expect(await screen.findByText("nenhum código encontrado")).not.toBeNull();
    mocked(api.searchCiap2).mockRejectedValueOnce(new ApiError(503, { error: "terminology_unavailable" }, "x"));
    fireEvent.change(screen.getByLabelText("Queixa (CIAP-2)"), { target: { value: "febre" } });
    expect((await screen.findByRole("alert")).textContent).toBe("a CIAP-2 não está disponível agora — tente de novo em instantes");
  });

  it("trocar volta para a busca", async () => {
    renderIt({ code: "K86", label: "Hipertensão sem complicações" });
    fireEvent.click(screen.getByRole("button", { name: "trocar" }));
    expect(value()).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Queixa (CIAP-2)")).not.toBeNull());
  });
});
