import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UrgencyPanel } from "./UrgencyPanel";
import { WaitingRoomSettings } from "./WaitingRoomSettings";
import { WaitingRoomTv } from "./WaitingRoomTv";
import { urgencyUser } from "../test/urgencyFixtures";
import { URGENCY_DISABLED, WAITING_ROOM_DISABLED } from "../lib/urgency";

let current: ReturnType<typeof urgencyUser> | null = urgencyUser([ "municipal_admin" ]);
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: current }) }));

describe("telas-portão da urgência", () => {
  it("painel: interruptor desligado e papel sem acesso", () => {
    current = urgencyUser([ "municipal_admin" ], [ "clinical_record" ]);
    const { unmount } = render(<UrgencyPanel />);
    expect(screen.getByText(URGENCY_DISABLED)).toBeTruthy();
    unmount();
    current = urgencyUser([ "health_professional" ]);
    render(<UrgencyPanel />);
    expect(screen.getByText(/não tem acesso/i)).toBeTruthy();
  });
  it("senhas, locais e TVs: interruptor desligado", () => {
    current = urgencyUser([ "municipal_admin" ], [ "urgency_care" ]);
    render(<WaitingRoomSettings onGoToSecurity={() => {}} />);
    expect(screen.getByText(WAITING_ROOM_DISABLED)).toBeTruthy();
  });
  it("a TV é uma região própria, sem menu nem sessão", () => {
    render(<WaitingRoomTv />);
    expect(screen.getByRole("main", { name: "Painel de chamada" })).toBeTruthy();
  });
});
