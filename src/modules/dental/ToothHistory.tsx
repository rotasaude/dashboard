// Histórico do dente (F-28.3): leitura nominal (com trilha) só no clique. O api pagina os eventos do paciente — o dente não
// vai na URL (O13) —, então a tela filtra o dente e "Ver mais" segue o `next_before`.
import { useEffect, useRef, useState } from "react";
import { listChartEvents, type ChartEvent, type DentalVocabulary } from "../../lib/api";
import { dentalError, FACE_LABEL, situationLabel } from "../../lib/dental";
import { fmtDateTime } from "../../lib/format";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, list } from "../exams/styles";

interface Props { patientId: string; tooth: string; situations?: DentalVocabulary["situations"] }

function eventText(e: ChartEvent, situations?: DentalVocabulary["situations"]): string {
  const what = e.procedure ? e.procedure.name : e.situation ? situationLabel(e.situation, situations, e.face ? "face" : e.part) : "—";
  const where = e.face ? `face ${FACE_LABEL[e.face]}` : e.part === "root" ? "raiz" : "coroa";
  return `${fmtDateTime(e.at)} · ${what} · ${where} · ${e.by.name} (${e.by.cbo}) · ${e.addendum_id ? "adendo" : "consulta"}`;
}

export function ToothHistory({ patientId, tooth, situations }: Props) {
  const [ events, setEvents ] = useState<ChartEvent[] | null>(null);
  const [ next, setNext ] = useState<string | null>(null);
  const [ lastEmpty, setLastEmpty ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const token = useRef(0);
  useEffect(() => { token.current += 1; setBusy(false); setEvents(null); setNext(null); setLastEmpty(false); setError(null); }, [ patientId, tooth ]);

  async function load(before: string | null) {
    const mine0 = ++token.current;
    setBusy(true); setError(null);
    try {
      const page = await listChartEvents(patientId, { before });
      if (mine0 !== token.current) return;
      const mine = page.events.filter((e) => e.tooth === tooth);
      setEvents((prev) => [ ...(before ? prev ?? [] : []), ...mine ]);
      setNext(page.next_before);
      setLastEmpty(mine.length === 0);
    } catch (err) {
      if (mine0 === token.current) setError(dentalError(err));
    } finally {
      if (mine0 === token.current) setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {events === null && (
        <div><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void load(null)}>{`Histórico do dente ${tooth}`}</button></div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      {events !== null && (
        <>
          <strong style={{ fontSize: 12 }}>{`Histórico do dente ${tooth}`}</strong>
          {events.length > 0 && <ul aria-label={`histórico do dente ${tooth}`} style={list}>{events.map((e) => <li key={e.id}>{eventText(e, situations)}</li>)}</ul>}
          {lastEmpty && <p style={muted}>{next ? `nenhuma marcação do dente ${tooth} nesta página` : `nenhuma marcação do dente ${tooth}`}</p>}
          {next && <div><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void load(next)}>Ver mais</button></div>}
        </>
      )}
    </div>
  );
}
