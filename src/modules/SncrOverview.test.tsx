import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSncrOverview: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SncrOverview } from "./SncrOverview";
import { renderWithProviders } from "../test/campaignFixtures";
import { controlledUser, sncrOverview } from "../test/controlledFixtures";
import { SNCR_SIMULATED_NOTICE } from "../lib/controlled";
import { CONTROLLED_DISABLED } from "../lib/clinicalDocuments";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(cleanup);

describe("SncrOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser([ "municipal_admin" ]));
    mocked(api.getSncrOverview).mockResolvedValue(sncrOverview());
  });

  it("saldo por prescritor, saldo baixo primeiro, quem nunca pediu e as contagens", async () => {
    renderWithProviders(<SncrOverview />);
    expect(await screen.findByText("Dra. Bruna Lopes")).not.toBeNull();
    expect(screen.getAllByText(/^Dra?\. /).map((e) => e.textContent)).toEqual([ "Dra. Bruna Lopes", "Dra. Helena Prado", "Dr. Caio Mendes" ]);
    expect(screen.getAllByText("saldo baixo")).toHaveLength(2);
    expect(screen.getByText("nunca pediu")).not.toBeNull();
    expect(screen.getByText("812")).not.toBeNull();
    expect(screen.getByText("Com saldo baixo")).not.toBeNull();
    expect(screen.getByText("Nunca pediram")).not.toBeNull();
    expect(screen.getByText("números livres de cada médico e dentista; saldo baixo = menos de 50 livres em um dos tipos")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null|Numeração simulada/);
  });

  it("SNCR simulado: faixa sem validade", async () => {
    mocked(api.getSncrOverview).mockResolvedValue(sncrOverview({ simulated: true }));
    renderWithProviders(<SncrOverview />);
    expect(await screen.findByText(SNCR_SIMULATED_NOTICE)).not.toBeNull();
  });

  it("sem prescritores: diz que não há ninguém", async () => {
    mocked(api.getSncrOverview).mockResolvedValue(sncrOverview({ professionals: [] }));
    renderWithProviders(<SncrOverview />);
    expect(await screen.findByText("nenhum médico ou dentista com números do SNCR")).not.toBeNull();
  });

  it("quem não é admin, ou cidade sem o interruptor: diz, sem consultar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
    renderWithProviders(<SncrOverview />);
    expect(await screen.findByText("só o administrador municipal vê este painel")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser([ "municipal_admin" ], { features: [ "clinical_documents" ] }));
    renderWithProviders(<SncrOverview />);
    expect(await screen.findByText(CONTROLLED_DISABLED)).not.toBeNull();
    expect(api.getSncrOverview).not.toHaveBeenCalled();
  });

  it("interruptor desligado depois de abrir (403): diz", async () => {
    mocked(api.getSncrOverview).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "controlled_prescriptions" }, "403"));
    renderWithProviders(<SncrOverview />);
    expect((await screen.findByRole("alert")).textContent).toBe(CONTROLLED_DISABLED);
  });
});
