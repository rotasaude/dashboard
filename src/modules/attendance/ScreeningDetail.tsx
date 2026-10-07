// src/modules/attendance/ScreeningDetail.tsx
// A escuta dentro do atendimento chamado (módulo 18; spec §8; contratos §3–§4):
// só para o profissional. Abrir pelo GET gera a trilha de leitura no api
// (`screening.viewed`); a recepção nunca chega aqui.
import type { CSSProperties } from "react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getScreening, type Screening, type ScreeningRevision } from "../../lib/api";
import {
  COLOR_LABEL, COLOR_TONE, DESTINATION_LABEL, GLUCOSE_MOMENT_LABEL, VITALS, alertLabel, screeningError
} from "../../lib/screening";
import { fmtDateTime, fmtNumber } from "../../lib/format";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";

export function ScreeningDetailLoader({ id, onClose, onError }: { id: string; onClose(): void; onError?(err: unknown): void }) {
  const query = useQuery({ queryKey: [ "screening", id ], queryFn: () => getScreening(id), staleTime: 0 });
  useEffect(() => { if (query.error) onError?.(query.error); }, [ query.error ]); // eslint-disable-line react-hooks/exhaustive-deps
  if (query.isPending || query.isError) {
    return (
      <section aria-label="Leitura da escuta" style={panel}>
        {query.isPending
          ? <p className="mono" style={muted}>carregando a escuta…</p>
          : <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{screeningError(query.error)}</p>}
        <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar escuta</button></div>
      </section>
    );
  }
  return <ScreeningDetail screening={query.data} onClose={onClose} />;
}

export function ScreeningDetail({ screening, onClose }: { screening: Screening; onClose(): void }) {
  const rev = screening.current_revision;
  const earlier = (screening.revisions ?? []).filter((r) => r.id !== rev?.id);
  return (
    <section aria-label="Escuta inicial do atendimento" style={panel}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Escuta inicial</strong>
        {rev && <Tag tone={COLOR_TONE[rev.final_color]}>{COLOR_LABEL[rev.final_color]}</Tag>}
        {screening.destination && <span style={muted}>{`destino: ${DESTINATION_LABEL[screening.destination]}`}</span>}
        <span style={muted}>{`${screening.revisions_count} ${screening.revisions_count === 1 ? "revisão" : "revisões"}`}</span>
      </div>
      {rev ? <RevisionBody rev={rev} /> : <p style={muted}>Escuta sem registro concluído.</p>}
      {screening.orientation_note && <p style={{ margin: 0, fontSize: 12.5 }}>{`Orientação: ${screening.orientation_note}`}</p>}
      {earlier.length > 0 && (
        <details>
          <summary style={{ fontSize: 12 }}>Revisões anteriores</summary>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {earlier.map((r) => (
              <li key={r.id}>{`${fmtDateTime(r.created_at)} · ${r.by.name} · ${COLOR_LABEL[r.final_color]} · ${r.ciap2.code}`}</li>
            ))}
          </ul>
        </details>
      )}
      <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar escuta</button></div>
    </section>
  );
}

function RevisionBody({ rev }: { rev: ScreeningRevision }) {
  const vitals = VITALS.filter((v) => typeof rev.vitals[v.key] === "number");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
      <span><span className="mono">{rev.ciap2.code}</span>{` — ${rev.ciap2.label}`}</span>
      {rev.complaint_note && <span>{`Queixa: ${rev.complaint_note}`}</span>}
      {vitals.length > 0 && (
        <ul aria-label="sinais vitais registrados" style={{ margin: 0, paddingLeft: 18 }}>
          {vitals.map((v) => (
            <li key={v.key}>{`${v.label}: ${fmtNumber(rev.vitals[v.key] as number)}${v.unit ? ` ${v.unit}` : ""}`}</li>
          ))}
          {rev.vitals.glucose_moment && <li>{`Momento da glicemia: ${GLUCOSE_MOMENT_LABEL[rev.vitals.glucose_moment]}`}</li>}
          {typeof rev.vitals.bmi === "number" && <li>{`IMC: ${fmtNumber(rev.vitals.bmi)}`}</li>}
        </ul>
      )}
      {rev.alerts.length > 0 && <span style={{ color: "var(--down)", fontWeight: 600 }}>{rev.alerts.map(alertLabel).join(" · ")}</span>}
      <span style={muted}>
        {rev.suggested_color ? `sugerida: ${COLOR_LABEL[rev.suggested_color]}` : "sem cor sugerida"}
        {rev.color_change_reason ? ` · mudança: ${rev.color_change_reason}` : ""}
      </span>
      <span style={muted}>{`${rev.by.name} · ${fmtDateTime(rev.created_at)}`}</span>
    </div>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
