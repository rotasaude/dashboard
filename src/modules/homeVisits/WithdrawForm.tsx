// src/modules/homeVisits/WithdrawForm.tsx
// Retirar uma visita registrada (módulo 24b): motivo de 10 a 500 caracteres, com o aviso do texto congelado. O corpo leva
// `expected_state: "recorded"` (o client faz isso); 409 `visit_changed`/`day_closed`/`not_found` vão a `onStale`, que relê uma vez
// e nunca reenvia sozinho. O motivo é texto livre: nunca vai a URL, a storage nem a mensagem de erro.
import { useState } from "react";
import { withdrawHomeVisit, type HomeVisit } from "../../lib/api";
import { homeVisitRefusals, isDayStale, textProblem } from "../../lib/homeVisits";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { useWriteLock } from "./writeLock";
import { fieldLabel, form, row } from "../exams/styles";

export function WithdrawForm({ visit, onDone, onClose, onStale }: {
  visit: HomeVisit; onDone(v: HomeVisit): void; onClose(): void; onStale(text: string): void;
}) {
  const f = useFormProblems({ refusals: (err) => homeVisitRefusals(err).map((r) => ({ ...r, participantIndex: null })), isStale: isDayStale });
  const [ reason, setReason ] = useState("");
  const lock = useWriteLock();
  const busy = f.busy || lock.busy;
  const noticeId = f.fid("notice");
  return (
    <form ref={f.formRef} noValidate style={form} aria-label="Retirar visita"
      onSubmit={(ev) => lock.held() ? ev.preventDefault() : f.submit(ev, {
        check: () => { const p = textProblem(reason, { min: 10, max: 500, path: "reason" }); return p ? [ p ] : []; },
        call: () => lock.run(() => withdrawHomeVisit(visit.id, reason.trim())),
        ok: onDone,
        stale: (text) => onStale(text)
      })}>
      <label style={fieldLabel}>
        Motivo da retirada
        <textarea value={reason} rows={3} maxLength={600} style={inputStyle} onChange={(e) => { setReason(e.target.value); f.clear("reason"); }}
          aria-describedby={[ noticeId, f.textOf("reason") ? `${f.fid("reason")}-err` : "" ].filter(Boolean).join(" ")} {...(f.textOf("reason") ? { "aria-invalid": true as const } : {})} />
      </label>
      <FrozenTextNotice id={noticeId} />
      {f.errNode("reason")}
      {f.top((p) => p === "reason")}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Retirar</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
      </div>
    </form>
  );
}
