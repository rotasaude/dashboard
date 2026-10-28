// src/modules/regulation/RequestTable.tsx
// A fila regulada em tabela (módulo 26a; F-26.3). A ordem é a do api (vencidos,
// cor, data): a tabela não reordena e não numera linha. "Abrir" fica numa coluna
// própria, então nunca há botão dentro de botão. Cor e situação nova do api
// aparecem cruas; nada some. Cor só por papéis do tema (Tag).
import type { RegulationRequest } from "../../lib/api";
import { dueText, typeLabel, waitDays, waitText } from "../../lib/regulation";
import { fmtDateTime } from "../../lib/format";
import { documentText } from "../../lib/patientDocument";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { ColorCell } from "./ColorCell";
import { secondaryButtonStyle } from "../../components/formStyles";

export const NO_NAME = "pessoa sem nome no cadastro";

const stackCell = { display: "flex", flexDirection: "column", gap: 2 } as const;
const mutedText = { fontSize: 11, color: "var(--ink3)" } as const;

export function RequestTable({ rows, today, onOpen, empty = "nenhum pedido nesta aba" }: {
  rows: RegulationRequest[]; today: string; onOpen(r: RegulationRequest): void; empty?: string;
}) {
  const cols: Column<RegulationRequest>[] = [
    { label: "Cor", w: "0.8fr", render: (r) => <ColorCell request={r} /> },
    {
      label: "Encaminhamento", w: "1.6fr", card: "title", render: (r) => (
        <span style={stackCell}>
          <strong>{r.target.name}</strong>
          <span className="mono" style={mutedText}>{typeLabel(r.type)}</span>
        </span>
      )
    },
    {
      label: "Paciente", w: "1.6fr", render: (r) => (
        <span style={stackCell}>
          <strong>{r.patient.display_name || NO_NAME}</strong>
          <span className="mono" style={mutedText}>{documentText(r.patient)}</span>
        </span>
      )
    },
    {
      label: "Solicitante", w: "1.3fr", render: (r) => (
        <span style={stackCell}>
          <span>{r.requester.name}</span>
          {r.requester.unit && <span className="mono" style={mutedText}>{r.requester.unit.name}</span>}
        </span>
      )
    },
    { label: "Pedido em", w: "1fr", render: (r) => fmtDateTime(r.requested_at) },
    { label: "Espera", w: "0.8fr", render: (r) => (r.requested_at ? waitText(waitDays(r.requested_at, today)) : "—") },
    {
      label: "Prazo", w: "1fr", render: (r) => r.overdue
        ? <Tag tone="down">{dueText(r.due_on, true, today)}</Tag>
        : dueText(r.due_on, false, today)
    },
    {
      label: "Ação", w: "90px", card: "actions", render: (r) => (
        // Nome distinto por linha, sem o nome da pessoa: alvo e data do pedido.
        <button type="button" style={secondaryButtonStyle} onClick={() => onOpen(r)}
          aria-label={`Abrir pedido de ${r.target.name} de ${fmtDateTime(r.requested_at)}`}>Abrir</button>
      )
    }
  ];
  return <DataTable cols={cols} rows={rows} rowKey={(r) => r.id} empty={empty} />;
}
