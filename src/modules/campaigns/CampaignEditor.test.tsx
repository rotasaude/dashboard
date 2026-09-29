// src/modules/campaigns/CampaignEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getCampaignOptions: vi.fn(), getCampaign: vi.fn(),
    getSmsSetting: vi.fn(), previewAudience: vi.fn(), createCampaign: vi.fn(), updateCampaign: vi.fn(),
    sendCampaign: vi.fn(), scheduleCampaign: vi.fn(), cancelCampaign: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError, type Audience } from "../../lib/api";
import { CampaignEditor } from "./CampaignEditor";
import { OPTIONS, campaign, renderWithProviders, sessionWith } from "../../test/campaignFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const BOQUEIRAO: Audience = { version: 1, geo: { scope: "neighborhoods", neighborhood_ids: [ "n1" ] }, clinical: { all: [] } };

function renderEditor(campaignId: string | null = null, previewDelayMs = 0) {
  const onBack = vi.fn();
  const onLeftDraft = vi.fn();
  renderWithProviders(<CampaignEditor campaignId={campaignId} onBack={onBack} onLeftDraft={onLeftDraft}
    onGoToSecurity={vi.fn()} previewDelayMs={previewDelayMs} />);
  return { onBack, onLeftDraft };
}

async function fillContent(title = " Vacina da gripe ", body = "Vacinação no sábado, das 8h às 17h.") {
  fireEvent.change(await screen.findByLabelText("Título"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Texto do aviso"), { target: { value: body } });
}

describe("CampaignEditor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-29T10:00:00-03:00"));
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "campaign_manager" ]));
    mocked(api.getCampaignOptions).mockResolvedValue(OPTIONS);
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: false });
    mocked(api.previewAudience).mockResolvedValue({ citizens: 12, phones: 9 });
  });

  it("nova campanha: salva com texto aparado e o público montado; o segundo salvar edita", async () => {
    mocked(api.createCampaign).mockResolvedValue(campaign({ id: "c9", audience: BOQUEIRAO }));
    mocked(api.updateCampaign).mockResolvedValue(campaign({ id: "c9", audience: BOQUEIRAO }));
    renderEditor();
    await fillContent();
    fireEvent.click(screen.getByRole("radio", { name: "Bairros" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Boqueirão" }));

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.createCampaign).toHaveBeenCalledWith({
      title: "Vacina da gripe", body: "Vacinação no sábado, das 8h às 17h.", audience: BOQUEIRAO
    }));
    expect((await screen.findByText("rascunho salvo")).getAttribute("role")).toBe("status");

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(api.updateCampaign).toHaveBeenCalledWith("c9", expect.objectContaining({ title: "Vacina da gripe" })));
    expect(api.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("título ou texto curto: não chama a API", async () => {
    renderEditor();
    await fillContent("ab");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect((await screen.findByText("o título precisa ter de 3 a 120 caracteres")).getAttribute("role")).toBe("alert");
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  it("público incompleto: não salva e diz o que falta", async () => {
    renderEditor();
    await fillContent();
    fireEvent.click(screen.getByRole("radio", { name: "Bairros" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("complete o público antes de salvar: escolha ao menos um bairro")).toBeTruthy();
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  it("rascunho existente: carrega título, texto e cartões", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({
      audience: { ...BOQUEIRAO, clinical: { all: [ { kind: "appointment_no_show", from: "2026-07-01", to: "2026-09-29" } ] } }
    }));
    renderEditor("c1");
    expect(((await screen.findByLabelText("Título")) as HTMLInputElement).value).toBe("Vacinação contra a gripe");
    const card = within(screen.getByRole("region", { name: "Falta em agendamento" }));
    expect((card.getByLabelText("De") as HTMLInputElement).value).toBe("2026-07-01");
    expect((screen.getByRole("checkbox", { name: "Boqueirão" }) as HTMLInputElement).checked).toBe(true);
  });

  it("pré-visualização mostra o texto como texto, com as quebras de linha", async () => {
    renderEditor();
    await fillContent("Aviso", "Atenção: vacina\nsegunda linha");
    const preview = screen.getByRole("article", { name: "Pré-visualização no wpda" });
    expect(preview.textContent).toContain("Atenção: vacina\nsegunda linha");
    expect((preview.querySelector("p") as HTMLElement).style.whiteSpace).toBe("pre-wrap");
  });

  it("HTML no texto: mostra a recusa e não salva", async () => {
    renderEditor();
    await fillContent("Aviso", "<b>Atenção</b>");
    fireEvent.click(screen.getByRole("radio", { name: "Bairros" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Boqueirão" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect((await screen.findByText("não use HTML no título nem no texto")).getAttribute("role")).toBe("alert");
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  it("contador: contagem da API e 'menos de 5'", async () => {
    renderEditor();
    expect(await screen.findByText("≈ 12 pessoas (9 telefones)")).toBeTruthy();
    cleanup();

    mocked(api.previewAudience).mockResolvedValue({ below_minimum: true });
    renderEditor();
    expect(await screen.findByText("menos de 5 — ajuste o público")).toBeTruthy();
  });

  it("linha informativa do SMS da cidade", async () => {
    renderEditor();
    expect(await screen.findByText("SMS nesta cidade: desligado")).toBeTruthy();
  });

  it("recusa not_editable aparece traduzida", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
    mocked(api.updateCampaign).mockRejectedValue(new ApiError(422, { error: "not_editable" }, "422"));
    renderEditor("c1");
    await screen.findByLabelText("Título");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("esta campanha não é mais rascunho — volte à lista e abra de novo")).toBeTruthy();
  });

  it("campanha que não é mais rascunho não abre no editor", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "scheduled" }));
    renderEditor("c1");
    expect(await screen.findByText("esta campanha não é mais rascunho — volte à lista")).toBeTruthy();
    expect(screen.queryByLabelText("Título")).toBeNull();
  });

  describe("enviar", () => {
    const sendButton = () => screen.getByRole("button", { name: "Revisar e enviar…" }) as HTMLButtonElement;

    it("envio travado com menos de 5 telefones", async () => {
      mocked(api.previewAudience).mockResolvedValue({ below_minimum: true });
      renderEditor();
      await screen.findByText("menos de 5 — ajuste o público");
      expect(sendButton().disabled).toBe(true);
    });

    it("envio travado enquanto a contagem não alcançou o público atual", async () => {
      mocked(api.getCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      renderEditor("c1", 200);
      await screen.findByText("≈ 12 pessoas (9 telefones)");
      expect(sendButton().disabled).toBe(false);

      fireEvent.click(screen.getByRole("checkbox", { name: "Xaxim" }));
      expect(sendButton().disabled).toBe(true);
      expect(screen.getByRole("status", { name: "Contagem do público" }).textContent).toBe("calculando…");
      await waitFor(() => expect(sendButton().disabled).toBe(false));
    });

    it("revisar e enviar: salva antes, abre o diálogo com a frase e sai do rascunho", async () => {
      mocked(api.getCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      mocked(api.updateCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      const sent = campaign({ audience: BOQUEIRAO, status: "sending" });
      mocked(api.sendCampaign).mockResolvedValue(sent);
      const { onLeftDraft } = renderEditor("c1");
      await screen.findByText("≈ 12 pessoas (9 telefones)");

      fireEvent.click(sendButton());
      await waitFor(() => expect(api.updateCampaign).toHaveBeenCalled());
      const dialog = await screen.findByRole("dialog", { name: "Como enviar" });
      expect(dialog.textContent).toContain("moradores de Boqueirão");
      fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
      fireEvent.click(await screen.findByRole("button", { name: "Enviar agora" }));

      await waitFor(() => expect(onLeftDraft).toHaveBeenCalledWith(sent));
    });

    it("below_minimum no envio: volta ao editor com a mensagem e recalcula", async () => {
      mocked(api.getCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      mocked(api.updateCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      mocked(api.previewAudience).mockResolvedValueOnce({ citizens: 12, phones: 9 }).mockResolvedValue({ below_minimum: true });
      mocked(api.sendCampaign).mockRejectedValue(new ApiError(422, { error: "below_minimum" }, "422"));
      const { onLeftDraft } = renderEditor("c1");
      await screen.findByText("≈ 12 pessoas (9 telefones)");

      fireEvent.click(sendButton());
      fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
      fireEvent.click(await screen.findByRole("button", { name: "Enviar agora" }));

      expect(await screen.findByText("o público ficou com menos de 5 telefones desde a contagem — ajuste o público")).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Enviar campanha" })).toBeNull();
      expect(await screen.findByText("menos de 5 — ajuste o público")).toBeTruthy();
      expect(onLeftDraft).not.toHaveBeenCalled();
    });

    it("invalid_audience no envio (bairro desativado): volta ao editor com a mensagem traduzida", async () => {
      mocked(api.getCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      mocked(api.updateCampaign).mockResolvedValue(campaign({ audience: BOQUEIRAO }));
      mocked(api.sendCampaign).mockRejectedValue(new ApiError(422, {
        error: "invalid_audience", details: [ { path: "/geo/neighborhood_ids/0", message: "inactive_or_unknown" } ]
      }, "422"));
      const { onLeftDraft } = renderEditor("c1");
      await screen.findByText("≈ 12 pessoas (9 telefones)");

      fireEvent.click(sendButton());
      fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
      fireEvent.click(await screen.findByRole("button", { name: "Enviar agora" }));

      const message = await screen.findByText("há bairro ou unidade inativa no recorte — desmarque ou troque");
      expect(message.getAttribute("role")).toBe("alert");
      expect(screen.queryByRole("region", { name: "Enviar campanha" })).toBeNull();
      expect(screen.queryByRole("dialog", { name: "Como enviar" })).toBeNull();
      expect(onLeftDraft).not.toHaveBeenCalled();
    });
  });

  it("voltar à lista", async () => {
    const { onBack } = renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Voltar à lista" }));
    expect(onBack).toHaveBeenCalled();
  });
});
