import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

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
