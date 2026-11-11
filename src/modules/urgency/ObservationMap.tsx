// Mapa da observação na mesa da UPA (módulo 32b, F-32.7; api-shapes §3): um cartão por leito de observação, com a senha, o nome,
// a entrada, as horas desde a PRIMEIRA entrada do encontro (mesmo depois de sair e voltar) e o alerta de 20 h / 24 h POR TEXTO.
// - Nada clínico: as linhas são montadas campo a campo (safe*), e só passam senha, nome, CNS mascarado, leito, horas e alerta.
//   O que o api mandar a mais (queixa, medicamento, motivo, CID) não chega à tela.
// - Polling por usePolling (30 s, um pedido por vez, nenhum timer depois de desmontar). Só a recusa que não passa sozinha
//   (403 missing_link/cbo_not_allowed, 404, 422) para o polling: o rodapé troca "atualiza a cada…" por "parado às hh:mm" e
//   "Tentar de novo". Sessão vencida (401), 408, 425, 429, 5xx e rede seguem no intervalo e se recuperam sozinhas.
// - Escrita (médico 225 e enfermagem 2235): entrada (quem está em atendimento sem leito), troca de leito (só para leito ativo e
//   livre) e saída sem desfecho. Um envio por vez; depois de qualquer escrita, ou de uma recusa que mostra que o mapa mudou
//   (bed_taken, bed_unavailable, not_in_care, not_in_observation, encounter_closed), o mapa relê na hora e o formulário fecha.
//   O desfecho da urgência fecha a estadia pelo api; a mesa pede `refresh()` depois dele.
// - Recepção e técnico 3222 só leem; o técnico (e quem checa) vê "Medicação", que a mesa liga ao aprazamento.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ApiError, endObservation, errorCode, getUrgencyObservation, startObservation,
  type ObservationAlert, type ObservationBed, type ObservationStayRef, type ObservationWaiting, type HealthUnit,
  type UrgencyObservationMap, type UrgencyPatientRef
} from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import {
  NO_CLINICAL_IN_MAP, NO_UPA_BEDS, URGENCY_OBSERVATION_POLL_MS, alertText, alertTone, hoursText
} from "../../lib/urgencyObservation";
import { urgencyError, type UrgencyRoles } from "../../lib/urgency";
import { usePolling } from "../../lib/usePolling";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle, buttonStyle } from "../../components/formStyles";
import { box, fieldLabel, muted, row, title } from "../exams/styles";

// O alvo da checagem de medicação (Task 7): só o id do encontro, a senha e o nome para o título do painel.
export type MedicationTarget = { encounterId: string; ticket: string | null; patientName: string };
export interface ObservationMapHandle { refresh(): void }
export interface ObservationMapProps {
  unit: HealthUnit;
  roles: UrgencyRoles;
  onMedication?(target: MedicationTarget): void;
  // O relógio do "parado às" (testes).
  now?: Date;
}

export const NO_NAME = "sem nome";
export const NO_IDENTIFICATION = "sem identificação";
export const NO_WAITING_FOR_BED = "ninguém em atendimento sem leito";
export const END_QUESTION = "O paciente volta ao atendimento, sem leito. Confirmar?";
const STARTED = "Paciente em observação.";
const CHANGED = "Leito trocado.";
const ENDED = "Observação encerrada.";
// A recusa que mostra que o mapa já mudou: relê na hora e fecha o formulário.
const MAP_CHANGED = new Set([ "bed_taken", "bed_unavailable", "not_in_care", "not_in_observation", "encounter_closed", "already_closed" ]);

// ─── Linhas campo a campo ───────────────────────────────────────────────────
const safePatient = (p: UrgencyPatientRef): UrgencyPatientRef =>
  ({ patient_id: p?.patient_id, name: p?.name ?? "", cns_masked: p?.cns_masked ?? null, unidentified: !!p?.unidentified });
const safeAlert = (a: unknown): ObservationAlert => (a === "near_limit" || a === "over_limit" ? a : null);
const safeStay = (s: ObservationStayRef): ObservationStayRef => ({
  stay_id: s.stay_id, encounter_id: s.encounter_id, ticket: s.ticket ?? null, patient: safePatient(s.patient),
  started_at: s.started_at, hours: Number.isFinite(s.hours) ? s.hours : 0, alert: safeAlert(s.alert)
});
const safeBed = (b: ObservationBed): ObservationBed =>
  ({ bed_id: b.bed_id, label: b.label, active: b.active !== false, stay: b.stay ? safeStay(b.stay) : null });
const safeWaiting = (w: ObservationWaiting): ObservationWaiting =>
  ({ encounter_id: w.encounter_id, ticket: w.ticket ?? null, patient: safePatient(w.patient), called_at: w.called_at ?? null });

// O nome mostrado: o provisório nunca mostra o que o api mandar no lugar do nome.
const nameOf = (p: UrgencyPatientRef): string => (p.unidentified ? NO_IDENTIFICATION : p.name.trim() || NO_NAME);
const whoText = (ticket: string | null, p: UrgencyPatientRef): string => `${ticket ?? "sem senha"} · ${nameOf(p)}`;
const refOf = (ticket: string | null, p: UrgencyPatientRef): string => ticket ?? nameOf(p);

