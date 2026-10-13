// src/modules/clinicalDocumentsAdmin/NursingProtocolsPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listNursingProtocols: vi.fn(), createNursingProtocol: vi.fn(),
    addNursingProtocolVersion: vi.fn(), searchMedications: vi.fn(), listNursingProtocolVersions: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError, type NursingProtocolVersionRow } from "../../lib/api";
import { NursingProtocolsPanel } from "./NursingProtocolsPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CLONAZEPAM, DIPYRONE, NOW19C, docUser, nursingProtocol } from "../../test/documentFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("NursingProtocolsPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19C));
    for (const fn of [ api.fetchCurrentSession, api.listNursingProtocols, api.createNursingProtocol, api.addNursingProtocolVersion,
      api.searchMedications, api.listNursingProtocolVersions ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "municipal_admin" ], { id: "ad1" }));
    mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol() ]);
    mocked(api.createNursingProtocol).mockResolvedValue(nursingProtocol({ id: "np2" }));
    mocked(api.addNursingProtocolVersion).mockResolvedValue(nursingProtocol());
    mocked(api.searchMedications).mockResolvedValue([ DIPYRONE ]);
  });

  it("lista os protocolos com número, ano, vigência e itens", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0]).getByText("Protocolo de enfermagem na atenção primária")).not.toBeNull();
    expect(within(rows[0]).getByText("nº 007/2025 · 2025")).not.toBeNull();
    expect(within(rows[0]).getByText("desde 01/03/2025")).not.toBeNull();
    expect(within(rows[0]).getByText("1")).not.toBeNull();
  });

  it("cria um protocolo: valida, pede step-up e manda título, número, ano, vigência e itens com dose máxima", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo protocolo" }));
    const form = screen.getByRole("form", { name: "Novo protocolo de enfermagem" });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("informe o título do protocolo");
    fireEvent.change(within(form).getByLabelText("Título"), { target: { value: "Protocolo de hipertensão" } });
    fireEvent.change(within(form).getByLabelText("Número"), { target: { value: "012/2026" } });
    fireEvent.change(within(form).getByLabelText("Incluir medicamento no protocolo"), { target: { value: "dipi" } });
    fireEvent.click(await within(form).findByRole("button", { name: "Dipirona sódica 500 mg/mL, solução oral" }));
    fireEvent.change(within(form).getByLabelText("Dose máxima — Dipirona sódica 500 mg/mL, solução oral"), { target: { value: "2" } });
    expect((within(form).getByLabelText("Unidade da dose máxima — Dipirona sódica 500 mg/mL, solução oral") as HTMLInputElement).value)
      .toBe("solução oral");
    fireEvent.change(within(form).getByLabelText("Unidade da dose máxima — Dipirona sódica 500 mg/mL, solução oral"), { target: { value: "frasco" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    const dialog = screen.getByRole("region", { name: "Criar o protocolo: Protocolo de hipertensão" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar protocolo" }));
    await waitFor(() => expect(api.createNursingProtocol).toHaveBeenCalledWith({
      title: "Protocolo de hipertensão", number: "012/2026", year: 2026, valid_from: "2026-10-09",
      items: [ { catalog_item_id: "ci4", max_dose: { quantity: 2, unit: "frasco" } } ]
    }));
    expect((await screen.findByRole("status")).textContent).toBe("Protocolo salvo.");
    expect(screen.queryByRole("form", { name: "Novo protocolo de enfermagem" })).toBeNull();
  });

  it("nova versão parte da vigente e não pede título", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" }));
    const form = screen.getByRole("form", { name: "Nova versão: Protocolo de enfermagem na atenção primária" });
    expect(within(form).queryByLabelText("Título")).toBeNull();
    expect((within(form).getByLabelText("Dose máxima — Dipirona sódica 500 mg/mL, solução oral") as HTMLInputElement).value).toBe("2");
    fireEvent.change(within(form).getByLabelText("Vigência — até (opcional)"), { target: { value: "2027-12-31" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Nova versão: Protocolo de enfermagem na atenção primária" }))
      .getByRole("button", { name: "Salvar protocolo" }));
    await waitFor(() => expect(api.addNursingProtocolVersion).toHaveBeenCalledWith("np1", {
      valid_from: "2026-10-09", valid_until: "2027-12-31", items: [ { catalog_item_id: "ci4", max_dose: { quantity: 2, unit: "frasco" } } ]
    }));
  });

  it("protocolo sem versão vigente hoje diz isso na lista", async () => {
    mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol({ current_version: null }) ]);
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    expect(await screen.findByText("sem versão vigente hoje")).not.toBeNull();
  });

  it("início no futuro: avisa antes e depois de salvar que a lista só mostra a versão quando valer", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" }));
    const form = screen.getByRole("form", { name: "Nova versão: Protocolo de enfermagem na atenção primária" });
    fireEvent.change(within(form).getByLabelText("Vigência — de"), { target: { value: "2026-12-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    const dialog = screen.getByRole("region", { name: "Nova versão: Protocolo de enfermagem na atenção primária" });
    expect(within(dialog).getByText(/A lista só mostra esta versão depois que ela começar a valer \(a partir de 01\/12\/2026\)/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar protocolo" }));
    expect((await screen.findByRole("status")).textContent)
      .toBe("Protocolo salvo. A lista só mostra esta versão depois que ela começar a valer (a partir de 01/12/2026).");
  });

  it("controlado aparece na busca do protocolo mas não entra", async () => {
    mocked(api.searchMedications).mockResolvedValue([ CLONAZEPAM ]);
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo protocolo" }));
    const form = screen.getByRole("form", { name: "Novo protocolo de enfermagem" });
    fireEvent.change(within(form).getByLabelText("Incluir medicamento no protocolo"), { target: { value: "clon" } });
    const btn = await within(form).findByRole("button", { name: CLONAZEPAM.label });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("recusas do api viram frases: já existe (409) e item inválido (422)", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    mocked(api.addNursingProtocolVersion).mockRejectedValueOnce(new api.ApiError(409, { error: "already_exists" }, "x"));
    fireEvent.click(within(screen.getByRole("region", { name: /Nova versão/ })).getByRole("button", { name: "Salvar protocolo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("já existe um protocolo com este número e ano");
    mocked(api.addNursingProtocolVersion).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_item", index: 0, field: "max_dose" }, "x"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar protocolo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("dose máxima"));
    // A recusa não perde o rascunho: cancelar o step-up volta ao formulário preenchido.
    fireEvent.click(within(screen.getByRole("region", { name: /Nova versão/ })).getByRole("button", { name: "Cancelar" }));
    const form = screen.getByRole("form", { name: "Nova versão: Protocolo de enfermagem na atenção primária" });
    expect((within(form).getByLabelText("Dose máxima — Dipirona sódica 500 mg/mL, solução oral") as HTMLInputElement).value).toBe("2");
  });

  it("trava o salvar enquanto a requisição está em voo: duplo clique manda uma vez só", async () => {
    let finish!: (p: Awaited<ReturnType<typeof api.addNursingProtocolVersion>>) => void;
    mocked(api.addNursingProtocolVersion).mockReturnValue(new Promise((res) => { finish = res; }));
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" }));
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    const dialog = screen.getByRole("region", { name: /Nova versão/ });
    const save = within(dialog).getByRole("button", { name: "Salvar protocolo" });
    fireEvent.click(save);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(save);
    expect((within(dialog).getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.addNursingProtocolVersion).toHaveBeenCalledTimes(1);
    finish(nursingProtocol());
    expect((await screen.findByRole("status")).textContent).toBe("Protocolo salvo.");
  });

  it("botões de linha ficam desabilitados com formulário aberto e durante o voo", async () => {
    let finish!: (p: Awaited<ReturnType<typeof api.addNursingProtocolVersion>>) => void;
    mocked(api.addNursingProtocolVersion).mockReturnValue(new Promise((res) => { finish = res; }));
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    const row = await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" });
    expect((row as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(row);
    expect((row as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Revisar e salvar" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar protocolo" }));
    expect((row as HTMLButtonElement).disabled).toBe(true);
    finish(nursingProtocol());
    await screen.findByRole("status");
    expect((row as HTMLButtonElement).disabled).toBe(false);
  });

  it("nova versão de protocolo sem versão vigente abre sem itens e exige um medicamento", async () => {
    mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol({ current_version: null }) ]);
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" }));
    const form = screen.getByRole("form", { name: /Nova versão/ });
    expect(within(form).getByText("nenhum medicamento no protocolo")).not.toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("inclua ao menos um medicamento no protocolo");
  });

  it("Enter na busca de medicamento não envia o formulário", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo protocolo" }));
    const form = screen.getByRole("form", { name: "Novo protocolo de enfermagem" });
    const input = within(form).getByLabelText("Incluir medicamento no protocolo");
    // Em navegador o Enter no campo dispara submit implícito; o keydown cancelado o impede.
    const inInput = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(inInput);
    expect(inInput.defaultPrevented).toBe(true);
    // Num botão de sugestão o Enter precisa seguir ativando o clique.
    fireEvent.change(input, { target: { value: "dipi" } });
    const suggestion = await within(form).findByRole("button", { name: "Dipirona sódica 500 mg/mL, solução oral" });
    const onButton = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    suggestion.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);
  });

  it("fim de vigência já passado: avisa que a versão não aparece como vigente", async () => {
    renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova versão de Protocolo de enfermagem na atenção primária" }));
    const form = screen.getByRole("form", { name: /Nova versão/ });
    fireEvent.change(within(form).getByLabelText("Vigência — de"), { target: { value: "2026-01-01" } });
    fireEvent.change(within(form).getByLabelText("Vigência — até (opcional)"), { target: { value: "2026-06-30" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar" }));
    const dialog = screen.getByRole("region", { name: /Nova versão/ });
    expect(within(dialog).getByText(/não vai aparecer como vigente.*30\/06\/2026/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar protocolo" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/^Protocolo salvo\. .*não vai aparecer como vigente.*30\/06\/2026/);
  });

  describe("api#61: histórico de versões", () => {
    const item = nursingProtocol().current_version!.items[0];
    const version = (over: Partial<NursingProtocolVersionRow>): NursingProtocolVersionRow =>
      ({ id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: null, items: [ item ], situation: "vigente", ...over });

    it("Ver versões lista número, vigência, situação e itens com dose máxima", async () => {
      mocked(api.listNursingProtocolVersions).mockResolvedValue([
        version({ id: "npv3", version: 3, valid_from: "2026-11-01", situation: "agendada" }),
        version({ id: "npv2", version: 2, valid_from: "2026-01-01", situation: "vigente" }),
        version({ id: "npv1", version: 1, valid_from: "2025-03-01", valid_until: "2025-12-31", situation: "encerrada" })
      ]);
      renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
      fireEvent.click(await screen.findByRole("button", { name: "Ver versões de Protocolo de enfermagem na atenção primária" }));
      const panel = await screen.findByRole("region", { name: "Versões: Protocolo de enfermagem na atenção primária" });
      await waitFor(() => expect(api.listNursingProtocolVersions).toHaveBeenCalledWith("np1"));
      const rows = await within(panel).findAllByRole("listitem", { name: /^Versão/ });
      expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([ "Versão 3", "Versão 2", "Versão 1" ]);
      expect(rows[0].textContent).toContain("a partir de 01/11/2026 · agendada a partir de 01/11/2026");
      expect(rows[1].textContent).toContain("a partir de 01/01/2026 · vigente");
      expect(rows[2].textContent).toContain("de 01/03/2025 a 31/12/2025 · encerrada");
      expect(rows[2].textContent).toContain("Dipirona sódica 500 mg/mL, solução oral · dose máxima 2 frasco");
      fireEvent.click(within(panel).getByRole("button", { name: "Fechar" }));
      expect(screen.queryByRole("region", { name: "Versões: Protocolo de enfermagem na atenção primária" })).toBeNull();
    });

    it("sem vigente e com uma agendada: depois de Ver versões, a vigência diz a próxima", async () => {
      mocked(api.listNursingProtocols).mockResolvedValue([ nursingProtocol({ current_version: null }) ]);
      mocked(api.listNursingProtocolVersions).mockResolvedValue([
        version({ id: "npv2", version: 2, valid_from: "2026-11-01", situation: "agendada" }),
        version({ id: "npv1", version: 1, valid_until: "2026-09-30", situation: "encerrada" })
      ]);
      renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
      expect(await screen.findByText("sem versão vigente hoje")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Ver versões de Protocolo de enfermagem na atenção primária" }));
      expect(await screen.findByText("sem versão vigente hoje — próxima a partir de 01/11/2026")).not.toBeNull();
    });

    it("erro ao buscar mostra a frase de erro e a tabela continua", async () => {
      mocked(api.listNursingProtocolVersions).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
      renderWithProviders(<NursingProtocolsPanel searchDelayMs={0} />);
      fireEvent.click(await screen.findByRole("button", { name: "Ver versões de Protocolo de enfermagem na atenção primária" }));
      const panel = await screen.findByRole("region", { name: "Versões: Protocolo de enfermagem na atenção primária" });
      expect((await within(panel).findByRole("alert")).textContent).toBe("seu papel não permite esta ação");
      expect(screen.getByText("nº 007/2025 · 2025")).not.toBeNull();
    });
  });
});
