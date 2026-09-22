import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { useStepUp } from "../lib/useStepUp";
import { describeActionError } from "../lib/actionErrors";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "./formStyles";

// Confirmação de ação sensível (spec do dashboard §5.1/§6, abordagem 1): o
// único lugar que conhece step-up, repetição e tradução de erro. As telas só
// dizem QUAL ação rodar (`run`) e com quais campos.
//
// O código TOTP vive só em estado local e é limpo antes de cada chamada.
// `mfa_required` vindo da ação (a janela fechou entre a leitura e o clique)
// pede um código novo e repete a ação uma vez; a segunda vez para.
export interface SensitiveField { name: string; label: string; required?: boolean; }

export interface SensitiveActionProps {
  title: string;
  description?: ReactNode;
  requiresStepUp: boolean;
  fields?: SensitiveField[];
  confirmLabel?: string;
  run(values: Record<string, string>): Promise<void>;
  onDone(): void;
  onCancel(): void;
  onGoToSecurity?(): void;
}

const EXPIRED = "sua verificação expirou — informe um novo código";
const GAVE_UP = "a verificação não foi aceita — recarregue a página e tente de novo";

export function SensitiveAction({
  title, description, requiresStepUp, fields = [], confirmLabel = "Confirmar",
  run, onDone, onCancel, onGoToSecurity
}: SensitiveActionProps) {
  const auth = useAuth();
  const { window, stepUp } = useStepUp();
  const [ values, setValues ] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [ f.name, "" ])));
  const [ code, setCode ] = useState("");
  const [ forceCode, setForceCode ] = useState(false);
  const [ retried, setRetried ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ codeError, setCodeError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ fieldError, setFieldError ] = useState<string | null>(null);

  const showCode = requiresStepUp && (forceCode || !window.open);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null); setCodeError(null); setFieldError(null); setNotice(null);

    const missing = fields.find((f) => f.required && !values[f.name]?.trim());
    if (missing) { setFieldError(`preencha: ${missing.label}`); return; }
    const typed = code;
    if (showCode && !typed.trim()) { setCodeError("informe o código do autenticador"); return; }

    setCode("");
    setBusy(true);
    try {
      if (showCode) await stepUp(typed);
      await run(values);
      onDone();
    } catch (err) {
      const described = describeActionError(err);
      if (described.kind === "mfa_required") {
        if (retried) {
          setError(GAVE_UP);
        } else {
          setRetried(true);
          setForceCode(true);
          setNotice(EXPIRED);
        }
      } else if (described.kind === "invalid_code") {
        setCodeError(described.message);
      } else {
        setError(described.message);
        if (described.kind === "session_expired") void auth.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  if (requiresStepUp && !window.enrolled) {
    return (
      <section aria-label={title} style={panel}>
        <strong>{title}</strong>
        <p style={text}>Esta ação exige um autenticador cadastrado.</p>
        <div style={row}>
          {onGoToSecurity && <button type="button" onClick={onGoToSecurity} style={buttonStyle}>cadastre seu autenticador</button>}
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={title} style={panel}>
      <strong>{title}</strong>
      {description && <div style={text}>{description}</div>}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {error && <p role="alert" style={alert}>{error}</p>}
        {fields.map((f) => (
          <label key={f.name} style={label}>
            {f.label}
            <input
              value={values[f.name] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
              style={inputStyle}
            />
          </label>
        ))}
        {fieldError && <p role="alert" style={alert}>{fieldError}</p>}
        {requiresStepUp && !showCode && (
          <p style={text}>verificação válida por mais {Math.ceil(window.remainingMs / 60_000)} min</p>
        )}
        {showCode && (
          <>
            {notice && <p style={text}>{notice}</p>}
            <label style={label}>
              Código do autenticador
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                style={inputStyle}
              />
            </label>
            {codeError && <p role="alert" style={alert}>{codeError}</p>}
          </>
        )}
        <div style={row}>
          <button type="submit" disabled={busy} style={buttonStyle}>{confirmLabel}</button>
          <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
        </div>
      </form>
    </section>
  );
}

const panel = { display: "flex", flexDirection: "column" as const, gap: 10, padding: 16,
  border: "1px solid var(--rule)", borderRadius: 8, background: "var(--panel)" };
const row = { display: "flex", gap: 8 };
const text = { margin: 0, fontSize: 12.5, color: "var(--ink2)" };
const label = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
const alert = { margin: 0, fontSize: 12, color: "var(--down)" };
