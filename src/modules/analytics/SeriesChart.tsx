// src/modules/analytics/SeriesChart.tsx
// Série do Analytics em linhas (Recharts, já dependência). Ponto oculto ou sem
// dado é lacuna (connectNulls={false}); a legenda é HTML, legível sem o SVG.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Cell, Granularity, Rate } from "../../lib/api";
import { fmtPeriod, plotValue } from "../../lib/analytics";

export interface ChartLine { key: string; label: string; series: Array<Cell | Rate> }

export const PALETTE = [ "var(--accent)", "var(--warn)", "var(--ok)", "var(--down)", "var(--info)", "var(--ink3)" ];

export function chartRows(periods: string[], granularity: Granularity, lines: ChartLine[]) {
  return periods.map((period, i) => {
    const row: Record<string, string | number | null> = { period: fmtPeriod(period, granularity) };
    lines.forEach((line, j) => { row[`s${j}`] = plotValue(line.series[i]); });
    return row;
  });
}

interface Props { label: string; periods: string[]; granularity: Granularity; lines: ChartLine[]; kind: "count" | "rate" }

export function SeriesChart({ label, periods, granularity, lines, kind }: Props) {
  const data = chartRows(periods, granularity, lines);
  const hasGaps = lines.some((line) => line.series.some((v) => typeof v !== "number"));
  return (
    <figure aria-label={label} style={{ margin: 0 }}>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={40} allowDecimals={kind === "rate"}
              domain={kind === "rate" ? [ 0, 100 ] : [ 0, "auto" ]} />
            <Tooltip />
            {lines.map((line, j) => (
              <Line key={line.key} dataKey={`s${j}`} name={line.label} stroke={PALETTE[j % PALETTE.length]}
                dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "var(--ink2)" }}>
        <ul aria-label="legenda" style={{ display: "flex", gap: 12, flexWrap: "wrap", listStyle: "none", margin: 0, padding: 0 }}>
          {lines.map((line, j) => (
            <li key={line.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{ width: 10, height: 2, background: PALETTE[j % PALETTE.length] }} />
              {line.label}
            </li>
          ))}
        </ul>
        {hasGaps && <span style={{ color: "var(--ink3)" }}>lacuna = oculto ou sem dado</span>}
      </figcaption>
    </figure>
  );
}
