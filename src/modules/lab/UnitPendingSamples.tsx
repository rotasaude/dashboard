// src/modules/lab/UnitPendingSamples.tsx
// O que o laboratório devolveu para a UBS (spec §5.3–§5.4): recoletas (nova
// amostra ligada à rejeitada; imprime a etiqueta nova) e amostras da remessa
// que não chegaram. Lido ao abrir; sem releitura automática.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLabLabels, listUnitPending, type LabPendingSample } from "../../lib/api";
import { LAB_UNIT_PENDING_KEY, labError } from "../../lib/lab";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { ActionButton } from "../../components/ActionButton";
import { openLabPdf } from "./openLabPdf";
import { alert, muted, stack } from "../exams/styles";

export function UnitPendingSamples({ unitId }: { unitId: string }) {
  const query = useQuery({ queryKey: [ LAB_UNIT_PENDING_KEY, unitId ], queryFn: () => listUnitPending(unitId), gcTime: 0, staleTime: 0, retry: false });
  const [ error, setError ] = useState<string | null>(null);
  if (query.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (query.isError) return <p role="alert" style={alert}>{labError(query.error)}</p>;
  const label = async (s: LabPendingSample) => {
    setError(null);
    const out = await openLabPdf(() => fetchLabLabels(s.requisition.id, [ s.id ]));
    if (!out.ok) setError(out.text);
  };
  const cols = (withLabel: boolean) => [
    { label: "Etiqueta", w: "1.1fr", card: "title" as const, render: (s: LabPendingSample) => <span className="mono">{s.barcode}</span> },
    { label: "Requisição", w: "1fr", render: (s: LabPendingSample) => <span className="mono">{s.requisition.number}</span> },
    { label: "Paciente", w: "1.6fr", render: (s: LabPendingSample) => s.requisition.patient_display_name },
    { label: "Material", w: "1.2fr", render: (s: LabPendingSample) => s.material },
    ...(withLabel
      ? [ { label: "", w: "auto", card: "actions" as const, render: (s: LabPendingSample) => <ActionButton variant="secondary" onClick={() => label(s)}>Etiqueta</ActionButton> } ]
      : [ { label: "Coletada", w: "1fr", render: (s: LabPendingSample) => fmtDateTime(s.collected_at) } ])
  ];
  return (
    <div style={stack}>
      <Panel title="Recoletas pedidas pelo laboratório" sub="amostra rejeitada · colete de novo e envie">
        <DataTable<LabPendingSample> cols={cols(true)} rows={query.data.recollections} rowKey={(s) => s.id} empty="nenhuma recoleta" />
      </Panel>
      <Panel title="Amostras que não chegaram ao laboratório" sub="estavam na remessa e não foram lidas na conferência">
        <DataTable<LabPendingSample> cols={cols(false)} rows={query.data.not_received} rowKey={(s) => s.id} empty="nenhuma" />
      </Panel>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}
