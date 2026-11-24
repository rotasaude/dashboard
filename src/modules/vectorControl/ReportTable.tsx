// src/modules/vectorControl/ReportTable.tsx
// Tabela de um relatório do 35a (VectorControl::Reports; contrato §10, D-13): as colunas na ordem do api, com o rótulo dele.
// Contagem com o número da cidade e, suprimida (Admin::SmallCount, hoje só os casos do `blocks`), "< 5" pelo fmtCount — nunca 0
// e nunca recalculada. Percentual e decimal chegam em texto ("37.5", "12.50") e saem com vírgula; percentual com uma casa;
// nulo (sem denominador) é "—". A tela não soma linhas: um total feito aqui revelaria a contagem suprimida (o api não manda
// total no `blocks` por isso). "provisório" quando o api diz (`provisional`, só o liraa); as `notes` abaixo.
import type { VectorReport } from "../../lib/api";
import { fmtCount, isSuppressed } from "../../lib/smallCount";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { muted, stack } from "../exams/styles";

type ReportRow = VectorReport["rows"][number];
type Kind = VectorReport["columns"][number]["kind"];

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function reportCell(v: ReportRow[string] | undefined, kind: Kind): string {
  if (v === null || v === undefined) return "—";
  if (isSuppressed(v)) return fmtCount(v, kind === "percent" ? "%" : undefined);
  if (kind === "percent") {
    const n = typeof v === "number" ? v : NUMERIC.test(v) ? Number(v) : null;
    return n === null ? String(v) : n.toFixed(1).replace(".", ",");
  }
  if (typeof v === "number") return fmtCount(v);
  return kind === "decimal" ? v.replace(".", ",") : v;
}

// O 35b reaproveita a tabela: o nome do relatório dele não é um `VectorReportName`.
export type TableReport = Omit<VectorReport, "name"> & { name: string };

export function ReportTable({ report, label = "Relatório", empty = "sem linhas para estes filtros" }: {
  report: TableReport; label?: string; empty?: string;
}) {
  const cols: Column<ReportRow>[] = report.columns.map((c, i) => ({
    label: c.label, w: c.kind === "text" ? "1.4fr" : "0.8fr", align: c.kind === "text" ? "left" : "right",
    ...(i === 0 ? { card: "title" as const } : {}),
    render: (r: ReportRow) => reportCell(r[c.key], c.kind)
  }));
  return (
    <div style={stack}>
      {report.provisional && <span><Tag tone="warn">provisório</Tag></span>}
      <DataTable<ReportRow> label={label} cols={cols} rows={report.rows} rowKey={(_, i) => String(i)} empty={empty} />
      {(report.notes ?? []).map((n) => <p key={n} style={muted}>{n}</p>)}
    </div>
  );
}
