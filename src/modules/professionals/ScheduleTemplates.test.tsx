import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listScheduleTemplates: vi.fn(), listAppointmentTypes: vi.fn(), updateScheduleTemplate: vi.fn(), listCbo: vi.fn() };
});

import * as api from "../../lib/api";
import { ScheduleTemplates } from "./ScheduleTemplates";
import { MORNING, TYPES } from "../../test/schedulingFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<ScheduleTemplates />, { wrapper });
}

describe("ScheduleTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.listScheduleTemplates).mockResolvedValue([ MORNING ]);
    mocked(api.listAppointmentTypes).mockResolvedValue(TYPES);
    mocked(api.listCbo).mockResolvedValue([]);
  });

  it("lista as faixas em frase, o limite e a situação", async () => {
    renderIt();
    expect(await screen.findByText("09:00–11:00 · agendável · Consulta médica")).not.toBeNull();
    expect(screen.getByText("07:00–09:00 · demanda do dia")).not.toBeNull();
    expect(screen.getByText("11:00–12:00 · bloqueada")).not.toBeNull();
    expect(screen.getByText("2 por turno")).not.toBeNull();
  });

  it("desativar manda só active e relê", async () => {
    mocked(api.updateScheduleTemplate).mockResolvedValue({ ...MORNING, active: false });
    renderIt();
    const row = (await screen.findByText("Manhã")).closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(api.updateScheduleTemplate).toHaveBeenCalledWith("t1", { active: false }));
    await waitFor(() => expect(api.listScheduleTemplates).toHaveBeenCalledTimes(2));
  });

  it("Editar abre o editor com o modelo", async () => {
    renderIt();
    const row = (await screen.findByText("Manhã")).closest("[role=row]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Nome do modelo") as HTMLInputElement).value).toBe("Manhã");
  });
});
