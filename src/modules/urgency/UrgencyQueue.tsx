// Fila da UPA (módulo 32a, F-32.3; contrato §6, §14 Q6/Q18): três faixas — aguardando classificação, classificados por cor (na
// ordem do api: cor e chegada) e em atendimento. Polling por usePolling (um pedido por vez, nenhum timer depois de desmontar).
// - Nenhum texto clínico: as linhas são montadas campo a campo, e o paciente só com id, nome, CNS mascarado e o sinal de provisório
//   (a descrição do não identificado fica no detalhe). A fila não grava trilha.
// - Estouro (Q18): vem pronto do api (desde a 1ª classificação, contra o tempo máximo da vigente); a tela nunca recalcula e diz por
//   texto, não só pela cor. A espera mostrada é desde a chegada.
// - Recusa que não passa sozinha (403 cbo_not_allowed do técnico 3222, 422 not_an_upa, 401) para o polling; falha de rede segue
//   tentando, mantendo a última fila.
// - Botões: só os que a mesa ligou (`actions`, Tasks 7–10) e que o papel permite no api (A8: identificar é da recepção; A13: a
//   recepção nunca chama de novo; Q2: só a enfermagem 2235 classifica e chama para a classificação; o médico chama por cor).
import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";
import {
  ApiError, getUrgencyQueue,
  type HealthUnit, type UrgencyColor, type UrgencyColorRow, type UrgencyInCareRow, type UrgencyLastCall, type UrgencyPatientRef,
  type UrgencyQueue as UrgencyQueueData, type UrgencyWaitingRow
} from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { waitLabel } from "../../lib/screening";
import {
  NO_CLINICAL_IN_LIST, URGENCY_COLOR_TONE, URGENCY_QUEUE_POLL_MS, colorLabel, maxWaitLabel, urgencyError, type UrgencyRoles
} from "../../lib/urgency";
import { usePolling } from "../../lib/usePolling";
import { DataTable, type Column } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";

export interface QueueActions {
  onClassify?(row: UrgencyWaitingRow | UrgencyColorRow): void;
  onCallClassification?(row: UrgencyWaitingRow | UrgencyColorRow): void;
  onCallCare?(row: UrgencyColorRow): void;
  onRecall?(row: { attendance_id: string }): void;
  onOpenCare?(row: UrgencyInCareRow): void;
  onIdentify?(row: UrgencyWaitingRow): void;
  onLeft?(row: UrgencyWaitingRow): void;
}
export interface UrgencyQueueHandle { refresh(): void }
export type QueueRoles = Pick<UrgencyRoles, "reception" | "nurse" | "doctor">;
export interface UrgencyQueueProps { unit: HealthUnit; roles: QueueRoles; now?(): Date; actions: QueueActions }

const LAST_CALL_KIND = { classification: "classificação", care: "atendimento" } as const;
const CONSULTATION_TEXT = { draft: "em rascunho", finalized: "finalizada", discarded: "—" } as const;

// ─── Linhas campo a campo (o que o api mandar a mais não passa) ─────────────
const safePatient = (p: UrgencyPatientRef): UrgencyPatientRef =>
  ({ patient_id: p.patient_id, name: p.name, cns_masked: p.cns_masked ?? null, unidentified: !!p.unidentified });
const safeCall = (c: UrgencyLastCall | null | undefined): UrgencyLastCall | null =>
  (c ? { kind: c.kind, location: c.location ?? null, called_at: c.called_at } : null);
const safeWaiting = (r: UrgencyWaitingRow): UrgencyWaitingRow => ({
  encounter_id: r.encounter_id, attendance_id: r.attendance_id, ticket: r.ticket ?? null, patient: safePatient(r.patient),
  arrived_at: r.arrived_at, waited_minutes: r.waited_minutes, last_call: safeCall(r.last_call), max_wait_minutes: r.max_wait_minutes ?? null
});
const safeColor = (r: UrgencyColorRow): UrgencyColorRow => ({
  ...safeWaiting(r), color: r.color, overdue: r.overdue === true, max_wait_minutes: r.max_wait_minutes, classified_at: r.classified_at
});
const safeInCare = (r: UrgencyInCareRow): UrgencyInCareRow => ({
  ...safeWaiting(r), color: r.color ?? null, max_wait_minutes: r.max_wait_minutes ?? null, called_at: r.called_at ?? null,
  called_by_name: r.called_by_name ?? null, consultation_id: r.consultation_id ?? null, consultation_status: r.consultation_status ?? null
});

