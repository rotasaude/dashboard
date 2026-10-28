// src/modules/regulation/TargetSearch.tsx
// Busca de alvo da regulação (módulo 26a): especialidade ou procedimento regulável, pelo NOME do alvo (nunca a queixa), de 3 a 60
// caracteres. Reusada pelo pedido, pela consulta, pelo complemento e pelas ofertas. O termo vai sem cache (gcTime 0).
// `cbo` filtra o que o solicitante pode pedir (`targetsFor`); `cbo` nulo ou ausente NÃO filtra (ofertas, lista do enfermeiro).
import { useState, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchRegulationTargets, type RegulationTarget, type RegulationType } from "../../lib/api";
import { REG_TARGETS_KEY, regulationError, targetTermProblem, targetsFor } from "../../lib/regulation";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted } from "../exams/styles";

export function TargetSearch({ type, cbo = null, label = "Especialidade ou procedimento", delayMs = 300, inputRef, onPick }: {
  type: RegulationType; cbo?: string | null; label?: string; delayMs?: number; inputRef?: Ref<HTMLInputElement>; onPick(t: RegulationTarget): void;
}) {
  const [ text, setText ] = useState("");
  const typed = text.trim();
  const term = useDebouncedValue(typed, delayMs);
  // Termo curto ou acima de 60 caracteres: a tela recusa e não chama o api (nunca corta).
  const problem = typed.length > 0 ? targetTermProblem(typed) : null;
  const enabled = targetTermProblem(term) === null;
  const query = useQuery({
    queryKey: [ REG_TARGETS_KEY, type, term ], queryFn: () => searchRegulationTargets(term, type), enabled,
    gcTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false
  });
  // Depois de escolher, o campo limpa na hora; o termo "atrasado" não mantém a lista velha.
  // `term === typed`: enquanto o debounce segura o termo anterior, a lista velha não fica clicável sob o texto novo.
  const show = enabled && term === typed && typed.length > 0 && targetTermProblem(typed) === null;
  const results = query.isSuccess ? targetsFor(cbo, query.data) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabel}>
        {label}
        <input ref={inputRef} value={text} placeholder="nome da especialidade ou do procedimento" style={inputStyle} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
      </label>
      {problem && <p style={muted}>{problem}</p>}
      {show && query.isPending && <p className="mono" style={muted}>buscando…</p>}
      {show && query.isError && <p role="alert" style={alert}>{regulationError(query.error)}</p>}
      {show && query.isSuccess && results.length === 0 && <p style={muted}>nenhum resultado</p>}
      {show && results.length > 0 && (
        <ul aria-label="resultados da busca" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {results.map((t) => (
            <li key={`${t.type}-${t.code}`}>
              <button type="button" style={{ ...secondaryButtonStyle, width: "100%", textAlign: "left" }} onClick={() => { onPick(t); setText(""); }}>
                {`${t.code} — ${t.name}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
