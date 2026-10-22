// src/modules/billing/SigtapSearch.tsx
// Busca na SIGTAP da competência (contrato §3; reaproveita a tabela da
// plataforma): pelo nome ou pelo código, de 2 a 60 caracteres. O cache
// sai da memória quando a tela fecha (gcTime 0).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchBillingSigtap, type SigtapProcedure } from "../../lib/api";
import { SIGTAP_KEY, billingError, instrumentLabel, sigtapQueryProblem } from "../../lib/billing";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted } from "../exams/styles";

export function SigtapSearch({ competence, onPick, delayMs = 300 }: { competence: string; onPick(p: SigtapProcedure): void; delayMs?: number }) {
  const [ text, setText ] = useState("");
  const typed = text.trim();
  const term = useDebouncedValue(typed, delayMs);
  // Termo curto ou acima de 60 caracteres: a tela recusa e não chama o api (nunca corta).
  const problem = typed.length > 0 ? sigtapQueryProblem(typed) : null;
  const enabled = sigtapQueryProblem(term) === null;
  const query = useQuery({
    queryKey: [ SIGTAP_KEY, competence, term ], queryFn: () => searchBillingSigtap(term, competence), enabled,
    gcTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false
  });
  // Depois de escolher, o campo limpa na hora; o termo "atrasado" não mantém a lista velha.
  const show = enabled && typed.length > 0 && sigtapQueryProblem(typed) === null;
  const optionText = (p: SigtapProcedure) =>
    `${p.code} — ${p.name}${p.instruments.length > 0 ? ` · ${p.instruments.map(instrumentLabel).join(", ")}` : ""}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabel}>
        Procedimento (SIGTAP)
        <input value={text} placeholder="nome ou código" style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {problem && <p style={muted}>{problem}</p>}
      {show && query.isPending && <p className="mono" style={muted}>buscando…</p>}
      {show && query.isError && <p role="alert" style={alert}>{billingError(query.error)}</p>}
      {show && query.isSuccess && query.data.length === 0 && <p style={muted}>nenhum procedimento encontrado</p>}
      {show && query.isSuccess && query.data.length > 0 && (
        <ul aria-label="resultados da SIGTAP" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {query.data.map((p) => (
            <li key={p.code}>
              <button type="button" style={{ ...secondaryButtonStyle, width: "100%", textAlign: "left" }} onClick={() => { onPick(p); setText(""); }}>
                {optionText(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
