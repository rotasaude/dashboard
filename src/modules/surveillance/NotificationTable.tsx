// src/modules/surveillance/NotificationTable.tsx
// A fila da vigilância em tabela (módulo 25; F-25.4). A ordem é a do api
// (vencidas e imediatas primeiro): a tabela não reordena. A ação "Abrir" fica
// numa coluna própria — a linha não é clicável, então nunca há botão dentro de
// botão. Situação ou código novo do api aparece cru; nada some.
import type { SurveillanceNotification } from "../../lib/api";
import { NO_NAME, NO_NEIGHBORHOOD, statusLabel, statusTone } from "../../lib/surveillance";
import { fmtDateTime } from "../../lib/format";
import { documentText } from "../../lib/patientDocument";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";

const deadlineCell = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 } as const;
const tagRow = { display: "flex", flexWrap: "wrap", gap: 4 } as const;
const personCell = { display: "flex", flexDirection: "column", gap: 2 } as const;
const mutedText = { fontSize: 11, color: "var(--ink3)" } as const;

export function NotificationTable({ rows, onOpen }: { rows: SurveillanceNotification[]; onOpen(id: string): void }) {
  const cols: Column<SurveillanceNotification>[] = [
    {
      label: "Prazo", w: "1.2fr", render: (n) => (
        <span style={deadlineCell}>
          {(n.overdue || n.deadline === "immediate") && (
            <span style={tagRow}>
              {n.overdue && <Tag tone="down">vencida</Tag>}
              {n.deadline === "immediate" && <Tag tone="warn">imediata</Tag>}
            </span>
          )}
          <span>{fmtDateTime(n.due_at)}</span>
        </span>
      )
    },
    {
      label: "Pessoa", w: "1.6fr", card: "title", render: (n) => (
        <span style={personCell}>
          <strong>{n.patient.display_name || NO_NAME}</strong>
          <span className="mono" style={mutedText}>{documentText(n.patient)}</span>
        </span>
      )
    },
    { label: "Doença", w: "1.2fr", render: (n) => n.disease.name || n.disease.code },
    { label: "Unidade", w: "1.2fr", render: (n) => n.unit.name },
    { label: "Bairro", w: "1fr", render: (n) => n.neighborhood?.name || NO_NEIGHBORHOOD },
    { label: "Situação", w: "1.2fr", render: (n) => <Tag tone={statusTone(n.status)}>{statusLabel(n.status)}</Tag> },
    {
      label: "Ação", w: "90px", card: "actions", render: (n) => (
        <button type="button" style={secondaryButtonStyle} onClick={() => onOpen(n.id)}>Abrir</button>
      )
    }
  ];
  return <DataTable cols={cols} rows={rows} rowKey={(n) => n.id} empty="nenhuma notificação nesta aba" />;
}
