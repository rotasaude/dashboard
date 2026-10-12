// Modo cartão do CNES (spec do subprojeto 3, §3.3): a caixa de seleção vai
// para as ações e o "Tipo" é o título do cartão.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getCnes: vi.fn(), applyCnesProposals: vi.fn() };
});

import * as api from "../lib/api";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { cnesFixture } from "../test/recordModeFixtures";
import { Cnes } from "./Cnes";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("CNES em modo cartão", () => {
  beforeEach(() => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
    m(api.getCnes).mockResolvedValue(cnesFixture());
  });

  it("propostas: caixa de seleção vai para ações e o tipo é o título do cartão", async () => {
    renderWithProviders(<Cnes />);
    const box = await screen.findAllByRole("checkbox", { name: /^Selecionar: / });
    const cell = box[0].closest('[role="cell"]')!;
    expect(cell.getAttribute("data-card")).toBe("actions");
    const title = cell.parentElement!.querySelector('[data-card="title"]');
    expect(title?.getAttribute("data-label")).toBe("Tipo");
  });
});
