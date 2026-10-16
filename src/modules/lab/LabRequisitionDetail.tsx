// src/modules/lab/LabRequisitionDetail.tsx
// A requisição (contrato §2 `<lab_requisition>`): situação, prazo previsto,
// exames, amostras e laudos; comprovante, etiquetas (reimpressão confirmada:
// fica na trilha), laudo e entrega. 409 relê; nada no cache (gcTime 0).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deliverRequisition, errorCode, fetchLabLabels, fetchLabReceipt, getLabRequisition,
  type LabItem, type LabReportSummary, type LabSample
} from "../../lib/api";
import {
  LAB_REQUISITION_KEY, itemStatusLabel, labError, refreshLab, reportStatusLabel, requisitionStatusLabel, requisitionStatusTone,
  sampleStatusLabel, sampleStatusTone, signatureLabel
} from "../../lib/lab";
import { fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { ConfirmButton } from "../../components/ConfirmButton";
import { DataTable } from "../../components/DataTable";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { openExamPdf } from "../exams/openExamPdf";
import { openLabPdf } from "./openLabPdf";
import { alert, fieldLabel, grid, muted, panel, row, title } from "../exams/styles";

export function LabRequisitionDetail({ id, onClose }: { id: string; onClose(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ LAB_REQUISITION_KEY, id ], queryFn: () => getLabRequisition(id), gcTime: 0, staleTime: 0, retry: false, refetchOnReconnect: false });
  const [ error, setError ] = useState<string | null>(null);
  const [ deliveredTo, setDeliveredTo ] = useState("");
  const r = query.data;

  async function pdf(fetcher: Parameters<typeof openLabPdf>[0]) {
    setError(null);
    const out = await openLabPdf(fetcher);
    if (!out.ok) setError(out.text);
  }

  async function report(rep: LabReportSummary) {
    if (!rep.pdf_url) return;
    setError(null);
    const out = await openExamPdf(rep.pdf_url);
    if (!out.ok) { setError(out.text); if (out.reread) void query.refetch(); }
  }

  async function deliver() {
    if (!deliveredTo.trim()) { setError("informe quem retirou o laudo"); return; }
    setError(null);
    try {
      await deliverRequisition(id, deliveredTo.trim());
      setDeliveredTo("");
      await refreshLab(queryClient);
    } catch (err) {
      setError(labError(err));
      if (errorCode(err) === "invalid_transition") void query.refetch();
    }
  }

  if (query.isPending) return <p className="mono" style={muted}>carregando a requisição…</p>;
  if (query.isError || !r) return <p role="alert" style={alert}>{labError(query.error)}</p>;

  return (
    <section aria-label={`Requisição ${r.number}`} style={panel}>
      <div style={row}>
        <h3 style={title}>{`Requisição ${r.number}`}</h3>
        <Tag tone={requisitionStatusTone(r.status)}>{requisitionStatusLabel(r.status)}</Tag>
        {r.urgent && <Tag tone="urgent">urgente</Tag>}
      </div>
      <div style={grid}>
        <KeyValue k="Paciente" v={r.patient.display_name} mono={false} />
        <KeyValue k="Nascimento" v={fmtDay(r.patient.birth_date)} />
        <KeyValue k="Origem" v={r.origin_unit.name} mono={false} />
        <KeyValue k="Previsão de entrega" v={fmtDay(r.expected_delivery_on)} />
      </div>
      <DataTable<LabItem>
        cols={[
          { label: "Exame", w: "2fr", card: "title", render: (i) => i.label },
          { label: "SIGTAP", w: "1fr", render: (i) => <span className="mono">{i.sigtap_code}</span> },
          { label: "Versão", w: "0.6fr", render: (i) => `v${i.version}` },
          { label: "Situação", w: "1fr", render: (i) => itemStatusLabel(i.status) }
        ]}
        rows={r.items} rowKey={(i) => i.id}
      />
      <DataTable<LabSample>
        cols={[
          { label: "Etiqueta", w: "1.2fr", card: "title", render: (s) => <span className="mono">{s.barcode}</span> },
          { label: "Material", w: "1.6fr", render: (s) => `${s.material} · ${s.container}` },
          { label: "Situação", w: "1.6fr", render: (s) => (
            <Tag tone={sampleStatusTone(s.status)}>
              {`${sampleStatusLabel(s)}${s.rejection_reason ? ` — ${s.rejection_reason}` : ""}${s.restriction_note ? ` — ${s.restriction_note}` : ""}`}
            </Tag>
          ) },
          { label: "", w: "auto", card: "actions", render: (s) => (
            s.status === "rejected" || s.status === "not_received" ? null : (
              <ConfirmButton label="Reimprimir" question="A reimpressão fica registrada. Reimprimir a etiqueta?"
                onConfirm={() => pdf(() => fetchLabLabels(r.id, [ s.id ]))} />
            )
          ) }
        ]}
        rows={r.samples} rowKey={(s) => s.id}
      />
      {r.reports.length > 0 && (
        <ul aria-label="laudos" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
          {r.reports.map((rep) => (
            <li key={rep.id}>
              {`Laudo v${rep.version}${rep.partial ? " (parcial)" : ""} · ${reportStatusLabel(rep.status)} · ${signatureLabel(rep.signature_kind)}`}
              {rep.pdf_url && <> <button type="button" style={secondaryButtonStyle} onClick={() => void report(rep)}>Abrir laudo</button></>}
            </li>
          ))}
        </ul>
      )}
      <div style={row}>
        <ActionButton variant="secondary" onClick={() => pdf(() => fetchLabReceipt(r.id))}>Comprovante</ActionButton>
        <ActionButton variant="secondary" onClick={() => pdf(() => fetchLabLabels(r.id, r.samples.map((s) => s.id)))}>Imprimir etiquetas</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
      </div>
      {r.status === "delivered" && r.delivered_to && (
        <p style={muted}>{`Entregue a ${r.delivered_to} · ${fmtDateTime(r.delivered_at)}`}</p>
      )}
      {r.status === "released" && r.reports.some((rep) => rep.status === "released") && (
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            Quem retirou
            <input value={deliveredTo} autoComplete="off" style={inputStyle} onChange={(e) => setDeliveredTo(e.target.value)} />
          </label>
          <ActionButton onClick={deliver}>Registrar entrega</ActionButton>
        </div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
    </section>
  );
}
