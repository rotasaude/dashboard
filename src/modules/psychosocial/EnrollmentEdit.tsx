// Edição da matrícula (F-31.2; §4, P37, P42, P57): os campos da matrícula (`EnrollmentFields` sem pré-preenchimento) e o próximo
// atendimento (data e hora da cidade → `next_visit_at`). O `PATCH` leva só o que mudou; sem mudança, nada vai (o api recusa o corpo
// vazio). Nada pré-travado (R4): quando o api recusa com `origin_locked`, a frase vai ao campo, origem e início voltam ao gravado e
// ficam travados. Início no mês fechado (`month_closed`), depois da primeira ação (`started_after_actions`) ou fora do piso de 12 meses
// vêm do api no campo do início. `already_closed`/`not_found`: a tela estava velha (`onStale`). Sem duplo envio (`busy` + ref).
import { useState } from "react";
import { updatePsyEnrollment, type PsyEnrollment, type PsyOptions, type PsyUnit } from "../../lib/api";
import {
  NOTHING_CHANGED, enrollmentDraftOf, enrollmentEditProblems, enrollmentPatch, nextVisitInput, type EnrollmentDraft, type PsyRefusal
} from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, row } from "../exams/styles";
import { EnrollmentFields } from "./EnrollmentFields";
import { useFormProblems } from "./useFormProblems";

// O path de cada campo do rascunho (a cobertura de ESF e o CNES dividem o mesmo lugar na tela).
const FIELD_PATH: Record<keyof EnrollmentDraft, string> = {
  startedOn: "started_on", origin: "origin", cidMain: "cid_main", cidSecondary: "cid_secondary", substances: "substances",
  esfCovered: "esf_cnes", esfCnes: "esf_cnes", referenceUserId: "reference_user_id"
};
const FIELDS = [ ...new Set(Object.values(FIELD_PATH)) ];
const VISIT = "next_visit_at";

export function EnrollmentEdit({ enrollment: e, unit, options, today, onSaved, onCancel, onStale }: {
  enrollment: PsyEnrollment; unit: PsyUnit; options: PsyOptions; today: string; onSaved(e: PsyEnrollment): void; onCancel(): void;
  onStale(text: string): void;
}) {
  const f = useFormProblems();
  const [ d, setD ] = useState<EnrollmentDraft>(() => enrollmentDraftOf(e));
  const [ nextVisit, setNextVisit ] = useState(() => nextVisitInput(e.next_visit_at));
  const [ locked, setLocked ] = useState(false);

  // Um campo editado perde a marca dele (e o aviso de "nada mudou").
  const setDraft = (next: EnrollmentDraft) => {
    const changed = (Object.keys(FIELD_PATH) as (keyof EnrollmentDraft)[]).filter((k) => next[k] !== d[k]).map((k) => FIELD_PATH[k]);
    f.clear("", ...changed);
    setD(next);
  };
  const refused = (refusals: PsyRefusal[]) => {
    const locks = refusals.filter((r) => r.code === "origin_locked");
    if (locks.length > 0) {
      setLocked(true);
      setD((x) => ({ ...x, origin: e.origin, startedOn: e.started_on }));
    }
    // Origem e início travados juntos: a frase uma vez só.
    const shown = locks.length > 1 ? refusals.filter((r) => !(r.code === "origin_locked" && r !== locks[0])) : refusals;
    return shown.map((r) => ({ path: r.path === "esf_covered" ? "esf_cnes" : r.path, text: r.text }));
  };
  const patch = enrollmentPatch(d, nextVisit, e);

  return (
    <form ref={f.formRef} aria-label="Editar matrícula" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => {
          const local = enrollmentEditProblems(d, nextVisit, e, today);
          return local.length > 0 || Object.keys(patch).length > 0 ? local : [ { path: "", text: NOTHING_CHANGED } ];
        },
        call: () => updatePsyEnrollment(e.id, patch), ok: onSaved, stale: onStale, refused
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Editar matrícula</p>
      {f.top((path) => FIELDS.includes(path) || path === VISIT)}

      <EnrollmentFields unitId={unit.id} patientId={e.patient.patient_id} options={options} value={d} onChange={setDraft}
        problems={f.problems.filter((p) => FIELDS.includes(p.path))} today={today} prefill={false} lockedOriginAndStart={locked} />

      <label style={fieldLabel}>
        Próximo atendimento
        <input type="datetime-local" value={nextVisit} style={inputStyle} {...f.aria(VISIT)}
          onChange={(ev) => { f.clear(VISIT, ""); setNextVisit(ev.target.value); }} />
      </label>
      {f.errNode(VISIT)}

      <div style={row}>
        <button type="submit" style={f.busy ? disabledButtonStyle : buttonStyle} disabled={f.busy}>Salvar alterações</button>
        <button type="button" style={f.busy ? disabledButtonStyle : secondaryButtonStyle} disabled={f.busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
