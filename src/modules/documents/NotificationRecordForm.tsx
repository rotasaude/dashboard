// src/modules/documents/NotificationRecordForm.tsx
// Registro da Notificação de receita de papel (módulo 19d, F-19.28; spec §5;
// contrato §3): o médico ou dentista preenche a Notificação A/B/B2 no talão da
// VISA e registra aqui o número, a UF da numeração e o medicamento (uma
// substância das listas A ou B). Não gera PDF nem assinatura; entra na lista de
// medicamentos em uso. O api confere tipo × lista e a duração.
import { useRef, useState, type FormEvent } from "react";
import type { MedicationRoute, MedicationSearchItem, NotificationRecordInput, NotificationType } from "../../lib/api";
import { ROUTES, ROUTE_LABEL, documentError } from "../../lib/clinicalDocuments";
import {
  NOTIFICATION_NOTE, NOTIFICATION_TYPE_LABEL, UFS, emptyNotification, notificationInput, notificationProblems, notificationTypeFor,
  type NotificationDraft
} from "../../lib/controlled";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { MedicationSearch } from "./MedicationSearch";
import { alertStyle, formBox, labelStyle, mutedStyle, rowStyle } from "./formStyles";

const TYPES: NotificationType[] = [ "A", "B", "B2" ];
const NOT_NOTIFICATION = "não é de Notificação (listas A/B)";
const onlyNotificationLists = (item: MedicationSearchItem) => (notificationTypeFor(item.controlled_list) ? null : NOT_NOTIFICATION);

interface Props {
  unitId?: string;
  defaultUf: string;
  onSubmit(content: NotificationRecordInput): Promise<void>;
  onCancel(): void;
  searchDelayMs?: number;
  busy?: boolean;
}

export function NotificationRecordForm({ unitId, defaultUf, onSubmit, onCancel, searchDelayMs, busy: externalBusy = false }: Props) {
  const [ d, setD ] = useState<NotificationDraft>(() => emptyNotification(defaultUf));
  const [ ownBusy, setOwnBusy ] = useState(false);
  const inFlight = useRef(false);
  const [ problems, setProblems ] = useState<string[]>([]);
  const busy = ownBusy || externalBusy;
  const set = (patch: Partial<NotificationDraft>) => setD((prev) => ({ ...prev, ...patch }));

  function pick(m: MedicationSearchItem) {
    setD((prev) => ({
      ...prev, medication: m, type: prev.type || (notificationTypeFor(m.controlled_list) ?? ""),
      quantityUnit: prev.quantityUnit || (m.dosage_form ?? "")
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || externalBusy) return;
    const found = notificationProblems(d);
    if (found.length > 0) { setProblems(found); return; }
    inFlight.current = true;
    setOwnBusy(true); setProblems([]);
    try {
      await onSubmit(notificationInput(d));
    } catch (err) {
      setProblems([ documentError(err) ]);
    } finally {
      inFlight.current = false;
      setOwnBusy(false);
    }
  }

  return (
    <form aria-label="Notificação de papel" onSubmit={(e) => void submit(e)} style={formBox}>
      <strong>Notificação de receita (papel)</strong>
      <p role="note" style={mutedStyle}>{NOTIFICATION_NOTE}</p>
      <div style={rowStyle}>
        <label style={labelStyle}>
          Tipo da Notificação
          <select value={d.type} style={inputStyle} onChange={(e) => set({ type: e.target.value as NotificationType | "" })}>
            <option value="">escolha</option>
            {TYPES.map((t) => <option key={t} value={t}>{NOTIFICATION_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          Número do talão
          <input value={d.paperNumber} style={inputStyle} onChange={(e) => set({ paperNumber: e.target.value })} />
        </label>
        <label style={labelStyle}>
          UF da numeração
          <select value={d.numberingUf} style={inputStyle} onChange={(e) => set({ numberingUf: e.target.value })}>
            <option value="">escolha</option>
            {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </label>
      </div>

      {d.medication ? (
        <div style={rowStyle}>
          <strong style={{ fontSize: 12.5 }}>{d.medication.label}</strong>
          {d.medication.controlled_list && <Tag tone="warn" mono={false}>{`lista ${d.medication.controlled_list}`}</Tag>}
          <button type="button" style={secondaryButtonStyle} onClick={() => set({ medication: null })}>Trocar medicamento</button>
        </div>
      ) : (
        <MedicationSearch label="Buscar medicamento (listas A e B)" unitId={unitId} blockControlled={false}
          blockReason={onlyNotificationLists} delayMs={searchDelayMs} onPick={pick} />
      )}

      <div style={rowStyle}>
        <label style={labelStyle}>
          Quantidade
          <input inputMode="decimal" value={d.quantity} style={inputStyle} onChange={(e) => set({ quantity: e.target.value })} />
        </label>
        <label style={labelStyle}>
          Unidade
          <input value={d.quantityUnit} style={inputStyle} onChange={(e) => set({ quantityUnit: e.target.value })} />
        </label>
        <label style={labelStyle}>
          Via
          <select value={d.route} style={inputStyle} onChange={(e) => set({ route: e.target.value as MedicationRoute | "" })}>
            <option value="">escolha</option>
            {ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r]}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          Duração em dias
          <input inputMode="numeric" value={d.durationDays} style={inputStyle} onChange={(e) => set({ durationDays: e.target.value })} />
        </label>
      </div>
      <label style={labelStyle}>
        Posologia
        <textarea value={d.dosage} rows={2} style={inputStyle} onChange={(e) => set({ dosage: e.target.value })} />
      </label>

      {problems.length > 0 && (
        <ul role="alert" style={{ ...alertStyle, paddingLeft: 18 }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Registrar Notificação</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
