// Encaminhamentos da manifestação (módulo 33; Q9, Q33): destino, extrato, estado, prazo (só no pendente) e, quando existem, a
// prorrogação, a resposta e quem respondeu. No `declined`, `reply` é o motivo da recusa. As chaves opcionais só são lidas se
// vierem preenchidas. O cancelamento do pendente entra na Task 6.
import type { ForwardingState, OmbudsmanForwarding, OmbudsmanManifestation } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { destinationLabel, forwardingStateLabel } from "../../lib/ombudsman";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { box, muted, row, stack } from "../exams/styles";
import { DeadlineTag } from "./DeadlineTag";

const STATE_TONE: Record<ForwardingState, string | undefined> = { pending: "info", replied: "ok", declined: "down", cancelled: undefined };
const filled = (v: unknown): v is string => typeof v === "string" && v !== "";
const label = { margin: 0, fontSize: 11, color: "var(--ink3)" } as const;
const body = { margin: 0, whiteSpace: "pre-wrap" } as const;

function ForwardingItem({ f }: { f: OmbudsmanForwarding }) {
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
    </li>
  );
}

export function Forwardings({ m }: { m: OmbudsmanManifestation }) {
  return (
    <Panel title="Encaminhamentos">
      {m.forwardings.length === 0 ? <p style={muted}>nenhum encaminhamento</p> : (
        <ul style={{ ...stack, gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {m.forwardings.map((f) => <ForwardingItem key={f.id} f={f} />)}
        </ul>
      )}
    </Panel>
  );
}
