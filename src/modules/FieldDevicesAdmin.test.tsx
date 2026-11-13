import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listAdminFieldDevices: vi.fn(), adminRevokeFieldDevice: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { HOME_VISIT_ERRORS } from "../lib/homeVisits";
import { renderWithProviders } from "../test/campaignFixtures";
import { device, hvUser } from "../test/homeVisitFixtures";
import { FieldDevicesAdmin } from "./FieldDevicesAdmin";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);
beforeEach(() => {
  for (const f of [ api.fetchCurrentSession, api.getHomeVisitContext, api.listAdminFieldDevices, api.adminRevokeFieldDevice ]) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "municipal_admin" ]));
  mocked(api.listAdminFieldDevices).mockResolvedValue([ { ...device(), user: { id: "u-7", name: "Joana ACS" } } ]);
});
const mount = () => renderWithProviders(<FieldDevicesAdmin />);
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

describe("Aparelhos de campo da cidade", () => {
  it("lista da cidade com a pessoa; filtro manda só o user_id; revogar com step-up", async () => {
    mocked(api.adminRevokeFieldDevice).mockResolvedValue({ ...device({ status: "revoked", revoked_at: "2026-11-12T10:00:00-03:00", revoked_reason: "admin" }), user: { id: "u-7", name: "Joana ACS" } });
    mount();
    expect((await screen.findAllByText("Joana ACS")).length).toBeGreaterThan(0);
    expect(api.listAdminFieldDevices).toHaveBeenCalledWith(undefined);
    fireEvent.change(screen.getByLabelText("Pessoa"), { target: { value: "u-7" } });
    await waitFor(() => expect(api.listAdminFieldDevices).toHaveBeenLastCalledWith("u-7"));
    fireEvent.click(await screen.findByRole("button", { name: "Revogar Celular da Joana de Joana ACS" }));
    confirm();
    await waitFor(() => expect(api.adminRevokeFieldDevice).toHaveBeenCalledWith("fd1"));
  });

  it("pede o código do autenticador quando a janela de step-up está fechada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "municipal_admin" ]));
    mocked(api.fetchCurrentSession).mockResolvedValue({ ...hvUser([ "municipal_admin" ]), mfa_verified_at: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar Celular da Joana de Joana ACS" }));
    expect(screen.getByLabelText("Código do autenticador")).not.toBeNull();
    confirm();
    expect(api.adminRevokeFieldDevice).not.toHaveBeenCalled();
  });

  it("não depende do interruptor: sem home_visits lista e não chama o contexto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "municipal_admin" ], []));
    mount();
    expect((await screen.findAllByText("Joana ACS")).length).toBeGreaterThan(0);
    expect(api.getHomeVisitContext).not.toHaveBeenCalled();
  });

  it("409 device_already_revoked: frase e uma releitura; missing_role tem frase", async () => {
    mocked(api.adminRevokeFieldDevice).mockRejectedValue(new ApiError(409, { error: "device_already_revoked" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar Celular da Joana de Joana ACS" }));
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.device_already_revoked)).not.toBeNull();
    await waitFor(() => expect(api.listAdminFieldDevices).toHaveBeenCalledTimes(2));
    expect(HOME_VISIT_ERRORS.missing_role).not.toBe("");
  });
});
