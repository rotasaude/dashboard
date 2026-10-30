// Periograma: dente a dente, seis sítios (PS, recessão, sangramento), mobilidade e furca. Campo vazio vai nulo, nunca 0.
import { useState } from "react";
import type { PerioSite, PeriodontalChart, PeriodontalSiteValue, PeriodontalTooth } from "../../lib/api";
import { PERIO_SITES, perioProblems } from "../../lib/dental";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

interface Props { value: PeriodontalChart | null; teeth: string[]; onChange(v: PeriodontalChart | null): void }

// Furca: pré-molares e molares (14–18, 24–28, 34–38, 44–48).
export const hasFurcation = (tooth: string): boolean => /^[1-4][4-8]$/.test(tooth);

const BUCCAL: PerioSite[] = [ "MV", "V", "DV" ];
const LINGUAL: PerioSite[] = [ "ML", "L", "DL" ];
const emptySite = (site: PerioSite): PeriodontalSiteValue => ({ site, probing_depth_mm: null, recession_mm: null, bleeding: false });
const num = (raw: string): number | null => (raw.trim() === "" ? null : Number(raw));
const show = (n: number | null) => (n === null ? "" : String(n));

export function PeriodontalChartFields({ value, teeth, onChange }: Props) {
  const [ pick, setPick ] = useState("");
  const list = value?.teeth ?? [];
  const offered = teeth.filter((t) => !list.some((x) => x.tooth === t));

  const set = (next: PeriodontalTooth[]) => onChange(next.length === 0 ? null : { teeth: next });
  const patchTooth = (tooth: string, change: Partial<PeriodontalTooth>) => set(list.map((t) => (t.tooth === tooth ? { ...t, ...change } : t)));
  const patchSite = (tooth: string, site: PerioSite, change: Partial<PeriodontalSiteValue>) =>
    set(list.map((t) => (t.tooth === tooth ? { ...t, sites: t.sites.map((s) => (s.site === site ? { ...s, ...change } : s)) } : t)));
  const add = () => {
    if (!pick) return;
    set([ ...list, { tooth: pick, mobility: null, furcation: null, sites: PERIO_SITES.map(emptySite) } ]);
    setPick("");
  };

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Periograma</legend>
      <div style={row}>
        <label style={fieldLabel}>
          Dente
          <select value={pick} style={inputStyle} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>
            {offered.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button type="button" style={secondaryButtonStyle} disabled={!pick} onClick={add}>Acrescentar dente</button>
      </div>
      {list.length === 0 && <p style={muted}>Nenhum dente no periograma.</p>}
      {list.map((t) => (
        <section key={t.tooth} aria-label={`Dente ${t.tooth}`} style={box}>
          <strong style={{ fontSize: 13 }}>{`Dente ${t.tooth}`}</strong>
          {[ { name: "vestibular", sites: BUCCAL }, { name: "lingual", sites: LINGUAL } ].map((line) => (
            <div key={line.name} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              {line.sites.map((site) => {
                const s = t.sites.find((x) => x.site === site) ?? emptySite(site);
                return (
                  <div key={site} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{`${site} (${line.name})`}</span>
                    <label style={fieldLabel}>
                      <span title="Profundidade de sondagem">PS (mm)</span>
                      <input type="number" step={1} style={inputStyle} aria-label={`Dente ${t.tooth}, sítio ${site}, profundidade de sondagem (mm)`}
                        value={show(s.probing_depth_mm)} onChange={(e) => patchSite(t.tooth, site, { probing_depth_mm: num(e.target.value) })} />
                    </label>
                    <label style={fieldLabel}>
                      Recessão (mm)
                      <input type="number" step={1} style={inputStyle} aria-label={`Dente ${t.tooth}, sítio ${site}, recessão (mm)`}
                        value={show(s.recession_mm)} onChange={(e) => patchSite(t.tooth, site, { recession_mm: num(e.target.value) })} />
                    </label>
                    <label style={checkLabel}>
                      <input type="checkbox" aria-label={`Dente ${t.tooth}, sítio ${site}, sangramento`} checked={s.bleeding}
                        onChange={(e) => patchSite(t.tooth, site, { bleeding: e.target.checked })} />
                      Sangramento
                    </label>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={row}>
            <label style={fieldLabel}>
              Mobilidade
              <select style={inputStyle} aria-label={`Dente ${t.tooth}, mobilidade`} value={show(t.mobility)}
                onChange={(e) => patchTooth(t.tooth, { mobility: num(e.target.value) })}>
                <option value="">—</option>
                {[ 0, 1, 2, 3 ].map((n) => <option key={n} value={String(n)}>{n}</option>)}
              </select>
            </label>
            {hasFurcation(t.tooth) && (
              <label style={fieldLabel}>
                Furca
                <select style={inputStyle} aria-label={`Dente ${t.tooth}, furca`} value={show(t.furcation)}
                  onChange={(e) => patchTooth(t.tooth, { furcation: num(e.target.value) })}>
                  <option value="">—</option>
                  {[ 0, 1, 2, 3 ].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                </select>
              </label>
            )}
            <button type="button" style={secondaryButtonStyle} aria-label={`Remover dente ${t.tooth}`} onClick={() => set(list.filter((x) => x.tooth !== t.tooth))}>Remover dente</button>
          </div>
        </section>
      ))}
      {value && perioProblems(value).map((p) => <p key={p} role="alert" style={alert}>{p}</p>)}
    </fieldset>
  );
}
