// Acolhimento no CAPS (F-31.2; §4, P7, P40): data e hora, o procedimento do acolhimento (SIGTAP com "ACOLHIMENTO", RAAS-PSI ou BPA-I,
// já filtrado pelo CBO em `options`), anotações (até 4000) e o desfecho; com "matricular", o bloco da matrícula vai NA MESMA chamada
// (`POST /psychosocial/receptions`). Confere tudo antes de enviar e mostra cada problema no campo; a recusa do api vem toda de uma
// vez (`action_rejected` com `at`/`sigtap_code`, `enrollment.*`, `month_closed` em `enrollment.started_on`) e vai ao campo do path.
// `referral_not_pending`/`not_found` dizem que a fila está velha: quem usa relê e fecha (`onStale`). Sem duplo envio (`busy` + ref);
// a resposta depois de desmontar é ignorada. Anotações nunca vão para mensagem, console ou URL.
import { useState, type FormEvent } from "react";
import { recordPsyReception, type PsyOptions, type PsyReceptionResult, type PsyUnit } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  NO_PROCEDURE_OPTION, NO_RECEPTION_PROCEDURE, RECEPTION_NOTES_TEXT, emptyReceptionDraft, outcomeLabel, receptionInput, receptionProblems, receptionProcedures,
  type EnrollmentDraft, type ReceptionDraft
} from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, row } from "../exams/styles";
import { EnrollmentFields } from "./EnrollmentFields";
import { useFormProblems } from "./useFormProblems";

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
  const f = useFormProblems();
  const procs = receptionProcedures(options);
  const meId = user && options.team.some((p) => p.user_id === user.id) ? user.id : "";
  const [ d, setD ] = useState<ReceptionDraft>(() => emptyReceptionDraft(now, today, meId, procs));
  const { problems, setProblems, aria, errNode, busy } = f;

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

  const submit = (ev: FormEvent) => f.submit(ev, {
    check: () => receptionProblems(d, today, now),
    call: () => recordPsyReception(receptionInput(d, unit.id, patient.patientId, referralId)),
    ok: onDone,
    stale: onStale,
    // A evolução da ação e as anotações do acolhimento usam o mesmo path; aqui, a frase do acolhimento.
    refused: (refusals) => refusals.map((r) => ({ path: r.path, text: r.path === "notes" && [ "too_long", "invalid_request" ].includes(r.code) ? RECEPTION_NOTES_TEXT : r.text }))
  });

  const enrolled = d.outcome === "enrolled";
  const enrollmentProblems = problems.filter((p) => p.path.startsWith(ENROLLMENT)).map((p) => ({ ...p, path: p.path.slice(ENROLLMENT.length) }));

  return (
    <form ref={f.formRef} aria-label="Acolhimento" style={form} onSubmit={(e) => { void submit(e); }} noValidate>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{patient.name}</p>
      <p style={muted}>{referralId ? "Encaminhamento da atenção básica" : "Demanda espontânea"}</p>
      {f.top((path) => OWN_FIELDS.includes(path) || (enrolled && path.startsWith(ENROLLMENT)))}

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
