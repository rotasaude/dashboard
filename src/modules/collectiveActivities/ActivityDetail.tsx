// src/modules/collectiveActivities/ActivityDetail.tsx
// Detalhe de uma atividade coletiva (módulo 24b, F-24.12): a leitura nominal (participantes com nome, documento mascarado, avaliação,
// medidas e tabagismo), com trilha, uma vez e sem sondagem. A ficha aparece só como situação (Q12/Q70: nada de "Gerar de novo" aqui).
// "Registrada por engano" só com `can_mark_mistaken` e atividade `recorded`; o motivo (10 a 500) fica congelado e vai com
// `expected_state: "recorded"` (o client faz isso). 409 `activity_changed`/`not_found` → a frase e UMA releitura; nunca reenvia sozinho.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getCollectiveActivity, markCollectiveMistaken, type CollectiveActivity, type CollectiveDomains, type CollectiveParticipant } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime } from "../../lib/format";
import { CA_DETAIL_KEY, CA_LIST_KEY, NOMINAL_QUERY, fichaLabel, homeVisitError, homeVisitRefusals, shiftLabel, textProblem } from "../../lib/homeVisits";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { useWriteLock } from "../homeVisits/writeLock";
import { alert, box, fieldLabel, form, grid, muted, row } from "../exams/styles";
import { activityTypeLabel, placeText } from "./ActivityList";

export const MISTAKEN_EFFECT = "A atividade sai das telas e das linhas de cuidado; a ficha já enfileirada no e-SUS não é desfeita.";
// O motivo vem nulo para quem não pode lê-lo: a frase diz isso, sem inventar motivo.
export const MISTAKEN_REASON_HIDDEN = "motivo não disponível para o seu perfil";
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const labels = (list: { code: number; label: string }[], codes: number[] | undefined): string =>
  codes && codes.length ? codes.map((c) => list.find((x) => x.code === c)?.label ?? String(c)).join(", ") : "—";
const isActivityStale = (err: unknown): boolean => [ "activity_changed", "not_found" ].includes(errorCode(err) ?? "");

function participantMeasures(p: CollectiveParticipant): string {
  const m = p.measurements;
  const out: string[] = [];
  if (m?.weight_kg != null) out.push(`Peso ${NUM.format(m.weight_kg)} kg`);
  if (m?.height_cm != null) out.push(`Altura ${NUM.format(m.height_cm)} cm`);
  return out.join(" · ");
}
function smokingText(p: CollectiveParticipant): string | null {
  if (!p.smoking) return null;
  const out: string[] = [];
  if (p.smoking.quit) out.push("parou de fumar");
  if (p.smoking.dropped_out) out.push("abandonou o grupo");
  return out.length ? out.join(" · ") : "tabagismo acompanhado";
}
const documentText = (p: CollectiveParticipant["patient"]): string =>
  [ p.has_cpf ? "CPF cadastrado" : null, p.cns_masked ? `CNS ${p.cns_masked}` : null ].filter(Boolean).join(" · ") || "sem CPF e sem CNS";

export function ActivityDetail({ id, domains }: { id: string; domains: CollectiveDomains }) {
  const q = useQuery({ queryKey: [ CA_DETAIL_KEY, id ], queryFn: () => getCollectiveActivity(id), ...NOMINAL_QUERY });
  if (q.isError && !q.data) return <p role="alert" style={alert}>{homeVisitError(q.error)}</p>;
  if (!q.data) return <p role="status" style={muted}>Carregando a atividade…</p>;
  return <Loaded a={q.data} domains={domains} />;
}

