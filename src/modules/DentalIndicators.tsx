// Indicadores B1 e B2 da eSB (módulo 28, F-28.8): contagens por equipe, sem pessoa e sem trilha. Estimativa — o
// valor oficial é do SIAPS. Leitura estática (ao abrir e ao filtrar), sem polling.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDentalIndicators, listDentalTeams } from "../lib/api";
import { DENTAL_INDICATORS_KEY, DENTAL_TEAMS_KEY, STATIC_QUERY, dentalError, monthOf, ratioLabel } from "../lib/dental";
import { todayInCity } from "../lib/campaigns";
import { StatTile } from "../components/StatTile";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { DentalGate } from "./dental/DentalGate";

const DENTAL_ESTIMATE_NOTICE = "Estimativa — o valor oficial é calculado pelo SIAPS.";
const NO_TEAM = "a eSB não tem equipe associada";

export function DentalIndicators({ today }: { today?: string }) {
  return (
    <DentalGate title="Indicadores B1 e B2" sub="primeira consulta e tratamento concluído por equipe" allow={(r) => r.admin || r.analyst}>
      {() => <IndicatorsBody today={today} />}
    </DentalGate>
  );
}

function IndicatorsBody({ today }: { today?: string }) {
  const teams = useQuery({ queryKey: [ DENTAL_TEAMS_KEY ], queryFn: listDentalTeams, ...STATIC_QUERY });
  const [ teamChoice, setTeamChoice ] = useState("");
  const [ periodChoice, setPeriodChoice ] = useState("");
  const list = teams.data ?? [];
  const team = list.find((t) => t.id === teamChoice) ?? list[0];
  const period = periodChoice || monthOf(today ?? todayInCity());
  const teamId = team?.id ?? "";
  const data = useQuery({ queryKey: [ DENTAL_INDICATORS_KEY, teamId, period ], queryFn: () => getDentalIndicators(teamId, period), enabled: !!teamId && !!period, ...STATIC_QUERY });

  return (
    <div style={stack}>
      <p role="note" aria-label="aviso de estimativa" style={noteStyle}>{DENTAL_ESTIMATE_NOTICE}</p>
      {teams.isError && <p role="alert" style={alert}>{dentalError(teams.error)}</p>}
      {teams.data && list.length === 0 && <EmptyState title="Nenhuma equipe de saúde bucal importada do CNES." />}
      {list.length > 0 && (
        <div style={row}>
          <label style={fieldLabel}>
            Equipe de saúde bucal
            <select value={teamId} style={inputStyle} onChange={(e) => setTeamChoice(e.target.value)}>
              {list.map((t) => <option key={t.id} value={t.id}>{`${t.name} · INE ${t.ine ?? "—"}`}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Período
            <input type="month" value={period} style={inputStyle} onChange={(e) => setPeriodChoice(e.target.value)} />
          </label>
        </div>
      )}
      <p style={muted}>O período cobre os 12 meses que terminam no mês escolhido.</p>
      {data.isError && <p role="alert" style={alert}>{dentalError(data.error)}</p>}
      {data.data && (
        <div style={tiles}>
          <Indicator label="B1 — primeira consulta programática" n={data.data.b1.numerator} d={data.data.b1.denominator} unit="pessoas" />
          <Indicator label="B2 — tratamento concluído" n={data.data.b2.numerator} d={data.data.b2.denominator} unit="primeiras consultas" />
        </div>
      )}
    </div>
  );
}

function Indicator({ label, n, d, unit }: { label: string; n: number; d: number | null; unit: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <StatTile label={label} value={ratioLabel(n, d)} />
      <p style={muted}>{d === null ? NO_TEAM : `${n} de ${d} ${unit}`}</p>
    </div>
  );
}

const noteStyle = { margin: 0, padding: 12, borderRadius: 8, border: "1px solid var(--warn)", background: "var(--sunken)", fontSize: 12.5, fontWeight: 600 } as const;
const tiles = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 } as const;
