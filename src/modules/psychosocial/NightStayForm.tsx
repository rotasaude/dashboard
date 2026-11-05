// Entrada no leito (F-31.5; §5, P41): "Usuário" (matrículas abertas do CAPS, lista local, sem quem já está num leito do mapa),
// "Entrada" (padrão agora; até agora + 12 h) e "Saída prevista" (depois da entrada, em até 30 dias), conferidos de uma vez antes de
// enviar. `bed_taken`, `already_staying` e leito recusado relêem o mapa (`onConflict`) e deixam a frase. `night_limit_reached` mostra
// "N de M" (`nightLimitText`, R20); só a coordenação vê "Motivo da reavaliação" (10–500) e "Passar do limite com reavaliação", que
// repete a mesma chamada com `reassessment: { reason }`, uma vez só. A entrada não grava trilha. "Agora" é lido na hora.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPsyEnrollments, startPsyNightStay, type PsyBed, type PsyNightStay, type PsyUnit } from "../../lib/api";
import {
  NIGHT_STAY_NOTE, NOMINAL_QUERY, NO_STAY_CANDIDATES, PSY_ENROLLMENTS_KEY, emptyNightStayDraft, nightStayInput, nightStayProblems, psyError,
  reassessmentProblems, type NightStayDraft, type PsyRefusal, type PsyRoles
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { cityLocalInput } from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const OWN = [ "enrollment_id", "started_at", "expected_end_at", "reassessment.reason" ];
// O mapa estava velho: o leito foi tomado, o usuário já está noutro leito, ou o leito saiu.
const CONFLICT = [ "bed_taken", "already_staying" ];

export type NightStayFormProps = {
  unit: PsyUnit; bed: PsyBed; roles: PsyRoles; now?: Date;
  // Pacientes que o mapa já mostra num leito (não são oferecidos).
  staying?: ReadonlySet<string>;
  // `ignored`: a reavaliação foi enviada e o api a ignorou (`reassessment: null`).
  onSaved(stay: PsyNightStay, ignored: boolean): void; onCancel(): void; onConflict?(): void;
};

export function NightStayForm({ unit, bed, roles, now, staying, onSaved, onCancel, onConflict }: NightStayFormProps) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const clock = () => now ?? new Date();
  const [ d, setD ] = useState<NightStayDraft>(() => emptyNightStayDraft(clock()));
  const [ limit, setLimit ] = useState<string | null>(null);
  const [ reason, setReason ] = useState("");
  const limitRef = useRef<HTMLParagraphElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!limit) return;
    if (roles.lead) reasonRef.current?.focus(); else limitRef.current?.focus();
  }, [ limit, roles.lead ]);

  // Só nome e CNS mascarado, sem repetir; quem já está num leito fica de fora (o api recusaria com `already_staying`).
  const people = useQuery({
    queryKey: [ PSY_ENROLLMENTS_KEY, unit.id, "open" ], queryFn: () => listPsyEnrollments({ unitId: unit.id, status: "open" }), ...NOMINAL_QUERY
  });
  const candidates = (people.data ?? [])
    .filter((r, i, xs) => xs.findIndex((x) => x.id === r.id) === i)
    .filter((r) => !staying?.has(r.patient.patient_id));
  const startedOn = candidates.find((r) => r.id === d.enrollmentId)?.started_on ?? null;

  const set = (patch: Partial<NightStayDraft>, path: string) => {
    f.clear(path);
    setLimit(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const refused = (rs: PsyRefusal[]): Problem[] => {
    const hit = rs.find((r) => r.code === "night_limit_reached");
    if (hit) { setLimit(hit.text); return []; }
    setLimit(null);
    if (rs.some((r) => CONFLICT.includes(r.code) || r.path === "bed_id")) onConflict?.();
    return rs.map((r) => ({ path: r.path, text: r.text }));
  };
  const send = (withReassessment: boolean) => ({
    check: () => [ ...nightStayProblems(d, clock(), startedOn), ...(withReassessment ? reassessmentProblems(reason) : []) ],
    call: () => startPsyNightStay(nightStayInput(d, bed.id, withReassessment ? reason : null)),
    ok: (stay: PsyNightStay) => onSaved(stay, withReassessment && stay.reassessment === null),
    refused
  });

  return (
    <form ref={f.formRef} aria-label={`Entrada no ${bed.label}`} style={form} noValidate onSubmit={(ev) => { void f.submit(ev, send(false)); }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{`Entrada no ${bed.label}`}</p>
      <p style={muted}>{NIGHT_STAY_NOTE}</p>
      {f.top((path) => OWN.includes(path))}
      {people.isError && <p role="alert" style={alert}>{psyError(people.error)}</p>}
      <label style={fieldLabel}>
        Usuário
        <select value={d.enrollmentId} style={inputStyle} {...aria("enrollment_id")} onChange={(ev) => set({ enrollmentId: ev.target.value }, "enrollment_id")}>
          <option value="">{people.isPending ? "carregando…" : "Escolha o usuário"}</option>
          {candidates.map((r) => (
            <option key={r.id} value={r.id}>{r.patient.cns_masked ? `${r.patient.name} · CNS ${r.patient.cns_masked}` : r.patient.name}</option>
          ))}
        </select>
      </label>
      {errNode("enrollment_id")}
      {people.isSuccess && candidates.length === 0 && <p style={muted}>{NO_STAY_CANDIDATES}</p>}
      <div style={row}>
        <label style={fieldLabel}>
          Entrada
          <input type="datetime-local" value={d.startedAt} style={inputStyle} {...aria("started_at")}
            onChange={(ev) => set({ startedAt: ev.target.value }, "started_at")} />
        </label>
        <label style={fieldLabel}>
          Saída prevista
          <input type="datetime-local" value={d.expectedEndAt} min={d.startedAt || cityLocalInput(clock())} style={inputStyle} {...aria("expected_end_at")}
            onChange={(ev) => set({ expectedEndAt: ev.target.value }, "expected_end_at")} />
        </label>
      </div>
      {errNode("started_at")}{errNode("expected_end_at")}
      {limit && <p ref={limitRef} role="alert" tabIndex={-1} style={alert}>{limit}</p>}
      {limit && roles.lead && (
        <fieldset style={fieldset}>
          <legend style={legend}>Reavaliação da coordenação</legend>
          <label style={fieldLabel}>
            Motivo da reavaliação
            <textarea ref={reasonRef} value={reason} rows={3} style={inputStyle} {...aria("reassessment.reason")}
              onChange={(ev) => { f.clear("reassessment.reason"); setReason(ev.target.value); }} />
          </label>
          {errNode("reassessment.reason")}
          <div style={row}>
            <button type="button" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}
              onClick={(ev) => { void f.submit(ev, send(true)); }}>Passar do limite com reavaliação</button>
          </div>
        </fieldset>
      )}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Registrar entrada</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
