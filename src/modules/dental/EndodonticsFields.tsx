// Endodontia: dente, canais (1–5) e situação. O histórico (leitura nominal, com trilha) só no clique, sem polling.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listEndodonticTreatments, type EndodonticEntry } from "../../lib/api";
import { dentalError, ENDO_KEY, endoProblems, NOMINAL_QUERY } from "../../lib/dental";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, list as listStyle, muted, row } from "../exams/styles";

interface Props { value: EndodonticEntry[]; teeth: string[]; patientId: string; onChange(v: EndodonticEntry[]): void }

const STATUS: Record<EndodonticEntry["status"], string> = { in_progress: "em andamento", completed: "concluída" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function EndodonticsFields({ value, teeth, patientId, onChange }: Props) {
  const [ pick, setPick ] = useState("");
  const history = useQuery({
    queryKey: [ ENDO_KEY, patientId ], queryFn: () => listEndodonticTreatments(patientId), enabled: false, ...NOMINAL_QUERY
  });
  const offered = teeth.filter((t) => !value.some((e) => e.tooth === t));
  const patch = (tooth: string, change: Partial<EndodonticEntry>) => onChange(value.map((e) => (e.tooth === tooth ? { ...e, ...change } : e)));

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Endodontia</legend>
      <div style={row}>
        <label style={fieldLabel}>
          Dente
          <select value={pick} style={inputStyle} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>
            {offered.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button type="button" style={secondaryButtonStyle} disabled={!pick}
          onClick={() => { onChange([ ...value, { tooth: pick, canals: 1, status: "in_progress" } ]); setPick(""); }}>Acrescentar dente</button>
      </div>
      {value.length === 0 && <p style={muted}>Nenhum dente em tratamento endodôntico nesta consulta.</p>}
      {value.map((e) => (
        <div key={e.tooth} style={row}>
          <strong style={{ fontSize: 13 }}>{`Dente ${e.tooth}`}</strong>
          <label style={fieldLabel}>
            Canais
            <select style={inputStyle} aria-label={`Dente ${e.tooth}, canais`} value={String(e.canals)} onChange={(ev) => patch(e.tooth, { canals: Number(ev.target.value) })}>
              {[ 1, 2, 3, 4, 5 ].map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Situação
            <select style={inputStyle} aria-label={`Dente ${e.tooth}, situação`} value={e.status}
              onChange={(ev) => patch(e.tooth, { status: ev.target.value as EndodonticEntry["status"] })}>
              <option value="in_progress">em andamento</option>
              <option value="completed">concluída</option>
            </select>
          </label>
          <button type="button" style={secondaryButtonStyle} aria-label={`Remover dente ${e.tooth}`} onClick={() => onChange(value.filter((x) => x.tooth !== e.tooth))}>Remover dente</button>
        </div>
      ))}
      {endoProblems(value).map((p) => <p key={p} role="alert" style={alert}>{p}</p>)}
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} disabled={history.isFetching} onClick={() => { void history.refetch(); }}>Ver histórico de endodontia</button>
      </div>
      {history.error && <p role="alert" style={alert}>{dentalError(history.error)}</p>}
      {history.data && history.data.length === 0 && <p style={muted}>Nenhum tratamento endodôntico registrado.</p>}
      {history.data && history.data.length > 0 && (
        <ul style={listStyle}>
          {history.data.map((t) => (
            <li key={t.tooth}>
              {`dente ${t.tooth} · ${plural(t.canals, "canal", "canais")} · ${STATUS[t.status as EndodonticEntry["status"]] ?? t.status} · ${plural(t.sessions.length, "sessão", "sessões")}`}
              {t.sessions.some((s) => s.by) && <span style={{ color: "var(--ink3)" }}>{` — ${t.sessions.map((s) => s.by?.name).filter(Boolean).join(", ")}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
