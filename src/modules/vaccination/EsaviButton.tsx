// "Notificar ESAVI" na dose (módulo 29; F-29.8; V12). Só com o interruptor `surveillance` e dose ativa. Dois passos, sem duplo envio.
// Primeira vez → 201; já notificada → 200 `existing: true` (o api também pode recusar 409 `already_notified` com o id): nos dois casos a
// tela mostra a frase e, para quem tem o papel `surveillance`, abre a notificação logo abaixo; os outros recebem a dica. Só o id da
// notificação circula; nada de vacina ou dose em URL, console ou storage.
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, notifyEsavi, type Immunization } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { featureDisabledKey } from "../../lib/features";
import { canUseSurveillance, surveillanceRoles } from "../../lib/surveillance";
import { vaccinationError } from "../../lib/vaccination";
import { secondaryButtonStyle, buttonStyle } from "../../components/formStyles";
import { NotificationDetail } from "../surveillance/NotificationDetail";
import { alert, okText, row, stack, muted } from "../exams/styles";

export const ESAVI_OPENED = "Notificação de ESAVI aberta na vigilância, presa a esta dose.";
export const ESAVI_EXISTING = "esta dose já tem notificação de ESAVI aberta";
export const ESAVI_HINT = "A equipe da vigilância completa a ficha e envia ao e-SUS Notifica.";
export const ESAVI_SURVEILLANCE_OFF = "a vigilância está desligada nesta cidade — notifique o ESAVI pelo e-SUS Notifica";

function existingId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409 || !err.body || typeof err.body !== "object") return null;
  const b = err.body as Record<string, unknown>;
  return b.error === "already_notified" && typeof b.notification_id === "string" ? b.notification_id : null;
}

export function EsaviButton({ imm }: { imm: Immunization }) {
  const { user } = useAuth();
  const [ confirming, setConfirming ] = useState(false);
  const [ done, setDone ] = useState<{ id: string; existing: boolean } | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ open, setOpen ] = useState(false);
  const note = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const send = useMutation({
    mutationFn: () => notifyEsavi(imm.id),
    onSettled: () => { inFlight.current = false; },
    onSuccess: (r) => { setDone({ id: r.notification_id, existing: r.existing === true }); setError(null); setConfirming(false); setOpen(true); queueMicrotask(() => note.current?.focus()); },
    onError: (err) => {
      const id = existingId(err);
      if (id) { setDone({ id, existing: true }); setError(null); setConfirming(false); setOpen(true); queueMicrotask(() => note.current?.focus()); return; }
      setError(featureDisabledKey(err) === "surveillance" ? ESAVI_SURVEILLANCE_OFF : vaccinationError(err));
    }
  });

  if (!canUseSurveillance(user) || imm.status !== "active") return null;
  const reviewer = surveillanceRoles(user).surveillance;
  const name = `${imm.immunobiological.name ?? imm.immunobiological.code} ${imm.dose.name ?? imm.dose.code}`;

  return (
    <div style={stack}>
      {!done && !confirming && (
        <button type="button" style={secondaryButtonStyle} onClick={() => { setConfirming(true); setError(null); }}>{`Notificar ESAVI — ${name}`}</button>
      )}
      {!done && confirming && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={send.isPending} onClick={() => { if (inFlight.current) return; inFlight.current = true; send.mutate(); }}>Sim, abrir a notificação</button>
          <button type="button" style={secondaryButtonStyle} disabled={send.isPending} onClick={() => setConfirming(false)}>Voltar</button>
        </div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      {done && (
        <>
          <p ref={note} tabIndex={-1} role="status" style={okText}>{done.existing ? ESAVI_EXISTING : ESAVI_OPENED}</p>
          {!reviewer && <p style={muted}>{ESAVI_HINT}</p>}
          {reviewer && open && <NotificationDetail key={done.id} id={done.id} onClose={() => setOpen(false)} />}
        </>
      )}
    </div>
  );
}
