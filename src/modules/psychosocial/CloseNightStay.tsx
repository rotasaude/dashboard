// Saída do leito (F-31.5; §5, P41, R15): "Saída" (padrão agora; depois da entrada e nunca futura) e "Motivo da saída" (10–500),
// conferidos de uma vez antes de enviar. O api fecha cada noite como ação de acolhimento noturno; noite em mês fechado
// (`month_closed` em `ended_at`) e a crítica de uma noite (`action_rejected`) voltam com a frase, e nada fecha. `already_closed` diz
// que o mapa estava velho (`onStale`). A permanência que não foi reavaliada na entrada pode dar `night_limit_reached` na saída: a
// mesma reavaliação da entrada, só para a coordenação. A saída grava trilha no api (devolve a reavaliação). "Agora" é lido na hora.
import { useEffect, useRef, useState } from "react";
import { closePsyNightStay, type PsyNightStay } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import {
  NIGHT_STAY_NOTE, closeStayInput, closeStayProblems, emptyCloseStayDraft, reassessmentProblems, type CloseStayDraft, type PsyRefusal, type PsyRoles
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { cityLocalInput } from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const OWN = [ "ended_at", "reason", "reassessment.reason" ];

// O que a saída usa da permanência: o mapa basta (o detalhe, com trilha, não é lido para sair).
export type ClosableStay = Pick<PsyNightStay, "id" | "patient" | "started_at" | "expected_end_at">;

export type CloseNightStayProps = {
  stay: ClosableStay; bedLabel: string; roles: PsyRoles; now?: Date;
  onSaved(stay: PsyNightStay, ignored: boolean): void; onCancel(): void; onStale(text: string): void;
};

export function CloseNightStay({ stay, bedLabel, roles, now, onSaved, onCancel, onStale }: CloseNightStayProps) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const clock = () => now ?? new Date();
  const [ d, setD ] = useState<CloseStayDraft>(() => emptyCloseStayDraft(clock()));
  const [ limit, setLimit ] = useState<string | null>(null);
  const [ reassessment, setReassessment ] = useState("");
  const limitRef = useRef<HTMLParagraphElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!limit) return;
    if (roles.lead) reasonRef.current?.focus(); else limitRef.current?.focus();
  }, [ limit, roles.lead ]);

  const set = (patch: Partial<CloseStayDraft>, path: string) => {
    f.clear(path);
    if (patch.endedAt !== undefined) setLimit(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const refused = (rs: PsyRefusal[]): Problem[] => {
    const hit = rs.find((r) => r.code === "night_limit_reached");
    if (hit) { setLimit(hit.text); return []; }
    setLimit(null);
    return rs.map((r) => ({ path: r.path, text: r.text }));
  };
  const send = (withReassessment: boolean) => ({
    check: () => [ ...closeStayProblems(d, stay.started_at, clock()), ...(withReassessment ? reassessmentProblems(reassessment) : []) ],
    call: () => closePsyNightStay(stay.id, closeStayInput(d, withReassessment ? reassessment : null)),
    ok: (s: PsyNightStay) => onSaved(s, withReassessment && s.reassessment === null),
    stale: onStale, refused
  });
  const title = `Saída de ${stay.patient.name} · ${bedLabel}`;

  return (
    <form ref={f.formRef} aria-label={title} style={form} noValidate onSubmit={(ev) => { void f.submit(ev, send(false)); }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</p>
      <p style={muted}>{`Entrada ${fmtDateTime(stay.started_at)} · saída prevista ${fmtDateTime(stay.expected_end_at)}`}</p>
      <p style={muted}>{NIGHT_STAY_NOTE}</p>
      {f.top((path) => OWN.includes(path))}
      <label style={fieldLabel}>
        Saída
        <input type="datetime-local" value={d.endedAt} max={cityLocalInput(clock())} style={inputStyle} {...aria("ended_at")}
          onChange={(ev) => set({ endedAt: ev.target.value }, "ended_at")} />
      </label>
      {errNode("ended_at")}
      <label style={fieldLabel}>
        Motivo da saída
        <textarea value={d.reason} rows={3} style={inputStyle} {...aria("reason")} onChange={(ev) => set({ reason: ev.target.value }, "reason")} />
      </label>
      {errNode("reason")}
      {limit && <p ref={limitRef} role="alert" tabIndex={-1} style={alert}>{limit}</p>}
      {limit && roles.lead && (
        <fieldset style={fieldset}>
          <legend style={legend}>Reavaliação da coordenação</legend>
          <label style={fieldLabel}>
            Motivo da reavaliação
            <textarea ref={reasonRef} value={reassessment} rows={3} style={inputStyle} {...aria("reassessment.reason")}
              onChange={(ev) => { f.clear("reassessment.reason"); setReassessment(ev.target.value); }} />
          </label>
          {errNode("reassessment.reason")}
          <div style={row}>
            <button type="button" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}
              onClick={(ev) => { void f.submit(ev, send(true)); }}>Confirmar saída com reavaliação</button>
          </div>
        </fieldset>
      )}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Confirmar saída</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
