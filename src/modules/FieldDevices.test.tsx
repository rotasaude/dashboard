import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("qrcode", () => ({ toDataURL: vi.fn(async () => "data:image/png;base64,QR") }));
vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getHomeVisitContext: vi.fn(), listFieldDevices: vi.fn(), registerFieldDevice: vi.fn(), revokeFieldDevice: vi.fn() };
});

import { toDataURL } from "qrcode";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { DEVICE_NOT_REPLACEABLE, HOME_VISIT_ERRORS } from "../lib/homeVisits";
import { REPLACE_NOTICE, REREGISTER_NOTICE } from "../lib/fieldDevices";
import { renderWithProviders } from "../test/campaignFixtures";
import { context, device, hvUser, nurseTeam } from "../test/homeVisitFixtures";
import { FieldDevices } from "./FieldDevices";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const OFF = "o cadastro de aparelho está desligado nesta cidade";
const PAYLOAD = "rotasaude-field:v1:eyJ0b2tlbiI6InJzZl9TRUdSRURPIn0";
afterEach(cleanup);
beforeEach(() => {
  for (const f of [ api.fetchCurrentSession, api.getHomeVisitContext, api.listFieldDevices, api.registerFieldDevice, api.revokeFieldDevice, toDataURL ]) mocked(f).mockClear();
  for (const f of [ api.fetchCurrentSession, api.getHomeVisitContext, api.listFieldDevices, api.registerFieldDevice, api.revokeFieldDevice ]) mocked(f).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(hvUser());
  mocked(api.getHomeVisitContext).mockResolvedValue(context());
  mocked(api.listFieldDevices).mockResolvedValue([]);
});
const mount = () => renderWithProviders(<FieldDevices />);
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

