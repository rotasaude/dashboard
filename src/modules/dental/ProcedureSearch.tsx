// Busca de procedimento (SIGTAP) da consulta odontológica: a partir de 3 letras, com atraso, pelo corpo da requisição
// (o termo pode ser clínico — nunca na URL). O auxiliar só vê a lista da cidade; `only` restringe a prótese.
import { useEffect, useState } from "react";
import { searchDentalProcedures, type DentalProcedureRef, type DentalRole } from "../../lib/api";
import { dentalError } from "../../lib/dental";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted } from "../exams/styles";

interface Props { role: DentalRole; only?: "prosthesis"; delayMs?: number; onPick(ref: DentalProcedureRef): void }

export function ProcedureSearch({ role, only, delayMs = 300, onPick }: Props) {
  const [ term, setTerm ] = useState("");
  const [ results, setResults ] = useState<DentalProcedureRef[]>([]);
  const [ error, setError ] = useState<string | null>(null);
  const q = term.trim();

  useEffect(() => {
    if (q.length < 3) { setResults([]); setError(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      searchDentalProcedures(q).then((list) => { if (live) { setResults(list); setError(null); } })
        .catch((e) => { if (live) { setResults([]); setError(dentalError(e)); } });
    }, delayMs);
    return () => { live = false; clearTimeout(timer); };
  }, [ q, delayMs ]);

  const shown = results.filter((r) => (role !== "auxiliary" || r.auxiliary_allowed) && (only !== "prosthesis" || r.prosthesis));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabel}>
        Procedimento (SIGTAP)
        <input type="search" value={term} style={inputStyle} autoComplete="off" onChange={(e) => setTerm(e.target.value)} />
      </label>
      {q.length > 0 && q.length < 3 && <p style={muted}>Digite ao menos 3 letras.</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {shown.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {shown.map((r) => (
            <button key={r.sigtap} type="button" style={{ ...secondaryButtonStyle, textAlign: "left" }}
              onClick={() => { onPick(r); setTerm(""); setResults([]); }}>{`${r.sigtap} — ${r.name}`}</button>
          ))}
        </div>
      )}
    </div>
  );
}
