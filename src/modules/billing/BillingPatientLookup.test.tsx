// src/modules/billing/BillingPatientLookup.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, lookupBillingPatient: vi.fn() };
});

import * as api from "../../lib/api";
import { BillingPatientLookup } from "./BillingPatientLookup";
import { PATIENT } from "../../test/billingFixtures";
import { VALID_CPF } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => { mocked(api.lookupBillingPatient).mockReset(); });

describe("BillingPatientLookup", () => {
  it("dois cliques síncronos: uma só busca", async () => {
    let resolve: (p: api.BillingPatient) => void = () => {};
    mocked(api.lookupBillingPatient).mockReturnValue(new Promise<api.BillingPatient>((r) => { resolve = r; }));
    const onFound = vi.fn();
    render(<BillingPatientLookup patient={null} onFound={onFound} />);
    fireEvent.change(screen.getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    const button = screen.getByRole("button", { name: "Buscar paciente" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.lookupBillingPatient).toHaveBeenCalledTimes(1);
    resolve(PATIENT);
    await waitFor(() => expect(onFound).toHaveBeenCalledWith(PATIENT));
    expect(api.lookupBillingPatient).toHaveBeenCalledTimes(1);
  });
});
