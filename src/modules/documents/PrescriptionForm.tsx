// Receita comum (módulo 19c; spec §5; contrato §2–§5). Médico e dentista
// buscam no catálogo (REMUME da unidade primeiro; controlado bloqueado — 19d)
// ou escrevem em texto livre. Enfermeiro prescreve só itens do protocolo
// municipal vigente (COFEN 801/2026), sem texto livre e até a dose máxima; o
// CNPJ da cidade e o Coren entram no documento pelo api. Antimicrobiano sai em
// papel, 2 vias, válido por 10 dias (o api decide; a tela avisa antes).
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { listNursingProtocols, type MedicationRoute, type PrescriptionInput } from "../../lib/api";
import {
  ANTIMICROBIAL_NOTE, NO_PROTOCOL, PROTOCOLS_KEY, ROUTES, ROUTE_LABEL, documentError, emptyItem, hasAntimicrobial, itemFromMedication,
  itemFromProtocolItem, prescriptionInput, prescriptionProblems, professionalKind, protocolLabel, vigentProtocols,
  type ItemDraft, type PrescriptionDraft
} from "../../lib/clinicalDocuments";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { MedicationSearch } from "./MedicationSearch";
import { alertStyle, checkLabel, formBox, labelStyle, mutedStyle, rowStyle } from "./formStyles";

interface Props {
  cboCode: string;
  unitId?: string;
  today: string;
  initial: PrescriptionDraft;
  onSubmit(content: PrescriptionInput): Promise<void>;
  onCancel(): void;
  busy?: boolean;
  searchDelayMs?: number;
  replacing?: boolean;
}

