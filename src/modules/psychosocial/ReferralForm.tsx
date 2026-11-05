// "Encaminhar ao CAPS" pela tela do paciente da UBS (F-31.2; §4, P12, R19): o health_professional escolhe o CAPS (`listActiveUnits`
// com `kind === "caps"`), escreve o motivo (10 a 2000) e a prioridade. R19: o nome do CAPS aparece SÓ no seletor; quem usa mostra a
// frase genérica e este formulário desmonta, levando o motivo junto. O motivo vai só no corpo do POST — nunca na URL, em
// mensagem de erro nem no console. Contexto e lotação são do api (`out_of_context`, `missing_role`). Sem duplo envio (`useFormProblems`).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPsyReferral, listActiveUnits } from "../../lib/api";
import {
  MAX_REFERRAL_REASON, NO_ACTIVE_CAPS, REFERRAL_NOTE, REFERRAL_REASON_TEXT, REFER_BUTTON, modalityLabel, priorityLabel, psyError, referralInput,
  referralProblems, type ReferralDraft
} from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const heading = { margin: 0, fontSize: 13, fontWeight: 600 } as const;
const PRIORITIES = [ "routine", "priority" ] as const;
const OWN_PATHS = [ "health_unit_id", "reason", "priority" ];

export function ReferralForm({ patientId, onSent, onCancel }: { patientId: string; onSent(): void; onCancel(): void }) {
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits });
  const caps = (units.data ?? []).filter((u) => u.kind === "caps");
  if (units.isPending) return <p className="mono" style={muted}>carregando os CAPS…</p>;
  if (units.isError) {
    return (
      <div style={form}>
        <p role="alert" style={muted}>{psyError(units.error)}</p>
        <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button></div>
      </div>
    );
  }
  if (caps.length === 0) {
    return (
      <div style={form}>
        <p role="status" style={muted}>{NO_ACTIVE_CAPS}</p>
        <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button></div>
      </div>
    );
  }
  return <ReferralFields patientId={patientId} caps={caps} onSent={onSent} onCancel={onCancel} />;
}

function ReferralFields({ patientId, caps, onSent, onCancel }: {
  patientId: string; caps: { id: string; name: string; caps_modality?: string | null }[]; onSent(): void; onCancel(): void;
}) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  // Um CAPS só: já vem escolhido. Mais de um: a escolha é de quem encaminha.
  const [ draft, setDraft ] = useState<ReferralDraft>(() => ({ unitId: caps.length === 1 ? caps[0].id : "", reason: "", priority: "routine" }));
  const set = <K extends keyof ReferralDraft>(key: K, path: string, value: ReferralDraft[K]) => { f.clear(path); setDraft((d) => ({ ...d, [key]: value })); };
  return (
    <form ref={f.formRef} aria-label={REFER_BUTTON} style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => referralProblems(draft),
        call: () => createPsyReferral(referralInput(draft, patientId)),
        ok: () => onSent(),
        refused: (rs) => rs.map((r) => ({ path: r.path, text: r.path === "reason" ? REFERRAL_REASON_TEXT : r.text }))
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={heading}>{REFER_BUTTON}</p>
      <p style={muted}>{REFERRAL_NOTE}</p>
      {f.top((path) => OWN_PATHS.includes(path))}
      <label style={fieldLabel}>
        CAPS
        <select value={draft.unitId} style={inputStyle} {...aria("health_unit_id")} onChange={(ev) => set("unitId", "health_unit_id", ev.target.value)}>
          {caps.length > 1 && <option value="">escolha…</option>}
          {caps.map((u) => <option key={u.id} value={u.id}>{u.caps_modality ? `${u.name} · ${modalityLabel(u.caps_modality)}` : u.name}</option>)}
        </select>
      </label>
      {errNode("health_unit_id")}
      <label style={fieldLabel}>
        Motivo do encaminhamento
        <textarea value={draft.reason} rows={4} style={inputStyle} {...aria("reason")} onChange={(ev) => set("reason", "reason", ev.target.value)} />
      </label>
      <p style={muted}>{`${draft.reason.trim().length} de ${MAX_REFERRAL_REASON} caracteres`}</p>
      {errNode("reason")}
      <label style={fieldLabel}>
        Prioridade
        <select value={draft.priority} style={inputStyle} {...aria("priority")}
          onChange={(ev) => set("priority", "priority", ev.target.value as ReferralDraft["priority"])}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
        </select>
      </label>
      {errNode("priority")}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Enviar encaminhamento</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
