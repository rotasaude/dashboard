// src/modules/billing/PendingPanel.urgency.test.tsx
// Módulo 32a (Q12; preflight A24, C-T13): a pendência do paciente provisório da UPA chega sem linha (`procedure_id: null`), com o
// `urgency_encounter_id` e `fix: "patient"`. A tela não quebra, não repete a chave, diz que é urgência e aponta a identificação
// na recepção da UPA — nunca o "Completar dados".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, getPeriodPending: vi.fn() };
});

import * as api from "../../lib/api";
import type { PendingItem } from "../../lib/api";
import { PendingPanel } from "./PendingPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { pending, period } from "../../test/billingFixtures";
import { URGENCY_IDENTIFY_HINT, URGENCY_PENDING_TAG, pendingKey, reasonLabel, sourceLabel } from "../../lib/billing";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { mocked(api.getPeriodPending).mockReset(); });

const urgency = (id: string): PendingItem => pending({
  procedure_id: null, urgency_encounter_id: id, reasons: [ "patient_unidentified" ], fix: "patient", late: false,
  patient: { id: `pa-${id}`, display_name: "Paciente não identificado", has_cpf: false, cns_masked: null, address_from_household: false }
});

describe("PendingPanel — pendência da urgência sem linha", () => {
  it("duas pendências sem procedure_id: sem chave repetida, com o rótulo da urgência e sem 'Completar dados'", async () => {
    const errors = vi.spyOn(console, "error");
    mocked(api.getPeriodPending).mockResolvedValue([ urgency("en1"), urgency("en2") ]);
    renderWithProviders(<PendingPanel period={period()} onClose={() => undefined} canFix />);
    const group = await screen.findByRole("region", { name: "Cadastro do paciente" });
    expect(within(group).getAllByText(URGENCY_PENDING_TAG).length).toBe(2);
    expect(within(group).getAllByText(reasonLabel("patient_unidentified")).length).toBe(2);
    expect(within(group).getAllByText(URGENCY_IDENTIFY_HINT).length).toBe(2);
    expect(within(group).queryByRole("button", { name: "Completar dados" })).toBeNull();
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
  });

  it("rótulos, origem e chave", () => {
    expect(reasonLabel("patient_unidentified")).toBe("paciente não identificado na UPA — a recepção precisa identificar");
    expect(sourceLabel("urgency")).toBe("urgência (UPA)");
    expect(pendingKey(urgency("en1"))).toBe("ue:en1");
    expect(pendingKey(pending({ procedure_id: "pp2" }))).toBe("pp2");
  });
});
