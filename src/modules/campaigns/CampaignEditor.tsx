// src/modules/campaigns/CampaignEditor.tsx
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCampaign, getCampaign, getCampaignOptions, getSmsSetting, updateCampaign, type Campaign, type CampaignOptions
} from "../../lib/api";
import {
  BODY_MAX, CAMPAIGNS_KEY, CAMPAIGN_OPTIONS_KEY, PREVIEW_DEBOUNCE_MS, PREVIEW_KEY, SMS_SETTING_KEY, TITLE_MAX, audienceProblem,
  buildAudience, campaignError, campaignKey, draftFromAudience, emptyAudienceDraft, isEditable, todayInCity,
  validateCampaignFields, type AudienceDraft
} from "../../lib/campaigns";
import { Panel } from "../../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { AudienceBuilder } from "./AudienceBuilder";
import { AudienceCounter, previewAllowsSend } from "./AudienceCounter";
import { describeAudience } from "../../lib/audiencePhrase";
import { CampaignLifecycleDialog } from "./CampaignLifecycleDialog";
import { SendDialog } from "./SendDialog";
import { useAudiencePreview } from "./useAudiencePreview";
import { alertStyle, columnStyle, labelStyle, noteStyle, rowStyle } from "./styles";

// Editor de rascunho (spec 2026-09-29 §7). Só `draft` é editável: outro
// status mostra a recusa e manda de volta à lista. O público inválido não
// salva — o schema do api recusaria (422 invalid_audience).
export interface CampaignEditorProps {
  campaignId: string | null;
  onBack(): void;
  onLeftDraft(campaign: Campaign): void;
  onGoToSecurity(): void;
  previewDelayMs?: number;
}

export function CampaignEditor(props: CampaignEditorProps) {
  const { campaignId, onBack } = props;
  const options = useQuery({ queryKey: CAMPAIGN_OPTIONS_KEY, queryFn: getCampaignOptions });
  const existing = useQuery({
    queryKey: campaignKey(campaignId ?? "new"),
    queryFn: () => getCampaign(campaignId as string),
    enabled: campaignId !== null
  });
  const back = <button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar à lista</button>;

  if (options.isError) return <Panel title="Campanha" right={back}><p role="alert" style={alertStyle}>{campaignError(options.error)}</p></Panel>;
  if (existing.isError) return <Panel title="Campanha" right={back}><p role="alert" style={alertStyle}>{campaignError(existing.error)}</p></Panel>;
  if (options.isPending || (campaignId !== null && existing.isPending)) {
    return <Panel title="Campanha" right={back}><p className="mono" style={noteStyle}>carregando…</p></Panel>;
  }
  const initial = campaignId === null ? null : existing.data ?? null;
  if (initial && !isEditable(initial.status)) {
    return <Panel title="Campanha" right={back}><p role="alert" style={alertStyle}>esta campanha não é mais rascunho — volte à lista</p></Panel>;
  }
  return <EditorForm {...props} initial={initial} options={options.data} />;
}

