// src/modules/surveillance/NotificationFormSection.tsx
// A ficha complementar da notificação (módulo 25; contrato §14): um campo por
// linha da tabela do Sinan, todos opcionais. O PATCH leva a ficha inteira e a
// versão lida. Só estas situações deixam editar (FORM_EDITABLE, como o SaveForm
// do api); nas outras, a ficha aparece em leitura.
// 409 stale_version: a frase explica, o que foi digitado fica na tela, nada é
// reenviado sozinho e "Recarregar" só relê o detalhe; quando a versão nova
// chega, os campos não digitados passam a ser os dela e os digitados ficam.
// A ficha é dado de saúde: nunca em URL, console, storage nem mensagem de erro.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode, updateNotificationForm, type SurveillanceNotification } from "../../lib/api";
import { NOTIFICATION_KEY, isStale, surveillanceError } from "../../lib/surveillance";
import { FORM_EDITABLE, SINAN_FORM_FIELDS, formBody, formProblem, formValues, type FormFieldSpec } from "../../lib/surveillanceForm";
import { UFS } from "../../lib/professionals";
import { errorPath } from "../../lib/territoryRegistry";
import { KeyValue } from "../../components/KeyValue";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, okText, row, title } from "../exams/styles";

const FIELDS = SINAN_FORM_FIELDS;
const LOCKED_TEXT = "ficha travada — recarregue";
const SAVED_TEXT = "Ficha salva.";
const fieldsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 } as const;

interface Props {
  notification: SurveillanceNotification;
  onSaved(n: SurveillanceNotification): void;
}

type Control = HTMLInputElement | HTMLSelectElement;

const shown = (f: FormFieldSpec, value: string): string =>
  value === "" ? "—" : f.kind === "code" ? (f.options?.find((o) => o.code === value)?.label ?? value) : value;

export function NotificationFormSection({ notification, onSaved }: Props) {
  const client = useQueryClient();
  const [ values, setValues ] = useState(() => formValues(notification.form, FIELDS));
  const [ error, setError ] = useState<string | null>(null);
  const [ invalidKey, setInvalidKey ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ done, setDone ] = useState(false);
  // Os campos que a pessoa mexeu desde a última leitura: a versão nova não os sobrescreve.
  const edited = useRef<Set<string>>(new Set());
  const controls = useRef<Record<string, Control | null>>({});

  // Versão nova (recarregada ou de um andamento): o que não foi digitado acompanha o api; a frase de versão antiga sai.
  useEffect(() => {
    const server = formValues(notification.form, FIELDS);
    setValues((prev) => Object.fromEntries(FIELDS.map((f) => [ f.key, edited.current.has(f.key) ? prev[f.key] : server[f.key] ])));
    setStale(false); setError(null); setInvalidKey(null);
  }, [ notification.version ]);

  function change(key: string, value: string) {
    edited.current.add(key);
    setValues((prev) => ({ ...prev, [key]: value }));
    setDone(false);
  }

  function refuse(path: string | null, message: string) {
    const key = /^form\.(.+)$/.exec(path ?? "")?.[1] ?? null;
    const target = key ? controls.current[key] : null;
    setInvalidKey(target ? key : null);
    setError(message);
    target?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setDone(false); setStale(false); setError(null); setInvalidKey(null);
    const invalid = formProblem(values, FIELDS);
    if (invalid) { refuse(invalid.path, invalid.message); return; }
    setBusy(true);
    try {
      const saved = await updateNotificationForm(notification.id, formBody(values, FIELDS), notification.version);
      edited.current.clear();
      setValues(formValues(saved.form, FIELDS));
      setDone(true);
      onSaved(saved);
    } catch (err) {
      setStale(isStale(err));
      refuse(errorPath(err), errorCode(err) === "invalid_transition" ? LOCKED_TEXT : surveillanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const reload = () => void client.refetchQueries({ queryKey: [ NOTIFICATION_KEY, notification.id ] });

  if (!FORM_EDITABLE.has(notification.status)) {
    return (
      <section aria-label="Ficha complementar" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={title}>Ficha complementar</h4>
        <div style={fieldsGrid}>
          {FIELDS.map((f) => (
            <KeyValue key={f.key} k={f.label} v={shown(f, formValues(notification.form, FIELDS)[f.key])} mono={f.kind !== "code" && f.kind !== "text"} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <form aria-label="Ficha complementar" onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h4 style={title}>Ficha complementar</h4>
      <div style={fieldsGrid}>
        {FIELDS.map((f) => {
          const common = {
            value: values[f.key], style: inputStyle, "aria-invalid": invalidKey === f.key || undefined,
            ref: (el: Control | null) => { controls.current[f.key] = el; },
            onChange: (e: { target: { value: string } }) => change(f.key, e.target.value)
          };
          return (
            <label key={f.key} style={fieldLabel}>
              {f.label}
              {f.kind === "code" || f.kind === "uf" ? (
                <select {...common}>
                  <option value="">—</option>
                  {f.kind === "uf"
                    ? UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)
                    : f.options?.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              ) : (
                <input {...common} autoComplete="off" inputMode={f.kind === "digits" || f.kind === "cbo" ? "numeric" : undefined} />
              )}
            </label>
          );
        })}
      </div>
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Salvar ficha</button>
        {error && <p role="alert" style={alert}>{error}</p>}
        {stale && <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>}
        {done && !error && <p role="status" style={okText}>{SAVED_TEXT}</p>}
      </div>
    </form>
  );
}
