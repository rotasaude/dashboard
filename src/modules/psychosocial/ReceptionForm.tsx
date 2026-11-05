// Acolhimento no CAPS (F-31.2; §4, P7, P40): data e hora, o procedimento do acolhimento (SIGTAP com "ACOLHIMENTO", RAAS-PSI ou BPA-I,
// já filtrado pelo CBO em `options`), anotações (até 4000) e o desfecho; com "matricular", o bloco da matrícula vai NA MESMA chamada
// (`POST /psychosocial/receptions`). Confere tudo antes de enviar e mostra cada problema no campo; a recusa do api vem toda de uma
// vez (`action_rejected` com `at`/`sigtap_code`, `enrollment.*`, `month_closed` em `enrollment.started_on`) e vai ao campo do path.
// `referral_not_pending`/`not_found` dizem que a fila está velha: quem usa relê e fecha (`onStale`). Sem duplo envio (`busy` + ref);
// a resposta depois de desmontar é ignorada. Anotações nunca vão para mensagem, console ou URL.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { recordPsyReception, type PsyOptions, type PsyReceptionResult, type PsyUnit } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  NO_PROCEDURE_OPTION, NO_RECEPTION_PROCEDURE, RECEPTION_NOTES_TEXT, emptyReceptionDraft, isStale, outcomeLabel, psyRefusals, receptionInput, receptionProblems, receptionProcedures,
  type EnrollmentDraft, type ReceptionDraft
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";
import { EnrollmentFields } from "./EnrollmentFields";

const ENROLLMENT = "enrollment.";
// Campos do acolhimento; o que não for daqui nem do bloco da matrícula vai ao topo.
const OWN_FIELDS = [ "at", "sigtap_code", "notes", "outcome" ];
const ENROLLMENT_PATH: Record<keyof EnrollmentDraft, string> = {
  startedOn: "enrollment.started_on", origin: "enrollment.origin", cidMain: "enrollment.cid_main", cidSecondary: "enrollment.cid_secondary",
  substances: "enrollment.substances", esfCovered: "enrollment.esf_cnes", esfCnes: "enrollment.esf_cnes", referenceUserId: "enrollment.reference_user_id"
};

