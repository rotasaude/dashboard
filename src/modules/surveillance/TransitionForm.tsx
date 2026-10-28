// src/modules/surveillance/TransitionForm.tsx
// O andamento da notificação (módulo 25; F-25.5): um botão por passo seguinte
// (NEXT[status]); o passo escolhido mostra só o que ele pede. "Descartar
// possível" é o único caminho para dismissed e vai por /dismiss, com motivo
// obrigatório (o api recusa to: "dismissed" em /transition).
// 409 stale_version: a frase explica, o que foi digitado fica na tela, nada é
// reenviado sozinho e "Recarregar" só relê o detalhe. O erro nunca repete o
// que foi digitado (classificação, número, motivo).
import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  dismissNotification, transitionNotification,
  type NotificationClassification, type NotificationStatus, type SurveillanceNotification, type TransitionInput
} from "../../lib/api";
import {
  CLASSIFICATIONS, NEXT, NOTIFICATIONS_KEY, NOTIFICATION_KEY, SURVEILLANCE_COUNT_KEY,
  isStale, officialNumberProblem, reasonProblem, surveillanceError, transitionLabel
} from "../../lib/surveillance";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, okText, row } from "../exams/styles";

export const CLASSIFICATION_PROBLEM = "escolha a classificação final para encerrar";
const REASON_MAX = 500;
const REASON_TOO_LONG = "motivo com mais de 500 caracteres";
const DONE_TEXT = "Andamento registrado.";

type Mode = NotificationStatus | "dismiss";
interface Props {
  notification: SurveillanceNotification;
  onDone(n: SurveillanceNotification): void;
  // Relê o detalhe (o botão "Recarregar" da frase de versão antiga).
  onReload?(): void;
}

export function TransitionForm({ notification, onDone, onReload }: Props) {
  const client = useQueryClient();
  const [ mode, setMode ] = useState<Mode | null>(null);
  const [ classification, setClassification ] = useState("");
  const [ officialNumber, setOfficialNumber ] = useState("");
  const [ reason, setReason ] = useState("");
  const [ dismissReason, setDismissReason ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ done, setDone ] = useState(false);

  // Uma versão nova (recarregada) tira a frase de versão antiga; o digitado fica.
  useEffect(() => { setStale(false); setError(null); }, [ notification.version ]);

  // Situação desconhecida do api: nenhum passo (nada some, nada é inventado).
  const steps = NEXT[notification.status] ?? [];
  const canDismiss = notification.status === "possible";
  const chosen: Mode | null = mode && (mode === "dismiss" ? canDismiss : steps.includes(mode)) ? mode : null;

  function choose(next: Mode | null) {
    setMode(next); setError(null); setStale(false); setDone(false);
  }

  function problem(): string | null {
    if (chosen === "dismiss") return reasonProblem(dismissReason, true);
    if (chosen === "closed" && !CLASSIFICATIONS.some((c) => c.key === classification)) return CLASSIFICATION_PROBLEM;
    // Recusar, nunca cortar: espaço nas pontas ou no meio é recusado e nada é enviado.
    if (chosen === "entered") {
      const p = officialNumberProblem(officialNumber);
      if (p) return p;
    }
    // O motivo opcional só tem o teto de 500 (o api não pede mínimo); o do descarte segue 3 a 500.
    return [ ...reason.trim() ].length > REASON_MAX ? REASON_TOO_LONG : null;
  }

  function body(to: NotificationStatus): TransitionInput {
    const input: TransitionInput = { to, version: notification.version };
    if (to === "closed") input.classification = classification as NotificationClassification;
    if (to === "entered") input.official_number = officialNumber;
    if (reason.trim()) input.reason = reason.trim();
    return input;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || busy) return;
    const invalid = problem();
    setDone(false); setStale(false);
    if (invalid) { setError(invalid); return; }
    setError(null); setBusy(true);
    try {
      const saved = chosen === "dismiss"
        ? await dismissNotification(notification.id, dismissReason.trim(), notification.version)
        : await transitionNotification(notification.id, body(chosen));
      client.setQueryData([ NOTIFICATION_KEY, notification.id ], saved);
      void client.invalidateQueries({ queryKey: [ NOTIFICATIONS_KEY ] });
      void client.invalidateQueries({ queryKey: [ SURVEILLANCE_COUNT_KEY ] });
      setMode(null); setClassification(""); setOfficialNumber(""); setReason(""); setDismissReason("");
      setDone(true);
      onDone(saved);
    } catch (err) {
      setStale(isStale(err));
      setError(surveillanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      {(steps.length > 0 || canDismiss) && (
        <div style={row} role="group" aria-label="Próximo passo">
          {steps.map((to) => (
            <button key={to} type="button" aria-pressed={chosen === to} style={chosen === to ? buttonStyle : secondaryButtonStyle}
              onClick={() => choose(to)}>{transitionLabel(to)}</button>
          ))}
          {canDismiss && (
            <button type="button" aria-pressed={chosen === "dismiss"} style={chosen === "dismiss" ? buttonStyle : secondaryButtonStyle}
              onClick={() => choose("dismiss")}>Descartar possível</button>
          )}
        </div>
      )}
      {chosen && (
        <form onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          {chosen === "closed" && (
            <label style={fieldLabel}>
              Classificação final
              <select value={classification} style={inputStyle} onChange={(e) => setClassification(e.target.value)}>
                <option value="">Escolha…</option>
                {CLASSIFICATIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          )}
          {chosen === "entered" && (
            <label style={fieldLabel}>
              Número da notificação no sistema oficial
              <input value={officialNumber} maxLength={60} style={inputStyle} autoComplete="off" onChange={(e) => setOfficialNumber(e.target.value)} />
            </label>
          )}
          {chosen === "dismiss" ? (
            <label style={fieldLabel}>
              Motivo do descarte
              <textarea value={dismissReason} rows={3} style={inputStyle} onChange={(e) => setDismissReason(e.target.value)} />
            </label>
          ) : (
            <label style={fieldLabel}>
              Motivo (opcional)
              <textarea value={reason} rows={2} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          <div style={row}>
            <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>
              {chosen === "dismiss" ? "Confirmar descarte" : "Confirmar"}
            </button>
            <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={() => choose(null)}>Cancelar</button>
          </div>
        </form>
      )}
      {error && (
        <div style={row}>
          <p role="alert" style={alert}>{error}</p>
          {stale && onReload && <button type="button" style={secondaryButtonStyle} onClick={onReload}>Recarregar</button>}
        </div>
      )}
      {done && !error && <p role="status" style={okText}>{DONE_TEXT}</p>}
    </div>
  );
}