// Recusa que não passa sozinha: parar de pedir (o 429 e a rede voltam a tentar).
const stopsPolling = (err: unknown): boolean => err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;

// ─── Células ────────────────────────────────────────────────────────────────
const ticketCell = (r: UrgencyWaitingRow) => <span className="mono" data-testid="ticket">{r.ticket ?? "—"}</span>;
const personCell = (r: UrgencyWaitingRow) => (
  <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
    <span>{r.patient.name}</span>
    {r.patient.unidentified ? <Tag tone="warn">sem identificação</Tag>
      : r.patient.cns_masked && <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{r.patient.cns_masked}</span>}
  </span>
);
const colorCell = (c: UrgencyColor | null) => (c ? <Tag tone={URGENCY_COLOR_TONE[c]}>{colorLabel(c)}</Tag> : "—");
const lastCallText = (c: UrgencyLastCall | null) =>
  (c ? [ LAST_CALL_KIND[c.kind] ?? "chamada", c.location, fmtHourMinute(c.called_at) ].filter(Boolean).join(" · ") : "—");
const waitCell = (r: UrgencyColorRow) => (r.overdue
  ? <span style={{ color: "var(--down)" }}>{`${waitLabel(r.waited_minutes)} · passou do tempo (${maxWaitLabel(r.max_wait_minutes)})`}</span>
  : waitLabel(r.waited_minutes));

type Btn = { label: string; onClick(): void } | false | undefined | null;