export function PrescriptionForm({ cboCode, unitId, today, initial, onSubmit, onCancel, busy: externalBusy = false, searchDelayMs, replacing }: Props) {
  const nurse = professionalKind(cboCode) === "nurse";
  const protocols = useQuery({ queryKey: [ PROTOCOLS_KEY ], queryFn: listNursingProtocols, enabled: nurse, retry: false });
  const [ d, setD ] = useState<PrescriptionDraft>(initial);
  const [ ownBusy, setOwnBusy ] = useState(false);
  const inFlight = useRef(false);
  const [ problems, setProblems ] = useState<string[]>([]);
  const busy = ownBusy || externalBusy;
  const vigent = vigentProtocols(protocols.data ?? [], today);
  const chosen = vigent.find((p) => p.current_version?.id === d.protocolVersionId) ?? null;
  const [ staleVersion, setStaleVersion ] = useState(false);
  // Reemissão (initial herdado): se a versão do protocolo do documento original
  // não está entre as vigentes, o select mostraria "escolha" mas enviaria o id
  // velho. Zera a versão e os itens dela, com aviso.
  const vigentIds = vigent.map((p) => p.current_version?.id).join(",");
  useEffect(() => {
    if (!nurse || !protocols.isSuccess || !d.protocolVersionId) return;
    if (vigentIds.split(",").includes(d.protocolVersionId)) return;
    setD({ items: [], protocolVersionId: "" });
    setStaleVersion(true);
  }, [ nurse, protocols.isSuccess, vigentIds, d.protocolVersionId ]);

  const addItem = (item: ItemDraft) => setD((prev) => ({ ...prev, items: [ ...prev.items, item ] }));
  const setItem = (key: string, patch: Partial<ItemDraft>) =>
    setD((prev) => ({ ...prev, items: prev.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const removeItem = (key: string) => setD((prev) => ({ ...prev, items: prev.items.filter((it) => it.key !== key) }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || externalBusy) return;
    const found = prescriptionProblems(d, nurse);
    if (found.length > 0) { setProblems(found); return; }
    inFlight.current = true;
    setOwnBusy(true); setProblems([]);
    try {
      await onSubmit(prescriptionInput(d));
    } catch (err) {
      setProblems([ documentError(err) ]);
    } finally {
      inFlight.current = false;
      setOwnBusy(false);
    }
  }

  return (
    <form aria-label="Receita" onSubmit={(e) => void submit(e)} style={formBox}>
      <strong>Receita</strong>
      {replacing && <p style={mutedStyle}>Substitui o documento cancelado.</p>}

      {nurse ? (
        <>
          {protocols.isPending && <p className="mono" style={mutedStyle}>carregando os protocolos…</p>}
          {protocols.isError && <p role="alert" style={alertStyle}>{documentError(protocols.error)}</p>}
          {protocols.isSuccess && vigent.length === 0 && <p role="alert" style={alertStyle}>{NO_PROTOCOL}</p>}
          {staleVersion && <p role="status" style={mutedStyle}>a versão do protocolo do documento anterior não está mais vigente — escolha o protocolo e os itens de novo</p>}
          {vigent.length > 0 && (
            <label style={labelStyle}>
              Protocolo de enfermagem
              <select value={d.protocolVersionId} style={inputStyle}
                onChange={(e) => { setStaleVersion(false); setD({ items: [], protocolVersionId: e.target.value }); }}>
                <option value="">escolha</option>
                {vigent.map((p) => <option key={p.id} value={p.current_version!.id}>{protocolLabel(p)}</option>)}
              </select>
            </label>
          )}
          {chosen && (
            <ul aria-label="itens do protocolo" style={list}>
              {chosen.current_version!.items.map((pi) => (
                <li key={pi.catalog_item.id}>
                  <button type="button" style={{ ...secondaryButtonStyle, width: "100%", textAlign: "left" }}
                    aria-label={`Incluir ${pi.catalog_item.label}`} onClick={() => addItem(itemFromProtocolItem(pi))}>
                    {`${pi.catalog_item.label}${pi.max_dose ? ` · até ${pi.max_dose.quantity} ${pi.max_dose.unit}` : ""}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <MedicationSearch label="Buscar medicamento" unitId={unitId} blockControlled delayMs={searchDelayMs}
            onPick={(m) => addItem(itemFromMedication(m))} />
          <div>
            <button type="button" style={secondaryButtonStyle} onClick={() => addItem(emptyItem())}>Incluir em texto livre</button>
          </div>
        </>
      )}

      {hasAntimicrobial(d) && <p role="note" style={{ ...mutedStyle, fontWeight: 600, color: "var(--warn)" }}>{ANTIMICROBIAL_NOTE}</p>}

      {d.items.length === 0 ? <p style={mutedStyle}>nenhum medicamento na receita</p> : (
        <ol aria-label="itens da receita" style={{ ...list, gap: 10 }}>
          {d.items.map((it, i) => (
            <ItemFields key={it.key} index={i} item={it} onChange={(patch) => setItem(it.key, patch)} onRemove={() => removeItem(it.key)} />
          ))}
        </ol>
      )}

      {problems.length > 0 && (
        <ul role="alert" style={{ ...alertStyle, paddingLeft: 18 }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Emitir receita</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function ItemFields({ index, item, onChange, onRemove }: {
  index: number; item: ItemDraft; onChange(patch: Partial<ItemDraft>): void; onRemove(): void;
}) {
  const n = index + 1;
  return (
    <li aria-label={`item ${n}`} style={itemBox}>
      <div style={rowStyle}>
        {item.medication ? <strong style={{ fontSize: 12.5 }}>{item.medication.label}</strong> : (
          <label style={{ ...labelStyle, flex: 1 }}>
            {`Medicamento ${n} (texto livre)`}
            <input value={item.freeText} style={inputStyle} onChange={(e) => onChange({ freeText: e.target.value })} />
          </label>
        )}
        {item.medication?.in_network && <Tag tone="ok" mono={false}>na rede</Tag>}
        {item.medication?.antimicrobial && <Tag tone="warn" mono={false}>antimicrobiano</Tag>}
        {item.medication?.max_dose && <span style={mutedStyle}>{`protocolo: até ${item.medication.max_dose.quantity} ${item.medication.max_dose.unit}`}</span>}
        <button type="button" aria-label={`Remover item ${n}`} style={secondaryButtonStyle} onClick={onRemove}>Remover</button>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>
          {`Quantidade ${n}`}
          <input inputMode="decimal" value={item.quantity} style={inputStyle} onChange={(e) => onChange({ quantity: e.target.value })} />
        </label>
        <label style={labelStyle}>
          {`Unidade ${n}`}
          <input value={item.quantityUnit} style={inputStyle} onChange={(e) => onChange({ quantityUnit: e.target.value })} />
        </label>
        <label style={labelStyle}>
          {`Via ${n}`}
          <select value={item.route} style={inputStyle} onChange={(e) => onChange({ route: e.target.value as MedicationRoute | "" })}>
            <option value="">escolha</option>
            {ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r]}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          {`Duração em dias ${n}`}
          <input inputMode="numeric" value={item.durationDays} style={inputStyle} onChange={(e) => onChange({ durationDays: e.target.value })} />
        </label>
      </div>
      <label style={labelStyle}>
        {`Posologia ${n}`}
        <textarea value={item.dosage} rows={2} style={inputStyle} onChange={(e) => onChange({ dosage: e.target.value })} />
      </label>
      <label style={checkLabel}>
        <input type="checkbox" checked={item.continuous} onChange={(e) => onChange({ continuous: e.target.checked })} />
        {`Uso contínuo ${n}`}
      </label>
    </li>
  );
}

const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 };
const itemBox: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 10, border: "1px solid var(--rule)", borderRadius: 6 };
