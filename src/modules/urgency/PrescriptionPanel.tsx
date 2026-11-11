// Prescrição interna da urgência (módulo 32b, F-32.8; ADR 0050; api-shapes §2–§5): entre a consulta e o desfecho, o médico emite,
// altera e suspende. O detalhe do encontro traz só a versão ATIVA (ou null).
// - Alterar sempre cria uma versão nova (`POST …/prescriptions`); a anterior fica substituída. Os itens abrem com os da ativa e,
//   para manter a grade de horários, a primeira dose de cada item mantido é a próxima da grade ORIGINAL a partir de agora − 1 h
//   (keptFirstDoseAt, D18a). O `now` do envio é o do momento do clique, não o da abertura da tela.
// - A primeira dose digitada vai com o fuso do navegador (nunca sem offset). Controlado de qualquer lista é aceito (P1).
// - Suspender pede o motivo (10 a 500) e a confirmação; a suspensa não volta, prescreve-se de novo.
// - Nada clínico (medicamento, motivo, termo da busca) em URL, console ou armazenamento do navegador.
import { useRef, useState, type CSSProperties } from "react";
import {
  errorCode, issueUrgencyPrescription, suspendUrgencyPrescription, type HealthUnit, type UrgencyEncounter, type UrgencyPrescription,
  type UrgencyPrescriptionItem
} from "../../lib/api";
import { ROUTE_LABEL } from "../../lib/clinicalDocuments";
import { fmtDateTime, fmtHourMinute } from "../../lib/format";
import type { Problem } from "../../lib/pharmacy";
import { URGENCY_ERRORS, urgencyRefusals } from "../../lib/urgency";
import {
  MAX_ITEMS, emptyItemDraft, frequencyText, itemDraftFrom, keptFirstDoseAt, prescriptionBody, prescriptionProblems, reasonProblem, type ItemDraft
} from "../../lib/urgencyObservation";
import { ActionButton } from "../../components/ActionButton";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { PrescriptionItemFields, controlledText } from "./PrescriptionItemFields";

export const REVISION_NOTE = "Alterar sempre cria uma versão nova; a anterior fica registrada como está.";
export const SUSPEND_QUESTION = "A prescrição suspensa não volta; para retomar, prescreva de novo. Confirmar?";
export const NO_ACTIVE_PRESCRIPTION = "Sem prescrição ativa";
export const issuedNotice = (version: number): string => `Prescrição emitida (versão ${version}).`;
export const revisedNotice = (version: number): string => `Versão ${version} ativa; a versão ${version - 1} ficou substituída.`;
export const SUSPENDED_NOTICE = "Prescrição suspensa.";
export const UNNAMED_PRESCRIBER = "profissional sem nome registrado";

export interface PrescriptionPanelProps {
  encounter: UrgencyEncounter;
  unit: HealthUnit;
  consultationStarted: boolean;
  // Relê o detalhe do encontro (a mudança vale também quando o api diz que a ativa mudou).
  onChanged(): void;
  // Só o médico prescreve; o painel de atendimento já é do médico (padrão true).
  doctor?: boolean;
}