// Recusa que não passa sozinha: parar de pedir (lista fechada, como a fila).
const STOP_STATUSES = new Set([ 403, 404, 422 ]);
const stopsPolling = (err: unknown): boolean => err instanceof ApiError && STOP_STATUSES.has(err.status);

const cards: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12 };
const card: CSSProperties = { ...box, flex: "1 1 240px", minWidth: 0 };
const formBox: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--rule)" };

type Form = { kind: "enter" | "change"; bedId: string; seq: number };

// ─── O cartão do leito ──────────────────────────────────────────────────────
interface CardProps {
  bed: ObservationBed;
  roles: UrgencyRoles;
  busy: boolean;
  form: Form | null;
  freeBeds: ObservationBed[];
  waiting: ObservationWaiting[];
  problem: string | null;
  onOpen(kind: Form["kind"], bedId: string): void;
  onCancel(): void;
  onSubmit(encounterId: string, bedId: string): void;
  onEnd(stay: ObservationStayRef): Promise<void>;
  onMedication?(target: MedicationTarget): void;
}

function BedCard({ bed, roles, busy, form, freeBeds, waiting, problem, onOpen, onCancel, onSubmit, onEnd, onMedication }: CardProps) {
  const [ chosen, setChosen ] = useState("");
  const { stay } = bed;
  const mine = form && (stay ? form.kind === "change" && form.bedId === bed.bed_id : form.kind === "enter" && form.bedId === bed.bed_id) ? form : null;
  const lock = busy ? { "aria-disabled": true as const, style: disabledButtonStyle } : null;
  const primary = (on: () => void, label: string, aria?: string) => (
    <button type="button" aria-label={aria} {...(lock ?? { style: buttonStyle })} onClick={() => { if (!busy) on(); }}>{label}</button>
  );
  const secondary = (on: () => void, label: string, aria?: string) => (
    <button type="button" aria-label={aria} {...(lock ?? { style: secondaryButtonStyle })} onClick={() => { if (!busy) on(); }}>{label}</button>
  );
  const open = (kind: Form["kind"]) => { setChosen(""); onOpen(kind, bed.bed_id); };
  const alert = stay ? alertText(stay.alert) : null;
  const ref = stay ? refOf(stay.ticket, stay.patient) : "";

  return (
    <section aria-label={bed.label} style={card}>
      <p style={title}>{bed.label}</p>
      {!stay ? (
        <>
          <div style={row}><Tag tone="ok">livre</Tag></div>
          {roles.observation && bed.active && !mine && (
            <div style={row}>{primary(() => open("enter"), "Colocar em observação", `Colocar em observação no ${bed.label}`)}</div>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>{whoText(stay.ticket, stay.patient)}</p>
          {!stay.patient.unidentified && stay.patient.cns_masked && (
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{stay.patient.cns_masked}</span>
          )}
          <p style={muted}>{`Entrada ${fmtHourMinute(stay.started_at)}`}</p>
          <div style={row}>
            <Tag tone={alertTone(stay.alert) === "neutral" ? "info" : alertTone(stay.alert)}>{hoursText(stay.hours)}</Tag>
            {alert && <Tag tone={alertTone(stay.alert)}>{alert}</Tag>}
          </div>
          {(roles.observation || (roles.medication && onMedication)) && !mine && (
            <div style={row}>
              {roles.observation && secondary(() => open("change"), "Trocar de leito", `Trocar de leito de ${ref}`)}
              {roles.observation && <ConfirmButton label={`Encerrar observação de ${ref}`} question={END_QUESTION} onConfirm={() => onEnd(stay)} />}
              {roles.medication && onMedication && secondary(
                () => onMedication({ encounterId: stay.encounter_id, ticket: stay.ticket, patientName: nameOf(stay.patient) }),
                "Medicação", `Medicação de ${ref}`
              )}
            </div>
          )}
        </>
      )}
      {mine && (
        <form style={formBox} onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          const encounterId = stay ? stay.encounter_id : chosen;
          const bedId = stay ? chosen : bed.bed_id;
          if (encounterId && bedId) onSubmit(encounterId, bedId);
        }}>
          {stay ? (
            <label style={fieldLabel}>Novo leito
              <select style={inputStyle} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">Escolha o leito</option>
                {freeBeds.filter((b) => b.bed_id !== bed.bed_id).map((b) => <option key={b.bed_id} value={b.bed_id}>{b.label}</option>)}
              </select>
            </label>
          ) : waiting.length === 0 ? (
            <p style={muted}>{NO_WAITING_FOR_BED}</p>
          ) : (
            <label style={fieldLabel}>Paciente em atendimento
              <select style={inputStyle} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">Escolha o paciente</option>
                {waiting.map((w) => <option key={w.encounter_id} value={w.encounter_id}>{whoText(w.ticket, w.patient)}</option>)}
              </select>
            </label>
          )}
          {problem && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{problem}</p>}
          <div style={row}>
            <button type="submit" {...(lock ?? { style: buttonStyle })}>{stay ? "Confirmar troca" : "Confirmar entrada"}</button>
            <button type="button" {...(lock ?? { style: secondaryButtonStyle })} onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
          </div>
        </form>
      )}
    </section>
  );
}

