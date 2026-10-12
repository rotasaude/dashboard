// src/modules/timeline/DocumentDetail.tsx
// Um documento clínico aberto pela linha do tempo (módulo 20): o resumo e o
// Imprimir do 19c (`printDocument`). A Notificação de papel (19d) não tem PDF.
// Sem texto do documento aqui: o conteúdo está no PDF.
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { getClinicalDocument } from "../../lib/api";
import { documentError, documentSituation, issueModeLabel, kindLabel } from "../../lib/clinicalDocuments";
import { endsOpening } from "../../lib/timeline";
import { fmtDateTime } from "../../lib/format";
import { KeyValue } from "../../components/KeyValue";
import { secondaryButtonStyle, disabledButtonStyle } from "../../components/formStyles";
import { printDocument } from "../documents/printDocument";

export const TIMELINE_DOCUMENT_KEY = "timelineDocument";

interface Props { id: string; onClose(): void; endOnOutOfContext?: boolean; onOpeningRequired?(): void }

export function DocumentDetail({ id, onClose, endOnOutOfContext = false, onOpeningRequired }: Props) {
  const query = useQuery({
    queryKey: [ TIMELINE_DOCUMENT_KEY, id ], queryFn: () => getClinicalDocument(id), gcTime: 0, staleTime: 0, retry: false
  });
  const [ printing, setPrinting ] = useState(false);
  const [ printError, setPrintError ] = useState<string | null>(null);
  const ended = query.isError && endsOpening(query.error, endOnOutOfContext);
  useEffect(() => { if (ended) onOpeningRequired?.(); }, [ ended, onOpeningRequired ]);

  async function print() {
    if (printing) return;
    setPrinting(true); setPrintError(null);
    setPrintError(await printDocument(id, (err) => documentError(err)));
    setPrinting(false);
  }

  const d = query.data;
  return (
    <section aria-label="Documento" style={panel}>
      <strong>Documento</strong>
      {query.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando o documento…</p>}
      {query.isError && !ended && <p role="alert" style={alert}>{documentError(query.error)}</p>}
      {printError && <p role="alert" style={alert}>{printError}</p>}
      {d && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <KeyValue k="Documento" v={kindLabel(d.kind)} mono={false} />
          <KeyValue k="Situação" v={documentSituation(d)} mono={false} />
          <KeyValue k="Modo" v={issueModeLabel(d.issue_mode)} />
          <KeyValue k="Emitido em" v={fmtDateTime(d.issued_at)} />
          <KeyValue k="Profissional" v={d.author.name} mono={false} />
          <KeyValue k="Código" v={d.short_code ?? "—"} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {d && d.kind !== "controlled_notification_record" && (
          <button type="button" disabled={printing} style={printing ? disabledButtonStyle : secondaryButtonStyle} onClick={() => void print()}>
            Imprimir
          </button>
        )}
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar documento</button>
      </div>
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
