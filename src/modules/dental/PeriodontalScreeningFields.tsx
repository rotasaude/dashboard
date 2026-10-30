// Registro periodontal simplificado (PSR): seis sextantes, código 0–4 ou "X — excluído" (code nulo) e asterisco.
import type { PeriodontalScreening, Sextant } from "../../lib/api";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";
import { screeningProblems } from "../../lib/dental";

interface Props { value: PeriodontalScreening | null; onChange(v: PeriodontalScreening | null): void }

const SEXTANTS: Sextant[] = [ "S1", "S2", "S3", "S4", "S5", "S6" ];

export function PeriodontalScreeningFields({ value, onChange }: Props) {
  const patch = (sextant: Sextant, change: Partial<PeriodontalScreening["sextants"][number]>) =>
    value && onChange({ sextants: value.sextants.map((s) => (s.sextant === sextant ? { ...s, ...change } : s)) });
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Registro periodontal simplificado</legend>
      {!value && (
        <div style={row}>
          <p style={muted}>Nenhum registro nesta consulta.</p>
          <button type="button" style={secondaryButtonStyle}
            onClick={() => onChange({ sextants: SEXTANTS.map((sextant) => ({ sextant, code: 0, star: false })) })}>Preencher o registro periodontal</button>
        </div>
      )}
      {value && (
        <>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {value.sextants.map((s) => (
              <div key={s.sextant} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={fieldLabel}>
                  {`Sextante ${s.sextant}`}
                  <select value={s.code === null ? "X" : String(s.code)} style={inputStyle}
                    onChange={(e) => patch(s.sextant, { code: e.target.value === "X" ? null : Number(e.target.value) })}>
                    {[ 0, 1, 2, 3, 4 ].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                    <option value="X">X — excluído</option>
                  </select>
                </label>
                <label style={checkLabel}>
                  <input type="checkbox" aria-label={`${s.sextant} com asterisco`} checked={s.star} onChange={(e) => patch(s.sextant, { star: e.target.checked })} />
                  asterisco (*)
                </label>
              </div>
            ))}
          </div>
          {screeningProblems(value).map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
          <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => onChange(null)}>Remover o registro</button></div>
        </>
      )}
    </fieldset>
  );
}
