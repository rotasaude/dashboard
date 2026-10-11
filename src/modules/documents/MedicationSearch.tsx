// src/modules/documents/MedicationSearch.tsx
// Busca no catálogo de medicamentos (módulo 19c; contrato §5): o termo vai no
// corpo de um POST e só a partir de 2 caracteres; a REMUME da unidade vem
// primeiro ("na rede"). Na receita, o controlado aparece (a médica precisa
// saber que existe); sem o 19d, não entra; com o 19d (`blockReason`), entra o
// C1/C5 e as listas A/B/C2/C3/C4 ficam bloqueadas com o motivo. Na lista de uso
// e na REMUME, entra.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchMedications, type MedicationSearchItem } from "../../lib/api";
import { CONTROLLED_BLOCKED, documentError } from "../../lib/clinicalDocuments";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export const MEDICATION_SEARCH_MIN_CHARS = 2;

interface Props {
  label: string;
  unitId?: string;
  blockControlled: boolean;
  onPick(item: MedicationSearchItem): void;
  delayMs?: number;
  // Módulo 19d: decide o bloqueio de cada item (motivo não nulo = bloqueado).
  blockReason?(item: MedicationSearchItem): string | null;
}

export function MedicationSearch({ label, unitId, blockControlled, onPick, delayMs = 300, blockReason }: Props) {
  const [ text, setText ] = useState("");
  const typed = text.trim();
  const term = useDebouncedValue(typed, delayMs);
  const enabled = term.length >= MEDICATION_SEARCH_MIN_CHARS;
  // gcTime: 0 — o termo pode dizer o que a pessoa toma; sai da memória com a tela.
  const query = useQuery({
    queryKey: [ "medicationSearch", unitId ?? null, term ], queryFn: () => searchMedications(term, unitId), enabled, gcTime: 0, retry: false
  });
  const show = enabled && typed.length >= MEDICATION_SEARCH_MIN_CHARS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={labelStyle}>
        {label}
        <input value={text} style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {typed.length > 0 && typed.length < MEDICATION_SEARCH_MIN_CHARS && (
        <small style={hint}>digite pelo menos {MEDICATION_SEARCH_MIN_CHARS} caracteres</small>
      )}
      {show && query.isPending && <small className="mono" style={hint}>buscando…</small>}
      {show && query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
      {show && query.isSuccess && query.data.length === 0 && <small style={hint}>nenhum medicamento encontrado</small>}
      {show && query.isSuccess && query.data.length > 0 && (
        <ul aria-label={`resultados: ${label}`} style={list}>
          {query.data.map((item) => {
            const reason = blockReason ? blockReason(item) : (blockControlled && item.controlled ? CONTROLLED_BLOCKED : null);
            const blocked = reason !== null;
            return (
              <li key={item.id} style={row}>
                <button type="button" disabled={blocked} aria-label={item.label}
                  style={{ ...(blocked ? disabledButtonStyle : secondaryButtonStyle), flex: 1, textAlign: "left" }}
                  onClick={() => { onPick(item); setText(""); }}>
                  {item.label}
                </button>
                {item.in_network && <Tag tone="ok" mono={false}>na rede</Tag>}
                {item.antimicrobial && <Tag tone="warn" mono={false}>antimicrobiano</Tag>}
                {blockReason ? (
                  <>
                    {reason !== null && <Tag tone="down" mono={false}>{reason}</Tag>}
                    {reason === null && item.controlled && (
                      <Tag tone="warn" mono={false}>{item.controlled_list ? `controlado · lista ${item.controlled_list}` : "controlado"}</Tag>
                    )}
                  </>
                ) : (
                  item.controlled && <Tag tone="down" mono={false}>{blockControlled ? CONTROLLED_BLOCKED : "controlado"}</Tag>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 };
const row: CSSProperties = { display: "flex", gap: 6, alignItems: "center" };