function EditorForm({ initial, options, onBack, onLeftDraft, onGoToSecurity, previewDelayMs = PREVIEW_DEBOUNCE_MS }: CampaignEditorProps & {
  initial: Campaign | null; options: CampaignOptions;
}) {
  const queryClient = useQueryClient();
  const sms = useQuery({ queryKey: SMS_SETTING_KEY, queryFn: getSmsSetting });
  const [ id, setId ] = useState<string | null>(initial?.id ?? null);
  const [ title, setTitle ] = useState(initial?.title ?? "");
  const [ body, setBody ] = useState(initial?.body ?? "");
  const [ draft, setDraft ] = useState<AudienceDraft>(() => (initial ? draftFromAudience(initial.audience) : emptyAudienceDraft()));
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  // A contagem é congelada ao abrir o diálogo: o que a pessoa confirma é o
  // número que ela viu, mesmo que o público mude atrás do modal.
  const [ reviewing, setReviewing ] = useState<{ campaign: Campaign; counts: { citizens: number; phones: number } } | null>(null);

  const [ cancelling, setCancelling ] = useState(false);

  const today = todayInCity();
  const problem = audienceProblem(draft, today);
  const audience = problem ? null : buildAudience(draft);
  const preview = useAudiencePreview(audience, previewDelayMs);

  function fail(message: string) {
    setError(message);
    setNotice(null);
  }

  async function save(): Promise<Campaign | null> {
    if (busy) return null;
    const invalid = validateCampaignFields(title, body);
    if (invalid) { fail(invalid); return null; }
    if (!audience) { fail(`complete o público antes de salvar: ${problem}`); return null; }
    const fields = { title: title.trim(), body: body.trim(), audience };
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = id ? await updateCampaign(id, fields) : await createCampaign(fields);
      setId(saved.id);
      queryClient.setQueryData(campaignKey(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
      setNotice("rascunho salvo");
      return saved;
    } catch (err) {
      fail(campaignError(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    if (!previewAllowsSend(preview)) return;
    setCancelling(false);
    const counts = { citizens: preview.citizens, phones: preview.phones };
    const saved = await save();
    if (saved) { setCancelling(false); setReviewing({ campaign: saved, counts }); }
  }

  function leftDraft(c: Campaign) {
    setReviewing(null);
    queryClient.setQueryData(campaignKey(c.id), c);
    void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
    onLeftDraft(c);
  }

  function belowMinimum() {
    setReviewing(null);
    fail("o público ficou com menos de 5 telefones desde a contagem — ajuste o público");
    void queryClient.invalidateQueries({ queryKey: PREVIEW_KEY });
  }

  // invalid_audience no envio (R-P10a): ex.: bairro desativado depois do
  // rascunho salvo. Como no below_minimum, só o editor conserta o público.
  function invalidAudience(message: string) {
    setReviewing(null);
    fail(message);
    void queryClient.invalidateQueries({ queryKey: PREVIEW_KEY });
  }

  const canSend = previewAllowsSend(preview) && !busy;

  const smsLine = sms.data
    ? `SMS nesta cidade: ${sms.data.enabled ? "ligado" : "desligado"}`
    : sms.isError ? "SMS nesta cidade: não foi possível consultar" : "SMS nesta cidade: consultando…";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title={id ? "Editar campanha" : "Nova campanha"} sub="rascunho"
        right={<button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar à lista</button>}>
        <div style={columnStyle}>
          {error && <p role="alert" style={alertStyle}>{error}</p>}
          {notice && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{notice}</p>}
          <label style={labelStyle}>
            Título
            <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </label>
          <span className="mono" style={noteStyle}>{title.trim().length}/{TITLE_MAX}</span>
          <label style={labelStyle}>
            Texto do aviso
            <textarea value={body} rows={8} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
          </label>
          <span className="mono" style={noteStyle}>{body.trim().length}/{BODY_MAX} · texto simples; as quebras de linha ficam</span>
        </div>
      </Panel>

      <Panel title="Como aparece no wpda" sub="pré-visualização">
        <article aria-label="Pré-visualização no wpda" style={wpdaPreviewStyle}>
          <h3 style={{ margin: 0, fontSize: 20 }}>{title.trim() || "Título do aviso"}</h3>
          <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{body || "O texto do aviso aparece aqui."}</p>
        </article>
      </Panel>

      <Panel title="Público" sub="recorte · critérios clínicos">
        <div style={columnStyle}>
          <AudienceBuilder draft={draft} options={options} today={today} onChange={setDraft} />
          <AudienceCounter state={preview} problem={problem} />
          <p style={noteStyle}>{smsLine}</p>
        </div>
      </Panel>

      {reviewing && (
        <SendDialog
          key={reviewing.campaign.id}
          campaign={reviewing.campaign}
          phrase={describeAudience(reviewing.campaign.audience, options)}
          counts={reviewing.counts}
          smsEnabled={sms.data?.enabled ?? null}
          onDone={leftDraft}
          onBelowMinimum={belowMinimum}
          onInvalidAudience={invalidAudience}
          onCancel={() => setReviewing(null)}
          onGoToSecurity={onGoToSecurity}
        />
      )}

      {cancelling && id && (
        <CampaignLifecycleDialog
          campaign={{ id, title: title.trim() || initial?.title || "" }}
          action="cancel"
          onDone={(c) => { setCancelling(false); leftDraft(c); }}
          onCancel={() => setCancelling(false)}
          onGoToSecurity={onGoToSecurity}
        />
      )}

      <div style={rowStyle}>
        <button type="button" disabled={busy} onClick={() => void save()} style={busy ? disabledButtonStyle : secondaryButtonStyle}>
          Salvar rascunho
        </button>
        <button type="button" disabled={!canSend} onClick={() => void review()} style={canSend ? buttonStyle : disabledButtonStyle}>
          Revisar e enviar…
        </button>
        {id && (
          <button type="button" disabled={busy} style={secondaryButtonStyle}
            onClick={() => { setReviewing(null); setCancelling(true); }}>
            Cancelar campanha…
          </button>
        )}
        {!canSend && !busy && <span style={noteStyle}>o envio libera quando a contagem mostrar pelo menos 5 telefones</span>}
      </div>
    </div>
  );
}

// Espelha as regras da casa do wpda: texto ≥ 18px.
const wpdaPreviewStyle: CSSProperties = {
  maxWidth: 420, padding: 16, fontSize: 18, lineHeight: 1.5,
  border: "1px solid var(--rule)", borderRadius: 12, background: "var(--sunken)"
};
