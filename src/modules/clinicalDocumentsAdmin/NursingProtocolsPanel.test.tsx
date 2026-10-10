// src/modules/clinicalDocumentsAdmin/NursingProtocolsPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listNursingProtocols: vi.fn(), createNursingProtocol: vi.fn(),
    addNursingProtocolVersion: vi.fn(), searchMedications: vi.fn() };
});

import * as api from "../../lib/api";
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
      api.searchMedications ]) mocked(fn).mockReset();
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
});
