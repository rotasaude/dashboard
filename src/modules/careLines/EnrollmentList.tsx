// src/modules/careLines/EnrollmentList.tsx
// Lista nominal das inscrições (contrato §5): pessoa, linha, a pior situação
// (do api; a tela só calcula sem `worst_status`, e `untracked` nunca piora) e
// cada boa prática em frase. No telefone vira cartão (pessoa no título).
import type { CareEnrollment, CarePracticeStatus } from "../../lib/api";
import { channelLabel, fmtDay, outcomeLabel, personName, personStatus, practiceText, statusLabel, statusTone } from "../../lib/careLines";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { list } from "../exams/styles";

const PRACTICE_COLOR: Record<string, string> = { overdue: "var(--down)", untracked: "var(--ink3)" };

export function PracticeList({ practices }: { practices: CarePracticeStatus[] }) {
  return (
    <ul style={list}>
      {practices.map((p) => (
        <li key={p.key}>
          <strong>{p.label}</strong>: <span style={{ color: PRACTICE_COLOR[p.status] ?? "var(--ink)" }}>{practiceText(p)}</span>
        </li>
      ))}
    </ul>
  );
}

export const personLine = (e: Pick<CareEnrollment, "person">) =>
  `${personName(e.person)}${e.person.age !== null ? ` · ${e.person.age} anos` : ""}`;

export function EnrollmentList({ rows, onOpen }: { rows: CareEnrollment[]; onOpen?(e: CareEnrollment): void }) {
  const cols: Column<CareEnrollment>[] = [
    { label: "Pessoa", w: "1.5fr", card: "title", render: personLine },
    { label: "Linha", w: "1.1fr", render: (e) => e.care_line.name },
    { label: "Situação", w: "130px", render: (e) => { const s = personStatus(e); return <Tag tone={statusTone(s)}>{statusLabel(s)}</Tag>; } },
    { label: "Boas práticas", w: "3fr", render: (e) => <PracticeList practices={e.practices} /> },
    {
      label: "Último contato", w: "1.3fr",
      render: (e) => (e.last_contact ? `${channelLabel(e.last_contact.channel)} · ${outcomeLabel(e.last_contact.outcome)} · ${fmtDay(e.last_contact.at)}` : "nenhum")
    }
  ];
  if (onOpen) cols.push({
    label: "Ação", w: "100px", card: "actions",
    render: (e) => <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ${personName(e.person)}`} onClick={() => onOpen(e)}>Abrir</button>
  });
  return <DataTable<CareEnrollment> cols={cols} rows={rows} rowKey={(e) => e.id} empty="ninguém nesta lista" />;
}