// ─── O painel ───────────────────────────────────────────────────────────────
export const ObservationMap = forwardRef<ObservationMapHandle, ObservationMapProps>(function ObservationMap(
  { unit, roles, onMedication, now }, ref
) {
  const [ dismissed, setDismissed ] = useState<unknown>(null);
  const [ lastError, setLastError ] = useState<unknown>(null);
  const stopped = stopsPolling(lastError) && lastError !== dismissed;
  const polling = usePolling<UrgencyObservationMap>(
    roles.mapReader && !stopped ? () => getUrgencyObservation(unit.id) : null, URGENCY_OBSERVATION_POLL_MS, unit.id
  );
  // O erro da última leitura decide a parada na renderização seguinte (o fetcher depende dela); trocar de unidade zera o erro.
  if (polling.error !== lastError) setLastError(polling.error);
  const stoppedAt = useMemo(() => (stopped ? (now ?? new Date()).getTime() : null), [ stopped, polling.error ]);
  const refresh = () => { if (stopped) setDismissed(polling.error); else polling.refresh(); };
  useImperativeHandle(ref, () => ({ refresh }));

  const [ form, setForm ] = useState<Form | null>(null);
  const [ busy, setBusy ] = useState(false);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);

  const data = polling.data;
  const beds = (data?.beds ?? []).map(safeBed);
  const waiting = (data?.waiting_bed ?? []).map(safeWaiting);
  const active = beds.filter((b) => b.active);
  const inactive = beds.filter((b) => !b.active);
  const freeBeds = active.filter((b) => !b.stay);

  const closeForm = () => { seqRef.current += 1; setForm(null); setProblem(null); };
  const open = (kind: Form["kind"], bedId: string) => { seqRef.current += 1; setNotice(null); setProblem(null); setForm({ kind, bedId, seq: seqRef.current }); };

  // Um envio por vez (ref + estado). `onOk` é a frase de sucesso; a resposta de um formulário já fechado não fecha o de outro leito.
  async function write(run: () => Promise<unknown>, onOk: string, fromForm: boolean): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null); setProblem(null);
    const seq = seqRef.current;
    try {
      await run();
      setNotice(onOk);
      if (fromForm && seqRef.current === seq) closeForm();
      refresh();
    } catch (err) {
      const code = errorCode(err) ?? "";
      const text = urgencyError(err);
      if (MAP_CHANGED.has(code)) {
        setNotice(text);
        if (fromForm && seqRef.current === seq) closeForm();
        refresh();
      } else if (fromForm && seqRef.current === seq) setProblem(text);
      else setNotice(text);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  const submit = (encounterId: string, bedId: string) =>
    void write(() => startObservation(encounterId, bedId), form?.kind === "change" ? CHANGED : STARTED, true);
  const end = (stay: ObservationStayRef) => write(() => endObservation(stay.encounter_id), ENDED, false);

  const hhmm = (ms: number) => fmtHourMinute(new Date(ms).toISOString());
  const loading = data === undefined && !polling.error;
  const empty = data !== undefined && beds.length === 0;

  const renderCard = (b: ObservationBed) => (
    <BedCard key={b.bed_id} bed={b} roles={roles} busy={busy} form={form} freeBeds={freeBeds} waiting={waiting} problem={problem}
      onOpen={open} onCancel={closeForm} onSubmit={submit} onEnd={end} onMedication={onMedication} />
  );

  return (
    <Panel title="Observação" sub="um paciente por leito · horas desde a 1ª entrada · atualiza a cada 30 s">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
        {polling.error != null && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(polling.error)}</p>}
        {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{notice}</p>}
        {loading ? (
          <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
        ) : empty ? (
          <p style={muted}>{NO_UPA_BEDS}</p>
        ) : data !== undefined && (
          <>
            <div style={cards}>{active.map(renderCard)}</div>
            {inactive.length > 0 && (
              <section aria-label="Leitos inativos" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>Leitos inativos</h3>
                <div style={cards}>{inactive.map(renderCard)}</div>
              </section>
            )}
          </>
        )}
        <footer style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}>
          <span>{NO_CLINICAL_IN_MAP}</span>
          {stopped && stoppedAt !== null ? (
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{`parado às ${hhmm(stoppedAt)}`}</span>
              <button type="button" style={secondaryButtonStyle} onClick={refresh}>Tentar de novo</button>
            </span>
          ) : (
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>
              {`atualiza a cada ${URGENCY_OBSERVATION_POLL_MS / 1000} s${polling.updatedAt ? ` · ${hhmm(polling.updatedAt)}` : ""}`}
            </span>
          )}
        </footer>
      </div>
    </Panel>
  );
});
