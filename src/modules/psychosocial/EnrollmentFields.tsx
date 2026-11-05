// Campos da matrícula no CAPS (F-31.2; §4, P38, P42): início (até 12 meses para trás), origem, CID principal e até 4 secundários
// (busca CID-10 por POST, o termo nunca na URL), substâncias ("nenhuma" sozinha), cobertura de ESF com o CNES da USF pré-preenchido
// pelo `GET /psychosocial/prefill` (eSF tipo 70; sem CNES → aviso e o campo em branco) e o técnico de referência da equipe lotada.
// Controlado: `value`/`onChange` são de quem usa (o acolhimento aqui; a edição na Task 6). `problems` vêm sem o prefixo `enrollment.`.
// O pré-preenchimento é leitura nominal (a USF do paciente): `NOMINAL_QUERY`, com o id do CAPS na chave.
import { useEffect, useId, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPsyPrefill, searchTerminology, type PsyOptions } from "../../lib/api";
import {
  ESF_CNES_MISSING, NO_SUBSTANCE, NOMINAL_QUERY, PSY_DETAIL_KEY, enrollmentFloor, psyError, type EnrollmentDraft
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CodeSearch } from "../consultation/CodeSearch";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

const MAX_SECONDARY = 4;

export function EnrollmentFields({ unitId, patientId, options, value, onChange, problems, today }: {
  unitId: string; patientId: string; options: PsyOptions; value: EnrollmentDraft; onChange(d: EnrollmentDraft): void; problems: Problem[];
  today: string;
}) {
  const uid = useId();
  const prefill = useQuery({
    queryKey: [ PSY_DETAIL_KEY, unitId, "prefill", patientId ],
    queryFn: () => getPsyPrefill(unitId, patientId),
    ...NOMINAL_QUERY
  });
  // O pré-preenchimento entra uma vez (depois, é da pessoa editar).
  const applied = useRef(false);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => {
    const p = prefill.data;
    if (!p || applied.current) return;
    applied.current = true;
    if (p.esf_covered) latest.current.onChange({ ...latest.current.value, esfCovered: true, esfCnes: p.esf_cnes ?? "" });
  }, [ prefill.data ]);

  const set = (patch: Partial<EnrollmentDraft>) => onChange({ ...value, ...patch });
  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = (path: string) => `${uid}-${path}`;
  const aria = (path: string) => (textOf(path) ? { "aria-invalid": true as const, "aria-describedby": `${fid(path)}-err` } : {});
  const errNode = (path: string) => {
    const t = textOf(path);
    return t ? <p id={`${fid(path)}-err`} role="alert" style={alert}>{t}</p> : null;
  };

  function toggleSubstance(code: string, on: boolean) {
    if (!on) { set({ substances: value.substances.filter((c) => c !== code) }); return; }
    if (code === NO_SUBSTANCE) { set({ substances: [ NO_SUBSTANCE ] }); return; }
    set({ substances: [ ...value.substances.filter((c) => c !== NO_SUBSTANCE && c !== code), code ] });
  }

  const hint = prefill.data && [ prefill.data.team?.name, prefill.data.usf?.name ].filter(Boolean).join(" · ");
  const noCnes = prefill.data?.esf_covered === true && prefill.data.esf_cnes === null;

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Matrícula no CAPS</legend>
      <div style={row}>
        <label style={fieldLabel}>
          Início da matrícula
          <input type="date" value={value.startedOn} min={enrollmentFloor(today)} max={today} style={inputStyle} {...aria("started_on")}
            onChange={(e) => set({ startedOn: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Origem
          <select value={value.origin} style={inputStyle} {...aria("origin")} onChange={(e) => set({ origin: e.target.value })}>
            <option value="">Escolha a origem</option>
            {options.origins.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {errNode("started_on")}{errNode("origin")}

      {value.cidMain ? (
        <div style={row}>
          <span style={fieldLabel}>CID principal<strong style={{ color: "var(--ink)" }}>{`${value.cidMain.code} — ${value.cidMain.label}`}</strong></span>
          <button type="button" style={secondaryButtonStyle} onClick={() => set({ cidMain: null })}>Trocar o CID principal</button>
        </div>
      ) : (
        <CodeSearch label="CID principal" queryKey={`${PSY_DETAIL_KEY}:${unitId}:cid-main`} search={(q) => searchTerminology(q, "cid10")}
          errorText={psyError} onPick={(c) => set({ cidMain: c })} />
      )}
      {errNode("cid_main")}

      {value.cidSecondary.length > 0 && (
        <ul aria-label="CIDs secundários" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {value.cidSecondary.map((c) => (
            <li key={c.code} style={row}>
              <span>{`${c.code} — ${c.label}`}</span>
              <button type="button" style={secondaryButtonStyle} aria-label={`Tirar o CID ${c.code}`}
                onClick={() => set({ cidSecondary: value.cidSecondary.filter((x) => x.code !== c.code) })}>Tirar</button>
            </li>
          ))}
        </ul>
      )}
      {value.cidSecondary.length < MAX_SECONDARY && (
        <CodeSearch label="CID secundário (até 4)" queryKey={`${PSY_DETAIL_KEY}:${unitId}:cid-secondary`} search={(q) => searchTerminology(q, "cid10")}
          errorText={psyError}
          onPick={(c) => {
            if (c.code === value.cidMain?.code || value.cidSecondary.some((x) => x.code === c.code)) return;
            set({ cidSecondary: [ ...value.cidSecondary, c ] });
          }} />
      )}
      {errNode("cid_secondary")}

      <fieldset style={fieldset} {...aria("substances")}>
        <legend style={legend}>Substâncias</legend>
        <div style={row}>
          {options.substances.map((s) => (
            <label key={s.code} style={checkLabel}>
              <input type="checkbox" checked={value.substances.includes(s.code)} onChange={(e) => toggleSubstance(s.code, e.target.checked)} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      {errNode("substances")}

      <label style={checkLabel}>
        <input type="checkbox" checked={value.esfCovered}
          onChange={(e) => set({ esfCovered: e.target.checked, ...(e.target.checked ? {} : { esfCnes: "" }) })} />
        Coberto por ESF
      </label>
      {value.esfCovered && (
        <label style={fieldLabel}>
          CNES da USF
          <input value={value.esfCnes} style={inputStyle} inputMode="numeric" autoComplete="off" {...aria("esf_cnes")}
            onChange={(e) => set({ esfCnes: e.target.value })} />
        </label>
      )}
      {value.esfCovered && hint && <p style={muted}>{hint}</p>}
      {value.esfCovered && noCnes && <p style={muted}>{ESF_CNES_MISSING}</p>}
      {prefill.isError && <p style={muted}>{psyError(prefill.error)}</p>}
      {errNode("esf_cnes")}

      <label style={fieldLabel}>
        Técnico de referência
        <select value={value.referenceUserId} style={inputStyle} {...aria("reference_user_id")}
          onChange={(e) => set({ referenceUserId: e.target.value })}>
          <option value="">Escolha o técnico</option>
          {options.team.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
      </label>
      {errNode("reference_user_id")}
    </fieldset>
  );
}
