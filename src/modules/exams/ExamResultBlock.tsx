// src/modules/exams/ExamResultBlock.tsx
// O resultado (contrato §2 `<exam_result>`): data, laboratório, origem,
// "crítico", os valores e o laudo. Duas visões: a clínica traz valores,
// crítico e laudo; a administrativa (unidade, regulador) não traz nenhum dos
// três — a clínica sempre manda `critical` (booleano), então é ele que decide
// a visão. `critical` de fora cobre a escalada por crítico do andamento (A31).
// `onExpired`: o link do laudo venceu ou sumiu (410/404) — releia o exame.
import { useState } from "react";
import type { ExamResult, ExamResultValue } from "../../lib/api";
import { SOURCE_LABEL, fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { openExamPdf } from "./openExamPdf";
import { alert, box, muted, row } from "./styles";

export function ExamResultBlock({ result, onExpired, critical, superseded = false }: {
  result: ExamResult; onExpired(): void; critical?: boolean; superseded?: boolean;
}) {
  const [ error, setError ] = useState<string | null>(null);
  const clinical = typeof result.critical === "boolean";
  const values = result.values ?? [];
  const pdfUrl = result.pdf_url ?? null;
  const isCritical = result.critical === true || (clinical && critical === true);

  async function open() {
    if (!pdfUrl) return;
    setError(null);
    const outcome = await openExamPdf(pdfUrl);
    if (outcome.ok) return;
    setError(outcome.text);
    if (outcome.reread) onExpired();
  }

  return (
    <section aria-label={superseded ? "Resultado substituído" : "Resultado"} style={box}>
      <div style={row}>
        <strong>{`Resultado liberado em ${fmtDay(result.released_on)}`}</strong>
        {superseded && <Tag tone="neutral">substituído</Tag>}
        {isCritical && <Tag tone="down">crítico</Tag>}
        {result.origin === "external" && <Tag>externo</Tag>}
      </div>
      <p style={muted}>{`${result.laboratory_name} · ${SOURCE_LABEL[result.source] ?? result.source}`}</p>
      {superseded && result.superseded_at && <p style={muted}>{`deixou de valer em ${fmtDateTime(result.superseded_at)}`}</p>}
      {!superseded && result.replaces_result_id && <p style={muted}>laudo retificado — substitui o anterior</p>}
      {!clinical && <p style={muted}>valores e laudo ficam com quem pediu e com a equipe</p>}
      {values.length > 0 && (
        <DataTable<ExamResultValue>
          cols={[
            { label: "Campo", w: "1.4fr", card: "title", render: (v) => v.label },
            { label: "Valor", w: "1fr", render: (v) => `${v.value}${v.unit ? ` ${v.unit}` : ""}` },
            { label: "LOINC", w: "0.8fr", render: (v) => <span className="mono">{v.loinc ?? "—"}</span> }
          ]}
          rows={values}
          rowKey={(v, i) => `${v.key ?? v.loinc ?? "valor"}:${i}`}
        />
      )}
      {clinical && values.length === 0 && <p style={muted}>{pdfUrl ? "sem valores digitados — veja o laudo" : "sem valores digitados"}</p>}
      {result.acknowledged_at && <p style={muted}>{`ciência em ${fmtDateTime(result.acknowledged_at)}`}</p>}
      {pdfUrl && <div><ActionButton variant="secondary" onClick={open}>Abrir laudo</ActionButton></div>}
      {error && <p role="alert" style={alert}>{error}</p>}
    </section>
  );
}
