// src/modules/campaigns/SendDialog.tsx
import { useRef, useState } from "react";
import { scheduleCampaign, sendCampaign, type Campaign } from "../../lib/api";
import { campaignError, campaignErrorCode, campaignErrorOrNull, validateSendAt } from "../../lib/campaigns";
import { fmtDateTime, fmtNumber } from "../../lib/format";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alertStyle, cardStyle, checkStyle, labelStyle, rowStyle } from "./styles";

// Envio (spec 2026-09-29 §7, D5, D9): primeiro escolhe agora ou agendar (a
// data é validada aqui, antes de gastar um código TOTP), depois confirma com
// step-up no SensitiveAction. `below_minimum` não é erro do diálogo: o
// público encolheu, e a pessoa volta ao editor (onBelowMinimum). O mesmo vale
// para `invalid_audience` (ex.: bairro desativado depois de salvar o
// rascunho): só o editor conserta o público (onInvalidAudience, com a frase).
export interface SendDialogProps {
  campaign: Campaign;
  phrase: string;
  counts: { citizens: number; phones: number };
  smsEnabled: boolean | null;
  onDone(campaign: Campaign): void;
  onBelowMinimum(): void;
  onInvalidAudience(message: string): void;
  onCancel(): void;
  onGoToSecurity(): void;
}

type Stage = { kind: "choose" } | { kind: "now" } | { kind: "schedule"; iso: string };

export function channelsText(smsEnabled: boolean | null): string {
  if (smsEnabled === true) return "aviso no wpda + SMS para quem aceitou receber (o SMS só sai entre 8h e 20h)";
  if (smsEnabled === false) return "aviso no wpda (SMS desligado nesta cidade)";
  return "aviso no wpda (não foi possível consultar o SMS da cidade)";
}

export function SendDialog({
  campaign, phrase, counts, smsEnabled, onDone, onBelowMinimum, onInvalidAudience, onCancel, onGoToSecurity
}: SendDialogProps) {
  const [ stage, setStage ] = useState<Stage>({ kind: "choose" });
  const [ mode, setMode ] = useState<"now" | "schedule">("now");
  const [ when, setWhen ] = useState("");
  const [ whenError, setWhenError ] = useState<string | null>(null);
  // O servidor recusou o instante congelado (invalid_send_at): a pessoa
  // precisa de um caminho de volta à escolha do horário.
  const [ sendAtRefused, setSendAtRefused ] = useState(false);
  const result = useRef<Campaign | null>(null);
  // Recusa que devolve ao editor: "below" (público encolheu) ou a frase do
  // invalid_audience. null = seguiu para onDone.
  const backToEditor = useRef<{ kind: "below" } | { kind: "invalid"; message: string } | null>(null);

  function proceed() {
    if (mode === "now") { setStage({ kind: "now" }); return; }
    const check = validateSendAt(when, new Date());
    if (!check.ok) { setWhenError(check.message); return; }
    setWhenError(null);
    setStage({ kind: "schedule", iso: check.iso });
  }

  const summary = (whenText: string | null) => (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span><strong>Público:</strong> {phrase}</span>
      <span><strong>Contagem:</strong> ≈ {fmtNumber(counts.citizens)} pessoas ({fmtNumber(counts.phones)} telefones)</span>
      <span><strong>Canais:</strong> {channelsText(smsEnabled)}</span>
      {whenText && <span><strong>Quando:</strong> {whenText}</span>}
    </span>
  );

  if (stage.kind !== "choose") {
    const scheduling = stage.kind === "schedule";
    return (
      <>
      <SensitiveAction
        title={scheduling ? "Agendar campanha" : "Enviar campanha"}
        description={summary(stage.kind === "schedule" ? fmtDateTime(stage.iso) : "agora")}
        requiresStepUp
        confirmLabel={scheduling ? "Agendar" : "Enviar agora"}
        run={async () => {
          backToEditor.current = null;
          try {
            result.current = stage.kind === "schedule"
              ? await scheduleCampaign(campaign.id, stage.iso)
              : await sendCampaign(campaign.id);
          } catch (err) {
            const code = campaignErrorCode(err);
            if (code === "below_minimum") { backToEditor.current = { kind: "below" }; return; }
            if (code === "invalid_audience") { backToEditor.current = { kind: "invalid", message: campaignError(err) }; return; }
            if (code === "invalid_send_at") setSendAtRefused(true);
            throw err;
          }
        }}
        onDone={() => {
          const back = backToEditor.current;
          if (back?.kind === "below") onBelowMinimum();
          else if (back?.kind === "invalid") onInvalidAudience(back.message);
          else onDone(result.current as Campaign);
        }}
        onCancel={onCancel}
        onGoToSecurity={onGoToSecurity}
        translateError={campaignErrorOrNull}
      />
      {scheduling && sendAtRefused && (
        <div style={rowStyle}>
          <button type="button" style={secondaryButtonStyle}
            onClick={() => { setSendAtRefused(false); setStage({ kind: "choose" }); }}>
            Mudar horário
          </button>
        </div>
      )}
      </>
    );
  }

  return (
    <section role="dialog" aria-label="Como enviar" style={cardStyle}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <strong>Enviar “{campaign.title}”</strong>
      <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{summary(null)}</div>
      <div role="radiogroup" aria-label="Quando enviar" style={{ display: "flex", gap: 16 }}>
        <label style={checkStyle}>
          <input type="radio" name="campaign-send-mode" checked={mode === "now"} onChange={() => setMode("now")} />
          Enviar agora
        </label>
        <label style={checkStyle}>
          <input type="radio" name="campaign-send-mode" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
          Agendar para
        </label>
      </div>
      {mode === "schedule" && (
        <label style={{ ...labelStyle, maxWidth: 280 }}>
          Data e hora (horário da cidade)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={inputStyle} />
        </label>
      )}
      {whenError && <p role="alert" style={alertStyle}>{whenError}</p>}
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} onClick={proceed}>Continuar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}
