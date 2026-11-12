// Relatório anual da ouvidoria (módulo 33; F-33.9): números do ano, três textos públicos, rascunho, publicação só de ano encerrado
// (Q27) e impressão só com os números e os textos.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW33, annualReport, ombudsmanUser } from "../test/ombudsmanFixtures";
import * as api from "../lib/api";
import { ApiError, type SessionUser } from "../lib/api";
import { OMBUDSMAN_ERRORS, OMBUDSMAN_NO_ROLE, PUBLIC_REPORT_NOTICE } from "../lib/ombudsman";
import { POPUP_BLOCKED } from "./documents/printDocument";
import { OmbudsmanAnnualReport } from "./OmbudsmanAnnualReport";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), getAnnualReport: vi.fn(),
  updateAnnualReport: vi.fn(), publishAnnualReport: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
const NOTE = "Contagens pequenas, e as que permitiriam deduzi-las, aparecem como 'oculto'.";

function mount(user: SessionUser = ombudsmanUser([ "ombudsman" ])) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  return renderWithProviders(<OmbudsmanAnnualReport now={NOW33} />);
}
const describedTexts = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "").split(/\s+/).map((i) => document.getElementById(i)?.textContent);

describe("relatório anual da ouvidoria", () => {
  it("rascunho: textos com o aviso público, até 8000, salvar manda os três; publicar espera o rascunho salvo", async () => {
    vi.mocked(api.getAnnualReport).mockResolvedValue(annualReport());
    vi.mocked(api.updateAnnualReport).mockImplementation(async (_y, i) => annualReport(i));
    mount();
    const field = await screen.findByLabelText("Problemas recorrentes");
    expect(api.getAnnualReport).toHaveBeenCalledWith(2025);
    for (const label of [ "Problemas recorrentes", "Providências adotadas", "Observações" ]) {
      expect(describedTexts(screen.getByLabelText(label))).toContain(PUBLIC_REPORT_NOTICE);
    }
    fireEvent.change(field, { target: { value: "x".repeat(8001) } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(api.updateAnnualReport).not.toHaveBeenCalled();
    expect(describedTexts(field)).toContain("cada texto do relatório tem até 8000 caracteres");
    fireEvent.change(field, { target: { value: "Falta de medicamentos na UBS Centro." } });
    fireEvent.change(screen.getByLabelText("Providências adotadas"), { target: { value: "Nova rotina de reposição semanal." } });
    expect(screen.getByText("salve o rascunho antes de publicar")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.updateAnnualReport).toHaveBeenCalledWith(2025,
      { recurring_problems: "Falta de medicamentos na UBS Centro.", actions_taken: "Nova rotina de reposição semanal.", notes: "" }));
    expect(await screen.findByText("Rascunho salvo.")).not.toBeNull();
    expect(screen.queryByText("salve o rascunho antes de publicar")).toBeNull();
  });

  it("publicar: dois passos; depois só leitura e o 'publicado em'", async () => {
    vi.mocked(api.getAnnualReport).mockResolvedValue(annualReport({ recurring_problems: "Falta de medicamentos." }));
    vi.mocked(api.publishAnnualReport).mockResolvedValue(annualReport({ state: "published", recurring_problems: "Falta de medicamentos.",
      published_at: "2026-11-11T10:00:00-03:00" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Publicar relatório de 2025" }));
    expect(screen.getByText("Publicar? Depois de publicado, o relatório não muda.")).not.toBeNull();
    expect(api.publishAnnualReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Publicado em 11/11/2026")).not.toBeNull();
    expect(api.publishAnnualReport).toHaveBeenCalledWith(2025);
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publicar relatório/ })).toBeNull();
    expect((screen.getByLabelText("Problemas recorrentes") as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Problemas recorrentes") as HTMLTextAreaElement).value).toBe("Falta de medicamentos.");
  });

  it("ano corrente: rascunho sim, publicar não (Q27), com o motivo", async () => {
    vi.mocked(api.getAnnualReport).mockImplementation(async (year) => annualReport({ year }));
    mount();
    await screen.findByRole("button", { name: "Publicar relatório de 2025" });
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: "2026" } });
    const publish = await screen.findByRole("button", { name: "Publicar relatório de 2026" });
    expect(api.getAnnualReport).toHaveBeenLastCalledWith(2026);
    expect(publish.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(OMBUDSMAN_ERRORS.year_not_closed)).not.toBeNull();
    fireEvent.click(publish);
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(api.publishAnnualReport).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).not.toBeNull();
  });

  it("report_published do api relê e passa a só leitura", async () => {
    vi.mocked(api.getAnnualReport).mockResolvedValueOnce(annualReport())
      .mockResolvedValueOnce(annualReport({ state: "published", published_at: "2026-02-01T09:00:00-03:00" }));
    vi.mocked(api.updateAnnualReport).mockRejectedValue(new ApiError(409, { error: "report_published" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.report_published)).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull());
    expect(api.getAnnualReport).toHaveBeenCalledTimes(2);
    expect(api.updateAnnualReport).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Publicado em 01/02/2026")).not.toBeNull();
  });

  it("already_published ao publicar relê e passa a só leitura", async () => {
    vi.mocked(api.getAnnualReport).mockResolvedValueOnce(annualReport())
      .mockResolvedValueOnce(annualReport({ state: "published", published_at: "2026-02-01T09:00:00-03:00" }));
    vi.mocked(api.publishAnnualReport).mockRejectedValue(new ApiError(409, { error: "already_published" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Publicar relatório de 2025" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(OMBUDSMAN_ERRORS.already_published)).not.toBeNull();
    expect(await screen.findByText("Publicado em 01/02/2026")).not.toBeNull();
    expect(api.publishAnnualReport).toHaveBeenCalledTimes(1);
  });

  it("texto mudado com a pergunta de publicar aberta: não publica, pede para salvar", async () => {
    vi.mocked(api.getAnnualReport).mockResolvedValue(annualReport());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Publicar relatório de 2025" }));
    fireEvent.change(screen.getByLabelText("Observações"), { target: { value: "Texto novo ainda não salvo." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("salve o rascunho antes de publicar");
    expect(api.publishAnnualReport).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Observações") as HTMLTextAreaElement).value).toBe("Texto novo ainda não salvo.");
  });

  it("com rascunho não salvo, o ano não troca (com o motivo)", async () => {
    vi.mocked(api.getAnnualReport).mockImplementation(async (year) => annualReport({ year }));
    mount();
    fireEvent.change(await screen.findByLabelText("Problemas recorrentes"), { target: { value: "Fila na farmácia." } });
    const select = screen.getByLabelText("Ano") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(describedTexts(select)).toContain("salve o rascunho antes de trocar de ano");
    fireEvent.change(select, { target: { value: "2026" } });
    expect(api.getAnnualReport).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Problemas recorrentes") as HTMLTextAreaElement).value).toBe("Fila na farmácia.");
    fireEvent.change(screen.getByLabelText("Problemas recorrentes"), { target: { value: "" } });
    expect(select.disabled).toBe(false);
  });

  it("imprimir: números com 'oculto', a nota da Q61 e os três textos; nunca '< 5'; nada pessoal", async () => {
    // Campos que o api não manda (nome, CPF, profissional) nunca vão à folha: ela só lê os números e os três textos.
    const stray = { published_by: { name: "Rita Prado", cpf: "123.456.789-09" } };
    const report = annualReport({ recurring_problems: "Falta de medicamentos." });
    vi.mocked(api.getAnnualReport).mockResolvedValue({ ...report, ...stray,
      numbers: { ...report.numbers, by_professional: [ { professional: { id: "p1", name: "Dr. Caio" }, total: 3 } ] } } as never);
    const doc = document.implementation.createHTMLDocument("");
    const open = vi.spyOn(window, "open").mockReturnValue({ document: doc, print: vi.fn(), focus: vi.fn(), close: vi.fn() } as never);
    const { container } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect(open).toHaveBeenCalledWith("", "_blank");
    // Na tela: "oculto" na célula escondida, a nota nova e nenhum "< 5".
    const praise = screen.getByText("Tipo: Elogio").closest("[role='row']") as HTMLElement;
    expect(praise.textContent).toContain("oculto");
    expect(screen.getByText(NOTE)).not.toBeNull();
    expect(container.innerHTML).not.toContain("&lt; 5");
    expect(container.textContent).not.toContain("< 5");
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Relatório de gestão da Ouvidoria da Saúde — 2025");
    expect(text).toContain("Falta de medicamentos.");
    expect(text).toContain("Tipo: Elogiooculto");
    expect(text).toContain(NOTE);
    expect(text).not.toContain("< 5");
    for (const title of [ "Problemas recorrentes", "Providências adotadas", "Observações" ]) expect(text).toContain(title);
    expect(text).toContain("Total de manifestações42");
    const html = doc.documentElement.outerHTML;
    expect(html).not.toContain("&lt; 5");
    expect(html).not.toContain("< 5");
    for (const personal of [ "Rita Prado", "123.456.789-09", "12345678909", "Dr. Caio" ]) expect(html).not.toContain(personal);
  });

  it("janela de impressão bloqueada: a frase", async () => {
    vi.mocked(api.getAnnualReport).mockResolvedValue(annualReport());
    vi.spyOn(window, "open").mockReturnValue(null);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect(screen.getByText(POPUP_BLOCKED)).not.toBeNull();
  });

  it("só o ouvidor", async () => {
    mount(ombudsmanUser([ "ombudsman_staff" ]));
    expect(await screen.findByText(OMBUDSMAN_NO_ROLE)).not.toBeNull();
    expect(api.getAnnualReport).not.toHaveBeenCalled();
  });
});
