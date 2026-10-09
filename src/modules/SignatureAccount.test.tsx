// src/modules/SignatureAccount.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getCurrentCertificate: vi.fn(),
    discoverCertificates: vi.fn(), linkCertificate: vi.fn(), unlinkCertificate: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SignatureAccount } from "./SignatureAccount";
import { renderWithProviders } from "../test/campaignFixtures";
import { certificate, signer } from "../test/signatureFixtures";
import { CERTIFICATE_HELP, SIGNATURE_DISABLED, SIMULATED_NOTICE } from "../lib/signature";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const PAPER = "Você continua assinando no papel: as consultas saem para impressão e assinatura à mão.";

afterEach(cleanup);

describe("SignatureAccount", () => {
  let redirect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redirect = vi.fn();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    mocked(api.getCurrentCertificate).mockResolvedValue(certificate());
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
  });

  it("certificado vinculado: prestador, emissor, série e validade, sem aviso longe do vencimento", async () => {
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    const panel = await screen.findByRole("region", { name: "Certificado" });
    expect(await within(panel).findByText("VIDaaS")).not.toBeNull();
    expect(within(panel).getByText("AC VALID RFB v5")).not.toBeNull();
    expect(within(panel).getByText("5A3F09")).not.toBeNull();
    expect(within(panel).getByText("15/03/2027")).not.toBeNull();
    expect(within(panel).queryByRole("status")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Trocar certificado" })).not.toBeNull();
  });

  it("vence em 12 dias: avisa com a data", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValue(
      certificate({ not_after: "2026-10-20T23:59:59-03:00", expires_in_days: 12 }));
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    expect((await screen.findByRole("status")).textContent)
      .toBe("o certificado vence em 12 dias (20/10/2026) — renove no prestador e vincule de novo");
  });

  it("sem certificado: continua no papel, com a orientação, e procura pelo CPF", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    mocked(api.discoverCertificates).mockResolvedValue({
      providers: [ { provider: "vidaas", found: true }, { provider: "birdid", found: false } ], unavailable: [ "safeid" ]
    });
    mocked(api.linkCertificate).mockResolvedValue({ authorize_url: "https://psc.example/authorize?x=1" });
    renderWithProviders(<SignatureAccount redirect={redirect} />);

    expect(await screen.findByText(PAPER)).not.toBeNull();
    expect(screen.getByText(CERTIFICATE_HELP)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Procurar meu certificado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Procurar" }));

    const found = await screen.findByRole("list", { name: "certificados encontrados" });
    expect(screen.getByText("não encontrado em: BirdID")).not.toBeNull();
    expect(screen.getByText("sem resposta: SafeID — procure de novo em alguns minutos")).not.toBeNull();

    fireEvent.click(within(found).getByRole("button", { name: "Vincular VIDaaS" }));
    const confirm = await screen.findByRole("region", { name: "Vincular certificado VIDaaS" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Ir ao prestador" }));

    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://psc.example/authorize?x=1"));
    expect(api.linkCertificate).toHaveBeenCalledWith("vidaas", "/signature");
  });

  it("janela de step-up fechada: pede o código antes de ir ao prestador", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer(undefined, { mfa_verified_at: null }));
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    mocked(api.discoverCertificates).mockResolvedValue({ providers: [ { provider: "vidaas", found: true } ], unavailable: [] });
    mocked(api.linkCertificate).mockResolvedValue({ authorize_url: "https://psc.example/authorize?x=2" });
    renderWithProviders(<SignatureAccount redirect={redirect} />);

    fireEvent.click(await screen.findByRole("button", { name: "Procurar meu certificado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Procurar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Vincular VIDaaS" }));
    const confirm = await screen.findByRole("region", { name: "Vincular certificado VIDaaS" });
    fireEvent.change(within(confirm).getByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Ir ao prestador" }));

    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://psc.example/authorize?x=2"));
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
  });

  it("nenhum certificado encontrado: diz que continua no papel", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    mocked(api.discoverCertificates).mockResolvedValue({
      providers: [ { provider: "vidaas", found: false }, { provider: "birdid", found: false } ], unavailable: []
    });
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: "Procurar meu certificado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Procurar" }));
    expect(await screen.findByText(
      "nenhum certificado em nuvem encontrado para o seu CPF nos prestadores habilitados — você continua no papel")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "certificados encontrados" })).toBeNull();
  });

  it("desvincular pede confirmação com step-up e volta ao papel", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValueOnce(certificate()).mockResolvedValue(null);
    mocked(api.unlinkCertificate).mockResolvedValue(undefined);
    const { client } = renderWithProviders(<SignatureAccount redirect={redirect} />);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(await screen.findByRole("button", { name: "Desvincular" }));
    const confirm = await screen.findByRole("region", { name: "Desvincular certificado" });
    expect(within(confirm).getByText(/Os documentos já assinados continuam válidos/)).not.toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Desvincular" }));

    await waitFor(() => expect(api.unlinkCertificate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(PAPER)).not.toBeNull();
    expect(screen.getByText("certificado desvinculado")).not.toBeNull();
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining([ "signatureCertificate", "signatureSession", "signaturePending" ]));
  });

  it("interruptor desligado entre a sessão e a leitura: diz que a assinatura está desligada", async () => {
    mocked(api.getCurrentCertificate).mockRejectedValue(
      new ApiError(403, { error: "feature_disabled", feature: "digital_signature" }, "403"));
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    expect((await screen.findByRole("alert")).textContent).toBe(SIGNATURE_DISABLED);
  });

  it("sem a funcionalidade na sessão: não chama o api", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer(undefined, { features: [ "clinical_record" ] }));
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(await screen.findByText(SIGNATURE_DISABLED)).not.toBeNull();
    expect(api.getCurrentCertificate).not.toHaveBeenCalled();
  });
  it("PSC simulado ligado na sessão: mostra o aviso", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(
      signer(undefined, { features: [ "clinical_record", "digital_signature", "signature_psc_mock" ] }));
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    await screen.findByRole("region", { name: "Certificado" });
    expect(await screen.findByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("certificado do prestador simulado: mostra o aviso mesmo sem o interruptor", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValue(certificate({ provider: "simulated" }));
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    expect(await screen.findByText("PSC simulado")).not.toBeNull();
    expect(screen.getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("caso normal: sem aviso de simulação", async () => {
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    await screen.findByText("VIDaaS");
    expect(screen.queryByText(SIMULATED_NOTICE)).toBeNull();
  });

  it("descoberta devolve o prestador simulado: o botão diz Vincular PSC simulado", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    mocked(api.discoverCertificates).mockResolvedValue({ providers: [ { provider: "simulated", found: true } ], unavailable: [] });
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: "Procurar meu certificado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Procurar" }));
    expect(await screen.findByRole("button", { name: "Vincular PSC simulado" })).not.toBeNull();
    expect(screen.getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("cadastro sem CPF: a procura diz que a administração resolve", async () => {
    mocked(api.getCurrentCertificate).mockResolvedValue(null);
    mocked(api.discoverCertificates).mockRejectedValue(new ApiError(409, { error: "professional_cpf_missing" }, "409"));
    renderWithProviders(<SignatureAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: "Procurar meu certificado" }));
    fireEvent.click(await screen.findByRole("button", { name: "Procurar" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("seu cadastro está sem CPF — procure a administração da cidade");
  });
});
