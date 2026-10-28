// SurveillancePanel — painel bairro × semana epidemiológica (módulo 25; F-25.8).
// Leitura agregada: sem nome de pessoa e sem trilha, por isso relê como as demais
// leituras estáticas (STATIC_QUERY), com a chave dos filtros aplicados. Abre nas
// 12 semanas que o api usa por padrão (até a semana anterior à de hoje); "Atualizar"
// confere a faixa (no máximo 53 semanas) antes de pedir. Contagem nula é a supressão
// de 1 a 4 casos e aparece como "< 5", nunca como 0 nem vazio; zero aparece 0.
// O aumento atípico é um sinal para avaliar, nunca uma conclusão: a célula leva o
// rótulo "sinal" e a nota explica a regra. A lista de doenças pode ser recusada
// (403) para o papel; então o painel segue sem o filtro de doença.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSurveillancePanel, listSurveillanceDiseases, type SurveillancePanel as PanelData } from "../lib/api";
import { fmtNumber } from "../lib/format";
import { todayInCity } from "../lib/campaigns";
import { SUPPRESSED_LABEL } from "../lib/smallCount";
import { DISEASES_KEY, PANEL_KEY, SIGNAL_NOTE, STATIC_QUERY, previousEpiWeek, shiftEpiWeek, surveillanceError, weekRangeProblem } from "../lib/surveillance";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

const SUPPRESSION_NOTE = `Contagens de 1 a 4 aparecem como “${SUPPRESSED_LABEL}”, para não identificar ninguém.`;

type PanelRow = PanelData["rows"][number];
interface Filters { from: string; to: string; disease: string }

// "AAAA-SS" → "SS/AAAA"
const columnLabel = (week: string): string => `${week.slice(5)}/${week.slice(0, 4)}`;

export function SurveillancePanel({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Painel por bairro e semana epidemiológica" sub="casos por bairro e semana epidemiológica"
      allow={(r) => r.surveillance || r.analyst}>
      {() => <PanelBody today={today} />}
    </SurveillanceGate>
  );
}

function PanelBody({ today }: { today: string }) {
  const to = previousEpiWeek(today);
  const initial: Filters = { from: shiftEpiWeek(to, -11), to, disease: "" };
  const [ draft, setDraft ] = useState<Filters>(initial);
  const [ applied, setApplied ] = useState<Filters>(initial);
  const [ problem, setProblem ] = useState<string | null>(null);

  // 403 (papel sem a lista): sem filtro de doença, o painel segue.
  const diseases = useQuery({ queryKey: [ DISEASES_KEY ], queryFn: listSurveillanceDiseases, ...STATIC_QUERY });
  // Doença vazia nunca vai ao api (ele recusaria `disease=`): "todas" é nulo.
  const panel = useQuery({
    queryKey: [ PANEL_KEY, applied.from, applied.to, applied.disease ],
    queryFn: () => getSurveillancePanel({ fromWeek: applied.from, toWeek: applied.to, disease: applied.disease || null }),
    ...STATIC_QUERY
  });

  function apply() {
    const next: Filters = { ...draft, from: draft.from.trim(), to: draft.to.trim() };
    const found = weekRangeProblem(next.from, next.to, today);
    setProblem(found);
    if (found) return;
    // Mesmos filtros: a chave da consulta não muda, então "Atualizar" relê à mão (agregado, sem trilha).
    if (next.from === applied.from && next.to === applied.to && next.disease === applied.disease) void panel.refetch();
    else setApplied(next);
  }

  const diseaseOptions = diseases.data ?? [];
  const weeks = panel.data?.weeks ?? [];
  const cols: Column<PanelRow>[] = [
    { label: "Bairro", w: "minmax(140px, 2fr)", card: "title", render: (r) => r.neighborhood.name },
    ...weeks.map((week, i): Column<PanelRow> => ({
      label: columnLabel(week), w: "minmax(64px, 1fr)",
      render: (r) => {
        const count = r.counts[i];
        return (
          <span style={cell}>
            <span className="mono">{count === null || count === undefined ? SUPPRESSED_LABEL : fmtNumber(count)}</span>
            {r.signal[i] && <Tag tone="warn">sinal</Tag>}
          </span>
        );
      }
    }))
  ];

  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          De (AAAA-SS)
          <input value={draft.from} style={inputStyle} className="mono" placeholder="2026-31"
            onChange={(e) => setDraft({ ...draft, from: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
        </label>
        <label style={fieldLabel}>
          Até (AAAA-SS)
          <input value={draft.to} style={inputStyle} className="mono" placeholder="2026-42"
            onChange={(e) => setDraft({ ...draft, to: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
        </label>
        {diseaseOptions.length > 0 && (
          <label style={fieldLabel}>
            Doença
            <select value={draft.disease} style={inputStyle} onChange={(e) => setDraft({ ...draft, disease: e.target.value })}>
              <option value="">Todas</option>
              {diseaseOptions.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" style={buttonStyle} onClick={apply}>Atualizar</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {!problem && panel.isError && <p role="alert" style={alert}>{surveillanceError(panel.error)}</p>}
      {panel.isPending && <p className="mono" style={muted}>carregando…</p>}
      {panel.data && (
        <DataTable cols={cols} rows={panel.data.rows} rowKey={(r, i) => r.neighborhood.id ?? `sem-bairro-${i}`}
          empty="nenhum caso na faixa escolhida" />
      )}
      <p style={muted}>{SUPPRESSION_NOTE}</p>
      <p style={muted}>{SIGNAL_NOTE}</p>
    </div>
  );
}

const cell = { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const };
