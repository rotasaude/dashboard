import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listExamProviders: vi.fn(), listLabAdminExams: vi.fn(), listLabTemplates: vi.fn(), adoptLabExam: vi.fn(),
    getLabContext: vi.fn()
  };
});

import * as api from "../lib/api";
import { LabAdmin } from "./LabAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { labExam, labTemplate, labUser } from "../test/labFixtures";
import { examProvider } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(labUser([ "municipal_admin" ]));
  mocked(api.listExamProviders).mockReset().mockResolvedValue([ examProvider({ id: "pv9", name: "Laboratório Municipal", uses_municipal_lab: true }) ]);
  mocked(api.listLabAdminExams).mockReset().mockResolvedValue([ labExam() ]);
  mocked(api.listLabTemplates).mockReset().mockResolvedValue([ labTemplate(), labTemplate({ id: "tp2", name: "Ureia", sigtap_code: "0202010651" }) ]);
  mocked(api.adoptLabExam).mockReset().mockResolvedValue(labExam({ id: "le2", template_id: "tp2" }));
});

describe("LabAdmin", () => {
  it("administrador entra sem consultar o contexto do laboratório", async () => {
    renderWithProviders(<LabAdmin />);
    expect((await screen.findAllByText("Glicose")).length).toBeGreaterThan(0);
    expect(api.getLabContext).not.toHaveBeenCalled();
  });

  it("sem prestador com laboratório municipal: estado vazio que aponta o cadastro", async () => {
    mocked(api.listExamProviders).mockResolvedValue([ examProvider() ]);
    renderWithProviders(<LabAdmin />);
    expect(await screen.findByText("nenhum prestador usa o laboratório municipal")).not.toBeNull();
    expect(screen.getByText(/Exames → Catálogo e prestadores/)).not.toBeNull();
  });

  it("adotar: prazo fora de 1 a 90 não abre a confirmação; válido adota com step-up", async () => {
    renderWithProviders(<LabAdmin />);
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("Ureia"))!;
    fireEvent.click(within(row).getByRole("button", { name: "Adotar" }));
    fireEvent.change(await screen.findByLabelText("Prazo de entrega (dias, 1 a 90)"), { target: { value: "91" } });
    fireEvent.click(screen.getByRole("button", { name: "Adotar exame" }));
    expect((await screen.findByRole("alert")).textContent).toBe("prazo de entrega em dias inteiros (1 a 90)");
    expect(screen.queryByRole("region", { name: "Adotar Ureia" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Prazo de entrega (dias, 1 a 90)"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Adotar exame" }));
    const confirm = await screen.findByRole("region", { name: "Adotar Ureia" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Adotar" }));
    await waitFor(() => expect(api.adoptLabExam).toHaveBeenCalledWith({
      provider_id: "pv9", template_id: "tp2", sector: "biochemistry", bench: null, delivery_days: 3
    }));
  });
});
