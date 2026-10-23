// src/modules/careLines/EnrollmentDetail.tsx
// Detalhe de uma inscrição (contrato §5; Divergência D5): cada boa prática
// com a última vez, o vencimento e a contagem; o histórico de contatos;
// registrar contato. Leitura NOMINAL com trilha: ao abrir e depois de uma
// ação, nunca sozinha. Inscrição encerrada fica só leitura.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCareEnrollment, type CareContact, type CarePracticeStatus } from "../../lib/api";
import {
  ENROLLMENT_KEY, NOMINAL_QUERY, careLineError, channelLabel, endReasonLabel, fmtDay, outcomeLabel, personName, personStatus, statusLabel,
  statusTone
} from "../../lib/careLines";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { KeyValue } from "../../components/KeyValue";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, grid, list, muted, row, stack } from "../exams/styles";
import { ContactForm } from "./ContactForm";

export type DetailAction = "contact" | null;

const NO_RECORDER = "profissional sem nome no cadastro";
const contactLine = (c: CareContact) =>
  `${fmtDay(c.recorded_at)} · ${channelLabel(c.channel)} · ${outcomeLabel(c.outcome)} · ${c.recorded_by?.name ?? NO_RECORDER}`;

export function EnrollmentDetail({ enrollmentId, onChanged, onClose }: {
  enrollmentId: string; onChanged(message: string, close?: boolean): void; onClose(): void;
}) {
  const query = useQuery({ queryKey: [ ENROLLMENT_KEY, enrollmentId ], queryFn: () => getCareEnrollment(enrollmentId), ...NOMINAL_QUERY });
  const [ action, setAction ] = useState<DetailAction>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const e = query.data;
  const active = e?.status === "active";
  const contacts = [ ...(e?.contacts ?? []) ].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));

  // Depois de uma ação: relê o detalhe (ou fecha) e avisa a tela, que relê a lista.
  function done(message: string, close = false) {
    setAction(null);
    setNotice(message);
    if (!close) void query.refetch();
    onChanged(message, close);
  }

  return (
    <Panel title={e ? `Inscrição de ${personName(e.person)}` : "Inscrição"} sub={e ? `${e.care_line.name} · ${e.team.name}` : undefined}
      right={<button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>}>
      <div style={{ ...stack, padding: 16 }}>
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{careLineError(query.error)}</p>}
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {e && (
          <>
            <div style={grid}>
              <KeyValue k="Situação" v={statusLabel(personStatus(e))} mono={false} />
              <KeyValue k="Inscrita em" v={fmtDay(e.enrolled_at)} />
              {e.anchor_date && <KeyValue k={e.care_line.requires_anchor === "lmp" ? "DUM" : "Data de referência"} v={fmtDay(e.anchor_date)} />}
              {!active && <KeyValue k="Inscrição" v={e.ended_reason ? `encerrada — ${endReasonLabel(e.ended_reason)}` : "encerrada"} mono={false} />}
            </div>
            <DataTable<CarePracticeStatus>
              cols={[
                { label: "Boa prática", w: "2fr", card: "title", render: (p) => p.label },
                { label: "Situação", w: "150px", render: (p) => <Tag tone={statusTone(p.status)}>{statusLabel(p.status)}</Tag> },
                { label: "Última vez", w: "110px", render: (p) => (p.status === "untracked" ? "—" : p.done_at ? fmtDay(p.done_at) : "nunca") },
                { label: "Vence", w: "110px", render: (p) => (p.status === "untracked" ? "—" : fmtDay(p.due_on)) },
                { label: "Contagem", w: "110px", render: (p) => (p.count !== null && p.expected !== null ? `${p.count} de ${p.expected}` : "—") }
              ]}
              rows={e.practices} rowKey={(p) => p.key}
            />
            <section aria-label="Contatos" style={stack}>
              <strong>Contatos</strong>
              {contacts.length === 0 ? <p style={muted}>nenhum contato registrado</p> : (
                <ul style={list}>
                  {contacts.map((c, i) => (
                    <li key={c.id ?? `${c.recorded_at}-${i}`}>
                      {contactLine(c)}
                      {c.note && <span style={noteStyle}> {c.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {active && action === null && (
              <div style={row}>
                <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setAction("contact"); }}>Registrar contato</button>
              </div>
            )}
            {active && action === "contact" && (
              <ContactForm enrollmentId={e.id} onSaved={() => done("Contato registrado.")} onStale={(m) => done(m, true)}
                onCancel={() => setAction(null)} />
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const noteStyle: CSSProperties = { color: "var(--ink2)" };
