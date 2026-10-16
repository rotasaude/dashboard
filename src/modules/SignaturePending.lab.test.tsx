import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listPendingSignatures: vi.fn(), startSignatureBatch: vi.fn(), returnToPaper: vi.fn() };
});

import * as api from "../lib/api";
import { SignaturePending } from "./SignaturePending";
import { renderWithProviders } from "../test/campaignFixtures";
import { pendingRequest, signer } from "../test/signatureFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.fetchCurrentSession).mockResolvedValue(signer());
  mocked(api.listPendingSignatures).mockResolvedValue([
    pendingRequest(),
    pendingRequest({ id: "sr9", document_type: "lab_report", document_id: "lr3", consultation_id: null, patient_display_name: "Joana Lima" })
  ]);
});

describe("SignaturePending — laudo laboratorial", () => {
  it("aparece como laudo laboratorial e não volta ao papel", async () => {
    renderWithProviders(<SignaturePending onNavigate={vi.fn()} redirect={vi.fn()} />);
    const lab = (await screen.findByText("laudo laboratorial")).closest("[role='row']") as HTMLElement;
    expect(within(lab).queryByRole("button", { name: "Voltar ao papel" })).toBeNull();
    expect(within(lab).getByText("assine pelo lote")).not.toBeNull();
    const consult = (screen.getAllByText("consulta")[0]).closest("[role='row']") as HTMLElement;
    expect(within(consult).getByRole("button", { name: "Voltar ao papel" })).not.toBeNull();
  });
});
