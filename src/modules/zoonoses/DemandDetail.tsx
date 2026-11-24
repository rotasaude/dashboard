// src/modules/zoonoses/DemandDetail.tsx
// Detalhe e andamento da demanda do centro de zoonoses (módulo 35b, F-35.13). O detalhe grava a trilha de leitura
// (NOMINAL_QUERY: lido ao abrir e depois de uma ação, nunca sozinho). Extrato (só o texto do cidadão) e endereço do lugar só aqui.
// Uma ação aberta por vez, só as de `demandActions`; toda escrita leva `expected_version`. 409 (demand_changed,
// forwarding_changed): a frase, UMA releitura do detalhe e da fila, nenhum reenvio.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { closeDemand, declineDemand, extendDemand, getDemand, inspectDemand, scheduleDemand, type DemandOutcome } from "../../lib/api";
import { fmtDay } from "../../lib/homeVisits";
import {
  NOMINAL_QUERY, ZOO_DEMAND_KEY, demandActions, demandProblems, isZoonosesStale, zooLabel, zoonosesRefusals, type DemandAction
} from "../../lib/zoonoses";
import { ActionButton } from "../../components/ActionButton";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { inputStyle } from "../../components/formStyles";
import { DeadlineTag } from "../ombudsman/DeadlineTag";
import { alert, box, fieldLabel, muted, okText, panel, row, title } from "../exams/styles";
import { useZooDomains } from "./useZooDomains";

const LABEL: Record<DemandAction, string> = {
  schedule: "Agendar vistoria", inspect: "Registrar vistoria", close: "Encerrar", decline: "Não é do centro", extend: "Prorrogar prazo"
};
export const CLOSE_NOTE = "este texto vai à ouvidoria como a resposta do encaminhamento";

export function DemandDetail({ id, today, onChanged }: { id: string; today: string; onChanged(): void }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const q = useQuery({ queryKey: [ ZOO_DEMAND_KEY, id ], queryFn: () => getDemand(id), ...NOMINAL_QUERY, gcTime: 0 });
  const [ action, setAction ] = useState<DemandAction | null>(null);
  const [ date, setDate ] = useState("");
  const [ note, setNote ] = useState("");
  const [ outcome, setOutcome ] = useState("");
  const [ text, setText ] = useState("");
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const d = q.data;

  const reread = () => { void client.invalidateQueries({ queryKey: [ ZOO_DEMAND_KEY, id ] }); onChanged(); };
  const open = (a: DemandAction) => { setAction(a); setProblems([]); setNotice(null); setDate(""); setNote(""); setOutcome(""); setText(""); };

  async function send() {
    if (!d || !action || sending.current) return;
    const found = demandProblems(action, { date, note, outcome, text }, today);
    if (found.length > 0) { setProblems(found.map((p) => p.text)); return; }
    sending.current = true;
    setBusy(true);
    setProblems([]);
    const v = d.version;
    try {
      if (action === "schedule") await scheduleDemand(id, { scheduled_on: date, expected_version: v });
      else if (action === "inspect") await inspectDemand(id, { inspected_on: date, inspection_note: note.trim(), expected_version: v });
      else if (action === "close") await closeDemand(id, { outcome: outcome as DemandOutcome, text: text.trim(), expected_version: v });
      else if (action === "decline") await declineDemand(id, { text: text.trim(), expected_version: v });
      else await extendDemand(id, { reason: text.trim(), expected_version: v });
      setAction(null);
      setNotice("Andamento registrado.");
      reread();
    } catch (err) {
      const refusals = zoonosesRefusals(err);
      setProblems([ ...new Set(refusals.map((r) => r.text)) ]);
      if (isZoonosesStale(err)) { setAction(null); setNotice(refusals[0].text); setProblems([]); reread(); }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (q.isLoading) return <p style={muted}>carregando…</p>;
  if (q.isError || !d) return <EmptyState title={q.error ? zoonosesRefusals(q.error)[0].text : "demanda não encontrada"} />;
  const actions = demandActions(d);
  const waiting = q.isFetching ? "atualizando…" : null;
  const needsDate = action === "schedule" || action === "inspect";
  return (
    <section style={panel} aria-label="Demanda">
      <strong style={title}>{zooLabel(domains?.subtypes, d.subtype)}</strong>
      <div style={row}>
        <Tag tone="neutral">{zooLabel(domains?.demand_states, d.state)}</Tag>
        <DeadlineTag color={d.color} dueOn={d.due_on} />
      </div>
      <p style={{ margin: 0, fontSize: 13 }}>{d.extract}</p>
      <p style={muted}>Endereço do local</p>
      <p style={{ margin: 0, fontSize: 13 }}>{d.place_address ?? "—"}</p>
      {d.scheduled_on && <p style={muted}>Visita agendada para {fmtDay(d.scheduled_on)}</p>}
      {d.inspected_on && <p style={muted}>Vistoria em {fmtDay(d.inspected_on)}{d.inspection_note ? `: ${d.inspection_note}` : ""}</p>}
      {d.outcome && <p style={muted}>Desfecho: {zooLabel(domains?.demand_outcomes, d.outcome)}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
      {!action && actions.length > 0 && (
        <div style={row}>{actions.map((a) => <ActionButton key={a} variant="secondary" disabledReason={waiting} onClick={() => open(a)}>{LABEL[a]}</ActionButton>)}</div>
      )}
      {action && (
        <form style={box} aria-label={LABEL[action]} onSubmit={(e) => e.preventDefault()}>
          {needsDate && (
            <label style={fieldLabel}>
              {action === "schedule" ? "Data da visita" : "Data da vistoria"}
              <input type="date" value={date} disabled={busy} style={inputStyle} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {action === "inspect" && (
            <label style={fieldLabel}>
              Nota da vistoria
              <textarea value={note} rows={3} disabled={busy} style={inputStyle} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          {action === "close" && (
            <>
              <label style={fieldLabel}>
                Desfecho
                <select value={outcome} disabled={busy} style={inputStyle} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="">—</option>
                  {(domains?.demand_outcomes ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </label>
              <p style={muted}>{CLOSE_NOTE}</p>
            </>
          )}
          {(action === "close" || action === "decline") && (
            <label style={fieldLabel}>
              Texto da resposta
              <textarea value={text} rows={4} disabled={busy} style={inputStyle} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {action === "extend" && (
            <label style={fieldLabel}>
              Motivo
              <textarea value={text} rows={3} disabled={busy} style={inputStyle} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {problems.map((p) => <p key={p} role="alert" style={alert}>{p}</p>)}
          <div style={row}>
            <ActionButton busy={busy} disabledReason={waiting} onClick={send}>Enviar</ActionButton>
            <ActionButton variant="secondary" onClick={() => { if (!busy) setAction(null); }}>Voltar</ActionButton>
          </div>
        </form>
      )}
    </section>
  );
}
