// src/modules/documents/MedicationSearch.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, searchMedications: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { MedicationSearch } from "./MedicationSearch";
import { AMOXICILLIN, CLONAZEPAM, searchItem } from "../../test/documentFixtures";
import { MORPHINE, SERTRALINE } from "../../test/controlledFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt(blockControlled: boolean, onPick = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<MedicationSearch label="Buscar medicamento" unitId="u1" blockControlled={blockControlled} onPick={onPick} delayMs={0} />, { wrapper });
  return onPick;
}

describe("MedicationSearch", () => {
  beforeEach(() => {
    mocked(api.searchMedications).mockReset();
    mocked(api.searchMedications).mockResolvedValue([ searchItem(), AMOXICILLIN, CLONAZEPAM ]);
  });

  it("busca com a unidade, mostra 'na rede' e 'antimicrobiano', escolhe e limpa o campo", async () => {
    const onPick = renderIt(true);
    const field = screen.getByLabelText("Buscar medicamento") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "metf" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    expect(api.searchMedications).toHaveBeenCalledWith("metf", "u1");
    expect(within(list).getAllByText("na rede")).toHaveLength(2);
    expect(within(list).getByText("antimicrobiano")).not.toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Metformina, cloridrato 850 mg, comprimido" }));
    expect(onPick).toHaveBeenCalledWith(searchItem());
    expect(field.value).toBe("");
  });

  it("receita: controlado aparece bloqueado com o aviso do 19d", async () => {
    const onPick = renderIt(true);
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "clon" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    const blocked = within(list).getByRole("button", { name: "Clonazepam 2 mg, comprimido" }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(within(list).getByText("receita de controle especial — 19d")).not.toBeNull();
    fireEvent.click(blocked);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("lista de uso: controlado entra (não é receita)", async () => {
    const onPick = renderIt(false);
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "clon" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    fireEvent.click(within(list).getByRole("button", { name: "Clonazepam 2 mg, comprimido" }));
    expect(onPick).toHaveBeenCalledWith(CLONAZEPAM);
    expect(within(list).queryByText("receita de controle especial — 19d")).toBeNull();
  });

  it("um caractere não busca; catálogo fora do ar usa a frase do api real (sem prometer texto livre)", async () => {
    renderIt(true);
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "m" } });
    expect(screen.getByText("digite pelo menos 2 caracteres")).not.toBeNull();
    expect(api.searchMedications).not.toHaveBeenCalled();
    mocked(api.searchMedications).mockRejectedValue(new ApiError(503, { error: "catalog_unavailable" }, "503"));
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "metf" } });
    expect((await screen.findByRole("alert")).textContent).toBe("o catálogo de medicamentos está indisponível agora — a receita não sai; tente de novo em instantes");
  });
});

describe("MedicationSearch — motivo de bloqueio por item (19d)", () => {
  afterEach(cleanup);

  function renderWithReason(onPick = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MedicationSearch label="Buscar medicamento" blockControlled delayMs={0} onPick={onPick}
          blockReason={(item) => (item.controlled_list === "A1" ? "registre a Notificação de papel" : null)} />
      </QueryClientProvider>
    );
    return onPick;
  }

  it("o motivo decide: A1 bloqueado com o motivo; C1 liberado com a lista no selo", async () => {
    mocked(api.searchMedications).mockResolvedValue([ MORPHINE, SERTRALINE ]);
    const onPick = renderWithReason();
    fireEvent.change(screen.getByLabelText("Buscar medicamento"), { target: { value: "mo" } });
    const list = await screen.findByRole("list", { name: "resultados: Buscar medicamento" });
    expect((within(list).getByRole("button", { name: MORPHINE.label }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(list).getByText("registre a Notificação de papel")).not.toBeNull();
    expect(within(list).getByText("controlado · lista C1")).not.toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: SERTRALINE.label }));
    expect(onPick).toHaveBeenCalledWith(SERTRALINE);
  });
});