function rowButtons(ticketOrName: string, buttons: Btn[]): ReactNode {
  const shown = buttons.filter((b): b is { label: string; onClick(): void } => !!b);
  if (shown.length === 0) return null;
  return (
    <div data-row-actions style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
      {shown.map((b) => (
        <button key={b.label} type="button" style={secondaryButtonStyle} aria-label={`${b.label} ${ticketOrName}`} onClick={b.onClick}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
const who = (r: UrgencyWaitingRow) => r.ticket ?? r.patient.name;

function Band({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{label}</strong>
      {children}
    </section>
  );
}

export const UrgencyQueue = forwardRef<UrgencyQueueHandle, UrgencyQueueProps>(function UrgencyQueue({ unit, roles, actions }, ref) {
  // Recusa definitiva desta unidade: o polling para (o `key` da unidade volta a ler numa troca).
  const [ stoppedFor, setStoppedFor ] = useState<string | null>(null);
  const hasRole = roles.reception || roles.nurse || roles.doctor;
  const polling = usePolling<UrgencyQueueData>(
    hasRole && stoppedFor !== unit.id ? () => getUrgencyQueue(unit.id) : null, URGENCY_QUEUE_POLL_MS, unit.id
  );
  useEffect(() => { if (stopsPolling(polling.error)) setStoppedFor(unit.id); }, [ polling.error, unit.id ]);
  useImperativeHandle(ref, () => ({ refresh: polling.refresh }), [ polling.refresh ]);

  const data = polling.data;
  const awaiting = (data?.awaiting_classification ?? []).map(safeWaiting);
  const byColor = (data?.by_color ?? []).map(safeColor);
  const inCare = (data?.in_care ?? []).map(safeInCare);
  const { onClassify, onCallClassification, onCallCare, onRecall, onOpenCare, onIdentify, onLeft } = actions;
  // A13: a nova chamada repete o tipo da última; chama de novo quem faz aquele tipo (nunca a recepção).
  const canRecall = (c: UrgencyLastCall | null) => !!c && ((c.kind === "classification" && roles.nurse) || (c.kind === "care" && roles.doctor));
  const recall = (r: UrgencyWaitingRow): Btn => onRecall && canRecall(r.last_call) && { label: "Chamar de novo", onClick: () => onRecall({ attendance_id: r.attendance_id }) };
  const identify = (r: UrgencyWaitingRow): Btn => onIdentify && roles.reception && r.patient.unidentified && { label: "Identificar", onClick: () => onIdentify(r) };
  const left = (r: UrgencyWaitingRow): Btn => onLeft && { label: "Saiu sem atendimento", onClick: () => onLeft(r) };

  const common: Column<UrgencyWaitingRow>[] = [
    { label: "Senha", w: "0.7fr", card: "title", render: ticketCell },
    { label: "Pessoa", w: "1.6fr", card: "title", render: personCell }
  ];
  const lastCallCol = { label: "Última chamada", w: "1.6fr", render: (r: UrgencyWaitingRow) => lastCallText(r.last_call) };

  const awaitingCols: Column<UrgencyWaitingRow>[] = [
    ...common,
    { label: "Espera", w: "1.2fr", render: (r) => `${waitLabel(r.waited_minutes)} desde a chegada` },
    lastCallCol,
    { label: "", w: "auto", align: "right", card: "actions", render: (r) => rowButtons(who(r), [
      onClassify && roles.nurse && { label: "Classificar", onClick: () => onClassify(r) },
      onCallClassification && roles.nurse && { label: "Chamar para classificação", onClick: () => onCallClassification(r) },
      recall(r), identify(r), left(r)
    ]) }
  ];
  const colorCols: Column<UrgencyColorRow>[] = [
    ...common,
    { label: "Cor", w: "0.8fr", render: (r) => colorCell(r.color) },
    { label: "Espera desde a chegada", w: "1.6fr", render: waitCell },
    lastCallCol,
    { label: "", w: "auto", align: "right", card: "actions", render: (r) => rowButtons(who(r), [
      onCallCare && roles.doctor && { label: "Chamar", onClick: () => onCallCare(r) },
      onClassify && roles.nurse && { label: "Reclassificar", onClick: () => onClassify(r) },
      recall(r), identify(r), left(r)
    ]) }
  ];
  const inCareCols: Column<UrgencyInCareRow>[] = [
    ...common,
    { label: "Cor", w: "0.8fr", render: (r) => colorCell(r.color) },
    { label: "Espera desde a chegada", w: "1fr", render: (r) => waitLabel(r.waited_minutes) },
    { label: "Chamado por", w: "1.2fr", render: (r) => [ r.called_by_name, r.called_at && fmtHourMinute(r.called_at) ].filter(Boolean).join(" · ") || "—" },
    { label: "Consulta", w: "0.9fr", render: (r) => (r.consultation_status ? CONSULTATION_TEXT[r.consultation_status] ?? "—" : "—") },
    { label: "", w: "auto", align: "right", card: "actions", render: (r) => rowButtons(who(r), [
      onOpenCare && roles.doctor && { label: "Atender", onClick: () => onOpenCare(r) },
      recall(r), identify(r)
    ]) }
  ];

  const loading = data === undefined && !polling.error;

  return (
    <Panel title="Fila da urgência" sub="por risco · quem corre mais risco é atendido primeiro">
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {polling.error != null && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(polling.error)}</p>
        )}
        {loading ? (
          <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
        ) : data !== undefined && (
          <>
            <Band label="Aguardando classificação">
              <DataTable<UrgencyWaitingRow> cols={awaitingCols} rows={awaiting} rowKey={(r) => r.encounter_id} empty="ninguém aguardando classificação" />
            </Band>
            <Band label="Classificados, por cor">
              <DataTable<UrgencyColorRow> cols={colorCols} rows={byColor} rowKey={(r) => r.encounter_id} empty="ninguém classificado aguardando" />
            </Band>
            <Band label="Em atendimento">
              <DataTable<UrgencyInCareRow> cols={inCareCols} rows={inCare} rowKey={(r) => r.encounter_id} empty="ninguém em atendimento" />
            </Band>
          </>
        )}
        <footer style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}>
          <span>{NO_CLINICAL_IN_LIST}</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>
            {`atualiza a cada ${URGENCY_QUEUE_POLL_MS / 1000} s${polling.updatedAt ? ` · ${fmtHourMinute(new Date(polling.updatedAt).toISOString())}` : ""}`}
          </span>
        </footer>
      </div>
    </Panel>
  );
});
