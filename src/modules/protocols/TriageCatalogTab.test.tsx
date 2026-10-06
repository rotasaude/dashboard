import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
    listTriageCatalog: vi.fn(), listPanelNeighborhoods: vi.fn(), updateTriageOffer: vi.fn()
  };
});

import * as api from "../../lib/api";
import { TriageCatalogTab } from "./TriageCatalogTab";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { NEIGHBORHOODS } from "../../test/conditionFixtures";
import { RESPIRATORY, catalogOffer } from "../../test/triageCatalogFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date("2026-10-05T12:00:00-03:00"));
  for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.listTriageCatalog, api.listPanelNeighborhoods, api.updateTriageOffer ]) {
    mocked(fn).mockReset();
  }
  mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "protocol_reviewer" ]));
  mocked(api.listPanelNeighborhoods).mockResolvedValue(NEIGHBORHOODS);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TriageCatalogTab — leitura", () => {
  it("uma linha por protocolo, com as frases, o período e a situação", async () => {
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer(), RESPIRATORY ]);
    renderWithProviders(<TriageCatalogTab />);
    expect(await screen.findByText("Saúde do idoso")).not.toBeNull();
    expect(screen.getByText("idade a partir de 60 anos")).not.toBeNull();
    expect(await screen.findByText("bairro Boqueirão")).not.toBeNull();
    expect(screen.getByText("até 31/12/2026")).not.toBeNull();
    expect(screen.getByText("oferecida")).not.toBeNull();
    expect(screen.getByText("Sintomas respiratórios")).not.toBeNull();
    expect(screen.getByText("para todos")).not.toBeNull();
    expect(screen.getByText("nenhuma")).not.toBeNull();
    expect(screen.getByText("sem período")).not.toBeNull();
    expect(screen.getByText("oferecida (sem configuração)")).not.toBeNull();
  });

  it("contadores com supressão", async () => {
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer(), RESPIRATORY ]);
    renderWithProviders(<TriageCatalogTab />);
    expect(await screen.findByText("120 · 40 · < 5 · 6")).not.toBeNull();
    expect(screen.getByText("0 · 0 · 0 · 0")).not.toBeNull();
    expect(screen.getByText("Últimos 30 dias. Contagens de 1 a 4 aparecem como “< 5”, para não identificar ninguém.")).not.toBeNull();
  });

  it("protocolo com elegibilidade e sem linha no catálogo aparece fora de oferta", async () => {
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer({ configured: false, enabled: null, position: null, restriction: null }) ]);
    renderWithProviders(<TriageCatalogTab />);
    expect(await screen.findByText("fora de oferta: configure")).not.toBeNull();
  });

  it("cidade sem protocolo em uso", async () => {
    mocked(api.listTriageCatalog).mockResolvedValue([]);
    renderWithProviders(<TriageCatalogTab />);
    expect(await screen.findByText("nenhum protocolo em uso nesta cidade")).not.toBeNull();
  });

  it("falha ao carregar mostra o erro com nova tentativa", async () => {
    mocked(api.listTriageCatalog).mockRejectedValue(new Error("rede"));
    renderWithProviders(<TriageCatalogTab />);
    expect(await screen.findByText("não foi possível carregar o catálogo")).not.toBeNull();
  });
});

