// src/modules/lab/LabReportList.tsx
// Laudos de uma requisição: versão, parcial, situação, assinatura e o PDF
// (URL curta assinada — vencida relê). Só o laudo `released` se retifica; o
// `withdrawn` (B13) e o `pending_signature` não.
import { useState } from "react";
import type { LabReportSummary } from "../../lib/api";
import { reportStatusLabel, signatureLabel } from "../../lib/lab";
import { fmtDateTime } from "../../lib/format";
import { secondaryButtonStyle } from "../../components/formStyles";
import { openExamPdf } from "../exams/openExamPdf";
import { alert, list, row } from "../exams/styles";

export function LabReportList({ reports, onRectify, onExpired }: {
  reports: LabReportSummary[]; onRectify(r: LabReportSummary): void; onExpired(): void;
}) {
  const [ error, setError ] = useState<string | null>(null);
  const byId = new Map(reports.map((r) => [ r.id, r ]));
  async function open(r: LabReportSummary) {
    if (!r.pdf_url) return;
    setError(null);
    const out = await openExamPdf(r.pdf_url);
    if (!out.ok) { setError(out.text); if (out.reread) onExpired(); }
  }
  return (
    <>
      <ul aria-label="laudos" style={list}>
        {reports.map((r) => (
          <li key={r.id} style={row}>
            <span>
              {`Laudo v${r.version}${r.partial ? " (parcial)" : ""} · ${reportStatusLabel(r.status)} · ${signatureLabel(r.signature_kind)}`}
              {r.released_at ? ` · ${fmtDateTime(r.released_at)}${r.released_by ? ` por ${r.released_by}` : ""}` : ""}
              {r.replaces_report_id ? ` · substitui a v${byId.get(r.replaces_report_id)?.version ?? "anterior"}` : ""}
            </span>
            {r.pdf_url && <button type="button" style={secondaryButtonStyle} onClick={() => void open(r)}>Abrir laudo</button>}
            {r.status === "released" && <button type="button" style={secondaryButtonStyle} onClick={() => onRectify(r)}>Retificar</button>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" style={alert}>{error}</p>}
    </>
  );
}
