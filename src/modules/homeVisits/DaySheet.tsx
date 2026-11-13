// src/modules/homeVisits/DaySheet.tsx
// Uma folha do dia (módulo 24b): cabeçalho (data, "folha N", contagens, situação da ficha), pendências (`blockers`) em linguagem
// simples, lista de cartões e "Fechar o dia". Reusada pelo detalhe da folha (Task 8). Sem `day.visits` (folha fechada lida pela
// lista), só o cabeçalho. A folha nunca é relida sozinha: 409 `day_changed`/`day_closed`/`visit_changed` mostra a frase e pede
// UMA releitura ao pai (`onChanged()`), sem reenviar. Uma gravação por vez na tela (`useWriteLock`).
import { useRef, useState } from "react";
import { closeHomeVisitDay, type HomeVisit, type HomeVisitDay, type HomeVisitDomains } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtHourMinute } from "../../lib/format";
import { CLOSE_EFFECT, LEDI_EXPORT_OFF, WRITE_RUNNING, blockerText, closedByLabel, dayStateLabel, fichaLabel, homeVisitRefusals, isDayStale } from "../../lib/homeVisits";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { box, list as listStyle, muted, row } from "../exams/styles";
import { VisitCard } from "./VisitCard";
import { WithdrawForm } from "./WithdrawForm";
import { useWriteLock } from "./writeLock";

const NO_VISITS = "nenhuma visita nesta folha ainda";

// `onChanged(updated?)`: com a folha devolvida pelo api (fechamento) o pai a grava; sem ela, relê uma vez.
export function DaySheet({ day, domains, onChanged }: { day: HomeVisitDay; domains: HomeVisitDomains; onChanged(updated?: HomeVisitDay): void }) {
  const msg = useActionMessage();
  const lock = useWriteLock();
  const [ withdrawing, setWithdrawing ] = useState<string | null>(null);
  const [ closing, setClosing ] = useState(false);
  const sending = useRef(false);
  const open = day.state === "open";
  const ficha = fichaLabel(day.ficha);
  const visits = day.visits;
  const byId = new Map((visits ?? []).map((v) => [ v.id, v ]));

  async function close() {
    if (sending.current || lock.held()) return;
    sending.current = true; setClosing(true); msg.start();
    try {
      const updated = await lock.run(() => closeHomeVisitDay(day.id));
      msg.ok("Dia fechado.");
      onChanged(updated);
    } catch (err) {
      msg.fail(homeVisitRefusals(err)[0].text);
      if (isDayStale(err)) onChanged();
    } finally { sending.current = false; setClosing(false); }
  }

  function blockerLine(b: { code: string; visit_id: string | null }): string {
    const v = b.visit_id ? byId.get(b.visit_id) : undefined;
    if (!v) return blockerText(b.code);
    return [ blockerText(b.code), fmtHourMinute(v.occurred_at), v.patient?.display_name ].filter(Boolean).join(" · ");
  }

  return (
    <section aria-label={`Folha de ${fmtDay(day.day)}${day.sequence > 1 ? `, folha ${day.sequence}` : ""}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={row}>
          <strong>{fmtDay(day.day)}</strong>
          {day.sequence > 1 && <span style={muted}>folha {day.sequence}</span>}
          <Tag tone={open ? "info" : "neutral"} mono={false}>{dayStateLabel(day.state)}</Tag>
          <Tag tone={ficha.tone} mono={false}>{ficha.text}</Tag>
        </div>
        <span style={muted}>
          {day.visits_count} {day.visits_count === 1 ? "visita" : "visitas"}
          {day.withdrawn_count > 0 ? ` · ${day.withdrawn_count} ${day.withdrawn_count === 1 ? "retirada" : "retiradas"}` : ""}
          {!open && day.closed_by ? ` · fechada ${closedByLabel(day.closed_by, day.own)}${day.closed_at ? ` às ${fmtHourMinute(day.closed_at)}` : ""}` : ""}
        </span>
        {day.ledi_export_enabled === false && <p role="status" style={{ ...muted, color: "var(--ink2)" }}>{LEDI_EXPORT_OFF}</p>}
      </header>

      {day.blockers.length > 0 && (
        <div style={box}>
          <strong style={{ fontSize: 12.5 }}>Antes de fechar, resolva</strong>
          <ul style={listStyle}>{day.blockers.map((b, i) => <li key={`${b.code}-${b.visit_id ?? i}`}>{blockerLine(b)}</li>)}</ul>
        </div>
      )}

      <ActionMessage message={msg.message} />

      {visits && (visits.length === 0 ? <EmptyState title={NO_VISITS} /> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {visits.map((v: HomeVisit) => (
            <li key={v.id} style={{ border: "1px solid var(--rule)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <VisitCard visit={v} domains={domains} busy={closing || lock.busy}
                canWithdraw={open && v.state === "recorded" && v.can_withdraw}
                onWithdraw={() => { msg.start(); setWithdrawing(v.id); }} />
              {withdrawing === v.id && (
                <WithdrawForm visit={v} onClose={() => setWithdrawing(null)}
                  onDone={() => { setWithdrawing(null); msg.ok("Visita retirada."); onChanged(); }}
                  onStale={(text) => { setWithdrawing(null); msg.fail(text); onChanged(); }} />
              )}
            </li>
          ))}
        </ul>
      ))}

      {day.own && open && (
        <div><ConfirmButton label="Fechar o dia" question={CLOSE_EFFECT} onConfirm={close} disabledReason={lock.busy && !closing ? WRITE_RUNNING : null} /></div>
      )}
    </section>
  );
}
