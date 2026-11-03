import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { ROOM, immunization, vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { ImmunizationRow } from "./ImmunizationRow";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("dose na caderneta", () => {
  it("dose da sala: quem aplicou e a sala", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
    renderWithProviders(<ul><ImmunizationRow imm={immunization()} onChanged={vi.fn()} roomId={ROOM.room_id} /></ul>);
    expect(await screen.findByText("Quem aplicou")).not.toBeNull();
    expect(screen.getByText("Sala")).not.toBeNull();
    expect(screen.queryByText("Transcrita por")).toBeNull();
  });

  it("dose transcrita: 'Transcrita por' e sem a sala (C, V29)", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
    renderWithProviders(<ul><ImmunizationRow imm={immunization({ transcription: true })} onChanged={vi.fn()} roomId={ROOM.room_id} /></ul>);
    expect(await screen.findByText("Transcrita por")).not.toBeNull();
    expect(screen.getByText("Téc. Ana Souza")).not.toBeNull();
    expect(screen.queryByText("Quem aplicou")).toBeNull();
    expect(screen.queryByText("Sala")).toBeNull();
    expect(screen.queryByText(ROOM.name)).toBeNull();
  });
});
