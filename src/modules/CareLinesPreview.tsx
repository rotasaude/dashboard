// src/modules/CareLinesPreview.tsx
// Prévia de C2–C7 por equipe (contrato §6; spec §6 "Gestão"; ADR 0040): para
// municipal_admin e analyst, agregada, sem nome. Denominador = população
// elegível da equipe (pacientes e cidadãos validados, inscritos ou não);
// pontuação pelas boas práticas rastreadas, com visita do ACS e vacina fora e
// os pesos redistribuídos. SEMPRE com o aviso de estimativa — nunca valor
// oficial. Lê só no clique de "Calcular prévia" (nada de polling).
import { useState, type CSSProperties } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getCareContext, getCarePreview } from "../lib/api";
import { CONTEXT_KEY, ESTIMATE_NOTICE, INDICATORS, PREVIEW_KEY, STATIC_QUERY, careLineError } from "../lib/careLines";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { CareLinesGate } from "./careLines/CareLinesGate";
import { PreviewCard } from "./careLines/PreviewCard";

export function CareLinesPreview() {
  return (
    <CareLinesGate title="Prévia dos indicadores" sub="C2 a C7 por equipe · estimativa, não o valor oficial" allow={(r) => r.admin || r.analyst}>
      {() => <PreviewBody />}
    </CareLinesGate>
  );
}

function PreviewBody() {
  const context = useQuery({ queryKey: [ CONTEXT_KEY ], queryFn: getCareContext, ...STATIC_QUERY });
  const [ teamChoice, setTeamChoice ] = useState("");
  const [ asked, setAsked ] = useState<string | null>(null);
  const teams = context.data?.teams ?? [];
  const teamId = teamChoice || teams[0]?.id || "";
  const askedTeam = teams.find((t) => t.id === asked);
  const results = useQueries({
    queries: INDICATORS.map((ind) => ({
      queryKey: [ PREVIEW_KEY, asked, ind.key ], queryFn: () => getCarePreview(asked ?? "", ind.key), enabled: asked !== null, ...STATIC_QUERY
    }))
  });

  // Mesma equipe de novo = recalcular; outra equipe = chaves novas, leitura nova.
  function calculate() {
    if (asked === teamId) results.forEach((r) => void r.refetch());
    else setAsked(teamId);
  }

  return (
    <div style={stack}>
      <p role="note" aria-label="aviso de estimativa" style={noteStyle}>{ESTIMATE_NOTICE}</p>
      {context.isError && <p role="alert" style={alert}>{careLineError(context.error)}</p>}
      {context.data && teams.length === 0 && <EmptyState title="nenhuma equipe cadastrada na cidade" />}
      {teams.length > 0 && (
        <Panel title="Calcular por equipe">
          <div style={{ ...row, alignItems: "flex-end", padding: 16 }}>
            <label style={fieldLabel}>
              Equipe
              <select value={teamId} style={inputStyle} onChange={(e) => setTeamChoice(e.target.value)}>
                {teams.map((t) => <option key={t.id} value={t.id}>{`${t.name} · INE ${t.ine} · ${t.unit.name}`}</option>)}
              </select>
            </label>
            <button type="button" style={buttonStyle} onClick={calculate}>Calcular prévia</button>
          </div>
        </Panel>
      )}
      {asked && (
        <>
          {askedTeam && <p style={muted}>{`Resultado da equipe ${askedTeam.name} · INE ${askedTeam.ine}`}</p>}
          <div style={cards}>
            {INDICATORS.map((ind, i) => (
              <PreviewCard key={ind.key} indicator={ind.key} data={results[i].data} error={results[i].error} pending={results[i].isFetching} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const noteStyle: CSSProperties = {
  margin: 0, padding: 12, borderRadius: 8, border: "1px solid var(--warn)", background: "var(--sunken)", fontSize: 12.5, fontWeight: 600
};
const cards: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16 };
