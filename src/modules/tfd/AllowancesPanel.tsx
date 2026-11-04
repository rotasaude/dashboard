// Ajuda de custo do TFD (módulo 30, F-30.6). O api calcula quando o segundo trecho de um par é dado como realizado (tabela SIGTAP
// da competência + complemento da cidade) e o processo já traz as linhas; a tela só mostra e soma o devido e o pago, sem recalcular.
import type { TfdAllowance, TfdCase } from "../../lib/api";
import { allowanceKindLabel, allowancePersonLabel, allowanceTotal, paidTotal } from "../../lib/tfd";
import { fmtCents } from "../../lib/transport";
import { DataTable, type Column } from "../../components/DataTable";
import { muted } from "../exams/styles";

export const ALLOWANCE_RULE_NOTE = "O valor é calculado pela regra (tabela SIGTAP da competência + complemento da cidade); a tela não recalcula.";

const cols: Column<TfdAllowance>[] = [
  { label: "Pessoa", w: "0.8fr", card: "title", render: (a) => allowancePersonLabel(a.person) },
  { label: "Tipo", w: "1.2fr", render: (a) => allowanceKindLabel(a.kind) },
  { label: "Código SIGTAP", w: "0.9fr", render: (a) => <span className="mono">{a.sigtap_code}</span> },
  { label: "Quantidade", w: "0.6fr", align: "right", render: (a) => String(a.quantity) },
  { label: "Tabela", w: "0.7fr", align: "right", render: (a) => fmtCents(a.table_cents) },
  { label: "Complemento", w: "0.7fr", align: "right", render: (a) => fmtCents(a.complement_cents) },
  { label: "Total", w: "0.7fr", align: "right", render: (a) => fmtCents(a.total_cents) }
];

export function AllowancesPanel({ tfdCase: c }: { tfdCase: TfdCase }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {c.allowances.length === 0
        ? <p style={muted}>a ajuda de custo é calculada quando a volta é marcada como realizada</p>
        : <DataTable<TfdAllowance> cols={cols} rows={c.allowances} rowKey={(a) => a.id} />}
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink)" }}>
        {`Total devido: ${fmtCents(allowanceTotal(c.allowances))} · pago ${fmtCents(paidTotal(c.payments))}`}
      </p>
      <p style={muted}>{ALLOWANCE_RULE_NOTE}</p>
    </div>
  );
}