describe("TriageCatalogTab — edição", () => {
  const admin = () => mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
  const open = async (title: string) => {
    fireEvent.click(await screen.findByText(title));
    return screen.getByRole("region", { name: `Editar ${title}` });
  };

  it("admin pausa e salva com a janela de step-up aberta; a lista é relida", async () => {
    admin();
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer(), RESPIRATORY ]);
    mocked(api.updateTriageOffer).mockResolvedValue(catalogOffer({ enabled: false }));
    renderWithProviders(<TriageCatalogTab />);
    const form = await open("Saúde do idoso");
    fireEvent.click(within(form).getByLabelText("Oferecer no catálogo"));
    fireEvent.click(within(form).getByRole("button", { name: "Salvar no catálogo…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateTriageOffer).toHaveBeenCalledWith("saude-do-idoso", {
      enabled: false, suggestion_only: false, position: 2, restriction: { in: [ "citizen.neighborhood_id", [ "n2" ] ] },
      available_from: null, available_until: "2026-12-31"
    }));
    expect(await screen.findByText("Catálogo atualizado: Saúde do idoso")).not.toBeNull();
    await waitFor(() => expect(api.listTriageCatalog).toHaveBeenCalledTimes(2));
  });

  it("marca só por sugestão e manda no PUT", async () => {
    admin();
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer(), RESPIRATORY ]);
    mocked(api.updateTriageOffer).mockResolvedValue(catalogOffer({ suggestion_only: true }));
    renderWithProviders(<TriageCatalogTab />);
    const form = await open("Saúde do idoso");
    fireEvent.click(within(form).getByLabelText("Só por sugestão"));
    fireEvent.click(within(form).getByRole("button", { name: "Salvar no catálogo…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateTriageOffer).toHaveBeenCalledWith("saude-do-idoso",
      expect.objectContaining({ enabled: true, suggestion_only: true })));
  });

  it("protocolo sem linha começa na próxima posição e ganha restrição por bairro", async () => {
    admin();
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer(), RESPIRATORY ]);
    mocked(api.updateTriageOffer).mockResolvedValue(RESPIRATORY);
    renderWithProviders(<TriageCatalogTab />);
    const form = await open("Sintomas respiratórios");
    expect((within(form).getByLabelText("Ordem no catálogo") as HTMLInputElement).value).toBe("3");
    const restriction = within(form).getByRole("group", { name: "Restrição da cidade" });
    fireEvent.click(within(restriction).getByRole("button", { name: "+ condição" }));
    fireEvent.change(within(restriction).getByLabelText("campo"), { target: { value: "citizen.neighborhood_id" } });
    fireEvent.click(await within(restriction).findByLabelText("Xaxim"));
    expect(within(restriction).queryByLabelText("Centro (bairro inativo)")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Salvar no catálogo…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.updateTriageOffer).toHaveBeenCalledWith("triage-respiratoria", {
      enabled: true, suggestion_only: false, position: 3, restriction: { in: [ "citizen.neighborhood_id", [ "n1" ] ] },
      available_from: null, available_until: null
    }));
  });

  it("período invertido trava o salvar", async () => {
    admin();
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer() ]);
    renderWithProviders(<TriageCatalogTab />);
    const form = await open("Saúde do idoso");
    fireEvent.change(within(form).getByLabelText("Disponível a partir de"), { target: { value: "2027-01-10" } });
    expect(within(form).getByText("o fim do período não pode ser antes do início")).not.toBeNull();
    expect((within(form).getByRole("button", { name: "Salvar no catálogo…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("janela de step-up fechada pede o código antes de gravar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { mfa_verified_at: null }));
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer() ]);
    mocked(api.updateTriageOffer).mockResolvedValue(catalogOffer());
    renderWithProviders(<TriageCatalogTab />);
    const form = await open("Saúde do idoso");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar no catálogo…" }));
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.stepUpMfa).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(api.updateTriageOffer).toHaveBeenCalledTimes(1));
  });

  it("recusa do servidor é traduzida e o diálogo continua aberto", async () => {
    admin();
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer() ]);
    mocked(api.updateTriageOffer).mockRejectedValue(new ApiError(422, { error: "invalid_restriction" }, "x"));
    renderWithProviders(<TriageCatalogTab />);
    const form = await open("Saúde do idoso");
    fireEvent.click(within(form).getByRole("button", { name: "Salvar no catálogo…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("a restrição usa um campo que o catálogo não aceita ou está malformada")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar" })).not.toBeNull();
  });

  it("revisor só lê: clicar na linha não abre edição", async () => {
    mocked(api.listTriageCatalog).mockResolvedValue([ catalogOffer() ]);
    renderWithProviders(<TriageCatalogTab />);
    fireEvent.click(await screen.findByText("Saúde do idoso"));
    expect(screen.queryByRole("button", { name: "Salvar no catálogo…" })).toBeNull();
  });
});
