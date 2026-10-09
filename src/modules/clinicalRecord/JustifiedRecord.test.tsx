import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getJustifiedRecord: vi.fn(), getConsultationOptions: vi.fn() };
});
vi.mock("../consultation/ConsultationView", () => ({
  ConsultationLoader: (p: { id: string; openingId?: string; canAddendum(c: unknown): boolean; onOpeningRequired?(): void }) => (
    <div>
      <span>{`consulta ${p.id} · abertura ${p.openingId} · adendo ${p.canAddendum({}) ? "sim" : "não"}`}</span>
      <button type="button" onClick={() => p.onOpeningRequired?.()}>abertura acabou (dublê)</button>
    </div>
  )
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { JustifiedRecord } from "./JustifiedRecord";
import { OPENING_ENDED } from "../../lib/clinicalRecord";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { NOW19, opening, options, record } from "../../test/consultationFixtures";

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("JustifiedRecord", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getJustifiedRecord, api.getConsultationOptions ]) m(fn).mockReset();
    vi.useFakeTimers({ toFake: [ "Date", "setInterval", "clearInterval" ] });
    vi.setSystemTime(new Date(NOW19));
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] }));
    m(api.getJustifiedRecord).mockResolvedValue(record({ access: "justified" }));
    m(api.getConsultationOptions).mockResolvedValue(options());
  });

  it("a contagem chega a zero: o prontuário some e oferece nova abertura", async () => {
    const onEnd = vi.fn();
    renderWithProviders(<JustifiedRecord opening={opening()} onEnd={onEnd} />);
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(screen.getByText("Abertura justificada · expira em 30:00")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Abertura justificada · expira em 29:59")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(30 * 60_000); });
    expect(screen.getByText(OPENING_ENDED)).not.toBeNull();
    expect(screen.queryByText("Joana Lima")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nova abertura" }));
    expect(onEnd).toHaveBeenCalled();
  });

  it("403 opening_required na leitura encerra a abertura", async () => {
    m(api.getJustifiedRecord).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    renderWithProviders(<JustifiedRecord opening={opening()} onEnd={vi.fn()} />);
    expect(await screen.findByText(OPENING_ENDED)).not.toBeNull();
  });

  it("consulta anterior com a abertura (adendo permitido) e fim da abertura vindo dela", async () => {
    renderWithProviders(<JustifiedRecord opening={opening()} onEnd={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" }));
    expect(screen.getByText("consulta cs0 · abertura op1 · adendo sim")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "abertura acabou (dublê)" }));
    expect(screen.getByText(OPENING_ENDED)).not.toBeNull();
  });
});