function Loaded({ a, domains }: { a: CollectiveActivity; domains: CollectiveDomains }) {
  const [ marking, setMarking ] = useState(false);
  const [ note, setNote ] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const lock = useWriteLock();
  const ficha = fichaLabel(a.ficha);
  const procedure = a.procedure_code ? (domains.procedures.find((p) => p.code === a.procedure_code)?.label ?? a.procedure_code) : null;
  const canMark = a.can_mark_mistaken && a.state === "recorded";
  const reread = () => queryClient.invalidateQueries({ queryKey: [ CA_DETAIL_KEY, a.id ] });
  const changed = () => { void reread(); void queryClient.invalidateQueries({ queryKey: [ CA_LIST_KEY ] }); };
  return (
    <section aria-label={`Atividade de ${fmtDay(a.held_on)}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong className="mono">{fmtDay(a.held_on)}</strong>
        <span>{activityTypeLabel(domains, a.activity_type)}</span>
        {a.state === "mistaken" && <Tag tone="down" mono={false}>registrada por engano</Tag>}
        <Tag tone={ficha.tone} mono={false}>{ficha.text}</Tag>
      </div>
      <div style={grid}>
        <KeyValue k="Turno" v={shiftLabel(a.shift)} mono={false} />
        <KeyValue k="Equipe" v={a.team.name ?? a.team.ine} mono={false} />
        <KeyValue k="Local" v={placeText(a)} mono={false} />
        <KeyValue k="Participantes" v={`${a.participants_count} (${a.altered_count} com avaliação alterada)`} mono={false} />
        <KeyValue k="Registrada por" v={a.recorded_by.name ?? "—"} mono={false} />
      </div>
      <KeyValue k="Temas de reunião" v={labels(domains.meeting_topics, a.meeting_topics)} mono={false} />
      <KeyValue k="Público-alvo" v={labels(domains.target_audience, a.target_audience)} mono={false} />
      <KeyValue k="Temas para saúde" v={labels(domains.health_topics, a.health_topics)} mono={false} />
      <KeyValue k="Práticas em saúde" v={labels(domains.health_practices, a.health_practices)} mono={false} />
      {procedure && <KeyValue k="Procedimento" v={procedure} mono={false} />}
      <KeyValue k="Profissionais" v={a.professionals.length ? a.professionals.map((p) => p.name).join(", ") : "—"} mono={false} />
      <div style={box}>
        <strong style={{ fontSize: 12.5 }}>Participantes</strong>
        {(a.participants ?? []).length === 0 && <p style={muted}>nenhum participante identificado</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {(a.participants ?? []).map((p) => (
            <li key={p.patient.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, overflowWrap: "anywhere" }}>{p.patient.display_name ?? "sem nome no cadastro"}</span>
              <span style={muted}>{documentText(p.patient)}</span>
              <span style={muted}>{p.altered_evaluation ? "avaliação alterada" : "avaliação sem alteração"}</span>
              {participantMeasures(p) && <span style={muted}>{participantMeasures(p)}</span>}
              {smokingText(p) && <span style={muted}>{smokingText(p)}</span>}
            </li>
          ))}
        </ul>
      </div>
      {a.mistaken && (
        <div style={box}>
          <strong style={{ fontSize: 12.5 }}>Registrada por engano</strong>
          <p style={muted}>em {fmtDateTime(a.mistaken.at)} por {a.mistaken.by.name ?? "—"}</p>
          {a.mistaken.reason ? <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>{a.mistaken.reason}</p> : <p style={muted}>{MISTAKEN_REASON_HIDDEN}</p>}
        </div>
      )}
      {note && <p role="status" style={alert}>{note}</p>}
      {canMark && !marking && <div><ActionButton variant="secondary" onClick={() => { setNote(null); setMarking(true); }}>Registrada por engano</ActionButton></div>}
      {canMark && marking && (
        <MistakenForm activity={a} lock={lock}
          onDone={() => { setMarking(false); setNote(null); changed(); }}
          onClose={() => setMarking(false)}
          onStale={(text) => { setMarking(false); setNote(text); changed(); }} />
      )}
    </section>
  );
}

function MistakenForm({ activity, lock, onDone, onClose, onStale }: {
  activity: CollectiveActivity; lock: ReturnType<typeof useWriteLock>; onDone(): void; onClose(): void; onStale(text: string): void;
}) {
  const f = useFormProblems({ refusals: (err) => homeVisitRefusals(err).map((r) => ({ ...r, participantIndex: null })), isStale: isActivityStale });
  const [ reason, setReason ] = useState("");
  const busy = f.busy || lock.busy;
  const noticeId = f.fid("notice");
  return (
    <form ref={f.formRef} noValidate style={form} aria-label="Registrada por engano"
      onSubmit={(ev) => lock.held() ? ev.preventDefault() : f.submit(ev, {
        check: () => { const p = textProblem(reason, { min: 10, max: 500, path: "reason" }); return p ? [ p ] : []; },
        call: () => lock.run(() => markCollectiveMistaken(activity.id, reason.trim())),
        ok: () => onDone(),
        stale: (text) => onStale(text)
      })}>
      <p style={muted}>{MISTAKEN_EFFECT}</p>
      <label style={fieldLabel}>
        Motivo
        <textarea value={reason} rows={3} maxLength={600} style={inputStyle} onChange={(e) => { setReason(e.target.value); f.clear("reason"); }}
          aria-describedby={[ noticeId, f.textOf("reason") ? `${f.fid("reason")}-err` : "" ].filter(Boolean).join(" ")} {...(f.textOf("reason") ? { "aria-invalid": true as const } : {})} />
      </label>
      <FrozenTextNotice id={noticeId} />
      {f.errNode("reason")}
      {f.top((p) => p === "reason")}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Confirmar</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
      </div>
    </form>
  );
}
