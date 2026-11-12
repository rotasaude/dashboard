// Encaminhamentos da manifestação (módulo 33; Q9, Q33): destino, extrato, estado, prazo (só no pendente) e, quando existem, a
// prorrogação, a resposta e quem respondeu. No `declined`, `reply` é o motivo da recusa. As chaves opcionais só são lidas se
// vierem preenchidas. A equipe cancela o pendente ("Cancelar encaminhamento", confirmação em dois passos): `onCancel` manda o
// estado lido do encaminhamento (Q33) e devolve a frase da recusa (e se o detalhe vai ser relido), ou `null`; 409
// `forwarding_changed` relê lá fora. A frase fica durante a releitura que ela causou e sai na mudança seguinte do detalhe.
import { useEffect, useRef, useState } from "react";
import type { ForwardingState, OmbudsmanForwarding, OmbudsmanManifestation } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { destinationLabel, forwardingStateLabel, type OmbudsmanRoles } from "../../lib/ombudsman";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { alert, box, muted, row, stack } from "../exams/styles";
import { DeadlineTag } from "./DeadlineTag";

const STATE_TONE: Record<ForwardingState, string | undefined> = { pending: "info", replied: "ok", declined: "down", cancelled: undefined };
const filled = (v: unknown): v is string => typeof v === "string" && v !== "";
const label = { margin: 0, fontSize: 11, color: "var(--ink3)" } as const;
const body = { margin: 0, whiteSpace: "pre-wrap" } as const;

function ForwardingItem({ f, onCancel }: { f: OmbudsmanForwarding; onCancel?(): Promise<void> }) {
  const by = [ filled(f.replied_by_name) ? `respondido por ${f.replied_by_name}` : null, filled(f.replied_at) ? fmtDateTime(f.replied_at) : null ]
    .filter(Boolean).join(" · ");
  return (
    <li style={box}>
      <div style={row}>
        <strong>{destinationLabel(f.destination)}</strong>
        <Tag tone={STATE_TONE[f.state]}>{forwardingStateLabel(f.state)}</Tag>
        {f.state === "pending" && <DeadlineTag color={f.color} dueOn={f.due_on} />}
        {f.extended && <Tag tone="info">prazo prorrogado</Tag>}
      </div>
      <p className="mono" style={muted}>{`encaminhado em ${fmtDateTime(f.created_at)}`}</p>
      <p style={label}>Extrato</p>
      <p style={body}>{f.extract}</p>
      {filled(f.extension_reason) && <><p style={label}>Motivo da prorrogação</p><p style={body}>{f.extension_reason}</p></>}
      {filled(f.reply) && <><p style={label}>{f.state === "declined" ? "Motivo da recusa" : "Resposta"}</p><p style={body}>{f.reply}</p></>}
      {by && <p className="mono" style={muted}>{by}</p>}
      {onCancel && (
        <div style={row}>
          <ConfirmButton label="Cancelar encaminhamento" variant="danger" onConfirm={onCancel}
            question="Cancelar este encaminhamento? O destino deixa de poder respondê-lo." />
        </div>
      )}
    </li>
  );
}

// `reread`: o detalhe vai ser relido por causa desta recusa — a frase sobrevive a essa releitura.
export type CancelOutcome = { text: string; reread: boolean } | null;

export function Forwardings({ m, roles, onCancel }: {
  m: OmbudsmanManifestation; roles?: OmbudsmanRoles; onCancel?(f: OmbudsmanForwarding): Promise<CancelOutcome>;
}) {
  const [ notice, setNotice ] = useState<CancelOutcome>(null);
  const seen = useRef(m);
  useEffect(() => {
    if (seen.current === m) return;
    seen.current = m;
    setNotice((n) => (n?.reread ? { ...n, reread: false } : null));
  }, [ m ]);
  const cancellable = (f: OmbudsmanForwarding) => !!onCancel && !!roles?.staff && m.can.cancel_forwarding && f.state === "pending";
  return (
    <Panel title="Encaminhamentos">
      <div style={{ ...stack, gap: 8 }}>
        {notice && <p role="alert" style={alert}>{notice.text}</p>}
        {m.forwardings.length === 0 ? <p style={muted}>nenhum encaminhamento</p> : (
          <ul style={{ ...stack, gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {m.forwardings.map((f) => (
              <ForwardingItem key={f.id} f={f} onCancel={cancellable(f) && onCancel
                ? async () => { setNotice(null); setNotice(await onCancel(f)); } : undefined} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
