// src/modules/consultation/ExamRequestsField.tsx
// Exames solicitados (SIGTAP da competência ativa; contratos §4 e §5). A
// justificativa CID-10 só aparece para o CBO que pode usar CID-10 (Divergência D9).
import type { CSSProperties } from "react";
import { searchSigtap, type ExamRequest } from "../../lib/api";
import { addExam, cid10Problem, consultationError, setJustification } from "../../lib/consultation";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CodeSearch } from "./CodeSearch";

interface Props { value: ExamRequest[]; onChange(next: ExamRequest[]): void; cid10Allowed: boolean; searchDelayMs?: number }

export function ExamRequestsField({ value, onChange, cid10Allowed, searchDelayMs }: Props) {
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Exames solicitados</legend>
      {value.length > 0 && (
        <ul aria-label="exames solicitados" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {value.map((e) => {
            const problem = cid10Allowed ? cid10Problem(e.cid10_justification) : null;
            return (
              <li key={e.sigtap_code} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", fontSize: 12.5 }}>
                <span style={{ flex: 1, minWidth: 200 }}><span className="mono">{e.sigtap_code}</span>{` — ${e.label}`}</span>
                {cid10Allowed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 220 }}>
                    <label style={labelStyle}>
                      {`CID-10 de justificativa (${e.sigtap_code})`}
                      <input value={e.cid10_justification ?? ""} placeholder="opcional, ex.: E11" style={inputStyle}
                        onChange={(ev) => onChange(setJustification(value, e.sigtap_code, ev.target.value))} />
                    </label>
                    {problem && <small role="alert" style={{ fontSize: 12, color: "var(--down)" }}>{problem}</small>}
                  </div>
                )}
                <button type="button" aria-label={`Remover exame ${e.sigtap_code}`} style={secondaryButtonStyle}
                  onClick={() => onChange(value.filter((x) => x.sigtap_code !== e.sigtap_code))}>Remover</button>
              </li>
            );
          })}
        </ul>
      )}
      <CodeSearch label="Solicitar exame (SIGTAP)" placeholder="nome ou código do procedimento" queryKey="sigtapSearch"
        search={searchSigtap} errorText={consultationError} onPick={(ref) => onChange(addExam(value, ref))} delayMs={searchDelayMs} />
    </fieldset>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--rule)", borderRadius: 8, padding: 12 };
const legend: CSSProperties = { fontSize: 12.5, fontWeight: 600 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
