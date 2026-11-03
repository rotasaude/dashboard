import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CATALOG29, LEAD_ROOM, NOW29, ROOM, card, immunization, pendingItem, vacUser } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { VaccinationPending } from "./VaccinationPending";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn(),
  listRndsPending: vi.fn(), getVaccinationCard: vi.fn(), getVaccinationCatalog: vi.fn() }));
const counts = (late: number) => ({ blocked: 1, rejected: 1, failed: 0, late });
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
  vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
  vi.mocked(api.listRndsPending).mockResolvedValueOnce({ items: [ pendingItem(), pendingItem({ immunization_id: "im3",
    rnds: { status: "rejected", sent_at: "2026-11-01T09:01:00-03:00", accepted_at: null, block_reason: null, error: "lote não reconhecido" } }) ],
    counts: counts(0), next_before: "c1" })
    .mockResolvedValueOnce({ items: [ pendingItem({ immunization_id: "im4", rnds: { status: "pending", sent_at: null, accepted_at: null, block_reason: null, error: null } }) ],
      counts: counts(0), next_before: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("pendências do envio (F-29.4)", () => {
  it("lista sem nome, motivo em português, paginação e sem releitura sozinha", async () => {
    renderWithProviders(<VaccinationPending now={NOW29} />);
    expect(await screen.findByText("o CNS de quem vacinou não está no CNES importado da cidade")).not.toBeNull();
    expect(screen.getByText("RNDS: lote não reconhecido")).not.toBeNull();
    expect(screen.queryByText(/Joana/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(api.listRndsPending).toHaveBeenLastCalledWith("r1", "c1"));
    expect(await screen.findByText("na fila de envio")).not.toBeNull();
    expect(api.listRndsPending).toHaveBeenCalledTimes(2);
  });

  it("abrir caderneta lê no clique e mostra a situação de cada dose", async () => {
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card({ immunizations: [ immunization({
      rnds: { status: "blocked", sent_at: null, accepted_at: null, block_reason: "patient_without_cns_or_cpf", error: null } }) ] }));
    renderWithProviders(<VaccinationPending now={NOW29} />);
    const rows = await screen.findAllByRole("button", { name: /^Abrir caderneta/ });
    expect(api.getVaccinationCard).not.toHaveBeenCalled();
    fireEvent.click(rows[0]);
    await waitFor(() => expect(api.getVaccinationCard).toHaveBeenCalledWith("r1", { patient_id: "pa1" }));
    const list = await screen.findByRole("region", { name: "Doses registradas" });
    expect(within(list).getByText("parada: cadastro a corrigir")).not.toBeNull();
    expect(within(list).getByText("o cidadão não tem CPF nem CNS no cadastro")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Registrar|Transcrever/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar caderneta" }));
    expect(screen.queryByRole("region", { name: "Doses registradas" })).toBeNull();
  });

  it("faixa de 24 h só para o responsável da sala, e só com atraso (V8)", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ LEAD_ROOM ]);
    vi.mocked(api.listRndsPending).mockReset().mockResolvedValue({ items: [ pendingItem() ], counts: counts(2), next_before: null });
    renderWithProviders(<VaccinationPending now={NOW29} />);
    expect(await screen.findByText(/mais de 24 horas/)).not.toBeNull();
  });

  it("vacinador comum não vê a faixa", async () => {
    vi.mocked(api.listRndsPending).mockReset().mockResolvedValue({ items: [ pendingItem() ], counts: counts(2), next_before: null });
    renderWithProviders(<VaccinationPending now={NOW29} />);
    await screen.findByText("o CNS de quem vacinou não está no CNES importado da cidade");
    expect(screen.queryByText(/mais de 24 horas/)).toBeNull();
  });

  it("diz de qual dose a caderneta foi aberta", async () => {
    vi.mocked(api.getVaccinationCard).mockResolvedValue(card());
    renderWithProviders(<VaccinationPending now={NOW29} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Abrir caderneta/ }))[0]);
    expect(await screen.findByText(/^Aberta pela pendência: Penta/)).not.toBeNull();
  });

  it("resposta atrasada de uma caderneta fechada não a repõe", async () => {
    let resolve!: (c: ReturnType<typeof card>) => void;
    vi.mocked(api.getVaccinationCard).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWithProviders(<VaccinationPending now={NOW29} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Abrir caderneta/ }))[0]);
    await screen.findByText("abrindo a caderneta…");
    resolve(card());
    await waitFor(() => expect(screen.queryByText("abrindo a caderneta…")).toBeNull());
    expect(screen.getByRole("region", { name: "Caderneta aberta" })).not.toBeNull();
  });
});