type Row = { key: number; draft: ItemDraft; original: UrgencyPrescriptionItem | null };

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
// "2026-11-10T15:00" (hora do navegador) → ISO com o fuso do navegador.
function withOffset(local: string): string {
  const t = local.trim();
  if (!LOCAL.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return `${t}:00${off >= 0 ? "+" : "-"}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

export function PrescriptionPanel({ encounter, unit, consultationStarted, onChanged, doctor = true }: PrescriptionPanelProps) {
  const active = encounter.prescription ?? null;
  const keys = useRef(0);
  const newRow = (draft: ItemDraft = emptyItemDraft(), original: UrgencyPrescriptionItem | null = null): Row => ({ key: keys.current++, draft, original });
  const [ rows, setRows ] = useState<Row[] | null>(null);
  const [ shown, setShown ] = useState<Problem[]>([]);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ suspending, setSuspending ] = useState(false);
  const [ reason, setReason ] = useState("");
  const [ suspendError, setSuspendError ] = useState<string | null>(null);
  const sending = useRef(false);

  const nextVersion = (active?.version ?? 0) + 1;
  const open = (from: UrgencyPrescription | null) => {
    setNotice(null); setShown([]); setSuspending(false);
    setRows(from ? from.items.map((it) => newRow(itemDraftFrom(it), it)) : [ newRow() ]);
  };
  const patchRow = (key: number, patch: Partial<ItemDraft>) => {
    setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, draft: { ...r.draft, ...patch } } : r)));
    setShown([]);
  };

  // A primeira dose de cada item no instante do envio: o item mantido e não mexido segue a grade original; o digitado leva o fuso.
  function drafts(now: Date): ItemDraft[] {
    return (rows ?? []).map(({ draft, original }) => {
      if (original && draft.firstDoseAt === original.first_dose_at) {
        const given = (encounter.administrations ?? []).some((a) => a.prescription_item_id === original.id && a.status === "administered");
        return { ...draft, firstDoseAt: keptFirstDoseAt(original, now, { given }) ?? "" };
      }
      return { ...draft, firstDoseAt: withOffset(draft.firstDoseAt) };
    });
  }

  async function submit() {
    if (!rows || sending.current) return;
    const now = new Date();
    const final = drafts(now);
    const problems = prescriptionProblems(final, now);
    if (problems.length > 0) { setShown(problems); return; }
    sending.current = true;
    setShown([]);
    try {
      const issued = await issueUrgencyPrescription(encounter.id, prescriptionBody(final));
      setRows(null);
      setNotice(issued.version > 1 ? revisedNotice(issued.version) : issuedNotice(issued.version));
      onChanged();
    } catch (err) {
      setShown(urgencyRefusals(err).map((r) => ({ path: r.path, text: r.text })));
      const code = errorCode(err);
      if (code === "prescription_not_active" || code === "encounter_closed") onChanged();
    } finally {
      sending.current = false;
    }
  }

  async function suspend() {
    if (!active) return;
    setSuspendError(null);
    try {
      await suspendUrgencyPrescription(active.id, reason.trim());
      setSuspending(false); setReason("");
      setNotice(SUSPENDED_NOTICE);
      onChanged();
    } catch (err) {
      setSuspendError(urgencyRefusals(err)[0]?.text ?? URGENCY_ERRORS.invalid_request);
      if (errorCode(err) === "prescription_not_active") onChanged();
    }
  }

  const itemProblems = (i: number) => shown.filter((p) => new RegExp(`^items\\.${i}(\\.|$)`).test(p.path)).map((p) => ({ ...p, text: /^item \d+:/.test(p.text) ? p.text : `item ${i + 1}: ${p.text}` }));
  const general = shown.filter((p) => !/^items\.\d+(\.|$)/.test(p.path));

  return (
    <section aria-label="Prescrição da urgência" style={section}>
      <h3 style={heading}>Prescrição</h3>
      {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{notice}</p>}

      {rows === null && (
        <>
          {active ? <ActiveView prescription={active} /> : <p style={muted}>{NO_ACTIVE_PRESCRIPTION}</p>}
          {!consultationStarted && <p style={muted}>{URGENCY_ERRORS.consultation_required}</p>}
          {doctor && consultationStarted && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {!active && <ActionButton onClick={() => open(null)}>Prescrever</ActionButton>}
              {active && <ActionButton variant="secondary" onClick={() => open(active)}>Alterar prescrição</ActionButton>}
              {active && !suspending && <ActionButton variant="secondary" onClick={() => { setSuspending(true); setSuspendError(null); }}>Suspender prescrição</ActionButton>}
            </div>
          )}
          {suspending && active && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={labelStyle}>
                Motivo da suspensão
                <textarea value={reason} rows={2} maxLength={500} style={inputStyle} onChange={(e) => { setReason(e.target.value); setSuspendError(null); }} />
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <ConfirmButton label="Suspender" question={SUSPEND_QUESTION} variant="danger"
                  disabledReason={reasonProblem(reason)} onConfirm={suspend} />
                <button type="button" style={secondaryButtonStyle} onClick={() => { setSuspending(false); setReason(""); setSuspendError(null); }}>Cancelar</button>
              </div>
              {suspendError && <p role="alert" style={alert}>{suspendError}</p>}
            </div>
          )}
        </>
      )}

      {rows !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r, i) => (
            <PrescriptionItemFields key={r.key} index={i} draft={r.draft} unitId={unit.id} problems={itemProblems(i)}
              onChange={(patch) => patchRow(r.key, patch)}
              onRemove={rows.length > 1 ? () => { setRows(rows.filter((x) => x.key !== r.key)); setShown([]); } : undefined} />
          ))}
          {rows.length < MAX_ITEMS && (
            <div><button type="button" style={secondaryButtonStyle} onClick={() => { setRows([ ...rows, newRow() ]); setShown([]); }}>Adicionar item</button></div>
          )}
          <p style={muted}>{REVISION_NOTE}</p>
          {general.length > 0 && (
            <ul aria-label="o que impede a prescrição" style={{ margin: 0, paddingLeft: 18 }}>
              {general.map((p) => <li key={`${p.path}-${p.text}`} role="alert" style={alert}>{p.text}</li>)}
            </ul>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton onClick={submit}>{active ? `Emitir versão ${nextVersion}` : "Emitir prescrição"}</ActionButton>
            <button type="button" style={secondaryButtonStyle} onClick={() => { setRows(null); setShown([]); }}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ActiveView({ prescription }: { prescription: UrgencyPrescription }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={muted}>
        Versão {prescription.version} ativa · prescrita por {prescription.prescribed_by.name ?? UNNAMED_PRESCRIBER} em {fmtDateTime(prescription.prescribed_at)}
      </p>
      <ul aria-label={`itens da versão ${prescription.version}`} style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {prescription.items.map((it) => {
          const marks = controlledText(it.controlled_list);
          return (
            <li key={it.id} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5 }}>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <strong>{it.catalog_item?.name ?? "medicamento fora do catálogo"}</strong>
                {it.controlled && marks && <Tag tone="warn" mono={false}>{marks}</Tag>}
              </span>
              <span>{it.dose} {it.dose_unit} · {Object.prototype.hasOwnProperty.call(ROUTE_LABEL, it.route) ? ROUTE_LABEL[it.route] : it.route} · {frequencyText(it.frequency)} · 1ª dose {fmtHourMinute(it.first_dose_at)}</span>
              {it.instructions && <span style={{ color: "var(--ink2)" }}>{it.instructions}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const section: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8 };
const heading: CSSProperties = { margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
