// src/modules/SurveillanceNegatives.tsx
// Notificação negativa semanal (módulo 25; F-25.6; contrato K1, K7, K11): cada
// unidade notificadora diz, por semana epidemiológica já encerrada, se teve
// caso ou não. A tela abre na semana anterior à de hoje (a mesma que o api
// devolve sem `week`); a semana em curso, ou depois, nunca vai ao api (a
// negativa só vale a partir do domingo seguinte). A lista traz só unidade,
// CNES e situação: sem dado de pessoa e sem trilha nominal, mas nada a relê
// sozinho (NOMINAL_QUERY). "Registrar negativa" só aparece para a unidade
// pendente; o api confere de novo (caso na semana, negativa repetida).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorCode, listWeeklyNegatives, recordWeeklyNegative, type WeeklyNegatives } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import {
  NEGATIVES_KEY, NOMINAL_QUERY, closedWeekProblem, negativeStatusLabel, previousEpiWeek, shiftEpiWeek, surveillanceError, weekLabel
} from "../lib/surveillance";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

type Unit = WeeklyNegatives["units"][number];

const STATUS_TONE: Record<string, string> = { with_cases: "ok", negative: "ok", pending: "warn" };

export function SurveillanceNegatives({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <SurveillanceGate title="Notificação negativa" sub="unidades sem casos na semana epidemiológica" allow={(r) => r.surveillance}>
      {() => <NegativesBody today={today} />}
    </SurveillanceGate>
  );
}

function NegativesBody({ today }: { today: string }) {
  const latest = previousEpiWeek(today);
  const [ week, setWeek ] = useState(latest);
  const [ typed, setTyped ] = useState(latest);
  const [ message, setMessage ] = useState<string | null>(null);
  const [ busyId, setBusyId ] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [ NEGATIVES_KEY, week ], queryFn: () => listWeeklyNegatives(week), ...NOMINAL_QUERY
  });

  function go(next: string) {
    setWeek(next); setTyped(next); setMessage(null);
  }

  function view() {
    const problem = closedWeekProblem(typed.trim(), today);
    if (problem) { setMessage(problem); return; }
    go(typed.trim());
  }

  async function record(unit: Unit) {
    if (busyId) return;
    setBusyId(unit.unit.id); setMessage(null);
    try {
      await recordWeeklyNegative(unit.unit.id, week);
      await query.refetch();
    } catch (err) {
      setMessage(surveillanceError(err, "negative"));
      // O estado pode ter mudado do outro lado: o que o api recusou por isso, a tela relê.
      const code = errorCode(err);
      if (code === "unit_has_notifications" || code === "already_recorded") await query.refetch();
    } finally {
      setBusyId(null);
    }
  }

  const cols: Column<Unit>[] = [
    {
      label: "Unidade", w: "2fr", card: "title", render: (u) => (
        <span><strong>{u.unit.name}</strong>{u.unit.cnes ? <span className="mono" style={muted}>{` · CNES ${u.unit.cnes}`}</span> : null}</span>
      )
    },
    { label: "Situação", w: "1.2fr", render: (u) => <Tag tone={STATUS_TONE[u.status] ?? "neutral"}>{negativeStatusLabel(u.status)}</Tag> },
    {
      label: "Ação", w: "150px", card: "actions", render: (u) => u.status === "pending" && (
        <button type="button" style={busyId ? disabledButtonStyle : buttonStyle} disabled={!!busyId} onClick={() => void record(u)}>
          Registrar negativa
        </button>
      )
    }
  ];

  const shown = message ?? (query.isError ? surveillanceError(query.error, "negative") : null);
  const units = query.data?.units ?? [];

  return (
    <Panel title="Semana">
      <div style={{ ...stack, padding: 16 }}>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <button type="button" style={secondaryButtonStyle} onClick={() => go(shiftEpiWeek(week, -1))}>Semana anterior</button>
          <button type="button" style={week >= latest ? disabledButtonStyle : secondaryButtonStyle} disabled={week >= latest}
            onClick={() => go(shiftEpiWeek(week, 1))}>Semana seguinte</button>
          <label style={fieldLabel}>
            Semana (AAAA-SS)
            <input value={typed} style={inputStyle} className="mono" onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") view(); }} placeholder="2026-42" />
          </label>
          <button type="button" style={secondaryButtonStyle} onClick={view}>Ver semana</button>
        </div>
        {shown && <p role="alert" style={alert}>{shown}</p>}
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.data && (
          <>
            {/* A semana que o api respondeu, não a pedida: o rótulo só aparece com a lista. */}
            <p className="mono" style={muted}>{weekLabel(query.data.week)}</p>
            <DataTable<Unit> cols={cols} rows={units} rowKey={(u) => u.unit.id} empty="nenhuma unidade notificadora cadastrada" />
          </>
        )}
      </div>
    </Panel>
  );
}
