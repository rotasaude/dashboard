// Campos da matrícula no CAPS (F-31.2; §4, P38, P42): início (até 12 meses para trás), origem, CID principal e até 4 secundários
// (busca CID-10 por POST, o termo nunca na URL), substâncias ("nenhuma" sozinha), cobertura de ESF com o CNES da USF pré-preenchido
// pelo `GET /psychosocial/prefill` (eSF tipo 70; sem CNES → aviso e o campo em branco) e o técnico de referência da equipe lotada.
// Controlado: `value`/`onChange` são de quem usa (o acolhimento aqui; a edição na Task 6). `problems` vêm sem o prefixo `enrollment.`.
// O pré-preenchimento é leitura nominal (a USF do paciente): `NOMINAL_QUERY`, com o id do CAPS na chave.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPsyPrefill, searchTerminology, type PsyOptions } from "../../lib/api";
import {
  CID_REPEATED_TEXT, ESF_CNES_MISSING, NO_SUBSTANCE, NOMINAL_QUERY, PSY_DETAIL_KEY, cidKey, cidLabel, enrollmentFloor, psyError, type EnrollmentDraft
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CodeSearch } from "../consultation/CodeSearch";
import { fieldErrors } from "./useFormProblems";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

const MAX_SECONDARY = 4;
// Enter na busca de CID não envia o formulário de fora (o CodeSearch é compartilhado e não sabe que está dentro de um <form>).
const keepEnterInSearch = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
};

// `prefill`: lê a ESF do paciente e preenche a cobertura só enquanto ninguém mexeu nela (o acolhimento liga; a edição, não).
// `lockedOriginAndStart`: a edição trava origem e início só depois que o api recusou com `origin_locked` (R4: nada pré-travado).
// O CID aparece com ponto (R5); o detalhe da matrícula não traz rótulo, e aí só o código aparece.
const cidText = (c: { code: string; label: string }) => (c.label ? `${cidLabel(c.code)} — ${c.label}` : cidLabel(c.code));

export function EnrollmentFields({ unitId, patientId, options, value, onChange, problems, today, prefill: usePrefill = false, lockedOriginAndStart = false }: {
  unitId: string; patientId: string; options: PsyOptions; value: EnrollmentDraft; onChange(d: EnrollmentDraft): void; problems: Problem[];
  today: string; prefill?: boolean; lockedOriginAndStart?: boolean;
}) {
  const uid = useId();
  const prefill = useQuery({
    queryKey: [ PSY_DETAIL_KEY, unitId, "prefill", patientId ],
    queryFn: () => getPsyPrefill(unitId, patientId),
    enabled: usePrefill,
    ...NOMINAL_QUERY
  });
  // O pré-preenchimento entra uma vez e nunca por cima do que a pessoa mexeu (cobertura ou CNES).
  const applied = useRef(false);
  const touchedEsf = useRef(false);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => {
    const p = prefill.data;
    if (!p || applied.current) return;
    applied.current = true;
    const v = latest.current.value;
    if (!p.esf_covered || touchedEsf.current || v.esfCovered || v.esfCnes.trim() !== "") return;
    latest.current.onChange({ ...v, esfCovered: true, esfCnes: p.esf_cnes ?? "" });
  }, [ prefill.data ]);
  const [ cidNote, setCidNote ] = useState<string | null>(null);

  const set = (patch: Partial<EnrollmentDraft>) => onChange({ ...value, ...patch });
  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = (path: string) => `${uid}-${path}`;
  const aria = (path: string) => (textOf(path) ? { "aria-invalid": true as const, "aria-describedby": `${fid(path)}-err` } : {});
  const errNode = (path: string) => fieldErrors(problems, path, `${fid(path)}-err`);

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
          <input type="date" value={value.startedOn} min={enrollmentFloor(today)} max={today} style={inputStyle} disabled={lockedOriginAndStart} {...aria("started_on")}
            onChange={(e) => set({ startedOn: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Origem
          <select value={value.origin} style={inputStyle} disabled={lockedOriginAndStart} {...aria("origin")} onChange={(e) => set({ origin: e.target.value })}>
            <option value="">Escolha a origem</option>
            {options.origins.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {errNode("started_on")}{errNode("origin")}

      {value.cidMain ? (
        <div style={row}>
          <span style={fieldLabel}>CID principal<strong style={{ color: "var(--ink)" }}>{cidText(value.cidMain)}</strong></span>
          <button type="button" style={secondaryButtonStyle} onClick={() => { setCidNote(null); set({ cidMain: null }); }}>Trocar o CID principal</button>
        </div>
      ) : (
        <div onKeyDown={keepEnterInSearch}>
          <CodeSearch label="CID principal" queryKey={`${PSY_DETAIL_KEY}:${unitId}:cid-main`} search={(q) => searchTerminology(q, "cid10")}
            errorText={psyError}
            onPick={(c) => {
              if (value.cidSecondary.some((x) => cidKey(x.code) === cidKey(c.code))) { setCidNote(CID_REPEATED_TEXT); return; }
              setCidNote(null);
              set({ cidMain: c });
            }} />
        </div>
      )}
      {errNode("cid_main")}

      {value.cidSecondary.length > 0 && (
        <ul aria-label="CIDs secundários" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {value.cidSecondary.map((c) => (
            <li key={c.code} style={row}>
              <span>{cidText(c)}</span>
              <button type="button" style={secondaryButtonStyle} aria-label={`Tirar o CID ${cidLabel(c.code)}`}
                onClick={() => set({ cidSecondary: value.cidSecondary.filter((x) => x.code !== c.code) })}>Tirar</button>
            </li>
          ))}
        </ul>
      )}
      {value.cidSecondary.length < MAX_SECONDARY && (
        <div onKeyDown={keepEnterInSearch}>
          <CodeSearch label="CID secundário (até 4)" queryKey={`${PSY_DETAIL_KEY}:${unitId}:cid-secondary`} search={(q) => searchTerminology(q, "cid10")}
            errorText={psyError}
            onPick={(c) => {
              const key = cidKey(c.code);
              if (key === cidKey(value.cidMain?.code ?? "") || value.cidSecondary.some((x) => cidKey(x.code) === key)) { setCidNote(CID_REPEATED_TEXT); return; }
              setCidNote(null);
              set({ cidSecondary: [ ...value.cidSecondary, c ] });
            }} />
        </div>
      )}
      {cidNote && <p role="alert" style={alert}>{cidNote}</p>}
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
          onChange={(e) => { touchedEsf.current = true; set({ esfCovered: e.target.checked, ...(e.target.checked ? {} : { esfCnes: "" }) }); }} />
        Coberto por ESF
      </label>
      {value.esfCovered && (
        <label style={fieldLabel}>
          CNES da USF
          <input value={value.esfCnes} style={inputStyle} inputMode="numeric" autoComplete="off" {...aria("esf_cnes")}
            onChange={(e) => { touchedEsf.current = true; set({ esfCnes: e.target.value }); }} />
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
