// src/modules/analytics/QualityTab.tsx
// Qualidade operacional (F-14.4; contratos §1.2): espera em faixas (não
// mediana, D11), faltas, desfechos e "saiu sem atendimento", por unidade.
// Taxas vêm prontas da API; nenhuma é recalculada aqui.
import { useRef, useState } from "react";
import type { AnalyticsQuery, QualityData } from "../../lib/api";
import {
  APPOINTMENT_LABEL, OUTCOME_LABEL, WAIT_BUCKET_LABEL, labelOr, rangeDates, type AnalyticsRange
} from "../../lib/analytics";
import { useAnalytics } from "../../hooks/useAnalytics";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { AnalyticsView } from "./AnalyticsView";
import { SeriesBlock } from "./SeriesBlock";
import { CellValue, RateValue } from "./values";
import { UnitSelect, filterRowStyle } from "./Filters";

type UnitRow = QualityData["by_unit"][number];

export function QualityTab({ range }: { range: AnalyticsRange }) {
  const [ unit, setUnit ] = useState<string | null>(null);
  const query: AnalyticsQuery = { ...rangeDates(range), granularity: range.granularity, health_unit_id: unit };
  const result = useAnalytics("quality", query);
  // data.units: todas as unidades da cidade, independentes do recorte. Guarda
  // a última lista recebida para o seletor não esvaziar enquanto um novo
  // recorte carrega (ou falha); os números nunca são reaproveitados.
  const lastUnits = useRef<QualityData["units"]>([]);
  if (result.data) lastUnits.current = result.data.data.units;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="group" aria-label="Recortes" style={filterRowStyle}>
        <UnitSelect value={unit} units={lastUnits.current} onChange={setUnit} />
      </div>
      <AnalyticsView result={result}>{(data) => <QualityBody data={data} />}</AnalyticsView>
    </div>
  );
}

function QualityBody({ data }: { data: QualityData }) {
  const common = { periods: data.periods, granularity: data.granularity ?? "week" };
  return (
    <>
      <SeriesBlock {...common} kind="count" title="Espera até a chamada" sub="atendimentos chamados, por faixa de espera"
        lines={data.wait.buckets.map((b) => ({ key: b.bucket, label: labelOr(WAIT_BUCKET_LABEL, b.bucket), series: b.series, total: b.total }))} />
      <SeriesBlock {...common} kind="rate" title="Chamados em até 30 min" sub="(até 15 + 15 a 30) ÷ todas as faixas"
        lines={[ { key: "within_30", label: "até 30 min", series: data.wait.within_30_pct, total: data.wait.within_30_pct_total } ]} />
      <SeriesBlock {...common} kind="count" title="Agendamentos encerrados" sub="por situação final"
        lines={data.appointments.map((a) => ({ key: a.status, label: labelOr(APPOINTMENT_LABEL, a.status), series: a.series, total: a.total }))} />
      <SeriesBlock {...common} kind="rate" title="Faltas" sub="faltou ÷ (compareceu + faltou)"
        lines={[ { key: "no_show", label: "faltas", series: data.no_show_pct, total: data.no_show_pct_total } ]} />
      <SeriesBlock {...common} kind="count" title="Desfechos dos atendimentos"
        lines={data.attendance_outcomes.map((o) => ({ key: o.outcome, label: OUTCOME_LABEL[o.outcome], series: o.series, total: o.total }))} />
      <SeriesBlock {...common} kind="rate" title="Saiu sem atendimento" sub="saiu ÷ todos os desfechos"
        lines={[ { key: "left", label: "saiu sem atendimento", series: data.left_pct, total: data.left_pct_total } ]} />
      <Panel title="Por unidade" sub="período inteiro">
        <DataTable<UnitRow>
          cols={[
            { label: "Unidade", w: "2fr", render: (r) => r.name },
            { label: "Atendimentos", w: "1fr", align: "right", render: (r) => <span className="mono"><CellValue value={r.attendances} /></span> },
            { label: "Até 30 min", w: "1fr", align: "right", render: (r) => <span className="mono"><RateValue value={r.wait_within_30_pct} /></span> },
            { label: "Faltas", w: "1fr", align: "right", render: (r) => <span className="mono"><RateValue value={r.no_show_pct} /></span> },
            { label: "Saiu sem atendimento", w: "1fr", align: "right", render: (r) => <span className="mono"><RateValue value={r.left_pct} /></span> }
          ]}
          rows={data.by_unit}
          rowKey={(r) => r.health_unit_id}
          empty="nenhum atendimento no período"
        />
      </Panel>
    </>
  );
}
