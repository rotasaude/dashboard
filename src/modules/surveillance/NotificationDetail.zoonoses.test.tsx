import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getNotification: vi.fn(), updateNotificationForm: vi.fn() };
});
import * as api from "../../lib/api";
import { NotificationDetail } from "./NotificationDetail";
import { NotificationTable } from "./NotificationTable";
import { renderWithProviders } from "../../test/campaignFixtures";
import { notification, survUser } from "../../test/surveillanceFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const RABIES = { code: "acidente_animal_raiva", name: "Acidente com animal potencialmente transmissor da raiva", deadline: "immediate" as const };
const open = () => renderWithProviders(<NotificationDetail id="nt1" onClose={vi.fn()} />);

describe("notificação do 25 com o animal (35b)", () => {
  beforeEach(() => {
    mocked(api.getNotification).mockReset(); mocked(api.updateNotificationForm).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(survUser());
  });

  it("ficha: uma seção, um PATCH; animal só em acidente_animal_raiva", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "investigating", version: 4 }));
    const first = open();
    expect(await screen.findByLabelText("Raça/Cor")).not.toBeNull();
    expect(screen.queryByLabelText("Espécie do animal")).toBeNull();
    first.unmount();

    mocked(api.getNotification).mockResolvedValue(notification({ status: "investigating", version: 4, disease: RABIES }));
    mocked(api.updateNotificationForm).mockResolvedValue(notification({ version: 5, disease: RABIES }));
    open();
    await screen.findByLabelText("Espécie do animal");
    expect(screen.getAllByRole("form", { name: "Ficha complementar" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Raça/Cor"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Espécie do animal"), { target: { value: "dog" } });
    fireEvent.click(screen.getByLabelText("Animal passível de observação"));
    fireEvent.change(screen.getByLabelText("Data da exposição"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ficha" }));
    await waitFor(() => expect(mocked(api.updateNotificationForm)).toHaveBeenCalledTimes(1));
    const [ id, body, version ] = mocked(api.updateNotificationForm).mock.calls[0];
    expect([ id, version ]).toEqual([ "nt1", 4 ]);
    expect(body).toMatchObject({ race_color: "4", animal_species: "dog", animal_observable: "true", exposure_on: "2026-11-15", animal_condition: null, animal_address: null });
    expect(typeof body.animal_observable).toBe("string");
  });

  it("observável sem espécie não sai: recusa na tela", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ status: "investigating", disease: RABIES }));
    open();
    fireEvent.click(await screen.findByLabelText("Animal passível de observação"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ficha" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(mocked(api.updateNotificationForm)).not.toHaveBeenCalled();
  });

  it("condição final do animal: título fixo, desfecho e data; em curso mostra o fim", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ disease: RABIES,
      animal_observation: { state: "closed", ends_on: "2026-11-25", outcome: "healthy", outcome_on: "2026-11-24" } }));
    const first = open();
    expect(await screen.findByText("Condição final do animal após a observação")).not.toBeNull();
    expect(screen.getByText("sadio · 24/11/2026")).not.toBeNull();
    first.unmount();
    mocked(api.getNotification).mockResolvedValue(notification({ disease: RABIES,
      animal_observation: { state: "open", ends_on: "2026-11-25", outcome: null, outcome_on: null } }));
    open();
    expect(await screen.findByText("observação em curso até 25/11/2026")).not.toBeNull();
  });

  it("sem observação: sem o bloco", async () => {
    mocked(api.getNotification).mockResolvedValue(notification({ disease: RABIES, animal_observation: null }));
    open();
    await screen.findByLabelText("Espécie do animal");
    expect(screen.queryByText("Condição final do animal após a observação")).toBeNull();
  });

  it("fila: animal_outcome_pending vira o sinal da linha", () => {
    renderWithProviders(<NotificationTable onOpen={vi.fn()} rows={[
      notification({ id: "a", animal_outcome_pending: true }), notification({ id: "b", animal_outcome_pending: false }) ]} />);
    expect(screen.getAllByText("Desfecho pendente")).toHaveLength(1);
  });
});
