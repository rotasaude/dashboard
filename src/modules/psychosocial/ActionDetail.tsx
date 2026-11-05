// Detalhe da ação do CAPS (F-31.4; §4, P12, P49): lido só no clique (`GET /psychosocial/actions/:id`, o api grava a trilha `action`),
// com `NOMINAL_QUERY` e o id do CAPS na chave. Mostra a evolução, os participantes (matriculado pelo nome, familiar como
// "familiar: <nome>"), a autorização e, se cancelada, o motivo. "Cancelar ação" (só a não cancelada) pede o motivo de 10 a 2000
// caracteres (CANCEL_REASON do api); quem decide o mês é o api: fechado → só a coordenação (403 `lead_required`), exportado →
// 409 `already_exported`, já cancelada → 409 `already_cancelled` (a frase, e o detalhe e a lista são relidos). `children` recebe a
// ação lida (a receita da Task 8 entra ali).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelPsyAction, getPsyAction, type PsyAction, type PsyActionRow, type PsyUnit } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import {
  ACTION_CANCELLED, CANCEL_LEAD_NOTE, LONG_REASON_TEXT, NOMINAL_QUERY, PSY_DETAIL_KEY, instrumentLabel, isStale, placeLabel, psyError, reasonProblem,
  type PsyRoles
} from "../../lib/psychosocial";
import { KeyValue } from "../../components/KeyValue";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, grid, list, muted, okText, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const CANCEL_REASON = { min: 10, max: 2000 };

export type ActionDetailProps = {
  actionId: string; roles: PsyRoles; unit: PsyUnit; onClose(): void; onChanged(): void; onStale?(text: string): void;
  children?(a: PsyAction): ReactNode;
};

export const actionStatusTag = (cancelled: boolean) => (cancelled ? <Tag tone="down">cancelada</Tag> : <Tag tone="ok">registrada</Tag>);

export function ActionDetail({ actionId, roles, unit, onClose, onChanged, onStale, children }: ActionDetailProps) {
  const queryClient = useQueryClient();
  const key = [ PSY_DETAIL_KEY, unit.id, "action", actionId ];
  const detail = useQuery({ queryKey: key, queryFn: () => getPsyAction(actionId), ...NOMINAL_QUERY });
  const [ cancelling, setCancelling ] = useState(false);
  const [ done, setDone ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const focused = useRef(false);
  const a = detail.data;

  useEffect(() => {
    if (!a || focused.current) return;
    focused.current = true;
    heading.current?.focus();
  }, [ a ]);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  useEffect(() => {
    if (detail.isError && isStale(detail.error) && onStale) onStale(psyError(detail.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ detail.isError, detail.error ]);

  // O cancelamento devolve o item (sem evolução): o detalhe guarda o que já tinha, mais o item e o motivo digitado.
  const cancelled = (item: PsyActionRow, reason: string) => {
    queryClient.setQueryData<PsyAction>(key, (old) => (old ? { ...old, ...item, cancelled: true, cancel_reason: reason } : old));
    setCancelling(false);
    setNotice(null);
    setDone(ACTION_CANCELLED);
    onChanged();
  };
  // Outra pessoa cancelou antes: a frase, e relê o detalhe e a lista.
  const alreadyCancelled = (text: string) => {
    setCancelling(false);
    setDone(null);
    setNotice(text);
    void detail.refetch();
    onChanged();
  };

  return (
    <Panel title="Ação no CAPS">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={row}>
          {a && (
            <h3 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1 }}>
              {`Ação de ${fmtDateTime(a.performed_at)}`}
            </h3>
          )}
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar ação</button>
        </div>
        {detail.isPending && <p className="mono" style={muted}>carregando…</p>}
        {detail.isError && !a && <p role="alert" style={alert}>{psyError(detail.error)}</p>}
        {notice && <p ref={noticeRef} tabIndex={-1} role="alert" style={alert}>{notice}</p>}
        {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
        {a && (
          <>
            <div style={grid}>
              <KeyValue k="Situação" v={actionStatusTag(a.cancelled)} />
              <KeyValue k="Procedimento" v={<span title={a.sigtap.code}>{a.sigtap.name || a.sigtap.code}</span>} mono={false} />
              <KeyValue k="Código" v={a.sigtap.code} />
              <KeyValue k="Instrumento" v={instrumentLabel(a.instrument)} />
              <KeyValue k="Local" v={placeLabel(a.place)} mono={false} />
              <KeyValue k="Quantidade" v={String(a.quantity)} />
              <KeyValue k="Profissional" v={a.professional.name} mono={false} />
              {a.authorization_number && <KeyValue k="Autorização" v={a.authorization_number} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Participantes</span>
              <ul style={list}>
                {a.participants.map((p, i) => (
                  <li key={i} style={{ overflowWrap: "anywhere" }}>{"family_name" in p ? `familiar: ${p.family_name}` : p.patient.name}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Evolução</span>
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.notes || "sem evolução registrada"}</p>
            </div>
            {a.cancelled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={muted}>{a.cancelled_at ? `Motivo do cancelamento · ${fmtDateTime(a.cancelled_at)}` : "Motivo do cancelamento"}</span>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.cancel_reason ?? "—"}</p>
              </div>
            )}
            {!a.cancelled && !cancelling && (
              <div style={row}>
                <button type="button" style={secondaryButtonStyle} onClick={() => { setDone(null); setNotice(null); setCancelling(true); }}>
                  Cancelar ação
                </button>
              </div>
            )}
            {!a.cancelled && cancelling && (
              <CancelAction actionId={a.id} lead={roles.lead} onCancelled={cancelled} onAlreadyCancelled={alreadyCancelled}
                onBack={() => setCancelling(false)} />
            )}
            {children?.(a)}
          </>
        )}
      </div>
    </Panel>
  );
}

function CancelAction({ actionId, lead, onCancelled, onAlreadyCancelled, onBack }: {
  actionId: string; lead: boolean; onCancelled(item: PsyActionRow, reason: string): void; onAlreadyCancelled(text: string): void; onBack(): void;
}) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const [ reason, setReason ] = useState("");

  return (
    <form ref={f.formRef} aria-label="Cancelar ação" style={form} noValidate onSubmit={(ev) => {
      const text = reason.trim();
      void f.submit(ev, {
        check: () => (reasonProblem(reason, CANCEL_REASON.min, CANCEL_REASON.max) ? [ { path: "reason", text: LONG_REASON_TEXT } ] : []),
        call: () => cancelPsyAction(actionId, text),
        ok: (item) => onCancelled(item, text),
        refused: (list) => {
          // A tela estava velha: a frase vai ao detalhe, que é relido.
          if (list.some((r) => r.code === "already_cancelled" || r.code === "not_found")) {
            onAlreadyCancelled(list[0].text);
            return [];
          }
          return list.map((r) => ({ path: r.path, text: r.path === "reason" ? LONG_REASON_TEXT : r.text }));
        }
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Cancelar ação</p>
      {!lead && <p style={muted}>{CANCEL_LEAD_NOTE}</p>}
      {f.top((path) => path === "reason")}
      <label style={fieldLabel}>
        Motivo do cancelamento
        <textarea value={reason} rows={3} style={inputStyle} {...aria("reason")} onChange={(ev) => { f.clear("reason"); setReason(ev.target.value); }} />
      </label>
      {errNode("reason")}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Confirmar cancelamento</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onBack}>Voltar</button>
      </div>
    </form>
  );
}
