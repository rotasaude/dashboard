// Campos de texto que o api grava sem volta (api#32; contrato §13, §14; Q30): o `FrozenTextNotice` antes do envio, ligado
// por `aria-describedby`, e, quando há, um aviso próprio do campo. O extrato leva também `EXTRACT_NOTICE` (o destino não
// vê quem fez a manifestação). Nenhum componente de `src/components` muda (D2).
import { FrozenTextNotice } from "../../../components/FrozenTextNotice";
import { ReasonHint, reasonHint } from "../../../components/ReasonHint";
import { inputStyle } from "../../../components/formStyles";
import { EXTRACT_NOTICE } from "../../../lib/ombudsman";
import { fieldLabel, muted } from "../../exams/styles";

// O que `useFormProblems().aria(path)` devolve.
export type FieldAria = { "aria-invalid"?: true; "aria-describedby"?: string };

export function FrozenTextArea({ id, label, value, onChange, aria, notice, min }: {
  id: string; label: string; value: string; onChange(v: string): void; aria: FieldAria;
  notice?: { id: string; text: string }; min?: number;
}) {
  const hint = min !== undefined && reasonHint(value, min) ? `${id}-hint` : null;
  const describedBy = [ notice?.id, `${id}-frozen`, hint, aria["aria-describedby"] ].filter(Boolean).join(" ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={fieldLabel}>
        {label}
        <textarea value={value} rows={5} style={inputStyle} aria-invalid={aria["aria-invalid"]} aria-describedby={describedBy}
          onChange={(ev) => onChange(ev.target.value)} />
      </label>
      {notice && <p id={notice.id} style={muted}>{notice.text}</p>}
      <FrozenTextNotice id={`${id}-frozen`} />
      {min !== undefined && <ReasonHint id={`${id}-hint`} text={value} min={min} />}
    </div>
  );
}

// `aria-describedby` = `<id>-extract-notice <id>-frozen` (+ o erro, quando há).
export function ExtractField({ id, value, onChange, aria }: { id: string; value: string; onChange(v: string): void; aria: FieldAria }) {
  return (
    <FrozenTextArea id={id} label="Extrato para o destino" value={value} onChange={onChange} aria={aria}
      notice={{ id: `${id}-extract-notice`, text: EXTRACT_NOTICE }} />
  );
}
