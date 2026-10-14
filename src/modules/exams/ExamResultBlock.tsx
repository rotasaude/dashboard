// src/modules/exams/ExamResultBlock.tsx
// O resultado (contrato §2 `<exam_result>`): data, laboratório, origem,
// "crítico", os valores e o laudo. Duas visões: a clínica traz valores,
// crítico e laudo; a administrativa (unidade, regulador) não traz nenhum dos
// três — mostra-se o que vem, sem supor o que falta. `critical` de fora
// cobre a escalada por crítico registrada no andamento (A31).
import { useState } from "react";
import type { ExamResult, ExamResultValue } from "../../lib/api";
import { SOURCE_LABEL, fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { openExamPdf } from "./openExamPdf";
import { alert, box, muted, row } from "./styles";

export function ExamResultBlock({ result, onExpired, critical }: { result: ExamResult; onExpired(): void; critical?: boolean }) {
  const [ error, setError ] = useState<string | null>(null);
  const clinical = result.values !== undefined || result.pdf_url !== undefined || result.critical !== undefined;
  const values = result.values ?? [];
  const pdfUrl = result.pdf_url ?? null;
  const isCritical = result.critical === true || (clinical && critical === true);

  async function open() {
    if (!pdfUrl) return;
    setError(null);
    const outcome = await openExamPdf(pdfUrl);
    if (outcome.ok) return;
    setError(outcome.text);
    if (outcome.expired) onExpired();
  }

  return (
    <section aria-label="Resultado" style={box}>
      <div style={row}>
        <strong>{`Resultado liberado em ${fmtDay(result.released_on)}`}</strong>
        {isCritical && <Tag tone="down">crítico</Tag>}
        {result.origin === "external" && <Tag>externo</Tag>}
      </div>
      <p style={muted}>{`${result.laboratory_name} · ${SOURCE_LABEL[result.source] ?? result.source}`}</p>
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
      {result.values !== undefined && values.length === 0 && <p style={muted}>sem valores digitados — veja o laudo</p>}
      {result.acknowledged_at && <p style={muted}>{`ciência em ${fmtDateTime(result.acknowledged_at)}`}</p>}
      {pdfUrl && <div><ActionButton variant="secondary" onClick={open}>Abrir laudo</ActionButton></div>}
      {error && <p role="alert" style={alert}>{error}</p>}
    </section>
  );
}
