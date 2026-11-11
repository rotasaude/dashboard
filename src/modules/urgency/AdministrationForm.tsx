// Checagem de uma dose (módulo 32b, F-32.8; api-shapes §3–§5): administrado, não administrado ou recusado. A checagem não se altera
// depois de registrada, por isso a confirmação é forte e o clique repetido não envia duas vezes.
// - Estoque (lote e quantidade) só com `stockDeduction` (o interruptor UTILIZÁVEL agora) e "Administrado"; o lote vem pré-escolhido
//   pelo FEFO (o 1º do aprazamento) e só o que a pessoa mudou vai no corpo. Falta de saldo não é erro: a resposta traz `shortfall`.
// - Horários: `scheduled_at` é o do aprazamento, ao pé da letra; `administered_at` (opcional) vai com o fuso do navegador.
// - slot_taken, slot_invalid, prescription_not_active, lot_invalid, max_per_day_reached e stock_deduction_disabled mandam reler o
//   aprazamento (`onStale`) e mantêm o que foi digitado; encounter_closed sobe.
// - Nada clínico (motivo, medicamento) em URL, console ou armazenamento do navegador.
import { useId, useRef, useState, type CSSProperties } from "react";
import {
  errorCode, recordAdministration, type AdministrationStatus, type ScheduleItem, type UrgencyAdministrationResult
} from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { URGENCY_ERRORS, urgencyRefusals } from "../../lib/urgency";
import {
  administrationBody, administrationProblems, type AdministrationContext, type AdministrationDraft
} from "../../lib/urgencyObservation";
import { ConfirmButton } from "../../components/ConfirmButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { withOffset } from "./PrescriptionPanel";

export const STATUS_CHOICES: { value: AdministrationStatus; label: string }[] = [
  { value: "administered", label: "Administrado" }, { value: "not_administered", label: "Não administrado" }, { value: "refused", label: "Recusado" }
];
export const CHECK_IMMUTABLE_QUESTION = "A checagem não pode ser alterada. Confirmar?";
export const CHOOSE_STATUS = "escolha a situação da dose";
export const FEFO_NOTE = "o lote sai pelo que vence primeiro, no estoque da UPA";
// Recusas que mudam o que a tela sabe: a tela relê e mostra a frase.
const STALE = new Set([ "slot_taken", "slot_invalid", "prescription_not_active", "lot_invalid", "max_per_day_reached", "stock_deduction_disabled" ]);

export const expiryText = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export interface AdministrationFormProps {
  item: ScheduleItem;
  // O horário do aprazamento a checar; null em "se necessário".
  slot: string | null;
  stockDeduction: boolean;
  now: Date;
  onRecorded(r: UrgencyAdministrationResult): void;
  // Recusa que pede releitura; `text` é a frase para a tela.
  onStale(text: string): void;
  onCancel(): void;
  onEncounterClosed?(): void;
}

