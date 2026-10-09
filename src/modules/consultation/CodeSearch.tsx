// Busca de código por nome ou código (módulo 19; contratos §5): problemas em
// CIAP-2 ou CID-10 e exames em SIGTAP. O termo vai no corpo de um POST (pode
// descrever a queixa) e só a partir de 2 caracteres. Escolher acrescenta o
// item à lista de quem usa (onPick) e limpa o campo para a próxima busca.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CodedOption } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export const CODE_SEARCH_MIN_CHARS = 2;

interface Props {
  label: string;
  placeholder?: string;
  queryKey: string;
  search(term: string): Promise<CodedOption[]>;
  onPick(item: CodedOption): void;
  errorText(err: unknown): string;
  delayMs?: number;
}

export function CodeSearch({ label, placeholder, queryKey, search, onPick, errorText, delayMs = 300 }: Props) {
  const [ text, setText ] = useState("");
  const typed = text.trim();
  const term = useDebouncedValue(typed, delayMs);
  const enabled = term.length >= CODE_SEARCH_MIN_CHARS;
  const query = useQuery({ queryKey: [ queryKey, term ], queryFn: () => search(term), enabled, staleTime: 5 * 60_000 });
  // Depois de escolher, o campo limpa na hora; o termo "atrasado" não pode
  // manter a lista velha na tela.
  const show = enabled && typed.length >= CODE_SEARCH_MIN_CHARS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={labelStyle}>
        {label}
        <input value={text} placeholder={placeholder} style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {typed.length > 0 && typed.length < CODE_SEARCH_MIN_CHARS && (
        <small style={hint}>digite pelo menos {CODE_SEARCH_MIN_CHARS} caracteres</small>
      )}
      {show && query.isPending && <small className="mono" style={hint}>buscando…</small>}
      {show && query.isError && <p role="alert" style={alert}>{errorText(query.error)}</p>}
      {show && query.isSuccess && query.data.length === 0 && <small style={hint}>nenhum código encontrado</small>}
      {show && query.isSuccess && query.data.length > 0 && (
        <ul aria-label={`resultados: ${label}`} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {query.data.map((item) => (
            <li key={item.code}>
              <button type="button" style={{ ...secondaryButtonStyle, width: "100%", textAlign: "left" }}
                onClick={() => { onPick(item); setText(""); }}>
                {`${item.code} — ${item.label}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