export function ReceptionForm({ unit, patient, referralId, options, today, now, onDone, onCancel, onStale }: {
  unit: PsyUnit; patient: { patientId: string; name: string }; referralId: string | null; options: PsyOptions; today: string; now: Date;
  onDone(r: PsyReceptionResult): void; onCancel(): void; onStale?(text: string): void;
}) {
  const { user } = useAuth();
  const uid = useId();
  const procs = receptionProcedures(options);
  const meId = user && options.team.some((p) => p.user_id === user.id) ? user.id : "";
  const [ d, setD ] = useState<ReceptionDraft>(() => emptyReceptionDraft(now, today, meId, procs));
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const focusNext = useRef(false);
  const ref = useRef<HTMLFormElement | null>(null);
  const title = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    // Ao abrir, o foco vai ao nome de quem é acolhido. (`alive` volta a true no remonte do StrictMode.)
    alive.current = true;
    title.current?.focus();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const first = ref.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-general='true']");
    // Um grupo de caixas inválido não recebe foco: vai à primeira caixa dele.
    (first instanceof HTMLFieldSetElement ? first.querySelector<HTMLElement>("input") : first)?.focus();
  }, [ problems ]);

  const set = (patch: Partial<ReceptionDraft>) => {
    const keys = Object.keys(patch).map((k) => (k === "sigtapCode" ? "sigtap_code" : k));
    setProblems((ps) => ps.filter((p) => !keys.includes(p.path)));
    setD((x) => ({ ...x, ...patch }));
  };
  // Um campo da matrícula editado perde a marca dele.
  const setEnrollment = (e: EnrollmentDraft) => {
    const changed = (Object.keys(ENROLLMENT_PATH) as (keyof EnrollmentDraft)[]).filter((k) => e[k] !== d.enrollment[k]).map((k) => ENROLLMENT_PATH[k]);
    if (changed.length > 0) setProblems((ps) => ps.filter((p) => !changed.includes(p.path)));
    setD((x) => ({ ...x, enrollment: e }));
  };
  const show = (list: Problem[]) => { focusNext.current = true; setProblems(list); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    const local = receptionProblems(d, today, now);
    if (local.length > 0) { show(local); return; }
    sending.current = true;
    setBusy(true);
    setProblems([]);
    try {
      const r = await recordPsyReception(receptionInput(d, unit.id, patient.patientId, referralId));
      if (alive.current) onDone(r);
    } catch (err) {
      if (!alive.current) return;
      const refusals = psyRefusals(err);
      if (isStale(err) && onStale) { onStale(refusals[0].text); return; }
      // A evolução da ação e as anotações do acolhimento usam o mesmo path; aqui, a frase do acolhimento.
      show(refusals.map((r) => ({ path: r.path, text: r.path === "notes" && [ "too_long", "invalid_request" ].includes(r.code) ? RECEPTION_NOTES_TEXT : r.text })));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = (path: string) => `${uid}-${path}`;
  const aria = (path: string) => (textOf(path) ? { "aria-invalid": true as const, "aria-describedby": `${fid(path)}-err` } : {});
  const errNode = (path: string) => {
    const t = textOf(path);
    return t ? <p id={`${fid(path)}-err`} role="alert" style={alert}>{t}</p> : null;
  };
  const enrolled = d.outcome === "enrolled";
  const enrollmentProblems = problems.filter((p) => p.path.startsWith(ENROLLMENT)).map((p) => ({ ...p, path: p.path.slice(ENROLLMENT.length) }));
  const top = [ ...new Set(problems.filter((p) => !OWN_FIELDS.includes(p.path) && !(enrolled && p.path.startsWith(ENROLLMENT))).map((p) => p.text)) ];

  return (
    <form ref={ref} aria-label="Acolhimento" style={form} onSubmit={(e) => { void submit(e); }} noValidate>
      <p ref={title} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{patient.name}</p>
      <p style={muted}>{referralId ? "Encaminhamento da atenção básica" : "Demanda espontânea"}</p>
      {top.map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>)}

      <div style={row}>
        <label style={fieldLabel}>
          Data e hora
          <input type="datetime-local" value={d.at} style={inputStyle} {...aria("at")} onChange={(e) => set({ at: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Procedimento do acolhimento
          <select value={d.sigtapCode} style={inputStyle} {...aria("sigtap_code")} onChange={(e) => set({ sigtapCode: e.target.value })}>
            {procs.length === 0 && <option value="">{NO_PROCEDURE_OPTION}</option>}
            {procs.map((p) => <option key={p.code} value={p.code}>{`${p.code} — ${p.name}`}</option>)}
          </select>
        </label>
      </div>
      {procs.length === 0 && <p style={muted}>{NO_RECEPTION_PROCEDURE}</p>}
      {errNode("at")}{errNode("sigtap_code")}

      <label style={fieldLabel}>
        Anotações do acolhimento
        <textarea value={d.notes} rows={4} style={inputStyle} {...aria("notes")} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {errNode("notes")}

      <label style={fieldLabel}>
        Desfecho
        <select value={d.outcome} style={inputStyle} {...aria("outcome")}
          onChange={(e) => set({ outcome: e.target.value as ReceptionDraft["outcome"] })}>
          <option value="">Escolha o desfecho</option>
          {options.reception_outcomes.map((o) => <option key={o} value={o}>{outcomeLabel(o)}</option>)}
        </select>
      </label>
      {errNode("outcome")}

      {enrolled && (
        <EnrollmentFields unitId={unit.id} patientId={patient.patientId} options={options} value={d.enrollment} onChange={setEnrollment}
          problems={enrollmentProblems} today={today} prefill />
      )}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Registrar acolhimento</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
