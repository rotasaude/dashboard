// Queixa em CIAP-2 por nome ou código (módulo 18; spec §3, decisão 6). A busca
// vai no corpo de um POST (o termo pode descrever a queixa) e só começa com 2
// caracteres. Escolhido o código, o campo mostra código e nome e só volta à
// busca por "trocar".
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchCiap2, type Ciap2Ref } from "../../lib/api";
import { screeningError } from "../../lib/screening";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export const CIAP2_MIN_CHARS = 2;

interface Props { value: Ciap2Ref | null; onChange(next: Ciap2Ref | null): void; delayMs?: number }

export function Ciap2Search({ value, onChange, delayMs = 300 }: Props) {
  const [ text, setText ] = useState("");
  const term = useDebouncedValue(text.trim(), delayMs);
  const enabled = value === null && term.length >= CIAP2_MIN_CHARS;
  const query = useQuery({ queryKey: [ "ciap2Search", term ], queryFn: () => searchCiap2(term), enabled, staleTime: 5 * 60_000 });

  if (value) {
    return (
      <div style={line}>
        <span style={label}>Queixa (CIAP-2)</span>
        <strong className="mono" style={{ fontSize: 12.5 }}>{value.code}</strong>
        <span style={{ fontSize: 12.5 }}>{value.label}</span>
        <button type="button" style={secondaryButtonStyle} onClick={() => { setText(""); onChange(null); }}>trocar</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ ...label, display: "flex", flexDirection: "column", gap: 4 }}>
        Queixa (CIAP-2)
        <input value={text} placeholder="nome ou código, ex.: cefaleia, K86" style={inputStyle}
          onChange={(e) => setText(e.target.value)} />
      </label>
      {text.trim().length > 0 && text.trim().length < CIAP2_MIN_CHARS && <small style={hint}>digite pelo menos {CIAP2_MIN_CHARS} caracteres</small>}
      {enabled && query.isPending && <small className="mono" style={hint}>buscando…</small>}
      {enabled && query.isError && <p role="alert" style={alert}>{screeningError(query.error)}</p>}
      {enabled && query.isSuccess && query.data.length === 0 && <small style={hint}>nenhum código encontrado</small>}
      {enabled && query.isSuccess && query.data.length > 0 && (
        <ul aria-label="códigos CIAP-2" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {query.data.map((item) => (
            <li key={item.code}>
              <button type="button" style={{ ...secondaryButtonStyle, width: "100%", textAlign: "left" }} onClick={() => onChange(item)}>
                {`${item.code} — ${item.label}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const line: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const label: CSSProperties = { fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
