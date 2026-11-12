// Filtros da Caixa (módulo 33): a consulta só muda no clique de "Filtrar", não a cada tecla. Sem filtro de responsável (Q37).
// O protocolo (`q`) é conferido aqui: só `AAAA-NNNNNN` ou o prefixo `AAAA-` sai do formulário (Q51).
import { useState } from "react";
import type { OmbudsmanListQuery, OmbudsmanOptions } from "../../lib/api";
import { PROTOCOL_QUERY_TEXT, channelLabel, colorLabel, isProtocolQuery, kindLabel, stateLabel } from "../../lib/ombudsman";
import { buttonStyle, inputStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, row } from "../exams/styles";

export type ListFilters = Omit<OmbudsmanListQuery, "before">;

const STATES = [ "received", "in_analysis", "forwarded", "awaiting_complement", "answered", "archived" ];
// O texto da cor "prazo suspenso" fica só na etiqueta da linha; no filtro a caixa diz "suspenso".
const COLORS: [ string, string ][] = [ [ "green", colorLabel("green") ], [ "yellow", colorLabel("yellow") ], [ "red", colorLabel("red") ], [ "paused", "suspenso" ] ];
const KINDS = [ "complaint", "report", "praise", "suggestion", "request" ];
const CHANNELS = [ "web", "in_person", "phone", "ouvidorsus" ];

function Group({ name, codes, label, value, onChange }: {
  name: string; codes: readonly string[] | [ string, string ][]; label: (code: string) => string; value: string[]; onChange(next: string[]): void;
}) {
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>{name}</legend>
      <div style={row}>
        {codes.map((c) => {
          const code = Array.isArray(c) ? c[0] : c;
          const text = Array.isArray(c) ? c[1] : label(c);
          return (
            <label key={code} style={checkLabel}>
              <input type="checkbox" checked={value.includes(code)}
                onChange={(e) => onChange(e.target.checked ? [ ...value, code ] : value.filter((v) => v !== code))} />
              {text}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ManifestationFilters({ options, onApply }: { options: OmbudsmanOptions | undefined; onApply(filters: ListFilters): void }) {
  const [ state, setState ] = useState<string[]>([]);
  const [ color, setColor ] = useState<string[]>([]);
  const [ kind, setKind ] = useState<string[]>([]);
  const [ channel, setChannel ] = useState<string[]>([]);
  const [ subjectId, setSubjectId ] = useState("");
  const [ unitId, setUnitId ] = useState("");
  const [ q, setQ ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);

  function apply() {
    const protocol = q.trim();
    if (protocol !== "" && !isProtocolQuery(protocol)) { setProblem(PROTOCOL_QUERY_TEXT); return; }
    setProblem(null);
    onApply({
      state, color, kind, channel,
      subject_id: subjectId || null, health_unit_id: unitId || null, ...(protocol ? { q: protocol } : {})
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); apply(); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Group name="Estado" codes={STATES} label={stateLabel} value={state} onChange={setState} />
      <Group name="Prazo" codes={COLORS} label={colorLabel} value={color} onChange={setColor} />
      <Group name="Tipo" codes={KINDS} label={kindLabel} value={kind} onChange={setKind} />
      <Group name="Canal" codes={CHANNELS} label={channelLabel} value={channel} onChange={setChannel} />
      <div style={row}>
        <label style={fieldLabel}>
          Assunto
          <select style={inputStyle} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">todos</option>
            {(options?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Unidade
          <select style={inputStyle} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">todas</option>
            {(options?.health_units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Protocolo
          <input style={inputStyle} value={q} placeholder="AAAA-NNNNNN" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}><button type="submit" style={buttonStyle}>Filtrar</button></div>
    </form>
  );
}
