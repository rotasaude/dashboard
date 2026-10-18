// Uma corrida: situação, horários e os valores com z, regras disparadas,
// desfecho, origem e o lote do reagente (contrato §3 e §7).
import type { QcRun, QcValue } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { fmtDecimal, fmtZ, outcomeLabel, outcomeTone, rulesText, runStatusLabel, runStatusTone } from "../../lib/qc";
import { fmtDateTime } from "../../lib/format";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { ReagentLotTag } from "../inventory/ReagentLotTag";
import { box, muted, row } from "../exams/styles";

export function QcRunCard({ run, analyte }: { run: QcRun; analyte(key: string): string }) {
  // Estoque desligado: a marca do lote não aparece, então a coluna também some.
  const { user } = useAuth();
  const inventory = hasFeature(user, "lab_inventory");
  return (
    <section aria-label={`Corrida de ${fmtDateTime(run.started_at)}`} style={box}>
      <div style={row}>
        <Tag tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Tag>
        <span style={muted}>{`início ${fmtDateTime(run.started_at)}${run.evaluated_at ? ` · avaliada ${fmtDateTime(run.evaluated_at)}` : ""}`}</span>
      </div>
      <DataTable<QcValue>
        cols={[
          { label: "Nível · analito", w: "1.6fr", card: "title", render: (v) => `${v.level} · ${analyte(v.analyte_key)}` },
          { label: "Valor", w: "0.7fr", align: "right", render: (v) => fmtDecimal(v.value) },
          { label: "z", w: "0.5fr", align: "right", render: (v) => fmtZ(v.z_score) },
          { label: "Regras", w: "0.9fr", render: (v) => (v.rules_fired.length > 0 ? rulesText(v.rules_fired) : "—") },
          { label: "Desfecho", w: "0.8fr", render: (v) => <Tag tone={outcomeTone(v.outcome)}>{outcomeLabel(v.outcome)}</Tag> },
          { label: "Origem", w: "1fr", render: (v) => (v.source === "hl7" ? "aparelho" : `digitado${v.entered_by ? ` por ${v.entered_by}` : ""}`) },
          ...(inventory ? [ { label: "Reagente", w: "1fr", render: (v: QcValue) => <ReagentLotTag row={v} /> } ] : [])
        ]}
        rows={run.values} rowKey={(v) => v.id} empty="nenhum valor nesta corrida"
      />
    </section>
  );
}
