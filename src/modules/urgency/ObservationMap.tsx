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
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ApiError, endObservation, errorCode, getUrgencyObservation, startObservation,
  type ObservationAlert, type ObservationBed, type ObservationStayRef, type ObservationWaiting, type HealthUnit,
  type UrgencyObservationMap, type UrgencyPatientRef
} from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import {
  NO_CLINICAL_IN_MAP, NO_UPA_BEDS, URGENCY_OBSERVATION_POLL_MS, alertText, alertTone, hoursText
} from "../../lib/urgencyObservation";
import { URGENCY_ERRORS, urgencyError, type UrgencyRoles } from "../../lib/urgency";
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
export const MAP_STALE = "o mapa foi atualizado — confira o leito";
export const END_QUESTION = "O paciente volta ao atendimento, sem leito. Confirmar?";
const STARTED = "Paciente em observação.";
const CHANGED = "Leito trocado.";
const ENDED = "Observação encerrada.";
// A recusa que mostra que o mapa já mudou: relê na hora e fecha o formulário.
const MAP_CHANGED = new Set([ "bed_taken", "bed_unavailable", "not_in_care", "not_in_observation", "encounter_closed", "already_closed" ]);
// 422 invalid_request com path bed_id: o leito já não existe ou mudou de unidade, o mesmo que bed_unavailable.
const bedPathRefusal = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 422 && errorCode(err) === "invalid_request"
  && (err.body as { path?: unknown } | null)?.path === "bed_id";

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

// `stayId`/`encounterId` (troca): a estadia que estava no leito quando o formulário abriu. O mesmo POST faz a entrada e a troca,
// então um encontro velho moveria um paciente de verdade: a troca só segue se o leito ainda tem ESTA estadia.
type Form = { kind: "enter" | "change"; bedId: string; seq: number; stayId: string | null; encounterId: string | null; chosen: string };

// ─── O cartão do leito ──────────────────────────────────────────────────────
interface CardProps {
  bed: ObservationBed;
  roles: UrgencyRoles;
  busy: boolean;
  form: Form | null;
  freeBeds: ObservationBed[];
  waiting: ObservationWaiting[];
  problem: string | null;
  onOpen(kind: Form["kind"], bed: ObservationBed): void;
  onChoose(value: string): void;
  onCancel(): void;
  onSubmit(chosen: string): void;
  onEnd(stay: ObservationStayRef): Promise<void>;
  onMedication?(target: MedicationTarget): void;
}

