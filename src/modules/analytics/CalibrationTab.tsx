// src/modules/analytics/CalibrationTab.tsx
// Calibração de protocolo (F-14.5; contratos §1.3): por versão, tier ×
// desfecho do atendimento ligado, com a proporção por linha que a API manda.
// Período inteiro, sem série: o agrupamento por semana/mês não se aplica.
// É por versão porque `tier` é texto de cada protocolo (spec §14).
import { useState } from "react";
import type { AnalyticsQuery, CalibrationData, CalibrationRow, Cell, Rate } from "../../lib/api";
import { CALIBRATION_OUTCOMES, OUTCOME_LABEL, rangeDates, type AnalyticsRange } from "../../lib/analytics";
import { useAnalytics } from "../../hooks/useAnalytics";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { AnalyticsView } from "./AnalyticsView";
import { CellValue, RateValue } from "./values";
import { ProtocolSelect, filterRowStyle, noteStyle } from "./Filters";

interface ProtocolFilter { name: string | null; version: number | null }

export function CalibrationTab({ range }: { range: AnalyticsRange }) {
  const [ protocol, setProtocol ] = useState<ProtocolFilter>({ name: null, version: null });
  const { from, to } = rangeDates(range);
  const query: AnalyticsQuery = { from, to, protocol_name: protocol.name, protocol_version: protocol.version };
  const result = useAnalytics("calibration", query);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="group" aria-label="Recortes" style={filterRowStyle}>
        <ProtocolSelect name={protocol.name} version={protocol.version} withVersion
          onChange={(name, version) => setProtocol({ name, version })} />
      </div>
      <p style={noteStyle}>Período inteiro, sem série: o agrupamento por semana ou mês não se aplica aqui.</p>
      <AnalyticsView result={result}>{(data) => <CalibrationBody data={data} />}</AnalyticsView>
    </div>
  );
}

const COLUMNS: Column<CalibrationRow>[] = [
  { label: "Tier", w: "1.2fr", render: (r) => r.tier },
  { label: "Triagens", w: "0.8fr", align: "right", render: (r) => <span className="mono"><CellValue value={r.total} /></span> },
  ...CALIBRATION_OUTCOMES.map((outcome): Column<CalibrationRow> => ({
    label: OUTCOME_LABEL[outcome], w: "1fr", align: "right",
    render: (r) => <OutcomeCell count={r.outcomes[outcome]} share={r.shares[outcome]} />
  }))
];

function CalibrationBody({ data }: { data: CalibrationData }) {
  if (data.versions.length === 0) {
    return <Panel title="Calibração"><EmptyState title="nenhuma triagem concluída no período" /></Panel>;
  }
  return (
    <>
      {data.versions.map((v) => (
        <Panel key={`${v.protocol_name}@${v.protocol_version}`} title={`${v.protocol_name} · versão ${v.protocol_version}`}
          sub="tier × desfecho · proporção por linha">
          <DataTable<CalibrationRow> cols={COLUMNS} rows={v.rows} rowKey={(r) => r.tier} empty="sem triagens nesta versão" />
        </Panel>
      ))}
    </>
  );
}

function OutcomeCell({ count, share }: { count: Cell; share: Rate }) {
  return (
    <span className="mono">
      <CellValue value={count} /> <span style={{ color: "var(--ink3)" }}>(<RateValue value={share} />)</span>
    </span>
  );
}
