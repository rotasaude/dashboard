// src/modules/billing/PendingPanel.psychosocial.test.tsx
// Módulo 31 (B7): pendência da produção do CAPS chega sem paciente (`patient: null`,
// `fix: "patient"`): a tela mostra "—", não oferece "Completar dados" e não quebra.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  // fetchCurrentSession: o AuthProvider do renderWithProviders lê a sessão; sem o mock, o fetch real de "/session"
  // rejeita depois do teste (erro não tratado que derruba o vitest na CI com tudo verde).
  return { ...real, fetchCurrentSession: vi.fn(), getPeriodPending: vi.fn() };
});

import * as api from "../../lib/api";
import type { PendingItem } from "../../lib/api";
import { PendingPanel } from "./PendingPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { billingUser, pending, period } from "../../test/billingFixtures";
import { NO_PATIENT_NAME, patientName } from "../../lib/billing";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  mocked(api.getPeriodPending).mockReset();
  mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(billingUser());
});

// O api manda `patient: null` (JSON); o tipo declarado só diz "ausente".
const caps = (): PendingItem => pending({
  procedure_id: "pp9", reasons: [ "missing_patient_id" ], fix: "patient", patient: null, professional: undefined
});

describe("PendingPanel — pendência do CAPS sem paciente", () => {
  it("lista sem nome, sem botão de completar dados e com a frase do motivo", async () => {
    mocked(api.getPeriodPending).mockResolvedValue([ caps() ]);
    renderWithProviders(<PendingPanel period={period()} onClose={() => undefined} canFix />);
    const group = await screen.findByRole("region", { name: "Cadastro do paciente" });
    expect(within(group).getAllByText("paciente sem CPF nem CNS").length).toBeGreaterThanOrEqual(1);
    expect(within(group).queryByRole("button", { name: "Completar dados" })).toBeNull();
    expect(within(group).getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(NO_PATIENT_NAME)).toBeNull();
  });

  it("patientName tolera null", () => {
    expect(patientName(null)).toBe(NO_PATIENT_NAME);
  });
});
