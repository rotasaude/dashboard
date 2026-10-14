// src/modules/exams/PatientExams.tsx
// Aba "Exames" do paciente (spec §9): os exames dele com a situação, os
// resultados externos e o registro de um novo resultado externo. Quem lê e
// a trilha são do api (regras do 19a); nada fica no cache.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listExamOrders, listExternalResults, type ExamOrder, type ExternalExamResult } from "../../lib/api";
import {
  EXAM_ORDERS_KEY, EXTERNAL_RESULTS_KEY, examError, examRoles, examStatusLabel, examStatusTone, fmtDay, overdueLabel
} from "../../lib/exams";
import { useAuth } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import { useExamOrderPages } from "../../hooks/useExamOrderPages";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { ExternalResultForm } from "./ExternalResultForm";
import { openExamPdf } from "./openExamPdf";
import { alert, muted, okText, row } from "./styles";

export interface PatientExamsProps { patientId: string; consultationId?: string | null }

export function PatientExams({ patientId, consultationId = null }: PatientExamsProps) {
  const { query, orders } = useExamOrderPages([ EXAM_ORDERS_KEY, "patient", patientId ],
    (before) => listExamOrders({ patientId, before }));
  // A lista de externos é só do profissional (403 missing_role para os outros): sem o papel, nem lê.
  const { user } = useAuth();
  const roles = examRoles(user);
  const external = useQuery({
    queryKey: [ EXTERNAL_RESULTS_KEY, patientId ], queryFn: () => listExternalResults(patientId),
    enabled: roles.professional, gcTime: 0, staleTime: 0, retry: false
  });
  const [ open, setOpen ] = useState<string | null>(null);
  const [ adding, setAdding ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ pdfError, setPdfError ] = useState<string | null>(null);

  async function openPdf(r: ExternalExamResult) {
    if (!r.pdf_url) return;
    setPdfError(null);
    const outcome = await openExamPdf(r.pdf_url);
    if (outcome.ok) return;
    setPdfError(outcome.text);
    if (outcome.reread) void external.refetch();
  }

  return (
    <section aria-label="Exames do paciente" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {query.isPending && <p className="mono" style={muted}>carregando os exames…</p>}
      {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
      {query.isSuccess && (
        <DataTable<ExamOrder>
          cols={[
            { label: "Exame", w: "1.8fr", card: "title", render: (o) => <Labelled o={o} /> },
            { label: "Situação", w: "1fr", render: (o) => <Tag tone={examStatusTone(o.status)}>{examStatusLabel(o.status)}</Tag> },
            { label: "Desde", w: "1fr", render: (o) => fmtDateTime(o.status_changed_at) },
            { label: "Prazo", w: "1.2fr", render: (o) => overdueLabel(o.overdue) },
            { label: "", w: "auto", align: "right", card: "actions", render: (o) => (
              <button type="button" aria-label={`Abrir ${o.label}`} style={secondaryButtonStyle} onClick={() => setOpen(o.id)}>Abrir</button>
            ) }
          ]}
          rows={orders} rowKey={(o) => o.id} empty="nenhum exame pedido"
        />
      )}
      {query.hasNextPage && (
        <div><button type="button" style={secondaryButtonStyle} onClick={() => void query.fetchNextPage()}>Carregar mais</button></div>
      )}
      {open && <ExamOrderDetail key={open} id={open} onClose={() => setOpen(null)} />}

      {roles.professional && <section aria-label="Resultados externos" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 12.5 }}>Resultados externos</strong>
        {external.isError && <p role="alert" style={alert}>{examError(external.error)}</p>}
        {external.isSuccess && (
          <DataTable<ExternalExamResult>
            cols={[
              { label: "Exame", w: "1.8fr", card: "title", render: (r) => r.label },
              { label: "Laboratório", w: "1.2fr", render: (r) => r.laboratory_name },
              { label: "Liberado em", w: "1fr", render: (r) => fmtDay(r.released_on) },
              { label: "", w: "auto", align: "right", card: "actions", render: (r) => (r.pdf_url ? (
                <button type="button" aria-label={`Abrir laudo de ${r.label}`} style={secondaryButtonStyle} onClick={() => void openPdf(r)}>Abrir laudo</button>
              ) : null) }
            ]}
            rows={external.data} rowKey={(r) => r.id} empty="nenhum resultado externo"
          />
        )}
        {pdfError && <p role="alert" style={alert}>{pdfError}</p>}
      </section>}

      {adding ? (
        <ExternalResultForm patientId={patientId} consultationId={consultationId} onCancel={() => setAdding(false)}
          onDone={() => { setAdding(false); setNotice("Resultado externo registrado."); }} />
      ) : (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setAdding(true); }}>Registrar resultado externo</button>
        </div>
      )}
    </section>
  );
}

function Labelled({ o }: { o: ExamOrder }): ReactNode {
  return (
    <span style={row}>
      <span>{o.label}</span>
      {o.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}
    </span>
  );
}
