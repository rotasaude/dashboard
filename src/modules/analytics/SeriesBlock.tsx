// src/modules/analytics/SeriesBlock.tsx
// Bloco de uma métrica (spec §8: "gráfico de série e tabela"): gráfico, totais
// do período inteiro (quando a API manda) e a tabela por período. Nenhum total
// é calculado aqui.
import type { Cell, Granularity, Rate } from "../../lib/api";
import { fmtPeriod } from "../../lib/analytics";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { SeriesChart, type ChartLine } from "./SeriesChart";
import { Value } from "./values";

export interface SeriesLine extends ChartLine { total?: Cell | Rate }

interface Props {
  title: string;
  sub?: string;
  kind: "count" | "rate";
  periods: string[];
  granularity: Granularity;
  lines: SeriesLine[];
  empty?: string;
}

export function SeriesBlock({ title, sub, kind, periods, granularity, lines, empty = "sem registros no período" }: Props) {
  const hasTotals = lines.some((line) => line.total !== undefined);
  return (
    <Panel title={title} sub={sub}>
      {lines.length === 0 ? <EmptyState title={empty} /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SeriesChart label={`${title} ao longo do tempo`} periods={periods} granularity={granularity} lines={lines} kind={kind} />
          {hasTotals && (
            <div role="group" aria-label="Totais do período">
              <DataTable<SeriesLine>
                cols={[
                  { label: "Série", w: "2fr", render: (line) => line.label },
                  { label: "Período inteiro", w: "1fr", align: "right", render: (line) => (
                    <span className="mono"><Value kind={kind} value={line.total} /></span>
                  ) }
                ]}
                rows={lines}
                rowKey={(line) => line.key}
              />
            </div>
          )}
          <details>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--ink2)" }}>ver por período</summary>
            <PeriodTable title={title} kind={kind} periods={periods} granularity={granularity} lines={lines} />
          </details>
        </div>
      )}
    </Panel>
  );
}

function PeriodTable({ title, kind, periods, granularity, lines }: Omit<Props, "sub" | "empty">) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table aria-label={`${title} por período`} className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
        <thead>
          <tr>
            <th scope="col" style={headStyle}>Período</th>
            {lines.map((line) => <th key={line.key} scope="col" style={{ ...headStyle, textAlign: "right" }}>{line.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map((period, i) => (
            <tr key={period}>
              <th scope="row" style={cellStyle}>{fmtPeriod(period, granularity)}</th>
              {lines.map((line) => (
                <td key={line.key} style={{ ...cellStyle, textAlign: "right" }}><Value kind={kind} value={line.series[i]} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const headStyle = { padding: "4px 8px", borderBottom: "1px solid var(--rule)", color: "var(--ink3)", fontWeight: 500, textAlign: "left" as const };
const cellStyle = { padding: "4px 8px", borderBottom: "1px solid var(--rule)", fontWeight: 400, textAlign: "left" as const };