function BedCard({ bed, roles, busy, form, freeBeds, waiting, problem, onOpen, onChoose, onCancel, onSubmit, onEnd, onMedication }: CardProps) {
  const { stay } = bed;
  const mine = form && (stay ? form.kind === "change" && form.bedId === bed.bed_id : form.kind === "enter" && form.bedId === bed.bed_id) ? form : null;
  const lock = busy ? { "aria-disabled": true as const, style: disabledButtonStyle } : null;
  const primary = (on: () => void, label: string, aria?: string) => (
    <button type="button" aria-label={aria} {...(lock ?? { style: buttonStyle })} onClick={() => { if (!busy) on(); }}>{label}</button>
  );
  const secondary = (on: () => void, label: string, aria?: string) => (
    <button type="button" aria-label={aria} {...(lock ?? { style: secondaryButtonStyle })} onClick={() => { if (!busy) on(); }}>{label}</button>
  );
  const open = (kind: Form["kind"]) => onOpen(kind, bed);
  const chosen = mine?.chosen ?? "";
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const enterRef = useRef<HTMLSpanElement>(null);
  const changeRef = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);
  const kind = mine?.kind;
  // Foco: abre dentro do campo; ao fechar, volta ao botão que abriu (ou ao título, se o botão já não existe).
  useEffect(() => {
    if (mine) selectRef.current?.focus();
    else if (wasOpen.current) {
      const at = document.activeElement;
      if (!at || at === document.body || sectionRef.current?.contains(at)) {
        const trigger = (stay ? changeRef : enterRef).current?.querySelector<HTMLButtonElement>("button");
        (trigger ?? headingRef.current)?.focus();
      }
    }
    wasOpen.current = !!mine;
  }, [ kind, mine !== null ]);
  const alert = stay ? alertText(stay.alert) : null;
  const ref = stay ? refOf(stay.ticket, stay.patient) : "";

  return (
    <section ref={sectionRef} aria-label={bed.label} style={card}>
      <p ref={headingRef} tabIndex={-1} style={title}>{bed.label}</p>
      {!stay ? (
        <>
          <div style={row}><Tag tone="ok">livre</Tag></div>
          {roles.observation && bed.active && !mine && (
            <div style={row}><span ref={enterRef}>{primary(() => open("enter"), "Colocar em observação", `Colocar em observação no ${bed.label}`)}</span></div>
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
              {roles.observation && <span ref={changeRef}>{secondary(() => open("change"), "Trocar de leito", `Trocar de leito de ${ref}`)}</span>}
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
          if (chosen) onSubmit(chosen);
        }}>
          {stay ? (
            <label style={fieldLabel}>Novo leito
              <select ref={selectRef} style={inputStyle} value={chosen} onChange={(e) => onChoose(e.target.value)}>
                <option value="">Escolha o leito</option>
                {freeBeds.filter((b) => b.bed_id !== bed.bed_id).map((b) => <option key={b.bed_id} value={b.bed_id}>{b.label}</option>)}
              </select>
            </label>
          ) : waiting.length === 0 ? (
            <p style={muted}>{NO_WAITING_FOR_BED}</p>
          ) : (
            <label style={fieldLabel}>Paciente em atendimento
              <select ref={selectRef} style={inputStyle} value={chosen} onChange={(e) => onChoose(e.target.value)}>
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
  const open = (kind: Form["kind"], bed: ObservationBed) => {
    seqRef.current += 1; setNotice(null); setProblem(null);
    setForm({ kind, bedId: bed.bed_id, seq: seqRef.current, stayId: bed.stay?.stay_id ?? null, encounterId: bed.stay?.encounter_id ?? null, chosen: "" });
  };
  const choose = (chosen: string) => setForm((f) => (f ? { ...f, chosen } : f));

  // O mapa mais recente (a conferência do envio lê daqui, não da renderização que abriu o formulário).
  const latest = useRef<{ beds: ObservationBed[]; waiting: ObservationWaiting[] }>({ beds: [], waiting: [] });
  latest.current = { beds, waiting };
  // Cada leitura confere o formulário aberto: o leito sumiu, ficou ocupado (entrada) ou trocou de estadia (troca) → fecha e avisa;
  // a seleção de quem saiu de "sem leito" cai.
  useEffect(() => {
    if (!form || data === undefined) return;
    const b = beds.find((x) => x.bed_id === form.bedId);
    const stale = !b || (form.kind === "change" ? !b.stay || b.stay.stay_id !== form.stayId : !b.active || !!b.stay);
    if (stale) { closeForm(); setNotice(MAP_STALE); return; }
    if (form.kind === "enter" && form.chosen && !waiting.some((w) => w.encounter_id === form.chosen)) choose("");
  }, [ data ]);

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
      if (MAP_CHANGED.has(code) || bedPathRefusal(err)) {
        setNotice(bedPathRefusal(err) ? URGENCY_ERRORS.bed_unavailable : text);
        if (fromForm && seqRef.current === seq) closeForm();
        refresh();
      } else if (fromForm && seqRef.current === seq) setProblem(text);
      else setNotice(text);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  // Reconfere no mapa mais recente antes de enviar: o mesmo POST faz a entrada e a troca, e um id velho moveria outro paciente.
  const submit = (chosen: string) => {
    if (!form || busyRef.current) return;
    const { beds: nowBeds, waiting: nowWaiting } = latest.current;
    const here = nowBeds.find((x) => x.bed_id === form.bedId);
    const stale = (): void => { closeForm(); setNotice(MAP_STALE); };
    if (form.kind === "change") {
      const target = nowBeds.find((x) => x.bed_id === chosen);
      if (!here?.stay || here.stay.stay_id !== form.stayId || !form.encounterId) return stale();
      if (!target || !target.active || target.stay) { choose(""); setNotice(MAP_STALE); return; }
      void write(() => startObservation(form.encounterId as string, chosen), CHANGED, true);
      return;
    }
    if (!here || !here.active || here.stay) return stale();
    if (!nowWaiting.some((w) => w.encounter_id === chosen)) { choose(""); setNotice(MAP_STALE); return; }
    void write(() => startObservation(chosen, form.bedId), STARTED, true);
  };
  const end = (stay: ObservationStayRef) => write(() => endObservation(stay.encounter_id), ENDED, false);

  const hhmm = (ms: number) => fmtHourMinute(new Date(ms).toISOString());
  const loading = data === undefined && !polling.error;
  const empty = data !== undefined && beds.length === 0;

  const renderCard = (b: ObservationBed) => (
    <BedCard key={b.bed_id} bed={b} roles={roles} busy={busy} form={form} freeBeds={freeBeds} waiting={waiting} problem={problem}
      onOpen={open} onChoose={choose} onCancel={closeForm} onSubmit={submit} onEnd={end} onMedication={onMedication} />
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
