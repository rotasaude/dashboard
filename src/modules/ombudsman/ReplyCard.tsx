// Cartão do encaminhamento no ponto de resposta (módulo 33; F-33.5): destino, data, prazo com a cor, estado e o extrato — nada
// além (o item já chega sem protocolo, texto, assunto, identidade e anexos). No pendente: responder (10–4000), "Não é do nosso
// destino" (motivo 10–4000) e "Prorrogar prazo" (motivo 10–4000, uma vez só: some quando `extended`). Uma ação aberta por vez (escolher outra troca o formulário).
// Toda chamada leva o estado lido (`item.state`, Q33). Tela velha (409 `forwarding_changed`, 422 `invalid_transition`, 404 de
// encaminhamento que saiu do destino): `onStale()` relê a lista uma vez e o texto não é reenviado. Sem duplo envio (`useFormProblems`).
import { useState } from "react";
import { ApiError, declineOmbudsmanInbox, extendOmbudsmanInbox, replyOmbudsmanInbox, type OmbudsmanInboxItem } from "../../lib/api";
import { destinationLabel, forwardingStateLabel, isChanged, ombudsmanRefusals, textActionProblems } from "../../lib/ombudsman";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { Tag } from "../../components/Tag";
import { box, form, muted, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { FrozenTextArea } from "./actions/ExtractField";
import { FormButtons, formTitle } from "./actions/TextActionForm";
import { DeadlineTag } from "./DeadlineTag";

const STATE_TONE = { pending: "info", replied: "ok", declined: "down", cancelled: undefined } as const;
const REPLY_PHRASE = "a resposta tem de ter de 10 a 4000 caracteres";
const REASON_PHRASE = "o motivo tem de ter de 10 a 4000 caracteres";
const day = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const gone = (err: unknown): boolean => err instanceof ApiError && err.status === 404;

type Kind = "reply" | "decline" | "extend";
type FormProps = { item: OmbudsmanInboxItem; onDone(next: OmbudsmanInboxItem): void; onStale(): void; onClose(): void };

const CONFIG = {
  reply: { path: "body", title: "Responder à ouvidoria", label: "Resposta à ouvidoria", submit: "Enviar resposta", phrase: REPLY_PHRASE,
    send: replyOmbudsmanInbox },
  decline: { path: "reason", title: "Não é do nosso destino", label: "Motivo", submit: "Devolver à ouvidoria", phrase: REASON_PHRASE,
    send: declineOmbudsmanInbox },
  extend: { path: "reason", title: "Prorrogar prazo", label: "Motivo da prorrogação", submit: "Prorrogar", phrase: REASON_PHRASE,
    send: extendOmbudsmanInbox }
} as const;

function ReplyForm({ kind, item, onDone, onStale, onClose }: FormProps & { kind: Kind }) {
  const c = CONFIG[kind];
  const f = useFormProblems({
    refusals: (err) => ombudsmanRefusals(err, { fields: { [c.path]: c.phrase } }).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isChanged(err) || gone(err)
  });
  const [ text, setText ] = useState("");
  const id = f.fid("text");
  return (
    <form ref={f.formRef} aria-label={c.title} style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => textActionProblems("extend", { text, resolution: null }).map((p) => ({ ...p, text: c.phrase })),
        call: () => c.send(item.id, item.state, text),
        ok: onDone,
        stale: onStale,
        refused: (refusals) => refusals.map((r) => ({ path: r.path === c.path ? "text" : r.path, text: r.text }))
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>{c.title}</p>
      {f.top((path) => path === "text")}
      <FrozenTextArea id={id} label={c.label} value={text} aria={f.aria("text")} min={10}
        onChange={(v) => { f.clear("text"); setText(v); }} />
      {f.errNode("text")}
      <FormButtons busy={f.busy} submit={c.submit} onClose={onClose} />
    </form>
  );
}

export function ReplyCard({ item, onDone, onStale }: { item: OmbudsmanInboxItem; onDone(next: OmbudsmanInboxItem): void; onStale(): void }) {
  const [ open, setOpen ] = useState<Kind | null>(null);
  const pending = item.state === "pending";
  return (
    <article aria-label={`Encaminhamento de ${day(item.created_at)}`} style={box}>
      <div style={row}>
        <strong>{destinationLabel(item.destination)}</strong>
        <Tag tone={STATE_TONE[item.state]}>{forwardingStateLabel(item.state)}</Tag>
        {pending && <DeadlineTag color={item.color} dueOn={item.due_on} />}
        {item.extended && <Tag tone="info">prazo prorrogado</Tag>}
      </div>
      <p className="mono" style={muted}>{`recebido em ${day(item.created_at)}`}</p>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{item.extract}</p>
      {item.reply && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{item.reply}</p>}
      {pending && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => setOpen("reply")}>Responder à ouvidoria</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => setOpen("decline")}>Não é do nosso destino</button>
          {!item.extended && <button type="button" style={secondaryButtonStyle} onClick={() => setOpen("extend")}>Prorrogar prazo</button>}
        </div>
      )}
      {open && (
        <ReplyForm key={open} kind={open} item={item} onClose={() => setOpen(null)} onStale={onStale}
          onDone={(next) => { setOpen(null); onDone(next); }} />
      )}
    </article>
  );
}