export function AdministrationForm({ item, slot, stockDeduction, now, onRecorded, onStale, onCancel, onEncounterClosed }: AdministrationFormProps) {
  const lots = item.lots ?? [];
  const defaultLotId = lots[0]?.id ?? "";
  const [ status, setStatus ] = useState<AdministrationStatus | "">("");
  const [ reason, setReason ] = useState("");
  const [ lotId, setLotId ] = useState(defaultLotId);
  const [ quantity, setQuantity ] = useState(item.stock_quantity_per_dose);
  const [ administeredAt, setAdministeredAt ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const sending = useRef(false);
  const hintId = useId();
  // Depois de uma releitura o lote escolhido pode ter saído da lista: volta ao primeiro.
  const effectiveLot = lots.some((l) => l.id === lotId) ? lotId : defaultLotId;
  const label = item.catalog_item?.name ?? "medicamento fora do catálogo";
  const target = { itemId: item.item_id, kind: item.frequency.kind, slot };
  // `prescribed_at` não vem no aprazamento: o api confere o limite de baixo.
  const context = (at: Date): AdministrationContext =>
    ({ stockDeduction, defaultLotId, defaultQuantity: item.stock_quantity_per_dose, now: at, prescribedAt: "" });
  const draft = (): AdministrationDraft => ({
    status: status || "administered", reason, lotId: effectiveLot, quantity, administeredAt: withOffset(administeredAt)
  });
  const problems = status === "" ? [] : administrationProblems(draft(), context(now), target);
  const blocked = status === "" ? CHOOSE_STATUS : (problems[0]?.text ?? null);
  const showStock = stockDeduction && status === "administered";
  const mark = (patch: () => void) => { patch(); setError(null); };

  async function send() {
    if (status === "" || sending.current) return;
    const at = new Date();
    const d = draft();
    const found = administrationProblems(d, context(at), target);
    if (found.length > 0) { setError(found[0].text); return; }
    sending.current = true;
    setError(null);
    try {
      onRecorded(await recordAdministration(administrationBody(d, context(at), target)));
    } catch (err) {
      const code = errorCode(err);
      if (code === "encounter_closed") { onEncounterClosed?.(); return; }
      const text = urgencyRefusals(err)[0]?.text ?? URGENCY_ERRORS.invalid_request;
      if (STALE.has(code ?? "")) onStale(text);
      else setError(text);
    } finally {
      sending.current = false;
    }
  }

  return (
    <div role="group" aria-label={slot ? `Checagem das ${fmtHourMinute(slot)}` : "Registro de dose"} style={box}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>
        {slot ? `Checando ${label} das ${fmtHourMinute(slot)}` : `Registrando dose de ${label}`}
      </p>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 12 }}>
        <legend style={{ fontSize: 12, color: "var(--ink2)", padding: 0, marginBottom: 4 }}>Situação</legend>
        {STATUS_CHOICES.map((c) => (
          <label key={c.value} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5 }}>
            <input type="radio" name={`status-${item.item_id}`} checked={status === c.value}
              onChange={() => mark(() => setStatus(c.value))} />
            {c.label}
          </label>
        ))}
      </fieldset>
      {status !== "" && status !== "administered" && (
        <label style={labelStyle}>
          Motivo
          <textarea value={reason} rows={2} maxLength={500} style={inputStyle} onChange={(e) => mark(() => setReason(e.target.value))} />
        </label>
      )}
      {status === "administered" && (
        <label style={labelStyle}>
          Horário da administração
          <input type="datetime-local" value={administeredAt} style={inputStyle} aria-describedby={`${hintId}`} onChange={(e) => mark(() => setAdministeredAt(e.target.value))} />
        </label>
      )}
      {status === "administered" && (
        <span id={hintId} style={muted}>horário em branco: vale o momento do registro; não pode passar de 5 minutos à frente</span>
      )}
      {showStock && (
        <>
          {lots.length > 0 ? (
            <label style={labelStyle}>
              Lote
              <select value={effectiveLot} style={inputStyle} onChange={(e) => mark(() => setLotId(e.target.value))}>
                {lots.map((l, i) => (
                  <option key={l.id} value={l.id}>{`${l.lot_number} · vence ${expiryText(l.expires_on)}${i === 0 ? " (o que vence primeiro)" : ""}`}</option>
                ))}
              </select>
            </label>
          ) : <p style={muted}>{FEFO_NOTE}</p>}
          <label style={labelStyle}>
            {`Quantidade (${item.stock_unit})`}
            <input value={quantity} inputMode="decimal" style={inputStyle} onChange={(e) => mark(() => setQuantity(e.target.value))} />
          </label>
        </>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>
        <ConfirmButton label="Registrar checagem" question={CHECK_IMMUTABLE_QUESTION} disabledReason={blocked} onConfirm={send} />
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--down)" }}>{error}</p>}
    </div>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8, background: "var(--sunken)" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
