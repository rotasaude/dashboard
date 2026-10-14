// src/modules/exams/UnitExamList.tsx
// Os exames da unidade por situação (spec §9 "Recepção/unidade"): a unidade
// abre cada um para agendar, registrar coleta e resultado (ExamOrderDetail).
import { useState } from "react";
import { listExamOrders, type ExamOrder, type ExamStatus, type HealthUnit } from "../../lib/api";
import { EXAM_ORDERS_KEY, examError, overdueLabel } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { useExamOrderPages } from "../../hooks/useExamOrderPages";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { alert, muted, row } from "./styles";

const TABS: { key: ExamStatus; label: string }[] = [
  { key: "awaiting_authorization", label: "Aguardando autorização" },
  { key: "awaiting_schedule", label: "A agendar" },
  { key: "scheduled", label: "Agendados" },
  { key: "collected", label: "Coletados" },
  { key: "resulted", label: "Com resultado" }
];

export function UnitExamList({ unit }: { unit: HealthUnit }) {
  const [ tab, setTab ] = useState<ExamStatus>("awaiting_schedule");
  const [ open, setOpen ] = useState<string | null>(null);
  const { query, orders } = useExamOrderPages([ EXAM_ORDERS_KEY, "unit", unit.id, tab ],
    (before) => listExamOrders({ unitId: unit.id, statuses: [ tab ], before }));

  return (
    <Panel title="Exames da unidade" sub={unit.name}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SegmentedControl<ExamStatus> options={TABS} value={tab} onChange={(t) => { setTab(t); setOpen(null); }} />
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
        {query.isSuccess && (
          <DataTable<ExamOrder>
            cols={[
              { label: "Código", w: "1fr", render: (o) => <span className="mono">{o.short_code}</span> },
              { label: "Paciente", w: "1.3fr", card: "title", render: (o) => o.patient.display_name },
              { label: "Exame", w: "1.6fr", render: (o) => (
                <span style={row}><span>{o.label}</span>{o.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}</span>
              ) },
              { label: "Prestador", w: "1.2fr", render: (o) => o.provider?.name ?? "—" },
              { label: "Agendado", w: "1fr", render: (o) => (o.scheduled_at ? fmtDateTime(o.scheduled_at) : "—") },
              { label: "Prazo", w: "1.2fr", render: (o) => overdueLabel(o.overdue) },
              { label: "", w: "auto", align: "right", card: "actions", render: (o) => (
                <button type="button" aria-label={`Abrir ${o.label} de ${o.patient.display_name}`} style={secondaryButtonStyle}
                  onClick={() => setOpen(o.id)}>Abrir</button>
              ) }
            ]}
            rows={orders} rowKey={(o) => o.id} empty="nenhum exame nesta situação"
          />
        )}
        {query.hasNextPage && (
          <div><button type="button" style={secondaryButtonStyle} onClick={() => void query.fetchNextPage()}>Carregar mais</button></div>
        )}
        {open && <ExamOrderDetail key={open} id={open} onClose={() => setOpen(null)} />}
      </div>
    </Panel>
  );
}
