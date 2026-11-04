// Peças comuns dos formulários da frota (veículo, motorista, destino): campo com recusa por campo (aria-invalid + aria-describedby),
// moldura do formulário com foco no primeiro campo ao abrir e roteamento das recusas do api para o campo certo.
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { Refusal } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, form, muted, row } from "../exams/styles";

export type FieldErrors = Record<string, string>;

// 409 sem `path` (placa, RENAVAM, IBGE repetidos) cai no campo pelo código; o que não tem campo vira o aviso geral.
export function routeRefusals(refusals: Refusal[], fields: readonly string[], codeField: Record<string, string> = {}): { fields: FieldErrors; general: string | null } {
  const out: FieldErrors = {};
  const general: string[] = [];
  for (const r of refusals) {
    const field = r.path !== "" ? r.path : codeField[r.code] ?? "";
    if (fields.includes(field) && out[field] === undefined) out[field] = r.text;
    else if (!general.includes(r.text)) general.push(r.text);
  }
  return { fields: out, general: general.length > 0 ? general.join("; ") : null };
}

export function problemsToErrors(problems: { path: string; text: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const p of problems) if (out[p.path] === undefined) out[p.path] = p.text;
  return out;
}

function Err({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} role="alert" style={{ ...alert, margin: 0 }}>{text}</p> : null;
}

interface FieldProps { id: string; label: string; error?: string; hint?: string }

export function TextField({ id, label, value, onChange, error, hint, type = "text", inputMode, autoComplete }: FieldProps & {
  value: string; onChange(v: string): void; type?: string; inputMode?: "numeric" | "text"; autoComplete?: string;
}) {
  const describedBy = [ hint ? `${id}-hint` : "", error ? `${id}-err` : "" ].filter(Boolean).join(" ") || undefined;
  return (
    <div style={fieldLabel}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} inputMode={inputMode} autoComplete={autoComplete} style={inputStyle}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
      {hint && <p id={`${id}-hint`} style={muted}>{hint}</p>}
      <Err id={`${id}-err`} text={error} />
    </div>
  );
}

export function SelectField({ id, label, value, onChange, error, options, blank }: FieldProps & {
  value: string; onChange(v: string): void; options: [ string, string ][]; blank?: string;
}) {
  return (
    <div style={fieldLabel}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} style={inputStyle} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map(([ v, t ]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <Err id={`${id}-err`} text={error} />
    </div>
  );
}

export function CheckField({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <div style={checkLabel}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// Enter envia (submit nativo); o primeiro campo recebe o foco quando o formulário abre.
export function FleetForm({ label, onSubmit, onCancel, busy, general, children }: {
  label: string; onSubmit(): void; onCancel(): void; busy: boolean; general: string | null; children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement | null>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled])")?.focus(); }, []);
  return (
    <form ref={ref} aria-label={label} noValidate style={{ ...box }} onSubmit={(e: FormEvent) => { e.preventDefault(); if (!busy) onSubmit(); }}>
      <div style={form}>{children}</div>
      {general && <p role="alert" style={alert}>{general}</p>}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Salvar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
