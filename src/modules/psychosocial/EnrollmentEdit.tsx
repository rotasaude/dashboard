// Edição da matrícula (F-31.2; §4, P37, P42, P57): os campos da matrícula (`EnrollmentFields` sem pré-preenchimento) e o próximo
// atendimento (data e hora da cidade → `next_visit_at`). O `PATCH` leva só o que mudou; sem mudança, nada vai (o api recusa o corpo
// vazio). Nada pré-travado (R4): quando o api recusa com `origin_locked`, a frase vai ao campo, origem e início voltam ao gravado e
// ficam travados. Início no mês fechado (`month_closed`), depois da primeira ação (`started_after_actions`) ou fora do piso de 12 meses
// vêm do api no campo do início. `already_closed`/`not_found`: a tela estava velha (`onStale`). Sem duplo envio (`busy` + ref).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { errorCode, updatePsyEnrollment, type PsyEnrollment, type PsyOptions, type PsyUnit } from "../../lib/api";
import {
  NOTHING_CHANGED, enrollmentDraftOf, enrollmentEditProblems, enrollmentPatch, isStale, nextVisitInput, psyRefusals, type EnrollmentDraft
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "../exams/styles";
import { EnrollmentFields } from "./EnrollmentFields";

// O path de cada campo do rascunho (a cobertura de ESF e o CNES dividem o mesmo lugar na tela).
const FIELD_PATH: Record<keyof EnrollmentDraft, string> = {
  startedOn: "started_on", origin: "origin", cidMain: "cid_main", cidSecondary: "cid_secondary", substances: "substances",
  esfCovered: "esf_cnes", esfCnes: "esf_cnes", referenceUserId: "reference_user_id"
};
const FIELDS = [ ...new Set(Object.values(FIELD_PATH)) ];

export function EnrollmentEdit({ enrollment: e, unit, options, today, onSaved, onCancel, onStale }: {
  enrollment: PsyEnrollment; unit: PsyUnit; options: PsyOptions; today: string; onSaved(e: PsyEnrollment): void; onCancel(): void;
  onStale(text: string): void;
}) {
  const uid = useId();
  const [ d, setD ] = useState<EnrollmentDraft>(() => enrollmentDraftOf(e));
  const [ nextVisit, setNextVisit ] = useState(() => nextVisitInput(e.next_visit_at));
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ locked, setLocked ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const focusNext = useRef(false);
  const ref = useRef<HTMLFormElement | null>(null);
  const title = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    alive.current = true;
    title.current?.focus();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const first = ref.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-general='true']");
    (first instanceof HTMLFieldSetElement ? first.querySelector<HTMLElement>("input") : first)?.focus();
  }, [ problems ]);

  const show = (list: Problem[]) => { focusNext.current = true; setProblems(list); };
  // Um campo editado perde a marca dele (e o aviso de "nada mudou").
  const setDraft = (next: EnrollmentDraft) => {
    const changed = (Object.keys(FIELD_PATH) as (keyof EnrollmentDraft)[]).filter((k) => next[k] !== d[k]).map((k) => FIELD_PATH[k]);
    setProblems((ps) => ps.filter((p) => p.path !== "" && !changed.includes(p.path)));
    setD(next);
  };

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (sending.current) return;
    const local = enrollmentEditProblems(d, nextVisit, e, today);
    if (local.length > 0) { show(local); return; }
    const patch = enrollmentPatch(d, nextVisit, e);
    if (Object.keys(patch).length === 0) { show([ { path: "", text: NOTHING_CHANGED } ]); return; }
    sending.current = true;
    setBusy(true);
    setProblems([]);
    try {
      const saved = await updatePsyEnrollment(e.id, patch);
      if (alive.current) onSaved(saved);
    } catch (err) {
      if (!alive.current) return;
      const refusals = psyRefusals(err);
      if (isStale(err) || errorCode(err) === "already_closed") { onStale(refusals[0].text); return; }
      const locks = refusals.filter((r) => r.code === "origin_locked");
      if (locks.length > 0) {
        setLocked(true);
        setD((x) => ({ ...x, origin: e.origin, startedOn: e.started_on }));
      }
      // Origem e início travados juntos: a frase uma vez só.
      const shown = locks.length > 1 ? refusals.filter((r) => !(r.code === "origin_locked" && r !== locks[0])) : refusals;
      show(shown.map((r) => ({ path: r.path === "esf_covered" ? "esf_cnes" : r.path, text: r.text })));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = `${uid}-next_visit_at`;
  const visitError = textOf("next_visit_at");
  const top = [ ...new Set(problems.filter((p) => !FIELDS.includes(p.path) && p.path !== "next_visit_at").map((p) => p.text)) ];

  return (
    <form ref={ref} aria-label="Editar matrícula" style={form} onSubmit={(ev) => { void submit(ev); }} noValidate>
      <p ref={title} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Editar matrícula</p>
      {top.map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>)}

      <EnrollmentFields unitId={unit.id} patientId={e.patient.patient_id} options={options} value={d} onChange={setDraft}
        problems={problems.filter((p) => FIELDS.includes(p.path))} today={today} prefill={false} lockedOriginAndStart={locked} />

      <label style={fieldLabel}>
        Próximo atendimento
        <input type="datetime-local" value={nextVisit} style={inputStyle}
          {...(visitError ? { "aria-invalid": true as const, "aria-describedby": `${fid}-err` } : {})}
          onChange={(ev) => { setProblems((ps) => ps.filter((p) => p.path !== "next_visit_at" && p.path !== "")); setNextVisit(ev.target.value); }} />
      </label>
      {visitError && <p id={`${fid}-err`} role="alert" style={alert}>{visitError}</p>}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar alterações</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