describe("Aparelhos de campo", () => {
  it("cadastrar: step-up, QR uma vez, sem o texto do token; fechar apaga; nada no cache", async () => {
    mocked(api.registerFieldDevice).mockResolvedValue({ device: device(), token: "rsf_SEGREDO", qr_payload: PAYLOAD });
    const { client, container } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar aparelho" }));
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "Celular da Joana" } });
    confirm();
    const img = await screen.findByAltText("QR do aparelho de campo");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,QR");
    expect(toDataURL).toHaveBeenCalledWith(PAYLOAD);
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText(/Leia o QR agora no app de campo/)).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/rsf_SEGREDO/);
    expect(container.innerHTML + document.body.innerHTML).not.toMatch(/rsf_SEGREDO|rotasaude-field/);
    const cached = client.getQueryCache().getAll();
    expect(cached.length).toBeGreaterThan(0);
    expect(JSON.stringify(cached.map((q) => [ q.queryKey, q.state.data ]))).not.toMatch(/rsf_|rotasaude-field/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByAltText("QR do aparelho de campo")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toMatch(/rsf_|rotasaude-field/);
    expect(api.registerFieldDevice).toHaveBeenCalledWith("Celular da Joana");
    expect(api.registerFieldDevice).toHaveBeenCalledTimes(1);
  });

  it("nome vazio ou acima de 60 não sai; device_limit tem frase", async () => {
    mocked(api.listFieldDevices).mockResolvedValue([ device(), device({ id: "fd2" }), device({ id: "fd3" }) ]);
    mocked(api.registerFieldDevice).mockRejectedValue(new ApiError(422, { error: "device_limit" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar aparelho" }));
    confirm();
    expect(api.registerFieldDevice).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "x".repeat(61) } });
    confirm();
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.registerFieldDevice).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "Tablet" } });
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.device_limit)).not.toBeNull();
    expect(api.registerFieldDevice).toHaveBeenCalledWith("Tablet");
  });

  it.each([ [ "Escape" ], [ "Fechar" ] ])("fechar o QR (%s) devolve o foco ao botão Cadastrar aparelho", async (how) => {
    mocked(api.registerFieldDevice).mockResolvedValue({ device: device(), token: "rsf_SEGREDO", qr_payload: PAYLOAD });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar aparelho" }));
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "Celular da Joana" } });
    confirm();
    await screen.findByAltText("QR do aparelho de campo");
    if (how === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const button = screen.getByRole("button", { name: "Cadastrar aparelho" });
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("revogar o próprio: confirma, sem step-up; revogado mostra o motivo", async () => {
    mocked(api.listFieldDevices).mockResolvedValueOnce([
      device(), device({ id: "fd2", name: "Antigo", status: "revoked", revoked_at: "2026-11-01T08:00:00-03:00", revoked_reason: "membership_ended" }),
      device({ id: "fd3", name: "Tablet velho", status: "inactive" })
    ]);
    mocked(api.revokeFieldDevice).mockResolvedValue(device({ status: "revoked", revoked_at: "2026-11-12T10:00:00-03:00", revoked_reason: "user" }));
    mount();
    expect(await screen.findByText("revogado automaticamente: cadastre de novo")).not.toBeNull();
    expect(screen.getByText("suspenso enquanto sem vínculo")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revogar Celular da Joana" }));
    expect(screen.queryByLabelText("Código do autenticador")).toBeNull();
    confirm();
    await waitFor(() => expect(api.revokeFieldDevice).toHaveBeenCalledWith("fd1"));
    await waitFor(() => expect(api.listFieldDevices).toHaveBeenCalledTimes(2));
  });

  it("409 device_already_revoked: frase e uma releitura", async () => {
    mocked(api.listFieldDevices).mockResolvedValue([ device() ]);
    mocked(api.revokeFieldDevice).mockRejectedValue(new ApiError(409, { error: "device_already_revoked" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar Celular da Joana" }));
    confirm();
    expect(await screen.findByText(HOME_VISIT_ERRORS.device_already_revoked)).not.toBeNull();
    await waitFor(() => expect(api.listFieldDevices).toHaveBeenCalledTimes(2));
  });

  it("enfermeiro: frase, sem botão de cadastrar", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mount();
    expect(await screen.findByText("só agentes de campo da Tabela 7 cadastram aparelho")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar aparelho" })).toBeNull();
  });

  it("home_visits desligado: lista e revoga, não chama o contexto, sem cadastrar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(hvUser([ "health_professional" ], []));
    mocked(api.listFieldDevices).mockResolvedValue([ device() ]);
    mocked(api.revokeFieldDevice).mockResolvedValue(device({ status: "revoked", revoked_reason: "user" }));
    mount();
    expect(await screen.findByText("Celular da Joana")).not.toBeNull();
    expect(screen.getByText(OFF)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar aparelho" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revogar Celular da Joana" }));
    confirm();
    await waitFor(() => expect(api.revokeFieldDevice).toHaveBeenCalledWith("fd1"));
    expect(api.getHomeVisitContext).not.toHaveBeenCalled();
  });

  it("403 feature_disabled do contexto cai no mesmo estado", async () => {
    mocked(api.getHomeVisitContext).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "home_visits" }, "x"));
    mocked(api.listFieldDevices).mockResolvedValue([ device() ]);
    mount();
    expect(await screen.findByText(OFF)).not.toBeNull();
    expect(screen.getByText("Celular da Joana")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar aparelho" })).toBeNull();
  });

  it("403 feature_disabled do POST cai no mesmo estado", async () => {
    mocked(api.registerFieldDevice).mockRejectedValue(new ApiError(403, { error: "feature_disabled", feature: "home_visits" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar aparelho" }));
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "Tablet" } });
    confirm();
    expect(await screen.findByText(OFF)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar aparelho" })).toBeNull();
  });

  it("substituir: step-up, manda replaces_device_id, QR uma vez, vale com 3 aparelhos", async () => {
    mocked(api.listFieldDevices).mockResolvedValue([ device(), device({ id: "fd2", name: "Tablet 2" }), device({ id: "fd3", name: "Tablet 3" }) ]);
    mocked(api.registerFieldDevice).mockResolvedValue({ device: device({ id: "fd4", name: "Tablet novo" }), token: "rsf_SEGREDO", qr_payload: PAYLOAD });
    const { client, container } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Substituir Celular da Joana" }));
    expect(screen.getByText(REPLACE_NOTICE)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "Tablet novo" } });
    confirm();
    expect(await screen.findByAltText("QR do aparelho de campo")).not.toBeNull();
    expect(api.registerFieldDevice).toHaveBeenCalledWith("Tablet novo", "fd1");
    expect(api.registerFieldDevice).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/rsf_SEGREDO/);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toMatch(/rsf_|rotasaude-field/);
  });

  it("revogar mostra o aviso com a data do último uso (e 'nunca usado')", async () => {
    mocked(api.listFieldDevices).mockResolvedValue([
      device({ last_used_at: "2026-11-12T10:00:00-03:00" }), device({ id: "fd2", name: "Tablet 2", last_used_at: null })
    ]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar Celular da Joana" }));
    expect(screen.getByText(/O que não foi sincronizado neste aparelho será perdido\. Último uso: 12\/11\/2026/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Revogar Tablet 2" }));
    expect(screen.getByText(/será perdido\. Último uso: nunca usado\./)).not.toBeNull();
    expect(api.revokeFieldDevice).not.toHaveBeenCalled();
  });

  it("Substituir só em ativo; revogado automaticamente oferece Cadastrar novo, sem replaces_device_id", async () => {
    mocked(api.listFieldDevices).mockResolvedValue([
      device({ status: "inactive" }),
      device({ id: "fd2", name: "Tablet da UBS", status: "revoked", revoked_reason: "membership_ended" }),
      device({ id: "fd3", name: "Antigo", status: "revoked", revoked_reason: "replaced" })
    ]);
    mocked(api.registerFieldDevice).mockResolvedValue({ device: device({ id: "fd9", name: "Tablet da UBS" }), token: "rsf_SEGREDO", qr_payload: PAYLOAD });
    mount();
    expect(await screen.findByText("suspenso enquanto sem vínculo")).not.toBeNull();
    expect(screen.getByText("revogado automaticamente: cadastre de novo")).not.toBeNull();
    expect(screen.getByText("revogado: substituído por outro aparelho")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Substituir / })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Cadastrar novo / })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cadastrar novo Tablet da UBS" }));
    expect(screen.getByText(REREGISTER_NOTICE)).not.toBeNull();
    expect((screen.getByLabelText("Nome do aparelho") as HTMLInputElement).value).toBe("Tablet da UBS");
    confirm();
    expect(await screen.findByAltText("QR do aparelho de campo")).not.toBeNull();
    expect(api.registerFieldDevice).toHaveBeenCalledWith("Tablet da UBS");
  });

  it("422 replaces_device_id: frase e lista relida", async () => {
    mocked(api.listFieldDevices).mockResolvedValue([ device() ]);
    mocked(api.registerFieldDevice).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "replaces_device_id" }, "x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Substituir Celular da Joana" }));
    fireEvent.change(screen.getByLabelText("Nome do aparelho"), { target: { value: "Tablet novo" } });
    confirm();
    expect(await screen.findByText(DEVICE_NOT_REPLACEABLE)).not.toBeNull();
    await waitFor(() => expect(api.listFieldDevices).toHaveBeenCalledTimes(2));
    expect(screen.queryByAltText("QR do aparelho de campo")).toBeNull();
  });

  it("sem poder cadastrar (enfermeiro ou interruptor desligado): nem Substituir nem Cadastrar novo; Revogar segue", async () => {
    mocked(api.getHomeVisitContext).mockResolvedValue(context({ teams: [ nurseTeam() ] }));
    mocked(api.listFieldDevices).mockResolvedValue([ device(), device({ id: "fd2", name: "Tablet da UBS", status: "revoked", revoked_reason: "user_disabled" }) ]);
    mount();
    expect(await screen.findByRole("button", { name: "Revogar Celular da Joana" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Substituir / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cadastrar novo / })).toBeNull();
  });
});
